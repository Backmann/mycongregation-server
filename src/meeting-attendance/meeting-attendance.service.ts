import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, Repository } from 'typeorm';
import {
  MeetingAttendance,
  type NotHeldReason,
} from '../entities/meeting-attendance.entity';
import { ReportSnapshot } from '../entities/report-snapshot.entity';
import { User } from '../entities/user.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Publisher } from '../entities/publisher.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { minutesOfDayIn, todayIn } from '../common/congregation-clock';
import { mondayOf } from '../common/week';
import { rulesFromContext } from '../common/week-rules.service';
import { refusal } from '../common/errors/refusal';

/** One meeting's figure as the report reads it. */
export interface AttendanceRow {
  date: string;
  eventType: EventType;
  count: number | null;
  /** The part of `count` that joined by video; null when nobody said. */
  onlineCount?: number | null;
  notHeld: boolean;
  /** Why it was not held: 'weather' | 'hall' | 'other'. */
  notHeldReason?: NotHeldReason | null;
  note?: string | null;
  /** Who put the figure there, and when — a report handed on should say. */
  recordedByName?: string | null;
  recordedAt?: string | null;
  /**
   * True when the figure was changed after it was first entered. Not a
   * reproach: a correction is proper and expected. But a number that was
   * revised should say so on the face of the sheet rather than only in the
   * journal, because the person signing it is the one who has to answer for it.
   */
  corrected?: boolean;
  /**
   * A figure recorded on a day that, by today's rules, has no meeting of
   * this kind — the visit's day changed or the visit was removed after the
   * meeting (24 October 2026, events audit M2). The meeting was held and
   * people came: counted in the month, and marked so the reader sees why it
   * stands off the usual days.
   */
  offSchedule?: boolean;
  /**
   * False when the meeting took place but nobody has entered a figure yet.
   * The sheet lists the year's MEETINGS, not the year's records: a week with
   * no entry has to be visible as a hole, or a reader cannot see that the
   * figures run week after week — and a gap that shows as nothing at all is a
   * gap nobody notices.
   */
  recorded: boolean;
}

/** A month of the service year, per meeting kind. */
export interface AttendanceMonth {
  /** First of the month, YYYY-MM-01. */
  month: string;
  midweek: AttendanceRow[];
  weekend: AttendanceRow[];
  midweekTotal: number;
  midweekAverage: number | null;
  weekendTotal: number;
  weekendAverage: number | null;
  /**
   * The Memorial, kept apart from the two.
   *
   * A line of its own rather than a third column: it happens once a year, and
   * a column for it would stand empty for eleven months and widen every sheet
   * that carries it. Empty in every month but the one — Lionel's decision.
   */
  memorial: AttendanceRow[];
  memorialTotal: number;
  /**
   * Meetings of the month that took place and still have no figure — the
   * month's average is then built on fewer meetings than it had, and every
   * sheet that reads it says so (31 October 2026).
   */
  midweekMissing: number;
  weekendMissing: number;
  /** The video part of the month's average, where it was given. */
  midweekOnlineAverage: number | null;
  weekendOnlineAverage: number | null;
}

/** The year's line, worked out HERE and nowhere else (31 October 2026). */
export interface AttendanceYearly {
  /**
   * The monthly averages added up and divided by the months that hold one.
   * The form's «divide by twelve» is written for a finished year, where every
   * month has a figure and the two agree; in the middle of a year dividing by
   * twelve turned 96 into 16 — which is what the printed sheet did, while the
   * screen, the S-10 page and the server each counted it their own way.
   */
  midweekAverage: number | null;
  weekendAverage: number | null;
  midweekMonths: number;
  weekendMonths: number;
  midweekOnlineAverage: number | null;
  weekendOnlineAverage: number | null;
  /** Meetings that took place by today, and how many of them have an entry. */
  expected: number;
  recorded: number;
}

export interface AttendanceYear {
  /** The September the service year starts in. */
  startYear: number;
  months: AttendanceMonth[];
  yearly: AttendanceYearly;
  /** Meetings that took place with no figure, oldest first. */
  gaps: { date: string; eventType: EventType }[];
  /** The year before, month by month — for «прошлый октябрь: 98». */
  previous: {
    months: {
      month: string;
      midweekAverage: number | null;
      weekendAverage: number | null;
    }[];
    midweekAverage: number | null;
    weekendAverage: number | null;
  } | null;
  /**
   * What already went to the branch: the S-10 of this year with its two
   * averages, and the months whose S-1 was sent. A figure changed after that
   * is asked about first — the form went out with the old one.
   */
  sent: {
    annual: {
      midweekAverage: number | null;
      weekendAverage: number | null;
    } | null;
    months: string[];
  };
}

