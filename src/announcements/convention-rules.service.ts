import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Repository } from 'typeorm';
import { MeetingAnnouncement } from '../entities/meeting-announcement.entity';
import { AnnouncementDismissal } from '../entities/announcement-dismissal.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { ElderTask, type TaskKind } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { Congregation } from '../entities/congregation.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { WeekRulesService } from '../common/week-rules.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { addDaysISO } from '../common/week-rules';
import { mondayOf } from '../common/week';
import { coerceLanguage } from '../common/i18n/supported-languages';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { AnnouncementsService } from './announcements.service';
import { SUGGESTION_WORDS } from './suggestion-words';

/** The item for the chairman is put on his list this many days before. */
export const SCREENS_DAYS_AHEAD = 21;
/** The 15 minutes before the campaign: a task this many days before the convention. */
export const CAMPAIGN_TASK_DAYS = 42;
/** … due when the campaign begins, three weeks before (R-04). */
export const CAMPAIGN_DUE_DAYS = 21;
/** How far ahead events are looked at: the campaign task's six weeks and a margin. */
const LOOK_AHEAD_DAYS = 70;
/** How many weeks back from the assembly a held midweek meeting is sought. */
const STEP_BACK_WEEKS = 4;

export const SCREENS_SOURCE = 'assembly_screens';

export const screensKey = (eventId: string) =>
  `rule:${SCREENS_SOURCE}:${eventId}`;

/**
 * What the guidelines themselves put in place before a convention
 * (announcements R-04 (2), (3) and R-05, 24 November 2026).
 *
 * - Before a CIRCUIT ASSEMBLY, at the last midweek meeting the week rules
 *   hold before it (R-06), the chairman shows the programme on the screens —
 *   the theme and the key talks. That item is put on his list by the app
 *   itself, marked «by the guidelines» (`byRule`), three weeks ahead; the
 *   overseer of the Life and Ministry meeting gets a task to see it done and
 *   may take the item off the chairman's list. Taken off is remembered, and
 *   the item does not come back.
 * - Before a REGIONAL CONVENTION, six weeks ahead, the same overseer gets a
 *   task: plan the 15-minute part before the invitation campaign, due when
 *   the campaign begins.
 *
 * Tasks are named by their kind and the event's date (the period), and the
 * calendar log keeps a deleted one from coming back — the same rule as the
 * calendar tasks. When an event moves or goes, what the app made for it and
 * nobody has touched follows or goes with it.
 */
