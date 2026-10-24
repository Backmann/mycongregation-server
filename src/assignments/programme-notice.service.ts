import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Congregation } from '../entities/congregation.entity';
import { ProgrammeNotice } from '../entities/programme-notice.entity';
import { EventType } from '../common/enums/event-type.enum';
import {
  DEFAULT_CONGREGATION_TIMEZONE,
  minutesOfDayIn,
  todayIn,
} from '../common/congregation-clock';
import { WeekRulesService } from '../common/week-rules.service';
import { versionForWeek } from '../common/week-rules';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AssignmentRemindersService,
  PendingNoticeRow,
} from '../assignment-reminders/assignment-reminders.service';
import { AssignmentsService } from './assignments.service';
import { refusal } from '../common/errors/refusal';

/**
 * AN EDIT OF A PUBLISHED MEETING IS SAID BY ITSELF (21 October 2026).
 *
 * «Уведомить» was a button nobody had to press, and left alone it stood on
 * the meeting for days — while the evening reminders had long told everybody
 * (Lionel: «будет лучше зафиксировать как есть и кнопку уведомить убрать»).
 * Taking the button away without a promise would be worse: the brother whose
 * part was given to somebody else must hear of it, or he comes prepared for a
 * part that is no longer his. So the server says it, and the card says when:
 *
 *  - ten minutes after the LAST edit — corrections in between restart the
 *    wait, and one message goes out, not three;
 *  - one minute after it, when the meeting is less than three hours away;
 *  - at 18:00, when the editor chose «Отправить вечером» (offered only when
 *    that evening is still three hours before the meeting);
 *  - never at night: what falls due between 21:00 and 08:00 goes at 08:00
 *    (NotificationsService's quiet hours, the same everywhere);
 *  - nothing about a meeting that has begun or passed: its marks are cleared.
 *
 * The «изменено» flags on the assignments stay what they were — «not told
 * yet» — and are cleared by the sending itself (AssignmentsService.
 * notifyChanges). Decisions are pure functions below, pinned by the spec.
 */

/** How long after the last edit a change is said. */
export const SETTLE_MS = 10 * 60 * 1000;
/** …and when the meeting is near. */
export const SOON_SETTLE_MS = 60 * 1000;
/** «Near»: the meeting starts within this many minutes. */
export const SOON_MINUTES = 3 * 60;
/** «Отправить вечером» — this hour, the congregation's own time. */
export const EVENING_HOUR = 18;

export type NoticeState = 'none' | 'pending' | 'evening' | 'sent';

export interface NoticeStatus {
  state: NoticeState;
  /** When the change goes out (pending, evening). */
  dueAt: string | null;
  /** The meeting is less than three hours away: no waiting on offer. */
  soon: boolean;
  /** «Отправить вечером» is on offer, and when that would be. */
  eveningAt: string | null;
  /** Who hears what — the same rows the old window showed. */
  rows: PendingNoticeRow[];
  /** The last sending of this meeting's changes, today. */
  sentAt: string | null;
  sentNames: string | null;
}

/** When an edit falls due — before quiet hours are applied. Pure. */
export function dueOf(input: {
  lastEditMs: number;
  holdUntilMs: number | null;
  minutesToMeeting: number | null;
}): number {
  const soon =
    input.minutesToMeeting !== null && input.minutesToMeeting <= SOON_MINUTES;
  if (input.holdUntilMs !== null && !soon) return input.holdUntilMs;
  return input.lastEditMs + (soon ? SOON_SETTLE_MS : SETTLE_MS);
}