/** What Home needs (31 October 2026). */
export interface PendingAttendance {
  /** Today's meetings open for a figure and still without one, newest first. */
  meetings: { date: string; eventType: EventType }[];
  /**
   * Today's open meetings that HAVE a figure — the card stays until midnight
   * as «Записано: 96 · изменить», so a slip of the finger is put right on the
   * spot instead of being looked for in the sheet.
   */
  recordedToday: AttendanceRow[];
  /**
   * Every meeting still without a figure: the current service year, and
   * until 20 September the year that just ended too — its August is what the
   * S-10 due by then is made from, and it used to vanish on the 1st.
   */
  outstandingThisYear: number;
  outstandingPreviousYear: number;
  /** The newest few of them, for Home to name. */
  gaps: { date: string; eventType: EventType }[];
}

interface WeekContext {
  versions: MeetingSettings[];
  visits: SpecialEvent[];
  cancelling: SpecialEvent[];
  memorials: SpecialEvent[];
  flagged: SpecialEvent[];
  /** Events whose day keeps its meeting «with changes» — maybe another hour. */
  changed: SpecialEvent[];
}

/** The S-10's own deadline: the closed year's debt is shown until then. */
const PREVIOUS_YEAR_UNTIL_DAY = 20;

@Injectable()
export class MeetingAttendanceService {
  constructor(
    @InjectRepository(MeetingAttendance)
    private readonly repo: Repository<MeetingAttendance>,
    @InjectRepository(MeetingSettings)
    private readonly settingsRepo: Repository<MeetingSettings>,
    @InjectRepository(SpecialEvent)
    private readonly eventsRepo: Repository<SpecialEvent>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
    @Optional()
    @InjectRepository(ReportSnapshot)
    private readonly snapshots?: Repository<ReportSnapshot>,
    @Optional()
    @InjectRepository(User)
    private readonly users?: Repository<User>,
  ) {}

