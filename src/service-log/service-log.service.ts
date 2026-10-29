import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Between, IsNull, LessThan, Repository } from 'typeorm';
import {
  ServiceLogEntry,
  ServiceLogKind,
} from '../entities/service-log-entry.entity';
import { Publisher } from '../entities/publisher.entity';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { AuxiliaryPioneer } from '../entities/auxiliary-pioneer.entity';
import { AuxPioneerApplication } from '../entities/aux-pioneer-application.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { ReportMonthClosure } from '../entities/report-month-closure.entity';
import { Congregation } from '../entities/congregation.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { pioneerTypeInMonth } from '../common/pioneer-status';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import {
  lastClosedReportMonth,
  monthKey as monthKeyOfDate,
} from '../common/report-month-window';
import {
  goalOf,
  isActiveInMonth,
} from '../auxiliary-pioneers/auxiliary-pioneer-hours';
import { refusal } from '../common/errors/refusal';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/** The monthly pace of a regular pioneer — the same 50 the committee's year uses. */
export const REGULAR_PIONEER_MONTH_GOAL = 50;
/** One entry: at most twelve hours. */
export const MAX_ENTRY_MINUTES = 720;
/** One day: never more than its own twenty-four hours. */
export const MAX_DAY_MINUTES = 1440;

/**
 * Who he is in a month, for the log: what his report will ask, and so
 * whether the log is open to him at all. Special pioneers and missionaries
 * have a goal too — it is not set here yet (Lionel, 29 October 2026).
 */
export type ServiceLogRole =
  | 'regular'
  | 'special'
  | 'missionary'
  | 'aux'
  | 'aux_pending';

export interface ServiceLogEntryView {
  id: string;
  day: string;
  minutes: number;
  kind: ServiceLogKind;
  note: string | null;
}

export interface ServiceLogMonth {
  month: string; // YYYY-MM
  /** Null: the log is not his this month — his report will not ask for hours. */
  role: ServiceLogRole | null;
  /** May entries for this month still be written, changed or removed? */
  open: boolean;
  /** Hours the month asks of him; null when none is set. */
  goal: number | null;
  entries: ServiceLogEntryView[];
  fieldMinutes: number;
  creditMinutes: number;
  /** What his report would say: whole hours, a started first hour counted. */
  reportHours: number;
  /** His report for the month, when it is in. */
  report: { hours: number | null; byOther: boolean } | null;
  /** The congregation's today, «YYYY-MM-DD». */
  today: string;
  /** The first month of the log here; null — the log is off. */
  startsFrom: string | null;
}

/**
 * Whole hours for the report (Lionel, 29 October 2026): rounded down — the
 * part of an hour is not carried over — except that a month with some time,
 * but under an hour, counts as one: he did go out.
 */
export function reportHoursOf(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 60) return 1;
  return Math.floor(minutes / 60);
}

/** «2026-02» → «2026-02-28». */
function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${month}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * A PIONEER'S OWN HOURS LOG (Lionel, 29 October 2026).
 *
 * Entries are read and written by their owner only — the sign-in and the
 * card it is linked to, both. Every question here starts from «who is
 * asking», never from an id handed in: there is no route by which anyone
 * else's entries can be named.
 */
@Injectable()
export class ServiceLogService {
  private readonly logger = new Logger(ServiceLogService.name);

  constructor(
    @InjectRepository(ServiceLogEntry)
    private readonly entries: Repository<ServiceLogEntry>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(PioneerSpell)
    private readonly spells: Repository<PioneerSpell>,
    @InjectRepository(AuxiliaryPioneer)
    private readonly auxPeriods: Repository<AuxiliaryPioneer>,
    @InjectRepository(AuxPioneerApplication)
    private readonly auxApps: Repository<AuxPioneerApplication>,
    @InjectRepository(ServiceReport)
    private readonly reports: Repository<ServiceReport>,
    @InjectRepository(ReportMonthClosure)
    private readonly closures: Repository<ReportMonthClosure>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly clock: CongregationClock,
  ) {}

