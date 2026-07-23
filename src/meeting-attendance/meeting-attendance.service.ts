import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { MeetingAttendance } from '../entities/meeting-attendance.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';

/** One meeting's figure as the report reads it. */
export interface AttendanceRow {
  date: string;
  eventType: EventType;
  count: number | null;
  notHeld: boolean;
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

@Injectable()
export class MeetingAttendanceService {
  constructor(
    @InjectRepository(MeetingAttendance)
    private readonly repo: Repository<MeetingAttendance>,
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

    const months: AttendanceMonth[] = [];
    for (let i = 0; i < 12; i++) {
      const y = startYear + (i < 4 ? 0 : 1);
      const m = ((8 + i) % 12) + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const inMonth = rows.filter((r) => r.date.slice(0, 7) === key);
      const midweek = inMonth.filter((r) => r.eventType === EventType.MIDWEEK);
      const weekend = inMonth.filter((r) => r.eventType === EventType.WEEKEND);
      const mw = summarise(midweek);
      const we = summarise(weekend);
      months.push({
        month: `${key}-01`,
        midweek: midweek.map(toRow),
        weekend: weekend.map(toRow),
        midweekTotal: mw.total,
        midweekAverage: mw.average,
        weekendTotal: we.total,
        weekendAverage: we.average,
      });
    }
    return { startYear, months };
  }
}

function toRow(r: MeetingAttendance): AttendanceRow {
  return {
    date: r.date,
    eventType: r.eventType,
    count: r.count,
    notHeld: r.notHeld,
  };
}

/**
 * Total and average for one kind of meeting in one month. Only meetings that
 * were held and counted take part — a meeting not held is not a zero, and an
 * entry nobody has made yet is not a zero either.
 */
function summarise(rows: MeetingAttendance[]): {
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