@Injectable()
export class ConventionRulesService {
  private readonly logger = new Logger(ConventionRulesService.name);

  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly weekRules: WeekRulesService,
    private readonly clock: CongregationClock,
    @InjectRepository(MeetingAnnouncement)
    private readonly repo: Repository<MeetingAnnouncement>,
    @InjectRepository(AnnouncementDismissal)
    private readonly dismissals: Repository<AnnouncementDismissal>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(ElderTaskCalendarLog)
    private readonly log: Repository<ElderTaskCalendarLog>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
  ) {}

  /** Every congregation, once a day. */
  async tick(): Promise<{ placed: number; tasks: number }> {
    const all = await this.congregations.find({ select: { id: true } });
    let placed = 0;
    let tasks = 0;
    for (const c of all) {
      try {
        const r = await this.forCongregation(c.id);
        placed += r.placed;
        tasks += r.tasks;
      } catch (err) {
        this.logger.error(
          `convention rules failed for ${c.id}: ${String(err)}`,
        );
      }
    }
    return { placed, tasks };
  }

  /** The last midweek meeting the week rules hold before `date`. */
  async screensMeeting(
    congregationId: string,
    date: string,
  ): Promise<{ week: string; date: string } | null> {
    const weeks = Array.from({ length: STEP_BACK_WEEKS + 1 }, (_, i) =>
      addDaysISO(mondayOf(date), -7 * i),
    );
    const rules = await this.weekRules.forWeeks(congregationId, weeks);
    for (const w of weeks) {
      const mw = rules
        .get(w)
        ?.meetings.find((m) => m.kind === 'midweek' && m.date < date);
      if (mw) return { week: w, date: mw.date };
    }
    return null;
  }

  async forCongregation(
    congregationId: string,
  ): Promise<{ placed: number; tasks: number }> {
    const today = await this.clock.todayFor(congregationId);
    const events = await this.events.find({
      where: {
        congregationId,
        deletedAt: IsNull(),
        type: In(['circuit_assembly', 'regional_convention']),
        date: Between(today, addDaysISO(today, LOOK_AHEAD_DAYS)),
      },
    });
    let placed = 0;
    let made = 0;
    const live = new Set<string>();

    for (const e of events) {
      if (e.type === 'circuit_assembly') {
        live.add(`assembly_screens|${e.date}`);
        const m = await this.screensMeeting(congregationId, e.date);
        if (!m || m.date < today) continue;
        if (addDaysISO(m.date, -SCREENS_DAYS_AHEAD) > today) continue;
        if (await this.placeScreens(congregationId, e, m)) placed += 1;
        if (
          await this.ensureTask(
            congregationId,
            'assembly_screens',
            e.date,
            m.date,
          )
        )
          made += 1;
      } else {
        live.add(`campaign_part|${e.date}`);
        if (addDaysISO(e.date, -CAMPAIGN_TASK_DAYS) > today) continue;
        const due = addDaysISO(e.date, -CAMPAIGN_DUE_DAYS);
        if (await this.ensureTask(congregationId, 'campaign_part', e.date, due))
          made += 1;
      }
    }

    await this.tidy(congregationId, today, live);
    return { placed, tasks: made };
  }

  /** The item on the chairman's list: put, or moved with its meeting. */
  private async placeScreens(
    congregationId: string,
    e: SpecialEvent,
    m: { week: string; date: string },
  ): Promise<boolean> {
    const base = screensKey(e.id);
    const sourceKey = `${base}.midweek`;
    const refused = await this.dismissals.findOne({
      where: { congregationId, sourceKey: base },
    });
    if (refused) return false;
    const have = await this.repo.findOne({
      where: { congregationId, sourceKey },
    });
    if (have) {
      // The assembly or its last meeting moved: the item goes along, unless
      // the chairman has already ticked it off.
      if (have.weekStartDate !== m.week && !have.readAt) {
        have.weekStartDate = m.week;
        have.position = await this.announcements.nextPosition(
          congregationId,
          m.week,
          'midweek',
        );
        await this.repo.save(have);
      }
      return false;
    }
    const cong = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, language: true },
    });
    const w = SUGGESTION_WORDS[coerceLanguage(cong?.language)];
    await this.repo.save(
      this.repo.create({
        congregationId,
        weekStartDate: m.week,
        eventType: 'midweek',
        position: await this.announcements.nextPosition(
          congregationId,
          m.week,
          'midweek',
        ),
        text: w.assemblyScreens({ programUrl: e.programUrl }),
        isLetter: false,
        source: SCREENS_SOURCE,
        sourceKey,
        sourceFacts: null,
        byRule: true,
        createdByUserId: null,
      }),
    );
    return true;
  }

  /** The overseer's task, once per event date; a deleted one stays deleted. */
  private async ensureTask(
    congregationId: string,
    kind: TaskKind,
    period: string,
    due: string,
  ): Promise<boolean> {
    const offered = await this.log.findOne({
      where: { congregationId, kind, period },
    });
    if (offered) {
      const open = await this.tasks.findOne({
        where: {
          congregationId,
          kind,
          kindPeriod: period,
          status: 'open',
          createdById: IsNull(),
        },
      });
      if (open && open.dueDate !== due) {
        open.dueDate = due;
        await this.tasks.save(open);
      }
      return false;
    }
    const held = await this.responsibilities.find({
      where: {
        congregationId,
        type: ResponsibilityType.LIFE_MINISTRY_OVERSEER,
      },
    });
    const userIds = held.map((r) => r.userId).filter(Boolean) as string[];
    const assignees = userIds.length
      ? await this.publishers.find({
          where: { congregationId, userId: In(userIds), removedAt: IsNull() },
        })
      : [];
    await this.tasks.save(
      this.tasks.create({
        congregationId,
        // A placeholder: the reader's own app writes the words from `kind`.
        title: kind,
        details: null,
        area: 'announcements',
        assigneeKind: 'people',
        assignees,
        assigneePublisherId: assignees[0]?.id ?? null,
        dueDate: due,
        kind,
        kindPeriod: period,
        status: 'open',
        createdById: null,
      }),
    );
    await this.log.save(this.log.create({ congregationId, kind, period }));
    return true;
  }

  /**
   * An assembly or convention that moved or was deleted: what the app made
   * for it and nobody touched goes — an unread item on a chairman's list, an
   * open task nobody created by hand.
   */
  private async tidy(
    congregationId: string,
    today: string,
    live: Set<string>,
  ): Promise<void> {
    const rows = await this.repo.find({
      where: { congregationId, source: SCREENS_SOURCE, byRule: true },
    });
    for (const a of rows) {
      if (a.readAt || !a.sourceKey) continue;
      const id = a.sourceKey
        .replace(/^rule:assembly_screens:/, '')
        .replace(/\.midweek$/, '');
      const e = await this.events.findOne({
        where: { id, congregationId, deletedAt: IsNull() },
      });
      if (!e || e.type !== 'circuit_assembly') await this.repo.remove(a);
    }
    const open = await this.tasks.find({
      where: {
        congregationId,
        kind: In(['assembly_screens', 'campaign_part']),
        status: 'open',
        createdById: IsNull(),
      },
    });
    for (const t of open) {
      if (!t.kindPeriod || t.kindPeriod < today) continue;
      if (!live.has(`${t.kind}|${t.kindPeriod}`)) await this.tasks.remove(t);
    }
  }

  // ---- The overseer's view of the item ---------------------------------

  /** The writers and the overseer of the Life and Ministry meeting. */
  private async assertMay(user: AuthenticatedUser): Promise<void> {
    if (await this.announcements.mayWrite(user)) return;
    const held = await this.responsibilities.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: ResponsibilityType.LIFE_MINISTRY_OVERSEER,
      },
    });
    if (!held) {
      throw new ForbiddenException(
        refusal(
          'NEEDS_RESPONSIBILITY',
          'Requires the overseer of the Life and Ministry meeting.',
          {
            responsibilities: [
              ResponsibilityType.LIFE_MINISTRY_OVERSEER,
              ResponsibilityType.BODY_COORDINATOR,
            ],
          },
        ),
      );
    }
  }

  private async assemblyOn(
    congregationId: string,
    date: string,
  ): Promise<SpecialEvent | null> {
    return this.events.findOne({
      where: {
        congregationId,
        date,
        type: 'circuit_assembly',
        deletedAt: IsNull(),
      },
    });
  }

  /**
   * For the task's page: where the item stands. `placed` — on the list;
   * `removed` — taken off; `later` — the app puts it three weeks ahead;
   * `none` — no assembly that day, or no midweek meeting before it.
   */
  async screensState(
    user: AuthenticatedUser,
    date: string,
  ): Promise<{
    state: 'placed' | 'removed' | 'later' | 'none';
    meetingDate: string | null;
    read: boolean;
  }> {
    await this.assertMay(user);
    const congregationId = user.congregationId;
    const e = await this.assemblyOn(congregationId, date);
    if (!e) return { state: 'none', meetingDate: null, read: false };
    const m = await this.screensMeeting(congregationId, e.date);
    if (!m) return { state: 'none', meetingDate: null, read: false };
    const base = screensKey(e.id);
    if (
      await this.dismissals.findOne({
        where: { congregationId, sourceKey: base },
      })
    )
      return { state: 'removed', meetingDate: m.date, read: false };
    const row = await this.repo.findOne({
      where: { congregationId, sourceKey: `${base}.midweek` },
    });
    if (row)
      return { state: 'placed', meetingDate: m.date, read: !!row.readAt };
    return { state: 'later', meetingDate: m.date, read: false };
  }

  /** «Take it off the chairman's list» — and do not put it back. */
  async removeScreens(user: AuthenticatedUser, date: string): Promise<void> {
    await this.assertMay(user);
    const congregationId = user.congregationId;
    const e = await this.assemblyOn(congregationId, date);
    if (!e) return;
    const base = screensKey(e.id);
    const row = await this.repo.findOne({
      where: { congregationId, sourceKey: `${base}.midweek` },
    });
    if (row) await this.repo.remove(row);
    await this.dismissals
      .createQueryBuilder()
      .insert()
      .values({
        congregationId,
        sourceKey: base,
        weekStartDate: mondayOf(e.date),
      })
      .orIgnore()
      .execute();
  }

  /** «Put it back» — the app places it again at once if it is time. */
  async restoreScreens(user: AuthenticatedUser, date: string): Promise<void> {
    await this.assertMay(user);
    const congregationId = user.congregationId;
    const e = await this.assemblyOn(congregationId, date);
    if (!e) return;
    await this.dismissals.delete({
      congregationId,
      sourceKey: screensKey(e.id),
    });
    await this.forCongregation(congregationId);
  }
}
