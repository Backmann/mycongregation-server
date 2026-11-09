import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { assertAssignable } from '../common/inactive';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
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
  conductorIdsOf,
  conductorsOf,
  inSeason,
  invitedOn,
  repeats,
  seasonOf,
  seasonYearOf,
  serviceYearOfDay,
  tidyName,
  type ConductorPlace,
  type MeetingWarning,
} from './pioneer-meeting-rules';
import { meetingText, type MeetingNews } from './pioneer-meeting-messages';

/** One who conducts it, as the form sends it: a card or a written name. */
export interface ConductorInput {
  publisherId?: string | null;
  name?: string | null;
}

export interface PioneerMeetingInput {
  date: string;
  timeStart?: string | null;
  timeEnd?: string | null;
  place?: string | null;
  /** One or two; the second may be left out (9 November 2026). */
  conductors?: ConductorInput[];
  /**
   * The app before 9 November 2026 sent one elder here. Read as the first
   * place; a second one already set is kept, not dropped by an old form.
   */
  conductorPublisherId?: string | null;
  note?: string | null;
}

export interface ConductorView {
  /** The card — null for a name written by hand. */
  id: string | null;
  name: string;
  /** elder / ministerial_servant; null for a written name. */
  appointment: string | null;
}

export interface PioneerMeetingView {
  id: string;
  date: string;
  timeStart: string | null;
  timeEnd: string | null;
  place: string | null;
  note: string | null;
  serviceYear: number;
  /** Those who conduct it, in order — one or two. */
  conductors: ConductorView[];
  /** The first of them, for the app before 9 November 2026. */
  conductor: { id: string; name: string };
  /** The pioneers invited — those who conduct it are not counted here. */
  invitedCount: number;
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

/** Who may conduct it: an elder, rarely a ministerial servant (Lionel). */
const MAY_CONDUCT: string[] = [
  PublisherAppointment.ELDER,
  PublisherAppointment.MINISTERIAL_SERVANT,
];

/** A name written by hand: long enough to be a name, short enough to fit. */
const NAME_MIN = 2;
const NAME_MAX = 120;

const dayOf = (d: string | Date) =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

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

  /** The cards of these people, the removed too — history keeps names. */
  private async cardsOf(
    tenantId: string,
    ids: (string | null | undefined)[],
  ): Promise<Map<string, Publisher>> {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (want.length === 0) return new Map();
    const cards = await this.publishers.find({
      where: { congregationId: tenantId, id: In(want) },
      withDeleted: true,
    });
    return new Map(cards.map((c) => [c.id, c]));
  }

  private conductorViews(
    m: PioneerMeeting,
    cards: Map<string, Publisher>,
  ): ConductorView[] {
    return conductorsOf(m).map((c) => {
      const card = c.publisherId ? cards.get(c.publisherId) : undefined;
      return {
        id: c.publisherId,
        name: card ? nameOf(card) : (c.name ?? ''),
        appointment: card ? (card.appointment ?? null) : null,
      };
    });
  }

  /** The pioneers it invites: of its day, still in the congregation, not conducting it. */
  private async invitedIds(
    tenantId: string,
    m: PioneerMeeting,
    spells: PioneerSpell[],
    present?: Set<string>,
  ): Promise<string[]> {
    const conducting = new Set(conductorIdsOf(m));
    const ids = invitedOn(spells, dayOf(m.date)).filter(
      (id) => !conducting.has(id),
    );
    const here =
      present ??
      new Set(
        (ids.length
          ? await this.publishers.find({
              select: { id: true },
              where: {
                congregationId: tenantId,
                id: In(ids),
                removedAt: IsNull(),
              },
            })
          : []
        ).map((p) => p.id),
      );
    return ids.filter((id) => here.has(id));
  }