  private async cardOf(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<Publisher | null> {
    return this.publishers.findOne({
      where: { congregationId, userId: user.id, removedAt: IsNull() },
    });
  }

  private async roleIn(
    congregationId: string,
    publisherId: string,
    month: string,
  ): Promise<{ role: ServiceLogRole | null; goal: number | null }> {
    // Before the month the log began in here — or with the log off — the
    // month is nobody's to log: its report goes in as it always did.
    const cong = await this.congregations.findOne({
      where: { id: congregationId },
      select: ['id', 'hoursLogFrom'],
    });
    if (!cong?.hoursLogFrom || month < cong.hoursLogFrom) {
      return { role: null, goal: null };
    }
    const spells = await this.spells.find({
      where: { congregationId, publisherId },
    });
    const type = pioneerTypeInMonth(spells, `${month}-01`);
    if (type === PioneerType.REGULAR)
      return { role: 'regular', goal: REGULAR_PIONEER_MONTH_GOAL };
    if (type === PioneerType.SPECIAL) return { role: 'special', goal: null };
    if (type === PioneerType.MISSIONARY)
      return { role: 'missionary', goal: null };
    const periods = await this.auxPeriods.find({
      where: { congregationId, publisherId },
    });
    const period = periods.find((p) =>
      isActiveInMonth(
        {
          startMonth: p.startMonth,
          endMonth: p.endMonth,
          untilCancelled: p.untilCancelled,
        },
        month,
      ),
    );
    if (period) return { role: 'aux', goal: goalOf(period, month) };
    // An application still before the committee: he may begin writing —
    // the entries stay his whatever is decided.
    const pending = await this.auxApps.findOne({
      where: { congregationId, publisherId, status: 'pending' },
    });
    if (pending) {
      const asked = pending.untilCancelled
        ? month >= pending.months[0]
        : pending.months.includes(month);
      if (asked) {
        return {
          role: 'aux_pending',
          goal: pending.reducedMonths.includes(month) ? 15 : 30,
        };
      }
    }
    return { role: null, goal: null };
  }

  /**
   * Months still open to writing: this one, and the previous one while its
   * reports are being collected and the secretary has not closed it.
   */
  private async openMonths(congregationId: string): Promise<{
    today: string;
    open: string[];
  }> {
    const today = await this.clock.todayFor(congregationId);
    const current = today.slice(0, 7);
    const lastShut = monthKeyOfDate(
      lastClosedReportMonth(
        new Date(Date.now()),
        await this.clock.timezoneOf(congregationId),
      ),
    ).slice(0, 7);
    const open = [current];
    const previous = addMonths(current, -1);
    if (previous > lastShut) {
      const closed = await this.closures.count({
        where: { congregationId, reportMonth: `${previous}-01` },
      });
      if (closed === 0) open.push(previous);
    }
    return { today, open };
  }

  private async reportOf(
    congregationId: string,
    publisherId: string,
    month: string,
  ): Promise<ServiceReport | null> {
    return this.reports.findOne({
      where: { congregationId, publisherId, reportMonth: `${month}-01` },
    });
  }

  async month(
    congregationId: string,
    user: AuthenticatedUser,
    monthRaw?: string,
  ): Promise<ServiceLogMonth> {
    const { today, open } = await this.openMonths(congregationId);
    const month =
      monthRaw && /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : today.slice(0, 7);
    const empty: ServiceLogMonth = {
      month,
      role: null,
      open: false,
      goal: null,
      entries: [],
      fieldMinutes: 0,
      creditMinutes: 0,
      reportHours: 0,
      report: null,
      today,
      startsFrom:
        (
          await this.congregations.findOne({
            where: { id: congregationId },
            select: ['id', 'hoursLogFrom'],
          })
        )?.hoursLogFrom ?? null,
    };
    const card = await this.cardOf(congregationId, user);
    if (!card) return empty;
    const { role, goal } = await this.roleIn(congregationId, card.id, month);
    // A month that is not his to log shows nothing — not even entries left
    // from before the log began.
    if (role === null) return empty;
    const rows = await this.entries.find({
      where: {
        congregationId,
        publisherId: card.id,
        userId: user.id,
        day: Between(`${month}-01`, lastDayOf(month)),
      },
      order: { day: 'DESC', createdAt: 'DESC' },
    });
    const report = await this.reportOf(congregationId, card.id, month);
    const fieldMinutes = rows
      .filter((r) => r.kind === 'field')
      .reduce((s, r) => s + r.minutes, 0);
    const creditMinutes = rows
      .filter((r) => r.kind === 'credit')
      .reduce((s, r) => s + r.minutes, 0);
    return {
      month,
      role,
      open: role !== null && open.includes(month) && !report,
      goal,
      entries: rows.map((r) => ({
        id: r.id,
        day: String(r.day).slice(0, 10),
        minutes: r.minutes,
        kind: r.kind,
        note: r.note,
      })),
      fieldMinutes,
      creditMinutes,
      reportHours: reportHoursOf(fieldMinutes),
      report: report
        ? {
            hours: report.hoursReported,
            byOther: report.submittedById !== user.id,
          }
        : null,
      today,
      startsFrom: empty.startsFrom,
    };
  }

  /** The months the log is his and still open — for the door and Home. */
  async overview(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<{ months: ServiceLogMonth[] }> {
    const { open } = await this.openMonths(congregationId);
    const out: ServiceLogMonth[] = [];
    for (const m of open) {
      const v = await this.month(congregationId, user, m);
      if (v.role !== null) out.push(v);
    }
    return { months: out };
  }

  /** Written, or written again — the id is the phone's. */
  async put(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
    input: {
      day: string;
      minutes: number;
      kind: ServiceLogKind;
      note?: string | null;
    },
  ): Promise<ServiceLogEntryView> {
    const card = await this.cardOf(congregationId, user);
    if (!card) {
      throw new ForbiddenException(
        refusal('SERVICE_LOG_NO_CARD', 'Your sign-in has no publisher card.'),
      );
    }
    const existing = await this.entries.findOne({ where: { id } });
    if (
      existing &&
      (existing.congregationId !== congregationId ||
        existing.userId !== user.id ||
        existing.publisherId !== card.id)
    ) {
      // Somebody else's id: answered as if it did not exist, and not taken.
      throw new NotFoundException();
    }
    if (existing)
      await this.assertWritable(congregationId, card.id, existing.day);
    await this.assertWritable(congregationId, card.id, input.day);

    const sameDay = await this.entries.find({
      where: {
        congregationId,
        publisherId: card.id,
        userId: user.id,
        day: input.day,
      },
      select: ['id', 'minutes'],
    });
    const others = sameDay
      .filter((e) => e.id !== id)
      .reduce((s, e) => s + e.minutes, 0);
    if (others + input.minutes > MAX_DAY_MINUTES) {
      throw new BadRequestException(
        refusal('SERVICE_LOG_DAY_FULL', 'A day has twenty-four hours.'),
      );
    }
    const row = existing ?? this.entries.create({ id });
    Object.assign(row, {
      congregationId,
      publisherId: card.id,
      userId: user.id,
      day: input.day,
      minutes: input.minutes,
      kind: input.kind,
      note: input.note?.trim() ? input.note.trim() : null,
    });
    const saved = await this.entries.save(row);
    return {
      id: saved.id,
      day: String(saved.day).slice(0, 10),
      minutes: saved.minutes,
      kind: saved.kind,
      note: saved.note,
    };
  }

  async remove(
    congregationId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<void> {
    const card = await this.cardOf(congregationId, user);
    if (!card) return;
    const existing = await this.entries.findOne({
      where: { id, congregationId, userId: user.id, publisherId: card.id },
    });
    // Already gone — or never his: the same quiet answer.
    if (!existing) return;
    await this.assertWritable(congregationId, card.id, String(existing.day));
    await this.entries.delete({ id });
  }

  /**
   * A day may be written when: it is not ahead of the congregation's today;
   * its month is still open; the log is his that month; and his report for
   * it is not in yet (from then the report speaks for the month).
   */
  private async assertWritable(
    congregationId: string,
    publisherId: string,
    dayRaw: string,
  ): Promise<void> {
    const day = String(dayRaw).slice(0, 10);
    const { today, open } = await this.openMonths(congregationId);
    if (day > today) {
      throw new BadRequestException(
        refusal('SERVICE_LOG_FUTURE', 'That day has not come yet.'),
      );
    }
    const month = day.slice(0, 7);
    if (!open.includes(month)) {
      throw new ForbiddenException(
        refusal('SERVICE_LOG_MONTH_CLOSED', 'That month is no longer open.', {
          month,
        }),
      );
    }
    const { role } = await this.roleIn(congregationId, publisherId, month);
    if (role === null) {
      throw new ForbiddenException(
        refusal(
          'SERVICE_LOG_NOT_YOURS',
          'Your report does not ask for hours that month.',
          { month },
        ),
      );
    }
    if (await this.reportOf(congregationId, publisherId, month)) {
      throw new ConflictException(
        refusal(
          'SERVICE_LOG_REPORTED',
          'The report for that month is in already.',
          { month },
        ),
      );
    }
  }

  /**
   * Kept for the current and the previous service year (Lionel, 29 October
   * 2026); older entries are deleted each night.
   */
  @Cron('40 3 * * *')
  async prune(): Promise<void> {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    const thisServiceYear = m >= 9 ? y : y - 1;
    const keepFrom = `${thisServiceYear - 1}-09-01`;
    try {
      const res = await this.entries.delete({ day: LessThan(keepFrom) });
      if (res.affected)
        this.logger.log(`hours log: ${res.affected} old entries deleted`);
    } catch (err) {
      this.logger.warn(`hours log prune failed: ${String(err)}`);
    }
  }
}
