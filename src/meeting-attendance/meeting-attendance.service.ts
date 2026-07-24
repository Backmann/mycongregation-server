import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { MeetingAttendance } from '../entities/meeting-attendance.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Publisher } from '../entities/publisher.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';

/** One meeting's figure as the report reads it. */
export interface AttendanceRow {
  date: string;
  eventType: EventType;
  count: number | null;
  notHeld: boolean;
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
}

export interface AttendanceYear {
  /** The September the service year starts in. */
  startYear: number;
  months: AttendanceMonth[];
}

interface WeekContext {
  versions: MeetingSettings[];
  visits: SpecialEvent[];
  cancelling: SpecialEvent[];
  memorials: SpecialEvent[];
}

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
      notHeld?: boolean;
      note?: string | null;
    },
    userId: string,
  ): Promise<MeetingAttendance> {
    const notHeld = dto.notHeld === true;
    if (!notHeld && (dto.count === undefined || dto.count === null)) {
      throw new BadRequestException('A held meeting needs a figure.');
    }
    if (
      !notHeld &&
      (!Number.isInteger(dto.count) || (dto.count as number) < 0)
    ) {
      throw new BadRequestException('Attendance cannot be negative.');
    }

    const existing = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        date: dto.date,
        eventType: dto.eventType,
      },
    });

    const before = existing
      ? { count: existing.count, notHeld: existing.notHeld }
      : null;

    const row =
      existing ??
      this.repo.create({
        congregationId: tenantId,
        date: dto.date,
        eventType: dto.eventType,
      });
    row.count = notHeld ? null : (dto.count as number);
    row.notHeld = notHeld;
    if (dto.note !== undefined) row.note = dto.note ?? null;
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
        after: { count: saved.count, notHeld: saved.notHeld },
        fields: ['count', 'notHeld'],
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
          notHeld: saved.notHeld,
        },
      });
    }
    return saved;
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
  async pending(
    tenantId: string,
    weeksBack = 8,
  ): Promise<{
    meetings: { date: string; eventType: EventType }[];
    /**
     * Everything still unrecorded in the CURRENT service year, not just in the
     * eight weeks the card offers.
     *
     * The card asks about a recent meeting because a figure is worth having
     * while it is fresh. But a meeting missed nine weeks ago stopped being
     * mentioned anywhere on the home screen, and the count beside it said
     * "three" when the year held fourteen holes — understating exactly the
     * thing it existed to surface. The offer stays recent; the count tells the
     * truth about the year.
     */
    outstandingThisYear: number;
  }> {
    const ctx = await this.weekContext(tenantId);
    if (!ctx) return { meetings: [], outstandingThisYear: 0 };

    const today = berlinToday();
    const thisMonday = mondayOfISO(today);
    const wanted: { date: string; eventType: EventType }[] = [];

    for (let back = 0; back < weeksBack; back++) {
      const weekStart = addDaysISO(thisMonday, -7 * back);
      for (const m of this.meetingsOfWeek(weekStart, ctx)) {
        // Only meetings whose own day has passed. The day of the meeting
        // itself is left alone: it is not over yet.
        if (m.date >= today) continue;
        wanted.push(m);
      }
    }

    return {
      meetings: await this.dropAlreadyRecorded(tenantId, wanted),
      outstandingThisYear: await this.outstandingThisYear(tenantId, ctx, today),
    };
  }

  /** How many meetings of the current service year still have no figure. */
  private async outstandingThisYear(
    tenantId: string,
    ctx: WeekContext,
    today: string,
  ): Promise<number> {
    // Before September the year in progress began last autumn.
    const y = Number(today.slice(0, 4));
    const startYear = Number(today.slice(5, 7)) >= 9 ? y : y - 1;
    const from = `${startYear}-09-01`;
    const rows = await this.range(tenantId, from, today);
    const done = new Set(rows.map((r) => `${r.date}|${r.eventType}`));

    let count = 0;
    let week = mondayOfISO(from);
    const lastWeek = mondayOfISO(today);
    while (week <= lastWeek) {
      for (const m of this.meetingsOfWeek(week, ctx)) {
        if (m.date > today || m.date < from) continue;
        if (!done.has(`${m.date}|${m.eventType}`)) count += 1;
      }
      week = addDaysISO(week, 7);
    }
    return count;
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
    return { versions, visits, cancelling, memorials };
  }

  /** Which meetings that week held, and on which dates. */
  private meetingsOfWeek(
    weekStart: string,
    ctx: WeekContext,
  ): { date: string; eventType: EventType }[] {
    const { versions, visits, cancelling, memorials } = ctx;
    const out: { date: string; eventType: EventType }[] = [];
    {
      let version: MeetingSettings | null = null;
      for (const v of versions) {
        if (v.effectiveFrom <= weekStart) version = v;
      }
      version = version ?? versions[0];

      for (const kind of [EventType.MIDWEEK, EventType.WEEKEND] as const) {
        let dow =
          kind === EventType.MIDWEEK ? version.midweekDow : version.weekendDow;
        if (kind === EventType.MIDWEEK) {
          const weekEnd = addDaysISO(weekStart, 6);
          const visit = visits.find(
            (e) => e.date <= weekEnd && (e.endDate ?? e.date) >= weekStart,
          );
          if (visit) dow = visit.coMidweekDow ?? 2;
        }
        if (!dow) continue;
        const date = addDaysISO(weekStart, dow - 1);
        // A meeting that an assembly or convention replaced never happened,
        // so there is nothing to ask about. Nothing is stored either: the
        // monthly average counts only meetings that WERE held, so an absent
        // row is already the right answer.
        const replaced = cancelling.some(
          (e) => e.date <= date && (e.endDate ?? e.date) >= date,
        );
        if (replaced) continue;

        const weekEndDate = addDaysISO(weekStart, 6);
        const memorialThisWeek = memorials.find(
          (e) => e.date >= weekStart && e.date <= weekEndDate,
        );
        if (memorialThisWeek) {
          const memorialDow = isoDowOf(memorialThisWeek.date);
          const givesWay =
            memorialDow >= 6 ? EventType.WEEKEND : EventType.MIDWEEK;
          if (kind === givesWay) continue;
        }
        out.push({ date, eventType: kind });
      }
    }
    return out;
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
    const from = `${startYear}-09-01`;
    const to = `${startYear + 1}-08-31`;
    const rows = await this.range(tenantId, from, to);
    const byMeeting = new Map<string, MeetingAttendance>();
    for (const r of rows) byMeeting.set(`${r.date}|${r.eventType}`, r);

    // Every meeting the year should have held, worked out from the same rules
    // the home card uses — so a week nobody entered still appears, as a hole.
    const names = await this.namesOfRecorders(rows);
    const ctx = await this.weekContext(tenantId);
    const today = berlinToday();
    const expected: AttendanceRow[] = [];
    if (ctx) {
      let week = mondayOfISO(from);
      const lastWeek = mondayOfISO(to);
      while (week <= lastWeek) {
        for (const m of this.meetingsOfWeek(week, ctx)) {
          // Meetings still ahead are not gaps; they simply have not happened.
          if (m.date > today) continue;
          if (m.date < from || m.date > to) continue;
          const saved = byMeeting.get(`${m.date}|${m.eventType}`);
          expected.push({
            date: m.date,
            eventType: m.eventType,
            count: saved?.count ?? null,
            notHeld: saved?.notHeld ?? false,
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
          });
        }
        week = addDaysISO(week, 7);
      }
    }

    const months: AttendanceMonth[] = [];
    for (let i = 0; i < 12; i++) {
      const y = startYear + (i < 4 ? 0 : 1);
      const m = ((8 + i) % 12) + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const inMonth = expected.filter((r) => r.date.slice(0, 7) === key);
      const midweek = inMonth.filter((r) => r.eventType === EventType.MIDWEEK);
      const weekend = inMonth.filter((r) => r.eventType === EventType.WEEKEND);
      const mw = summarise(midweek);
      const we = summarise(weekend);
      months.push({
        month: `${key}-01`,
        midweek,
        weekend,
        midweekTotal: mw.total,
        midweekAverage: mw.average,
        weekendTotal: we.total,
        weekendAverage: we.average,
      });
    }
    return { startYear, months };
  }
}

function berlinToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO day of week: 1 = Monday … 7 = Sunday. */
function isoDowOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Monday of the ISO week a date falls in. */
function mondayOfISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDaysISO(iso, 1 - dow);
}

/**
 * Total and average for one kind of meeting in one month. Only meetings that
 * were held and counted take part — a meeting not held is not a zero, and an
 * entry nobody has made yet is not a zero either.
 */
function summarise(rows: AttendanceRow[]): {
  total: number;
  average: number | null;
} {
  const held = rows.filter((r) => !r.notHeld && r.count !== null);
  const total = held.reduce((sum, r) => sum + (r.count as number), 0);
  return {
    total,
    average: held.length ? Math.round(total / held.length) : null,
  };
}
