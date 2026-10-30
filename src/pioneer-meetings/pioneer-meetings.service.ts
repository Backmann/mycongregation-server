import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { PioneerMeeting } from '../entities/pioneer-meeting.entity';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { Publisher } from '../entities/publisher.entity';
import { Absence } from '../entities/absence.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { Congregation } from '../entities/congregation.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { CongregationClock } from '../common/congregation-clock.service';
import {
  DEFAULT_CONGREGATION_TIMEZONE,
  todayIn,
} from '../common/congregation-clock';
import { refusal } from '../common/errors/refusal';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import {
  HM,
  inSeason,
  invitedOn,
  seasonOf,
  serviceYearOfDay,
  type MeetingWarning,
} from './pioneer-meeting-rules';
import { meetingText, type MeetingNews } from './pioneer-meeting-messages';

export interface PioneerMeetingInput {
  date: string;
  timeStart?: string | null;
  timeEnd?: string | null;
  place?: string | null;
  conductorPublisherId: string;
  note?: string | null;
}

export interface PioneerMeetingView {
  id: string;
  date: string;
  timeStart: string | null;
  timeEnd: string | null;
  place: string | null;
  note: string | null;
  serviceYear: number;
  conductor: { id: string; name: string };
  invitedCount: number;
}

/** A meeting as Home shows it to the invited and the conductor. */
export interface HomeMeeting {
  id: string;
  date: string;
  timeStart: string | null;
  timeEnd: string | null;
  place: string | null;
  role: 'conduct' | 'invited';
  conductorName: string;
}

export interface PioneerMeetingDetail extends PioneerMeetingView {
  /** Those pioneering on its day; for the conductor and the elders. */
  invited: { id: string; name: string; kind: string; away: boolean }[];
  warnings: MeetingWarning[];
  canManage: boolean;
}

/** The tasks of the body that these replace: who decides who conducts. */
const TASK_KIND = 'pioneer_meeting' as const;
/** The task appears on 1 November and is due on the 30th. */
const TASK_MONTH = 11;

const nameOf = (p: Pick<Publisher, 'firstName' | 'lastName'>) =>
  [p.lastName, p.firstName].filter(Boolean).join(' ').trim();

/**
 * THE ANNUAL MEETING OF THE ELDERS WITH THE PIONEERS (S-211; Lionel, 30
 * October 2026). Kept, shown and announced only to those it concerns: the
 * pioneers of its day, the elder who conducts it, and the elders.
 */
@Injectable()
export class PioneerMeetingsService {
  private readonly logger = new Logger(PioneerMeetingsService.name);