/** The next moment (at or after `from`) the local clock reads hh:00. Pure. */
export function nextLocalHour(
  from: Date,
  timezone: string,
  hour: number,
): Date {
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  // Up to the next quarter hour, then forward a quarter at a time: correct on
  // the days the clocks change, and for zones a half hour off UTC.
  t.setUTCMinutes(Math.ceil(t.getUTCMinutes() / 15) * 15);
  if (t.getTime() < from.getTime()) t.setUTCMinutes(t.getUTCMinutes() + 15);
  for (let i = 0; i < 4 * 48; i += 1) {
    const { hour: h, minute: m } = NotificationsService.localHourMinute(
      t,
      timezone,
    );
    if (h === hour && m === 0) return t;
    t.setUTCMinutes(t.getUTCMinutes() + 15);
  }
  return t;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

function minutesOf(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

type Meeting = {
  congregationId: string;
  weekStartDate: string;
  eventType: EventType;
};

const isMeeting = (t: EventType): boolean =>
  t === EventType.MIDWEEK || t === EventType.WEEKEND;

const NONE: NoticeStatus = {
  state: 'none',
  dueAt: null,
  soon: false,
  eveningAt: null,
  rows: [],
  sentAt: null,
  sentNames: null,
};

@Injectable()
export class ProgrammeNoticeService {
  private readonly logger = new Logger(ProgrammeNoticeService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(ProgrammeNotice)
    private readonly notices: Repository<ProgrammeNotice>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly weekRules: WeekRulesService,
    private readonly reminders: AssignmentRemindersService,
    private readonly assignmentsService: AssignmentsService,
  ) {}

  private async timezoneOf(congregationId: string): Promise<string> {
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    return c?.timezone || DEFAULT_CONGREGATION_TIMEZONE;
  }

  /** Minutes from now to the meeting's start, or null when it is not held that week. */
  async minutesToMeeting(
    m: Meeting,
    now: Date,
    tz: string,
  ): Promise<number | null> {
    const ctx = await this.weekRules.contextOf(m.congregationId);
    const rules = this.weekRules.rulesFrom(ctx, m.weekStartDate);
    const date = rules.meetings.find(
      (x) => (x.kind as string) === m.eventType,
    )?.date;
    if (!date) return null;
    const version = versionForWeek(ctx.versions, m.weekStartDate);
    const start = minutesOf(
      m.eventType === EventType.MIDWEEK
        ? version?.midweekTime
        : version?.weekendTime,
    );
    if (start === null) return null;
    return (
      daysBetween(todayIn(now, tz), date) * 1440 +
      start -
      minutesOfDayIn(now, tz)
    );
  }

  private async changed(m: Meeting): Promise<Assignment[]> {
    return this.assignments.find({
      where: { ...m, changedSincePublish: true },
      // A part removed from a published meeting waits to be said too.
      withDeleted: true,
    });
  }

  private async row(m: Meeting): Promise<ProgrammeNotice | null> {
    return this.notices.findOne({ where: m });
  }

  /** «Отправить вечером» — or null when that evening is too close to the meeting. */
  private eveningFor(
    now: Date,
    tz: string,
    minutesToMeeting: number | null,
  ): Date | null {
    if (minutesToMeeting !== null && minutesToMeeting <= SOON_MINUTES)
      return null;
    // This evening only: after 18:00 «вечером» would mean tomorrow, and a
    // change held a whole day is a change said too late. Nor when the ten
    // minutes would bring it out before 18:00 anyway — there is nothing to
    // hold.
    if (todayIn(now, tz) !== todayIn(new Date(now.getTime() + SETTLE_MS), tz))
      return null;
    if (minutesOfDayIn(now, tz) + SETTLE_MS / 60_000 >= EVENING_HOUR * 60)
      return null;
    const evening = nextLocalHour(now, tz, EVENING_HOUR);
    if (minutesToMeeting === null) return evening;
    const startMs = now.getTime() + minutesToMeeting * 60_000;
    return evening.getTime() <= startMs - SOON_MINUTES * 60_000
      ? evening
      : null;
  }

  /** The line on the meeting's card. */
  async status(m: Meeting, now = new Date()): Promise<NoticeStatus> {
    if (!isMeeting(m.eventType)) return NONE;
    const tz = await this.timezoneOf(m.congregationId);
    const [changed, row, toMeeting] = await Promise.all([
      this.changed(m),
      this.row(m),
      this.minutesToMeeting(m, now, tz),
    ]);
    const soon = toMeeting !== null && toMeeting <= SOON_MINUTES;
    const evening = this.eveningFor(now, tz, toMeeting);
    const sentToday =
      row?.sentAt && todayIn(row.sentAt, tz) === todayIn(now, tz)
        ? row.sentAt
        : null;
    const base = {
      soon,
      eveningAt: evening ? evening.toISOString() : null,
      sentAt: sentToday ? sentToday.toISOString() : null,
      sentNames: sentToday ? (row?.sentNames ?? null) : null,
    };
    if (changed.length === 0 || (toMeeting !== null && toMeeting < 0)) {
      return {
        ...base,
        state: sentToday ? 'sent' : 'none',
        dueAt: null,
        rows: [],
      };
    }
    const lastEditMs = Math.max(
      ...changed.map((a) => new Date(a.updatedAt).getTime()),
    );
    const holdUntilMs =
      row?.holdUntil && row.holdUntil.getTime() > now.getTime()
        ? row.holdUntil.getTime()
        : null;
    let due = dueOf({ lastEditMs, holdUntilMs, minutesToMeeting: toMeeting });
    if (!soon)
      due =
        NotificationsService.computeNotBefore(new Date(due), tz)?.getTime() ??
        due;
    const pending = await this.reminders.pendingNotice(
      m.congregationId,
      m.weekStartDate,
      m.eventType as 'midweek' | 'weekend',
      now,
    );
    return {
      ...base,
      state: holdUntilMs !== null && !soon ? 'evening' : 'pending',
      dueAt: new Date(due).toISOString(),
      rows: pending.rows,
    };
  }

  /** «Отправить вечером». */
  async later(m: Meeting, now = new Date()): Promise<NoticeStatus> {
    if (!isMeeting(m.eventType)) return NONE;
    const tz = await this.timezoneOf(m.congregationId);
    const evening = this.eveningFor(
      now,
      tz,
      await this.minutesToMeeting(m, now, tz),
    );
    if (!evening) {
      throw new BadRequestException(
        refusal(
          'NOTICE_NO_EVENING',
          'No evening is left before the meeting: the change goes out now.',
        ),
      );
    }
    await this.upsert(m, { holdUntil: evening });
    return this.status(m, now);
  }

  /** «Отправить сейчас» — and what the job does when the time has come. */
  async sendNow(m: Meeting, now = new Date()): Promise<{ notified: number }> {
    if (!isMeeting(m.eventType)) {
      return this.assignmentsService.notifyChanges(
        m.congregationId,
        m.weekStartDate,
        m.eventType,
      );
    }
    const tz = await this.timezoneOf(m.congregationId);
    const toMeeting = await this.minutesToMeeting(m, now, tz);
    if (toMeeting !== null && toMeeting < 0) {
      // The meeting has begun or is over: nothing about it is news, and an
      // edit now is the record being put right, not a change to announce.
      await this.assignments.update(
        { ...m, changedSincePublish: true },
        { changedSincePublish: false },
      );
      return { notified: 0 };
    }
    const pending = await this.reminders.pendingNotice(
      m.congregationId,
      m.weekStartDate,
      m.eventType as 'midweek' | 'weekend',
      now,
    );
    const res = await this.assignmentsService.notifyChanges(
      m.congregationId,
      m.weekStartDate,
      m.eventType,
    );
    if (res.notified > 0) {
      // Pressed at night, it is held for the morning by the notifications'
      // quiet hours: the card says when it really goes.
      const goes = NotificationsService.computeNotBefore(now, tz) ?? now;
      const names = [
        ...new Set(
          pending.rows
            .filter((r) => r.reach !== 'none')
            .map((r) => r.displayName)
            .filter(Boolean),
        ),
      ].join(', ');
      await this.upsert(m, {
        holdUntil: null,
        sentAt: goes,
        sentNames: names || null,
      });
    }
    return res;
  }

  private async upsert(
    m: Meeting,
    patch: Partial<ProgrammeNotice>,
  ): Promise<void> {
    const row = await this.row(m);
    if (row) {
      await this.notices.update({ id: row.id }, patch);
    } else {
      await this.notices.save(
        this.notices.create({
          ...m,
          holdUntil: null,
          sentAt: null,
          sentNames: null,
          ...patch,
        }),
      );
    }
  }

  /** Every minute: the changes whose time has come go out. */
  private running = false;

  async runDue(now = new Date()): Promise<number> {
    // A slow pass must not meet the next minute's: one message, not two.
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.runDueOnce(now);
    } finally {
      this.running = false;
    }
  }

  private async runDueOnce(now: Date): Promise<number> {
    const groups: {
      congregationId: string;
      weekStartDate: string;
      eventType: EventType;
      last: Date;
    }[] = await this.assignments
      .createQueryBuilder('a')
      .select('a.congregation_id', 'congregationId')
      .addSelect("to_char(a.week_start_date, 'YYYY-MM-DD')", 'weekStartDate')
      .addSelect('a.event_type', 'eventType')
      .addSelect('max(a.updated_at)', 'last')
      .where('a.changed_since_publish = true')
      .andWhere('a.event_type IN (:...kinds)', {
        kinds: [EventType.MIDWEEK, EventType.WEEKEND],
      })
      .groupBy('a.congregation_id')
      .addGroupBy('a.week_start_date')
      .addGroupBy('a.event_type')
      .getRawMany();
    let sent = 0;
    for (const g of groups) {
      const m: Meeting = {
        congregationId: g.congregationId,
        weekStartDate: g.weekStartDate,
        eventType: g.eventType,
      };
      try {
        const tz = await this.timezoneOf(m.congregationId);
        const toMeeting = await this.minutesToMeeting(m, now, tz);
        if (toMeeting !== null && toMeeting < 0) {
          await this.sendNow(m, now); // clears the marks, says nothing
          continue;
        }
        const soon = toMeeting !== null && toMeeting <= SOON_MINUTES;
        // Not at night — the morning says it (soon cannot fall at night: no
        // meeting starts before 03:00).
        if (!soon && NotificationsService.computeNotBefore(now, tz)) continue;
        const row = await this.row(m);
        const holdUntilMs =
          row?.holdUntil && row.holdUntil.getTime() > now.getTime()
            ? row.holdUntil.getTime()
            : null;
        const due = dueOf({
          lastEditMs: new Date(g.last).getTime(),
          holdUntilMs,
          minutesToMeeting: toMeeting,
        });
        if (now.getTime() < due) continue;
        const res = await this.sendNow(m, now);
        if (res.notified > 0) sent += 1;
      } catch (err) {
        this.logger.warn(
          `programme notice ${m.weekStartDate} ${m.eventType}: ${(err as Error)?.message ?? err}`,
        );
      }
    }
    return sent;
  }

  /** For the app's list of meetings: which of them wait to be said. */
  async waiting(
    congregationId: string,
    weekStartDates: string[],
  ): Promise<Meeting[]> {
    if (weekStartDates.length === 0) return [];
    const rows = await this.assignments.find({
      where: {
        congregationId,
        weekStartDate: In(weekStartDates),
        changedSincePublish: true,
      },
      select: { weekStartDate: true, eventType: true },
      withDeleted: true,
    });
    const seen = new Map<string, Meeting>();
    for (const r of rows) {
      seen.set(`${r.weekStartDate}|${r.eventType}`, {
        congregationId,
        weekStartDate: r.weekStartDate,
        eventType: r.eventType,
      });
    }
    return [...seen.values()];
  }
}
