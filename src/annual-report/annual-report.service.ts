import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { lastClosedReportMonth, monthKey } from '../common/report-month-window';
import { addMonthKey } from '../common/service-status-rule';
import {
  AnnualFigures,
  computeAnnualFigures,
  monthsOfServiceYear,
} from './annual-figures';
import {
  endOfLocalDay,
  LateFact,
  publishersAsOf,
  reportsAsOf,
  UnsureReport,
} from './as-of';

export type {
  AnnualFigures,
  CountedPublisher,
  MonthlyReporters,
} from './annual-figures';
export { monthsOfServiceYear } from './annual-figures';

@Injectable()
export class AnnualReportService {
  constructor(
    @InjectRepository(ServiceReport)
    private readonly reportsRepo: Repository<ServiceReport>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly clock: CongregationClock,
  ) {}

  async figures(tenantId: string, startYear: number): Promise<AnnualFigures> {
    // How far into the year we are entitled to judge anybody.
    //
    // A service year is twelve months whether or not they have happened. Open
    // the report on the year that began three days ago and every month of it
    // is unreported — not because anyone lapsed, but because September 2027
    // has not arrived. The figures then said the whole congregation had become
    // inactive, dated five months into the future, and «Активные» stood empty.
    //
    // A month is judged only once its collection window has closed, which is
    // the same line the service status is drawn at.
    const timezone = await this.clock.timezoneOf(tenantId);
    const [reports, publishers] = await Promise.all([
      this.reportsOf(tenantId, startYear, false),
      this.cardsOf(tenantId),
    ]);
    return computeAnnualFigures({
      startYear,
      judgeUntil: judgeUntilAt(new Date(), timezone),
      reports,
      publishers,
    });
  }

  /**
   * The figures as the app's data stood at the end of `day` (YYYY-MM-DD) —
   * the reports filed by then, as they read then, and the departures entered
   * by then — worked out by today's rules.
   *
   * Today's rules, not the rules of that day: the point is to know what the
   * DATA said. What the screen showed on the day also depended on code that
   * has since been corrected, and reproducing a mistake is not a figure.
   */
  async figuresAsOf(
    tenantId: string,
    startYear: number,
    day: string,
  ): Promise<AnnualFiguresAsOf> {
    const timezone = await this.clock.timezoneOf(tenantId);
    const at = endOfLocalDay(day, timezone);
    const [rows, cards] = await Promise.all([
      this.reportsOf(tenantId, startYear, true),
      this.cardsOf(tenantId),
    ]);
    const journal = rows.length
      ? await this.auditRepo.find({
          where: {
            congregationId: tenantId,
            entityType: 'service_report',
            entityId: In(rows.map((r) => r.id)),
            action: In(['UPDATE', 'DELETE', 'RESTORE']),
          },
        })
      : [];
    const then = reportsAsOf(
      rows,
      journal.map((e) => ({
        entityId: e.entityId,
        action: e.action,
        at: e.createdAt,
        before: e.beforeJson
          ? (JSON.parse(e.beforeJson) as Record<string, unknown>)
          : null,
      })),
      at,
    );
    const roll = publishersAsOf(cards, at);
    const yearMonths = monthsOfServiceYear(startYear);
    const inYear = (f: LateFact) =>
      !f.reportMonth || yearMonths.includes(f.reportMonth.slice(0, 7));
    return {
      ...computeAnnualFigures({
        startYear,
        judgeUntil: judgeUntilAt(at, timezone),
        reports: then.reports,
        publishers: roll.publishers,
      }),
      asOf: day,
      unsure: then.unsure,
      late: [...then.late, ...roll.late]
        .filter(inYear)
        .sort((a, b) => a.at.localeCompare(b.at)),
    };
  }

  /** Every report the year's arithmetic looks at, withdrawn ones on request. */
  private reportsOf(
    tenantId: string,
    startYear: number,
    withDeleted: boolean,
  ): Promise<ServiceReport[]> {
    const yearMonths = monthsOfServiceYear(startYear);
    // Six months of run-up as well (see computeAnnualFigures). Bounds must be
    // real dates: reportMonth is a date column, and Postgres cannot parse
    // "2026-02". The months here are YYYY-MM, so the day is added for the
    // query — the mistake the mocked repository in the tests could never have
    // shown, because the query was never actually run.
    const from = `${addMonthKey(yearMonths[0], -7)}-01`;
    const to = `${yearMonths[11]}-01`;
    return this.reportsRepo.find({
      where: { congregationId: tenantId, reportMonth: Between(from, to) },
      withDeleted,
    });
  }

  /**
   * Every card, departed ones included: who belonged to a year is decided by
   * the day they left, not by whether they are still on the roll today.
   */
  private cardsOf(tenantId: string): Promise<Publisher[]> {
    return this.publishersRepo.find({
      where: { congregationId: tenantId },
      withDeleted: true,
    });
  }
}

/** The last month whose collection had closed at `at`, as YYYY-MM. */
function judgeUntilAt(at: Date, timezone: string): string {
  return monthKey(lastClosedReportMonth(at, timezone)).slice(0, 7);
}

/** The figures as they stood on a past day, and what has been entered since. */
export interface AnnualFiguresAsOf extends AnnualFigures {
  asOf: string;
  /** Reports whose figures on that day cannot be recovered — named, not guessed. */
  unsure: UnsureReport[];
  /** What was entered after that day and bears on this year. */
  late: LateFact[];
}