  /**
   * Record (or correct) one meeting's figure.
   *
   * Upsert by the meeting itself rather than by row id: whoever counts thinks
   * "the midweek meeting on the 20th", not "record 4f3a…", and a second row
   * for the same meeting would quietly double that month's total.
   */
  async record(
    tenantId: string,
    dto: {
      date: string;
      eventType: EventType;
      count?: number | null;
      onlineCount?: number | null;
      notHeld?: boolean;
      notHeldReason?: NotHeldReason | null;
      note?: string | null;
      expectNew?: boolean;
      expectedRecordedAt?: string;
    },
    userId: string,
  ): Promise<MeetingAttendance> {
    const notHeld = dto.notHeld === true;
    if (!notHeld && (dto.count === undefined || dto.count === null)) {
      throw new BadRequestException(
        refusal('ATTENDANCE_NEEDS_FIGURE', 'A held meeting needs a figure.'),
      );
    }
    if (
      !notHeld &&
      (!Number.isInteger(dto.count) || (dto.count as number) < 0)
    ) {
      throw new BadRequestException(
        refusal('ATTENDANCE_NEGATIVE', 'Attendance cannot be negative.'),
      );
    }
    const online = notHeld ? null : (dto.onlineCount ?? null);
    if (online !== null && online > (dto.count as number)) {
      throw new BadRequestException(
        refusal(
          'ATTENDANCE_ONLINE_TOO_MANY',
          'Those by video are part of the figure, not more than it.',
        ),
      );
    }

    const existing = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        date: dto.date,
        eventType: dto.eventType,
      },
    });

    // A meeting still ahead has nobody to count, and a day with no meeting
    // of that kind has nothing to count at (31 October 2026). The app only
    // ever offers real meetings; this is the server keeping to it. A figure
    // already standing on such a day (a visit moved after it was entered)
    // may still be corrected — that is what it is there for.
    if (!existing)
      await this.assertIsMeeting(tenantId, dto.date, dto.eventType);

    // Two people at once: the second is told, not quietly written over.
    if (existing && dto.expectNew === true) {
      throw new ConflictException(
        refusal(
          'ATTENDANCE_ALREADY_RECORDED',
          'Somebody has already recorded this meeting.',
          await this.alreadyRecorded(existing),
        ),
      );
    }
    if (
      existing &&
      dto.expectedRecordedAt &&
      Math.abs(
        new Date(existing.updatedAt).getTime() -
          new Date(dto.expectedRecordedAt).getTime(),
      ) > 1000
    ) {
      throw new ConflictException(
        refusal(
          'ATTENDANCE_ALREADY_RECORDED',
          'Somebody has already recorded this meeting.',
          await this.alreadyRecorded(existing),
        ),
      );
    }

    const next = {
      count: notHeld ? null : (dto.count as number),
      onlineCount: online,
      notHeld,
      notHeldReason: notHeld ? (dto.notHeldReason ?? null) : null,
      note:
        dto.note === undefined
          ? (existing?.note ?? null)
          : dto.note?.trim()
            ? dto.note.trim()
            : null,
    };
    const before = existing
      ? {
          count: existing.count,
          onlineCount: existing.onlineCount ?? null,
          notHeld: existing.notHeld,
          notHeldReason: existing.notHeldReason ?? null,
          note: existing.note ?? null,
        }
      : null;
    // Saving the same thing again changes nothing — and must not mark the
    // figure «изменено» on the sheet or move its stamp.
    if (
      before &&
      before.count === next.count &&
      before.onlineCount === next.onlineCount &&
      before.notHeld === next.notHeld &&
      before.notHeldReason === next.notHeldReason &&
      before.note === next.note
    ) {
      return existing as MeetingAttendance;
    }

    const row =
      existing ??
      this.repo.create({
        congregationId: tenantId,
        date: dto.date,
        eventType: dto.eventType,
      });
    row.count = next.count;
    row.onlineCount = next.onlineCount;
    row.notHeld = next.notHeld;
    row.notHeldReason = next.notHeldReason;
    row.note = next.note;
    row.recordedBy = userId;
    const saved = await this.repo.save(row);

    // Worth a journal entry: a figure that quietly changes after the fact is
    // exactly what a report to the circuit overseer must not do.
    if (before) {
      await this.auditLog.logUpdate({
        tenantId,
        entityType: 'meeting_attendance',
        entityId: saved.id,
        before,
        after: next,
        fields: ['count', 'onlineCount', 'notHeld', 'notHeldReason', 'note'],
      });
    } else {
      await this.auditLog.logCreate({
        tenantId,
        entityType: 'meeting_attendance',
        entityId: saved.id,
        after: {
          date: saved.date,
          eventType: saved.eventType,
          count: saved.count,
          onlineCount: saved.onlineCount,
          notHeld: saved.notHeld,
          notHeldReason: saved.notHeldReason,
        },
      });
    }
    return saved;
  }

  /**
   * Take a figure away — one entered on the wrong day, which «not held»
   * could only grey out while it kept standing in the month (31 October 2026).
   */
  async remove(
    tenantId: string,
    dto: { date: string; eventType: EventType },
  ): Promise<{ removed: true }> {
    const row = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        date: dto.date,
        eventType: dto.eventType,
      },
    });
    if (!row) {
      throw new NotFoundException(
        refusal('ATTENDANCE_NOT_FOUND', 'There is no such figure.'),
      );
    }
    await this.repo.delete({ id: row.id });
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'meeting_attendance',
      entityId: row.id,
      action: 'DELETE',
      detail: {
        date: row.date,
        eventType: row.eventType,
        count: row.count,
        notHeld: row.notHeld,
      },
    });
    return { removed: true };
  }

  /**
   * Move a figure to the meeting it belongs to.
   *
   * The day of a meeting can change after its figure is in — the settings
   * changed backwards, a visit moved. The figure then stood on a day with no
   * meeting and the true day showed a hole, both in the same month, with no
   * way to bring them together (31 October 2026). Only onto a meeting of the
   * same kind that took place and has no figure of its own.
   */
  async move(
    tenantId: string,
    dto: { date: string; eventType: EventType; toDate: string },
  ): Promise<MeetingAttendance> {
    const row = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        date: dto.date,
        eventType: dto.eventType,
      },
    });
    if (!row) {
      throw new NotFoundException(
        refusal('ATTENDANCE_NOT_FOUND', 'There is no such figure.'),
      );
    }
    const taken = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        date: dto.toDate,
        eventType: dto.eventType,
      },
    });
    if (taken) {
      throw new BadRequestException(
        refusal('ATTENDANCE_MOVE_TARGET', 'That meeting already has a figure.'),
      );
    }
    await this.assertIsMeeting(tenantId, dto.toDate, dto.eventType);
    const from = row.date;
    row.date = dto.toDate;
    const saved = await this.repo.save(row);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'meeting_attendance',
      entityId: saved.id,
      before: { date: from },
      after: { date: dto.toDate },
      fields: ['date'],
    });
    return saved;
  }

  /** «Already recorded by …: 96» — what the second person is told. */
  private async alreadyRecorded(
    existing: MeetingAttendance,
  ): Promise<Record<string, unknown>> {
    const names = await this.namesOfRecorders([existing]);
    return {
      current: {
        count: existing.count,
        onlineCount: existing.onlineCount ?? null,
        notHeld: existing.notHeld,
        recordedByName: names.get(existing.recordedBy ?? '') ?? null,
        recordedAt: existing.updatedAt
          ? new Date(existing.updatedAt).toISOString()
          : null,
      },
    };
  }

  /** Refuse a day still ahead, or a day with no meeting of that kind. */
  private async assertIsMeeting(
    tenantId: string,
    date: string,
    eventType: EventType,
  ): Promise<void> {
    const today = await this.clock.todayFor(tenantId);
    if (date.slice(0, 10) > today) {
      throw new BadRequestException(
        refusal('ATTENDANCE_FUTURE', 'That meeting has not taken place yet.'),
      );
    }
    const ctx = await this.weekContext(tenantId);
    // A congregation with no meeting days yet has nothing to check against.
    if (!ctx) return;
    const day = date.slice(0, 10);
    const ok = this.meetingsOfWeek(mondayOf(day), ctx).some(
      (m) => m.date === day && m.eventType === eventType,
    );
    if (!ok) {
      throw new BadRequestException(
        refusal(
          'ATTENDANCE_NOT_A_MEETING',
          'There is no meeting of that kind on that day.',
        ),
      );
    }
  }

  /**
   * Meetings that have already taken place and have no figure yet, newest
   * first — what the home card offers to record.
   *
   * The meeting day is worked out HERE rather than in the app because the
   * rules already live on this side: the settings version in force for that
   * week decides the weekday, and a circuit overseer's visit moves the midweek
   * meeting. A second copy of that arithmetic in the client would drift from
   * this one, and the two would disagree about which meeting a figure belongs
   * to — the one mistake this table's unique constraint cannot catch.
   */
  async pending(tenantId: string): Promise<PendingAttendance> {
    const ctx = await this.weekContext(tenantId);
    if (!ctx) {
      return {
        meetings: [],
        recordedToday: [],
        outstandingThisYear: 0,
        outstandingPreviousYear: 0,
        gaps: [],
      };
    }

    const timezone = await this.clock.timezoneOf(tenantId);
    const now = new Date(Date.now());
    const today = todayIn(now, timezone);
    const nowMinutes = minutesOfDayIn(now, timezone);
    // Only today's meetings can be open (attendanceOpen), so only this week
    // is looked at — it used to walk eight weeks to find them.
    const open = this.meetingsOfWeek(mondayOf(today), ctx).filter((m) =>
      attendanceOpen(
        m.date,
        this.startTimeOf(m.date, m.eventType, ctx),
        today,
        nowMinutes,
      ),
    );
    const todays = open.length
      ? await this.repo.find({
          where: { congregationId: tenantId, date: today },
        })
      : [];
    const byKey = new Map(todays.map((r) => [`${r.date}|${r.eventType}`, r]));
    const names = await this.namesOfRecorders(todays);
    const meetings = open
      .filter((m) => !byKey.has(`${m.date}|${m.eventType}`))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const recordedToday = open
      .filter((m) => byKey.has(`${m.date}|${m.eventType}`))
      .map((m) => this.rowOf(m, byKey.get(`${m.date}|${m.eventType}`), names));

    const y = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const startYear = month >= 9 ? y : y - 1;
    const thisYear = await this.gapsBetween(
      tenantId,
      ctx,
      `${startYear}-09-01`,
      today,
    );
    // The year just closed stays in view until its S-10 is due.
    const previous =
      month === 9 && Number(today.slice(8, 10)) <= PREVIOUS_YEAR_UNTIL_DAY
        ? await this.gapsBetween(
            tenantId,
            ctx,
            `${startYear - 1}-09-01`,
            `${startYear}-08-31`,
          )
        : [];
    const all = [...previous, ...thisYear];
    return {
      meetings,
      recordedToday,
      outstandingThisYear: all.length,
      outstandingPreviousYear: previous.length,
      gaps: all.slice(-6).reverse(),
    };
  }

  /** Meetings between two days that took place and have no figure. */
  private async gapsBetween(
    tenantId: string,
    ctx: WeekContext,
    from: string,
    to: string,
  ): Promise<{ date: string; eventType: EventType }[]> {
    const rows = await this.range(tenantId, from, to);
    const done = new Set(rows.map((r) => `${r.date}|${r.eventType}`));
    const out: { date: string; eventType: EventType }[] = [];
    let week = mondayOf(from);
    const lastWeek = mondayOf(to);
    while (week <= lastWeek) {
      for (const m of this.meetingsOfWeek(week, ctx)) {
        if (m.date > to || m.date < from) continue;
        if (!done.has(`${m.date}|${m.eventType}`)) out.push(m);
      }
      week = addDaysISO(week, 7);
    }
    return out;
  }

  /**
   * Today's meetings that took place and still have no figure — for the
   * evening reminder (31 October 2026), with the hour each began.
   */
  async unrecordedToday(
    tenantId: string,
    today: string,
  ): Promise<{ date: string; eventType: EventType; time: string | null }[]> {
    const ctx = await this.weekContext(tenantId);
    if (!ctx) return [];
    const mine = this.meetingsOfWeek(mondayOf(today), ctx).filter(
      (m) => m.date === today,
    );
    if (mine.length === 0) return [];
    const rows = await this.repo.find({
      where: { congregationId: tenantId, date: today },
    });
    const done = new Set(rows.map((r) => r.eventType));
    return mine
      .filter((m) => !done.has(m.eventType))
      .map((m) => ({ ...m, time: this.startTimeOf(m.date, m.eventType, ctx) }));
  }

  /**
   * The meetings of ONE week that actually took place, ignoring today — the
   * piece worth testing on its own, since every rule about which meetings
   * exist lives here.
   */
  async pendingForWeek(
    tenantId: string,
    weekStart: string,
  ): Promise<{ date: string; eventType: EventType }[]> {
    const ctx = await this.weekContext(tenantId);
    if (!ctx) return [];
    return this.meetingsOfWeek(weekStart, ctx);
  }

  /**
   * Everything the hall HOSTS that week — the meetings and the Memorial.
   *
   * Not the same question as `pendingForWeek`, and the difference matters. The
   * Memorial takes a meeting AWAY, so it is rightly absent from the list of
   * meetings whose attendance is recorded under «midweek» or «weekend». But
   * the hall is full that evening and wants cleaning afterwards more than
   * usual — and the reminder, which asked the meetings list, stayed silent.
   *
   * The rule it inherited was written for a convention: that takes the
   * congregation ELSEWHERE, so nothing needs cleaning. The Memorial is the
   * opposite case — it gathers the congregation at home.
   *
   * The Memorial brings its OWN hour: it does not start when a midweek meeting
   * would, and the caller must not reach for the settings to find it.
   */
  async gatheringsForWeek(
    tenantId: string,
    weekStart: string,
  ): Promise<
    {
      date: string;
      kind: 'midweek' | 'weekend' | 'memorial';
      time: string | null;
    }[]
  > {
    const ctx = await this.weekContext(tenantId);
    if (!ctx) return [];
    const out: {
      date: string;
      kind: 'midweek' | 'weekend' | 'memorial';
      time: string | null;
    }[] = this.meetingsOfWeek(weekStart, ctx).map((m) => ({
      date: m.date,
      kind:
        m.eventType === EventType.MEMORIAL
          ? 'memorial'
          : m.eventType === EventType.MIDWEEK
            ? 'midweek'
            : 'weekend',
      // Null on purpose: the hour of an ordinary meeting comes from the
      // settings version in force, which the caller already has.
      time: null,
    }));

    // The Memorial arrives with the meetings now — `meetingsOfWeek` asks about
    // it under its own kind — so it is no longer appended here. What is still
    // needed is its HOUR: it starts at its own time, and reaching for the
    // settings would put the reminder at the time of a meeting not being held.
    const weekEnd = addDaysISO(weekStart, 6);
    const memorial = ctx.memorials.find(
      (e) => e.date >= weekStart && e.date <= weekEnd,
    );
    if (memorial) {
      for (const g of out) {
        if (g.kind === 'memorial') g.time = memorial.time ?? null;
      }
    }
    /**
     * A meeting that goes ahead «with changes» on an event's day may start at
     * another hour (27 September — a branch representative's visit). Whoever
     * reminds people about that meeting must use that hour, not the one from
     * the settings.
     */
    const changed = await this.eventsRepo.find({
      where: {
        congregationId: tenantId,
        meetingMode: 'changed',
        date: LessThanOrEqual(weekEnd),
      },
    });
    for (const g of out) {
      if (g.kind === 'memorial') continue;
      const e = changed.find(
        (c) =>
          c.meetingTime && c.date <= g.date && (c.endDate ?? c.date) >= g.date,
      );
      if (e) g.time = e.meetingTime;
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  private async weekContext(tenantId: string): Promise<WeekContext | null> {
    const versions = await this.settingsRepo.find({
      where: { congregationId: tenantId },
      order: { effectiveFrom: 'ASC' },
    });
    if (versions.length === 0) return null;

    const visits = await this.eventsRepo.find({
      where: { congregationId: tenantId, type: 'circuit_overseer_visit' },
    });
    // Events that REPLACE the congregation's own meetings. A circuit visit is
    // deliberately not among them: it moves a meeting, it does not cancel one.
    // Nobody should be asked to record attendance at a meeting the whole
    // congregation was away at an assembly for.
    const cancelling = await this.eventsRepo.find({
      where: [
        { congregationId: tenantId, type: 'regional_convention' },
        { congregationId: tenantId, type: 'circuit_assembly' },
      ],
    });
    // The Memorial replaces ONE of that week's meetings, chosen by the kind of
    // day it falls on: on a weekday the midweek meeting gives way, at the
    // weekend the weekend meeting does. Not "the meeting on the same day" —
    // the Memorial can fall on a Tuesday while the midweek meeting is a
    // Thursday, and it is still the midweek meeting that goes.
    const memorials = await this.eventsRepo.find({
      where: { congregationId: tenantId, type: 'memorial' },
    });
    // Anything the congregation marked by hand as «в этот день обычной встречи
    // нет». Fetched by the FLAG rather than by a type, because that is the
    // whole point of it: it exists for the events that have no rule of their
    // own. The rules module ignores it on events that do.
    const flagged = await this.eventsRepo.find({
      where: { congregationId: tenantId, replacesMeeting: true },
    });
    const changed = await this.eventsRepo.find({
      where: { congregationId: tenantId, meetingMode: 'changed' },
    });
    return { versions, visits, cancelling, memorials, flagged, changed };
  }

  /**
   * The hour the meeting began: an event that keeps the meeting «with
   * changes» may move it (31 October 2026 — the card opened by the usual
   * hour while the cleaning reminder already followed the event's), else the
   * settings version in force for that week; null when none is recorded.
   */
  private startTimeOf(
    date: string,
    kind: EventType,
    ctx: WeekContext,
  ): string | null {
    if (kind !== EventType.MEMORIAL) {
      const e = (ctx.changed ?? []).find(
        (c) => c.meetingTime && c.date <= date && (c.endDate ?? c.date) >= date,
      );
      if (e?.meetingTime) return e.meetingTime;
    } else {
      const memorial = ctx.memorials.find((e) => e.date === date);
      if (memorial) return memorial.time ?? null;
    }
    const weekStart = mondayOf(date);
    let version: MeetingSettings | null = null;
    for (const v of ctx.versions) {
      if (v.effectiveFrom <= weekStart) version = v;
    }
    version = version ?? ctx.versions[0];
    if (!version) return null;
    return kind === EventType.MIDWEEK
      ? version.midweekTime
      : version.weekendTime;
  }

  private meetingsOfWeek(
    weekStart: string,
    ctx: WeekContext,
  ): { date: string; eventType: EventType }[] {
    // The rule itself lives in common/week-rules.ts, named and tested, because
    // it was being answered here AND in the app with two different answers.
    // This method now only translates that answer into the EventType the
    // attendance rows are keyed by.
    //
    // The three lists are re-tagged with the type they were QUERIED by rather
    // than read off the row: weekContext fetches each by an explicit `type`
    // filter, so the kind is already known here, and the rules must not depend
    // on a column that a caller might not have selected.
    const rules = rulesFromContext(ctx, weekStart);
    const out = rules.meetings.map((m) => ({
      date: m.date,
      eventType: m.kind === 'midweek' ? EventType.MIDWEEK : EventType.WEEKEND,
    }));

    // The Memorial is counted too, under its OWN kind.
    //
    // It takes a meeting away, so it is absent from `rules.meetings` — and the
    // figure was therefore asked of nobody, on the one evening of the year the
    // hall is fullest and the number matters most. Recorded separately rather
    // than folded into the midweek or weekend column, because those are what
    // the congregation reports week by week and the Memorial is its own line.
    const weekEnd = addDaysISO(weekStart, 6);
    const memorial = ctx.memorials.find(
      (e) => e.date >= weekStart && e.date <= weekEnd,
    );
    if (memorial) {
      out.push({ date: memorial.date, eventType: EventType.MEMORIAL });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Drop the ones already recorded, newest first. */
  private async dropAlreadyRecorded(
    tenantId: string,
    wanted: { date: string; eventType: EventType }[],
  ): Promise<{ date: string; eventType: EventType }[]> {
    if (wanted.length === 0) return [];
    const recorded = await this.repo.find({
      where: {
        congregationId: tenantId,
        date: Between(
          wanted.reduce((a, w) => (w.date < a ? w.date : a), wanted[0].date),
          wanted.reduce((a, w) => (w.date > a ? w.date : a), wanted[0].date),
        ),
      },
    });
    const done = new Set(recorded.map((r) => `${r.date}|${r.eventType}`));
    return wanted
      .filter((w) => !done.has(`${w.date}|${w.eventType}`))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /**
   * Names for whoever entered the figures, through the publisher card linked
   * to the account — the same path the journal uses, so a person reads the
   * same way wherever the app names them.
   */
  private async namesOfRecorders(
    rows: MeetingAttendance[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.recordedBy).filter(Boolean))];
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const cards = await this.publishersRepo.find({
      where: { userId: In(ids as string[]) },
    });
    for (const c of cards) {
      if (!c.userId) continue;
      out.set(
        c.userId,
        [c.lastName, c.firstName].filter(Boolean).join(' ').trim(),
      );
    }
    // An account with no publisher card — an administrator's — was signed
    // with nothing at all (31 October 2026); its own label says who.
    const rest = (ids as string[]).filter((id) => !out.get(id));
    if (rest.length && this.users) {
      const accounts = await this.users.find({
        where: { id: In(rest) },
        select: { id: true, displayLabel: true, loginName: true, email: true },
      });
      for (const u of accounts) {
        const label =
          u.displayLabel?.trim() ||
          u.loginName?.trim() ||
          u.email?.split('@')[0] ||
          '';
        if (label) out.set(u.id, label);
      }
    }
    return out;
  }

  /** Everything recorded between two dates, oldest first. */
  async range(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<MeetingAttendance[]> {
    return this.repo.find({
      where: { congregationId: tenantId, date: Between(from, to) },
      order: { date: 'ASC' },
    });
  }

  /** One meeting as the sheet reads it, from its expected slot and its row. */
  private rowOf(
    m: { date: string; eventType: EventType },
    saved: MeetingAttendance | undefined,
    names: Map<string, string>,
  ): AttendanceRow {
    return {
      date: m.date,
      eventType: m.eventType,
      count: saved?.count ?? null,
      onlineCount: saved?.onlineCount ?? null,
      notHeld: saved?.notHeld ?? false,
      notHeldReason: saved?.notHeldReason ?? null,
      note: saved?.note ?? null,
      recorded: saved !== undefined,
      recordedByName: saved
        ? (names.get(saved.recordedBy ?? '') ?? null)
        : null,
      recordedAt: saved?.updatedAt
        ? new Date(saved.updatedAt).toISOString()
        : null,
      // A second's grace: the same save writes both stamps, and they can
      // differ by a hair without anything having been revised.
      corrected:
        saved?.updatedAt && saved?.createdAt
          ? new Date(saved.updatedAt).getTime() -
              new Date(saved.createdAt).getTime() >
            1000
          : false,
    };
  }

  /**
   * The S-3 sheet for one service year, which runs September to August.
   *
   * The average divides by the meetings actually HELD, never by four or five:
   * a month with an assembly week has fewer meetings, and dividing by the
   * calendar would understate every such month.
   */
  async serviceYear(
    tenantId: string,
    startYear: number,
  ): Promise<AttendanceYear> {
    if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2200) {
      throw new BadRequestException(
        refusal('ATTENDANCE_YEAR_INVALID', 'No such service year.'),
      );
    }
    const ctx = await this.weekContext(tenantId);
    const today = await this.clock.todayFor(tenantId);
    const year = await this.yearOf(tenantId, startYear, ctx, today);
    const before = await this.yearOf(tenantId, startYear - 1, ctx, today);
    const hadAny = before.months.some(
      (m) => m.midweekAverage !== null || m.weekendAverage !== null,
    );
    return {
      ...year,
      previous: hadAny
        ? {
            months: before.months.map((m) => ({
              month: m.month,
              midweekAverage: m.midweekAverage,
              weekendAverage: m.weekendAverage,
            })),
            midweekAverage: before.yearly.midweekAverage,
            weekendAverage: before.yearly.weekendAverage,
          }
        : null,
      sent: await this.sentFor(tenantId, startYear),
    };
  }

  /** The months, the year's line and the holes of one service year. */
  private async yearOf(
    tenantId: string,
    startYear: number,
    ctx: WeekContext | null,
    today: string,
  ): Promise<Omit<AttendanceYear, 'previous' | 'sent'>> {
    const from = `${startYear}-09-01`;
    const to = `${startYear + 1}-08-31`;
    const rows = await this.range(tenantId, from, to);
    const byMeeting = new Map<string, MeetingAttendance>();
    for (const r of rows) byMeeting.set(`${r.date}|${r.eventType}`, r);

    // Every meeting the year should have held, worked out from the same rules
    // the home card uses — so a week nobody entered still appears, as a hole.
    const names = await this.namesOfRecorders(rows);
    const expected: AttendanceRow[] = [];
    if (ctx) {
      let week = mondayOf(from);
      const lastWeek = mondayOf(to);
      while (week <= lastWeek) {
        for (const m of this.meetingsOfWeek(week, ctx)) {
          // Meetings still ahead are not gaps; they simply have not happened.
          if (m.date > today) continue;
          if (m.date < from || m.date > to) continue;
          expected.push(
            this.rowOf(m, byMeeting.get(`${m.date}|${m.eventType}`), names),
          );
        }
        week = addDaysISO(week, 7);
      }
    }
    const scheduled = expected.length;
    const recordedCount = expected.filter((r) => r.recorded).length;
    const gaps = expected
      .filter((r) => !r.recorded)
      .map((r) => ({ date: r.date, eventType: r.eventType }));

    // Figures that no expected meeting claims: kept, not dropped.
    const claimed = new Set(expected.map((r) => `${r.date}|${r.eventType}`));
    for (const saved of rows) {
      const key = `${saved.date}|${saved.eventType}`;
      if (claimed.has(key) || saved.date < from || saved.date > to) continue;
      expected.push({
        ...this.rowOf(saved, saved, names),
        offSchedule: true,
      });
    }
    expected.sort((a, b) => a.date.localeCompare(b.date));

    const months: AttendanceMonth[] = [];
    for (let i = 0; i < 12; i++) {
      const y = startYear + (i < 4 ? 0 : 1);
      const m = ((8 + i) % 12) + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const inMonth = expected.filter((r) => r.date.slice(0, 7) === key);
      const midweek = inMonth.filter((r) => r.eventType === EventType.MIDWEEK);
      const weekend = inMonth.filter((r) => r.eventType === EventType.WEEKEND);
      const memorial = inMonth.filter(
        (r) => r.eventType === EventType.MEMORIAL,
      );
      const mw = summarise(midweek);
      const we = summarise(weekend);
      const me = summarise(memorial);
      months.push({
        month: `${key}-01`,
        midweek,
        weekend,
        midweekTotal: mw.total,
        midweekAverage: mw.average,
        weekendTotal: we.total,
        weekendAverage: we.average,
        memorial,
        // No average: one evening a year has nothing to be averaged against,
        // and a number that always equals the total only invites doubt about
        // which of the two to read.
        memorialTotal: me.total,
        midweekMissing: midweek.filter((r) => !r.recorded).length,
        weekendMissing: weekend.filter((r) => !r.recorded).length,
        midweekOnlineAverage: mw.online,
        weekendOnlineAverage: we.online,
      });
    }

    // The year's line: the months that have begun and hold an average.
    const started = months.filter(
      (mo) => mo.month <= `${today.slice(0, 7)}-01`,
    );
    const avgOf = (xs: (number | null)[]) => {
      const have = xs.filter((v): v is number => v !== null);
      return {
        value: have.length
          ? Math.round(have.reduce((a, b) => a + b, 0) / have.length)
          : null,
        n: have.length,
      };
    };
    const mwy = avgOf(started.map((mo) => mo.midweekAverage));
    const wey = avgOf(started.map((mo) => mo.weekendAverage));
    return {
      startYear,
      months,
      yearly: {
        midweekAverage: mwy.value,
        weekendAverage: wey.value,
        midweekMonths: mwy.n,
        weekendMonths: wey.n,
        midweekOnlineAverage: avgOf(
          started.map((mo) => mo.midweekOnlineAverage),
        ).value,
        weekendOnlineAverage: avgOf(
          started.map((mo) => mo.weekendOnlineAverage),
        ).value,
        expected: scheduled,
        recorded: recordedCount,
      },
      gaps,
    };
  }

  /** What of this year already went to the branch. */
  private async sentFor(
    tenantId: string,
    startYear: number,
  ): Promise<AttendanceYear['sent']> {
    if (!this.snapshots) return { annual: null, months: [] };
    const months: string[] = [];
    for (let i = 0; i < 12; i++) {
      const y = startYear + (i < 4 ? 0 : 1);
      const m = ((8 + i) % 12) + 1;
      months.push(`${y}-${String(m).padStart(2, '0')}`);
    }
    const rows = await this.snapshots.find({
      where: [
        { congregationId: tenantId, kind: 'annual', period: String(startYear) },
        { congregationId: tenantId, kind: 'monthly', period: In(months) },
      ],
      select: { id: true, kind: true, period: true, figures: true },
    });
    const annual = rows.find((r) => r.kind === 'annual');
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    return {
      annual: annual
        ? {
            midweekAverage: num(annual.figures?.midweekAverage),
            weekendAverage: num(annual.figures?.weekendAverage),
          }
        : null,
      months: rows
        .filter((r) => r.kind === 'monthly')
        .map((r) => r.period)
        .sort(),
    };
  }
}

/** 'HH:MM' as minutes since midnight; null when the value is unusable. */
export function minutesOfClock(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * May a meeting be counted yet?
 *
 * Until now the card waited for the day to be OVER — the meeting's own day was
 * left alone because "it is not over yet". Correct, but it cost exactly the
 * freshness the card exists for: the brother counts during the meeting and
 * wants to type the figure in on his way home, not the next morning.
 *
 * An hour before the start is when he is already at the hall, so that is when
 * the field appears — and it stays only until midnight of that same day.
 */
export function attendanceOpen(
  meetingDate: string,
  startTime: string | null | undefined,
  today: string,
  nowMinutes: number,
  leadMinutes = 60,
): boolean {
  // ONLY the meeting of TODAY. A card that outlives its day stops meaning
  // anything definite: a midweek meeting nobody entered was still sitting on
  // the home screen when the weekend one arrived, and the figure counted at
  // the weekend can then be typed into the midweek row. The unique constraint
  // cannot catch that — the entry is perfectly valid, just about the wrong
  // meeting.
  //
  // So the card now says one thing only: "the meeting that happened today".
  // At midnight, by the CONGREGATION's clock, it goes; a meeting that was
  // missed is not lost — «Ещё N без записи» stays on the home screen and leads
  // to the page where every meeting carries its own date and kind, and where a
  // whole year can be filled in at once.
  if (meetingDate !== today) return false;
  const start = minutesOfClock(startTime);
  // No start time on record: open for the whole of the meeting's day. It has
  // to be the day itself now that later days are closed, and a congregation
  // that has not set its meeting times would otherwise never see the card.
  if (start === null) return true;
  return nowMinutes >= start - leadMinutes;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Total and average for one kind of meeting in one month. Only meetings that
 * were held and counted take part — a meeting not held is not a zero, and an
 * entry nobody has made yet is not a zero either.
 */
function summarise(rows: AttendanceRow[]): {
  total: number;
  average: number | null;
  /** The video part's average, over the meetings that said it. */
  online: number | null;
} {
  const held = rows.filter((r) => !r.notHeld && r.count !== null);
  const total = held.reduce((sum, r) => sum + (r.count as number), 0);
  const said = held.filter(
    (r) => r.onlineCount !== null && r.onlineCount !== undefined,
  );
  return {
    total,
    average: held.length ? Math.round(total / held.length) : null,
    online: said.length
      ? Math.round(
          said.reduce((sum, r) => sum + (r.onlineCount as number), 0) /
            said.length,
        )
      : null,
  };
}