  private view(
    m: PioneerMeeting,
    cards: Map<string, Publisher>,
    invitedCount: number,
  ): PioneerMeetingView {
    const conductors = this.conductorViews(m, cards);
    return {
      id: m.id,
      date: dayOf(m.date),
      timeStart: m.timeStart,
      timeEnd: m.timeEnd,
      place: m.place,
      note: m.note,
      serviceYear: serviceYearOfDay(dayOf(m.date)),
      conductors,
      conductor: {
        id: conductors[0]?.id ?? '',
        name: conductors[0]?.name ?? '',
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
    const cards = await this.cardsOf(
      tenantId,
      rows.flatMap((m) => conductorIdsOf(m)),
    );
    const spells = await this.spellsOf(tenantId);
    // Who is still here, asked once for every meeting: the count in the
    // list is the list inside the meeting (it counted the removed too).
    const everInvited = [
      ...new Set(rows.flatMap((m) => invitedOn(spells, dayOf(m.date)))),
    ];
    const present = new Set(
      (everInvited.length
        ? await this.publishers.find({
            select: { id: true },
            where: {
              congregationId: tenantId,
              id: In(everInvited),
              removedAt: IsNull(),
            },
          })
        : []
      ).map((p) => p.id),
    );
    const meetings: PioneerMeetingView[] = [];
    for (const m of rows) {
      const invited = await this.invitedIds(tenantId, m, spells, present);
      meetings.push(this.view(m, cards, invited.length));
    }
    return { canManage: await this.canManage(tenantId, user), meetings };
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
    const conductorIds = conductorIdsOf(m);
    const cards = await this.cardsOf(tenantId, conductorIds);
    const isConductor = conductorIds.some(
      (id) => !!cards.get(id)?.userId && cards.get(id)?.userId === user.id,
    );
    if (!this.isElder(user) && !isConductor) {
      throw new ForbiddenException(
        refusal('NEEDS_ROLE', 'Only elders see who is invited.', {
          roles: ['admin', 'elder'],
        }),
      );
    }
    const day = dayOf(m.date);
    const spells = await this.spellsOf(tenantId);
    const ids = await this.invitedIds(tenantId, m, spells);
    const people = ids.length
      ? await this.publishers.find({
          where: { congregationId: tenantId, id: In(ids) },
        })
      : [];
    const away = await this.awayOn(tenantId, [...ids, ...conductorIds], day);
    const kindOf = (pid: string) =>
      spells.find(
        (s) =>
          s.publisherId === pid &&
          String(s.startMonth).slice(0, 7) <= day.slice(0, 7) &&
          (!s.endMonth || String(s.endMonth).slice(0, 7) >= day.slice(0, 7)),
      )?.pioneerType ?? 'regular';
    return {
      ...this.view(m, cards, people.length),
      invited: people
        .map((p) => ({
          id: p.id,
          name: nameOf(p),
          kind: kindOf(p.id),
          away: away.has(p.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      warnings: await this.warningsFor(tenantId, m, away, cards),
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
    cards: Map<string, Publisher>,
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
    for (const id of conductorIdsOf(m)) {
      const card = cards.get(id);
      if (away.has(id)) {
        out.push({ kind: 'conductorAway', name: card ? nameOf(card) : '' });
      }
    }
    return out;
  }

  // ---- writing -------------------------------------------------------------

  private invalid(): BadRequestException {
    return new BadRequestException(
      refusal(
        'PIONEER_MEETING_INVALID',
        'A day, and a time written as HH:mm that ends after it starts.',
      ),
    );
  }

  /**
   * The form's places, tidied: a card where one is chosen, otherwise the
   * name written by hand; empty places dropped. An old form sends its one
   * elder only — then a second place already set stays as it was.
   */
  private placesOf(
    input: PioneerMeetingInput,
    prev: PioneerMeeting | null,
  ): ConductorPlace[] {
    const raw: ConductorInput[] =
      input.conductors !== undefined
        ? input.conductors
        : [
            { publisherId: input.conductorPublisherId ?? null },
            ...(prev ? conductorsOf(prev).slice(1) : []),
          ];
    return raw
      .map((c) => ({
        publisherId: c.publisherId || null,
        name: c.publisherId ? null : tidyName(c.name) || null,
      }))
      .filter((c) => c.publisherId || c.name);
  }

  private async checked(
    tenantId: string,
    input: PioneerMeetingInput,
    prev: PioneerMeeting | null = null,
  ): Promise<{
    date: string;
    timeStart: string | null;
    timeEnd: string | null;
    place: string | null;
    note: string | null;
    places: ConductorPlace[];
  }> {
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
      throw this.invalid();
    }

    // Who conducts it: one or two, never the same one twice.
    const places = this.placesOf(input, prev);
    if (places.length === 0) {
      throw new BadRequestException(
        refusal(
          'PIONEER_MEETING_NO_CONDUCTOR',
          'Somebody conducts the meeting: choose him or write his name.',
        ),
      );
    }
    if (
      places.length > 2 ||
      places.some(
        (c) => c.name && (c.name.length < NAME_MIN || c.name.length > NAME_MAX),
      )
    ) {
      throw this.invalid();
    }
    if (repeats(places)) {
      throw new BadRequestException(
        refusal(
          'PIONEER_MEETING_SAME_CONDUCTOR',
          'The two who conduct it are two different brothers.',
        ),
      );
    }
    const ids = places
      .map((c) => c.publisherId)
      .filter((x): x is string => !!x);
    const cards = ids.length
      ? await this.publishers.find({
          where: { id: In(ids), congregationId: tenantId, removedAt: IsNull() },
        })
      : [];
    // A card already on the meeting stays even if he is no longer appointed
    // since: the elders may still change its time (as with inactivity).
    const held = new Set(prev ? conductorIdsOf(prev) : []);
    for (const id of ids) {
      const card = cards.find((c) => c.id === id);
      const ok = card && MAY_CONDUCT.includes(String(card.appointment));
      if (!ok && !(held.has(id) && card)) {
        throw new BadRequestException(
          refusal(
            'PIONEER_MEETING_NOT_APPOINTED',
            'The meeting with the pioneers is conducted by an elder or a ministerial servant.',
          ),
        );
      }
    }

    // December or January, once a season (Lionel, 9 November 2026). A
    // meeting kept from before on another day keeps its day if it is not
    // moved.
    const moved = !prev || dayOf(prev.date) !== day;
    const season = seasonYearOf(day);
    if (moved && season === null) {
      throw new BadRequestException(
        refusal(
          'PIONEER_MEETING_OUT_OF_SEASON',
          'The meeting with the pioneers is held in December or January.',
        ),
      );
    }
    if (season !== null) {
      const { from, to } = seasonOf(season);
      const other = await this.meetings.findOne({
        where: {
          congregationId: tenantId,
          date: Between(from, to),
          ...(prev ? { id: Not(prev.id) } : {}),
        },
      });
      if (other) {
        throw new BadRequestException(
          refusal(
            'PIONEER_MEETING_SEASON_TAKEN',
            'This season already has its meeting with the pioneers.',
            { date: dayOf(other.date), meetingId: other.id },
          ),
        );
      }
    }
    return {
      date: day,
      timeStart: t,
      timeEnd: e,
      place: input.place?.trim().slice(0, 200) || null,
      note: input.note?.trim() || null,
      places,
    };
  }

  /** The four columns of the places. */
  private columnsOf(places: ConductorPlace[]) {
    const [a, b] = places;
    return {
      conductorPublisherId: a?.publisherId ?? null,
      conductorName: a && !a.publisherId ? a.name : null,
      secondConductorPublisherId: b?.publisherId ?? null,
      secondConductorName: b && !b.publisherId ? b.name : null,
    };
  }

  /** Past meetings are history: frozen from the day after (CLAUDE.md). */
  private async assertNotPast(m: PioneerMeeting): Promise<void> {
    if (dayOf(m.date) < (await this.clock.todayFor(m.congregationId))) {
      throw new BadRequestException(
        refusal(
          'PIONEER_MEETING_PAST_LOCKED',
          'A meeting that has taken place is kept as it was.',
        ),
      );
    }
  }

  async create(
    tenantId: string,
    user: AuthenticatedUser,
    input: PioneerMeetingInput,
  ): Promise<PioneerMeetingDetail> {
    await this.assertManage(tenantId, user);
    const ok = await this.checked(tenantId, input);
    const cols = this.columnsOf(ok.places);
    await assertAssignable(
      this.meetings.manager,
      tenantId,
      conductorIdsOf(cols),
    );
    const saved = await this.meetings.save(
      this.meetings.create({
        congregationId: tenantId,
        date: ok.date,
        timeStart: ok.timeStart,
        timeEnd: ok.timeEnd,
        place: ok.place,
        ...cols,
        note: ok.note,
        createdById: user.id,
      }),
    );
    await this.audit.logCreate({
      tenantId,
      entityType: 'pioneer_meeting',
      entityId: saved.id,
      actorUserId: user.id,
      after: { date: ok.date, ...cols },
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
    await this.assertNotPast(m);
    const ok = await this.checked(tenantId, input, m);
    const cols = this.columnsOf(ok.places);
    await assertAssignable(
      this.meetings.manager,
      tenantId,
      conductorIdsOf(cols),
      conductorIdsOf(m),
    );
    const before = { ...m };
    m.date = ok.date;
    m.timeStart = ok.timeStart;
    m.timeEnd = ok.timeEnd;
    m.place = ok.place;
    Object.assign(m, cols);
    m.note = ok.note;
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
        'conductorName',
        'secondConductorPublisherId',
        'secondConductorName',
        'note',
      ],
    });
    const moved =
      dayOf(before.date) !== ok.date ||
      before.timeStart !== saved.timeStart ||
      before.timeEnd !== saved.timeEnd ||
      before.place !== saved.place;
    // A new one hears he conducts it; one taken off, that he does not; the
    // one who stays hears only of a move.
    const was = new Set(conductorIdsOf(before));
    const now = new Set(conductorIdsOf(saved));
    const added = [...now].filter((id) => !was.has(id));
    const freed = [...was].filter((id) => !now.has(id));
    if (added.length) await this.announceConductors(saved, added, 'created');
    if (freed.length) await this.announceTo(saved, freed, 'conductorFreed');
    if (moved) await this.announce(saved, 'changed', new Set(added));
    await this.syncTask(
      tenantId,
      serviceYearOfDay(dayOf(before.date)),
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
    await this.assertNotPast(m);
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

  /** The names of those who conduct it, in order, as the app writes people. */
  private async namesOf(m: PioneerMeeting): Promise<string[]> {
    const cards = await this.cardsOf(m.congregationId, conductorIdsOf(m));
    return this.conductorViews(m, cards).map((c) => c.name);
  }

  /**
   * Tell the invited pioneers, and each one who conducts it (with the other
   * one named). `skip` — conductors already told something fuller.
   */
  private async announce(
    m: PioneerMeeting,
    news: MeetingNews,
    skip: Set<string> = new Set(),
  ): Promise<void> {
    try {
      const day = dayOf(m.date);
      if (day < (await this.clock.todayFor(m.congregationId))) return;
      const names = await this.namesOf(m);
      // The pioneers: everything but the week's reminder, which is the
      // conductors' time to prepare (it used to go to the pioneers alone).
      if (news !== 'conductorNew' && news !== 'reminderWeek') {
        const invited = await this.invitedIds(
          m.congregationId,
          m,
          await this.spellsOf(m.congregationId),
        );
        await this.send(
          m,
          await this.usersOf(m.congregationId, invited),
          news,
          false,
          names,
          null,
        );
      }
      await this.tellConductors(
        m,
        conductorIdsOf(m).filter((id) => !skip.has(id)),
        news === 'conductorNew' ? 'created' : news,
        names,
      );
    } catch (err) {
      this.logger.warn(
        `pioneer meeting ${m.id} ${news}: ${(err as Error).message}`,
      );
    }
  }

  /** Tell these conductors alone (one added to the meeting). */
  private async announceConductors(
    m: PioneerMeeting,
    ids: string[],
    news: MeetingNews,
  ): Promise<void> {
    try {
      if (dayOf(m.date) < (await this.clock.todayFor(m.congregationId))) return;
      await this.tellConductors(m, ids, news, await this.namesOf(m));
    } catch (err) {
      this.logger.warn(
        `pioneer meeting ${m.id} ${news}: ${(err as Error).message}`,
      );
    }
  }

  /** Each conductor separately: his message names the other one. */
  private async tellConductors(
    m: PioneerMeeting,
    ids: string[],
    news: MeetingNews,
    names: string[],
  ): Promise<void> {
    const views = this.conductorViews(
      m,
      await this.cardsOf(m.congregationId, conductorIdsOf(m)),
    );
    for (const id of ids) {
      const other = views.find((v) => v.id !== id);
      await this.send(
        m,
        await this.usersOf(m.congregationId, [id]),
        news,
        true,
        names,
        other?.name ?? null,
      );
    }
  }

  private async announceTo(
    m: PioneerMeeting,
    publisherIds: string[],
    news: MeetingNews,
  ): Promise<void> {
    try {
      if (dayOf(m.date) < (await this.clock.todayFor(m.congregationId))) return;
      await this.send(
        m,
        await this.usersOf(m.congregationId, publisherIds),
        news,
        true,
        [],
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
    conductorNames: string[],
    partnerName: string | null,
  ): Promise<void> {
    if (cards.length === 0) return;
    const facts = {
      date: dayOf(m.date),
      timeStart: m.timeStart,
      timeEnd: m.timeEnd,
      place: m.place,
      conductorNames,
      partnerName,
    };
    const stamp = createHash('sha1')
      .update(
        [
          facts.date,
          facts.timeStart,
          facts.timeEnd,
          facts.place,
          m.conductorPublisherId,
          m.conductorName,
          m.secondConductorPublisherId,
          m.secondConductorName,
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 12);
    await this.notifications.notify({
      tenantId: m.congregationId,
      userIds: cards.map((c) => c.userId as string),
      text: (lang) => meetingText(news, asConductor, facts, lang),
      kind: asConductor ? 'pioneer_meeting_conduct' : 'pioneer_meeting',
      key: `pioneer-meeting:${m.id}:${news}:${asConductor ? 'c' : 'i'}:${stamp}`,
      // «c» opens the meeting for a conductor; «i» — Home, for a pioneer.
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
}