  constructor(
    @InjectRepository(PioneerMeeting)
    private readonly meetings: Repository<PioneerMeeting>,
    @InjectRepository(PioneerSpell)
    private readonly spells: Repository<PioneerSpell>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Absence)
    private readonly absences: Repository<Absence>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(ElderTaskCalendarLog)
    private readonly taskLog: Repository<ElderTaskCalendarLog>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly clock: CongregationClock,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogService,
  ) {}

  // ---- who may ------------------------------------------------------------

  /**
   * Who arranges it (Lionel, 30 October 2026): the administrators, the
   * coordinator of the body of elders and the service overseer.
   */
  async canManage(tenantId: string, user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilities.count({
      where: {
        congregationId: tenantId,
        userId: user.id,
        type: In([
          ResponsibilityType.BODY_COORDINATOR,
          ResponsibilityType.SERVICE_OVERSEER,
        ]),
      },
    });
    return held > 0;
  }

  private async assertManage(tenantId: string, user: AuthenticatedUser) {
    if (!(await this.canManage(tenantId, user))) {
      throw new ForbiddenException(
        refusal(
          'NEEDS_RESPONSIBILITY',
          'Requires responsibility: body_coordinator or service_overseer',
          { responsibilities: ['body_coordinator', 'service_overseer'] },
        ),
      );
    }
  }

  private isElder(user: AuthenticatedUser): boolean {
    return user.role === UserRole.ADMIN || user.role === UserRole.ELDER;
  }

  // ---- reading -------------------------------------------------------------

  private async spellsOf(tenantId: string): Promise<PioneerSpell[]> {
    return this.spells.find({ where: { congregationId: tenantId } });
  }

  private view(
    m: PioneerMeeting,
    conductor: Publisher | undefined,
    invitedCount: number,
  ): PioneerMeetingView {
    return {
      id: m.id,
      date: String(m.date).slice(0, 10),
      timeStart: m.timeStart,
      timeEnd: m.timeEnd,
      place: m.place,
      note: m.note,
      serviceYear: serviceYearOfDay(String(m.date)),
      conductor: {
        id: m.conductorPublisherId,
        name: conductor ? nameOf(conductor) : '',
      },
      invitedCount,
    };
  }

  /** Every meeting, newest first — the elders' list and its history. */
  async list(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<{ canManage: boolean; meetings: PioneerMeetingView[] }> {
    if (!this.isElder(user)) {
      throw new ForbiddenException(
        refusal(
          'NEEDS_ROLE',
          'Only elders see the meetings with the pioneers.',
          {
            roles: ['admin', 'elder'],
          },
        ),
      );
    }
    const rows = await this.meetings.find({
      where: { congregationId: tenantId },
      order: { date: 'DESC' },
    });
    const cards = rows.length
      ? await this.publishers.find({
          where: {
            congregationId: tenantId,
            id: In(rows.map((r) => r.conductorPublisherId)),
          },
          withDeleted: true,
        })
      : [];
    const spells = await this.spellsOf(tenantId);
    return {
      canManage: await this.canManage(tenantId, user),
      meetings: rows.map((m) =>
        this.view(
          m,
          cards.find((c) => c.id === m.conductorPublisherId),
          invitedOn(spells, String(m.date)).length,
        ),
      ),
    };
  }

  /** One meeting with who is invited and what is worth knowing first. */
  async get(
    tenantId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<PioneerMeetingDetail> {
    const m = await this.meetings.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!m) {
      throw new NotFoundException(
        refusal('PIONEER_MEETING_NOT_FOUND', 'No such meeting.'),
      );
    }
    const conductor = await this.publishers.findOne({
      where: { id: m.conductorPublisherId, congregationId: tenantId },
      withDeleted: true,
    });
    const isConductor = !!conductor?.userId && conductor.userId === user.id;
    if (!this.isElder(user) && !isConductor) {
      throw new ForbiddenException(
        refusal('NEEDS_ROLE', 'Only elders see who is invited.', {
          roles: ['admin', 'elder'],
        }),
      );
    }
    const day = String(m.date).slice(0, 10);
    const spells = await this.spellsOf(tenantId);
    const ids = invitedOn(spells, day);
    const people = ids.length
      ? await this.publishers.find({
          where: { congregationId: tenantId, id: In(ids), removedAt: IsNull() },
        })
      : [];
    const away = await this.awayOn(
      tenantId,
      [...ids, m.conductorPublisherId],
      day,
    );
    const kindOf = (pid: string) =>
      spells.find(
        (s) =>
          s.publisherId === pid &&
          String(s.startMonth).slice(0, 7) <= day.slice(0, 7) &&
          (!s.endMonth || String(s.endMonth).slice(0, 7) >= day.slice(0, 7)),
      )?.pioneerType ?? 'regular';
    return {
      ...this.view(m, conductor ?? undefined, people.length),
      invited: people
        .map((p) => ({
          id: p.id,
          name: nameOf(p),
          kind: kindOf(p.id),
          away: away.has(p.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      warnings: await this.warningsFor(tenantId, m, away),
      canManage: await this.canManage(tenantId, user),
    };
  }

  private async awayOn(
    tenantId: string,
    ids: string[],
    day: string,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.absences.find({
      where: {
        congregationId: tenantId,
        publisherId: In(ids),
        startDate: LessThanOrEqual(day),
      },
    });
    return new Set(
      rows
        .filter((a) => String(a.endDate ?? a.startDate).slice(0, 10) >= day)
        .map((a) => a.publisherId),
    );
  }

  private async warningsFor(
    tenantId: string,
    m: PioneerMeeting,
    away: Set<string>,
  ): Promise<MeetingWarning[]> {
    const day = String(m.date).slice(0, 10);
    const out: MeetingWarning[] = [];
    if (!inSeason(day)) out.push({ kind: 'outsideSeason' });
    const events = await this.events.find({
      where: {
        congregationId: tenantId,
        type: In([
          'circuit_assembly',
          'regional_convention',
          'circuit_overseer_visit',
        ]),
        date: LessThanOrEqual(day),
      },
    });
    for (const e of events) {
      if (String(e.endDate ?? e.date).slice(0, 10) >= day) {
        out.push({ kind: 'event', eventType: e.type ?? '', title: e.title });
      }
    }
    if (away.has(m.conductorPublisherId)) out.push({ kind: 'conductorAway' });
    return out;
  }

  // ---- writing -------------------------------------------------------------

  private async checked(
    tenantId: string,
    input: PioneerMeetingInput,
  ): Promise<PioneerMeetingInput> {
    const day = (input.date ?? '').slice(0, 10);
    const t = input.timeStart?.trim() || null;
    const e = input.timeEnd?.trim() || null;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      (t && !HM.test(t)) ||
      (e && !HM.test(e)) ||
      (e && !t) ||
      (t && e && e <= t)
    ) {
      throw new BadRequestException(
        refusal(
          'PIONEER_MEETING_INVALID',
          'A day, and a time written as HH:mm that ends after it starts.',
        ),
      );
    }
    const conductor = await this.publishers.findOne({
      where: {
        id: input.conductorPublisherId,
        congregationId: tenantId,
        removedAt: IsNull(),
      },
    });
    if (!conductor || conductor.appointment !== PublisherAppointment.ELDER) {
      throw new BadRequestException(
        refusal(
          'PIONEER_MEETING_NOT_ELDER',
          'The meeting with the pioneers is conducted by an elder.',
        ),
      );
    }
    return {
      date: day,
      timeStart: t,
      timeEnd: e,
      place: input.place?.trim().slice(0, 200) || null,
      conductorPublisherId: conductor.id,
      note: input.note?.trim() || null,
    };
  }

  async create(
    tenantId: string,
    user: AuthenticatedUser,
    input: PioneerMeetingInput,
  ): Promise<PioneerMeetingDetail> {
    await this.assertManage(tenantId, user);
    const ok = await this.checked(tenantId, input);
    const saved = await this.meetings.save(
      this.meetings.create({
        congregationId: tenantId,
        date: ok.date,
        timeStart: ok.timeStart ?? null,
        timeEnd: ok.timeEnd ?? null,
        place: ok.place ?? null,
        conductorPublisherId: ok.conductorPublisherId,
        note: ok.note ?? null,
        createdById: user.id,
      }),
    );
    await this.audit.logCreate({
      tenantId,
      entityType: 'pioneer_meeting',
      entityId: saved.id,
      actorUserId: user.id,
      after: { date: ok.date, conductorPublisherId: ok.conductorPublisherId },
    });
    await this.syncTask(tenantId, serviceYearOfDay(ok.date), user.id);
    await this.announce(saved, 'created');
    return this.get(tenantId, user, saved.id);
  }

  async update(
    tenantId: string,
    user: AuthenticatedUser,
    id: string,
    input: PioneerMeetingInput,
  ): Promise<PioneerMeetingDetail> {
    await this.assertManage(tenantId, user);
    const m = await this.meetings.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!m) {
      throw new NotFoundException(
        refusal('PIONEER_MEETING_NOT_FOUND', 'No such meeting.'),
      );
    }
    const ok = await this.checked(tenantId, input);
    const before = { ...m };
    m.date = ok.date;
    m.timeStart = ok.timeStart ?? null;
    m.timeEnd = ok.timeEnd ?? null;
    m.place = ok.place ?? null;
    m.conductorPublisherId = ok.conductorPublisherId;
    m.note = ok.note ?? null;
    const saved = await this.meetings.save(m);
    await this.audit.logUpdate({
      tenantId,
      entityType: 'pioneer_meeting',
      entityId: id,
      actorUserId: user.id,
      before,
      after: saved,
      fields: [
        'date',
        'timeStart',
        'timeEnd',
        'place',
        'conductorPublisherId',
        'note',
      ],
    });
    const moved =
      String(before.date).slice(0, 10) !== ok.date ||
      before.timeStart !== saved.timeStart ||
      before.timeEnd !== saved.timeEnd ||
      before.place !== saved.place;
    if (before.conductorPublisherId !== saved.conductorPublisherId) {
      // The new elder hears he conducts it; the one before, that he does not.
      await this.announce(saved, 'conductorNew');
      await this.announceTo(
        saved,
        [before.conductorPublisherId],
        'conductorFreed',
      );
    }
    if (moved) await this.announce(saved, 'changed');
    await this.syncTask(
      tenantId,
      serviceYearOfDay(String(before.date)),
      user.id,
    );
    await this.syncTask(tenantId, serviceYearOfDay(ok.date), user.id);
    return this.get(tenantId, user, id);
  }

  async remove(
    tenantId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ ok: true }> {
    await this.assertManage(tenantId, user);
    const m = await this.meetings.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!m) {
      throw new NotFoundException(
        refusal('PIONEER_MEETING_NOT_FOUND', 'No such meeting.'),
      );
    }
    await this.meetings.softRemove(m);
    await this.audit.logEvent({
      tenantId,
      entityType: 'pioneer_meeting',
      entityId: id,
      action: 'DELETE',
      actorUserId: user.id,
      detail: { date: String(m.date).slice(0, 10) },
    });
    await this.announce(m, 'cancelled');
    await this.syncTask(tenantId, serviceYearOfDay(String(m.date)), user.id);
    return { ok: true };
  }

  // ---- telling ------------------------------------------------------------

  /** The sign-ins of the invited and the conductor, minus whoever is gone. */
  private async usersOf(tenantId: string, publisherIds: string[]) {
    if (publisherIds.length === 0) return [];
    const cards = await this.publishers.find({
      where: {
        congregationId: tenantId,
        id: In(publisherIds),
        removedAt: IsNull(),
      },
    });
    return cards.filter((c) => !!c.userId);
  }

  private async announce(m: PioneerMeeting, news: MeetingNews): Promise<void> {
    try {
      const day = String(m.date).slice(0, 10);
      const today = await this.clock.todayFor(m.congregationId);
      if (day < today) return;
      const conductor = await this.publishers.findOne({
        where: { id: m.conductorPublisherId, congregationId: m.congregationId },
        withDeleted: true,
      });
      const invited = invitedOn(
        await this.spellsOf(m.congregationId),
        day,
      ).filter((pid) => pid !== m.conductorPublisherId);
      if (news !== 'conductorNew') {
        await this.send(
          m,
          await this.usersOf(m.congregationId, invited),
          news,
          false,
          conductor,
        );
      }
      if (news !== 'reminderWeek') {
        await this.send(
          m,
          await this.usersOf(m.congregationId, [m.conductorPublisherId]),
          news === 'conductorNew' ? 'created' : news,
          true,
          conductor,
        );
      }
    } catch (err) {
      this.logger.warn(
        `pioneer meeting ${m.id} ${news}: ${(err as Error).message}`,
      );
    }
  }

  private async announceTo(
    m: PioneerMeeting,
    publisherIds: string[],
    news: MeetingNews,
  ): Promise<void> {
    try {
      const day = String(m.date).slice(0, 10);
      if (day < (await this.clock.todayFor(m.congregationId))) return;
      await this.send(
        m,
        await this.usersOf(m.congregationId, publisherIds),
        news,
        true,
        null,
      );
    } catch (err) {
      this.logger.warn(
        `pioneer meeting ${m.id} ${news}: ${(err as Error).message}`,
      );
    }
  }

  private async send(
    m: PioneerMeeting,
    cards: Publisher[],
    news: MeetingNews,
    asConductor: boolean,
    conductor: Publisher | null | undefined,
  ): Promise<void> {
    if (cards.length === 0) return;
    const facts = {
      date: String(m.date).slice(0, 10),
      timeStart: m.timeStart,
      timeEnd: m.timeEnd,
      place: m.place,
      conductorName: conductor ? nameOf(conductor) : '',
    };
    const stamp = createHash('sha1')
      .update(
        `${facts.date}|${facts.timeStart}|${facts.timeEnd}|${facts.place}|${m.conductorPublisherId}`,
      )
      .digest('hex')
      .slice(0, 12);
    await this.notifications.notify({
      tenantId: m.congregationId,
      userIds: cards.map((c) => c.userId as string),
      text: (lang) => meetingText(news, asConductor, facts, lang),
      kind: asConductor ? 'pioneer_meeting_conduct' : 'pioneer_meeting',
      key: `pioneer-meeting:${m.id}:${news}:${asConductor ? 'c' : 'i'}:${stamp}`,
      // «c» opens the meeting for the conductor; «i» — Home, for a pioneer.
      data: {
        type: 'pioneer_meeting',
        meetingId: m.id,
        role: asConductor ? 'c' : 'i',
      },
    });
  }

  /**
   * Each evening: tomorrow's meeting to everyone it concerns, and the one a
   * week away to the elder who prepares it on the outline S-211.
   */
  async remindEvening(now: Date = new Date()): Promise<number> {
    const congs = await this.congregations.find({
      select: { id: true, timezone: true },
    });
    let n = 0;
    for (const c of congs) {
      const today = todayIn(now, c.timezone || DEFAULT_CONGREGATION_TIMEZONE);
      const plus = (d: number) => {
        const x = new Date(`${today}T12:00:00Z`);
        x.setUTCDate(x.getUTCDate() + d);
        return x.toISOString().slice(0, 10);
      };
      const rows = await this.meetings.find({
        where: { congregationId: c.id, date: In([plus(1), plus(7)]) },
      });
      for (const m of rows) {
        await this.announce(
          m,
          String(m.date).slice(0, 10) === plus(1) ? 'tomorrow' : 'reminderWeek',
        );
        n += 1;
      }
    }
    return n;
  }

  // ---- the body's task -----------------------------------------------------

  /**
   * «Who conducts the meeting with the pioneers» — the body of elders' task
   * from 1 to 30 November. It is not raised when a meeting for the season is
   * already set, and closes itself when one is; a task closed by the app
   * opens again when that meeting is taken away. A person's «done» stands.
   */
  async ensureTasks(now: Date = new Date()): Promise<number> {
    const congs = await this.congregations.find({
      select: { id: true, timezone: true },
    });
    let changed = 0;
    for (const c of congs) {
      const today = todayIn(now, c.timezone || DEFAULT_CONGREGATION_TIMEZONE);
      if (Number(today.slice(5, 7)) !== TASK_MONTH) continue;
      changed += await this.syncTask(
        c.id,
        serviceYearOfDay(today),
        null,
        today,
      );
    }
    return changed;
  }

  /** Bring the season's task in line with whether its meeting is set. */
  async syncTask(
    tenantId: string,
    serviceYear: number,
    actorUserId: string | null,
    todayIfRaising?: string,
  ): Promise<number> {
    const { from, to } = seasonOf(serviceYear);
    const set =
      (await this.meetings.count({
        where: { congregationId: tenantId, date: Between(from, to) },
      })) > 0;
    const period = String(serviceYear);
    const existing = await this.tasks.findOne({
      where: { congregationId: tenantId, kind: TASK_KIND, kindPeriod: period },
    });
    if (!existing) {
      // Raised only by the November round, never by a save at another time.
      if (set || !todayIfRaising) return 0;
      const offered = await this.taskLog.findOne({
        where: { congregationId: tenantId, kind: TASK_KIND, period },
      });
      if (offered) return 0;
      await this.tasks.save(
        this.tasks.create({
          congregationId: tenantId,
          title: TASK_KIND,
          details: null,
          area: 'ministry',
          assigneeKind: 'body_of_elders',
          assignees: [],
          dueDate: `${serviceYear - 1}-11-30`,
          kind: TASK_KIND,
          kindPeriod: period,
          status: 'open',
          createdById: null,
        }),
      );
      await this.taskLog.save(
        this.taskLog.create({
          congregationId: tenantId,
          kind: TASK_KIND,
          period,
        }),
      );
      return 1;
    }
    if (set && existing.status === 'open') {
      await this.tasks.update(existing.id, {
        status: 'done',
        doneAt: new Date(),
        doneById: null,
      });
      return 1;
    }
    if (!set && existing.status === 'done' && !existing.doneById) {
      await this.tasks.update(existing.id, { status: 'open', doneAt: null });
      return 1;
    }
    void actorUserId;
    return 0;
  }

  // ---- Home ------------------------------------------------------------------

  /**
   * For Home: the coming meetings this person is invited to or conducts —
   * from today on, up to `horizon`.
   */
  async forHome(
    tenantId: string,
    publisherId: string,
    today: string,
    horizon: string,
  ): Promise<HomeMeeting[]> {
    const rows = await this.meetings.find({
      where: { congregationId: tenantId, date: Between(today, horizon) },
      order: { date: 'ASC' },
    });
    if (rows.length === 0) return [];
    const spells = await this.spells.find({
      where: { congregationId: tenantId, publisherId },
    });
    const out: HomeMeeting[] = [];
    for (const m of rows) {
      const day = String(m.date).slice(0, 10);
      const conducts = m.conductorPublisherId === publisherId;
      const invited = invitedOn(spells, day).includes(publisherId);
      if (!conducts && !invited) continue;
      const conductor = await this.publishers.findOne({
        where: { id: m.conductorPublisherId, congregationId: tenantId },
        withDeleted: true,
      });
      out.push({
        id: m.id,
        date: day,
        timeStart: m.timeStart,
        timeEnd: m.timeEnd,
        place: m.place,
        role: conducts ? ('conduct' as const) : ('invited' as const),
        conductorName: conductor ? nameOf(conductor) : '',
      });
    }
    return out;
  }
}
