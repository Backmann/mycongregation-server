import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { ReportSnapshot } from '../entities/report-snapshot.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Congregation } from '../entities/congregation.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { todayIn } from '../common/congregation-clock';
import { lastClosedReportMonth, monthKey } from '../common/report-month-window';
import { addMonthKey } from '../common/service-status-rule';
import {
  publishersAsOf,
  reportsAsOf,
  type LateFact,
} from '../annual-report/as-of';
import {
  ServiceReportsService,
  type ServiceReportSummary,
  type SummaryMembers,
} from './service-reports.service';

/** The form's lines, by the names the journal shows. */
const LINES = [
  {
    type: 'none',
    count: 'publishers',
    hours: null,
    studies: 'publishersStudies',
  },
  {
    type: 'auxiliary',
    count: 'auxiliary',
    hours: 'auxiliaryHours',
    studies: 'auxiliaryStudies',
  },
  {
    type: 'regular',
    count: 'regular',
    hours: 'regularHours',
    studies: 'regularStudies',
  },
  {
    type: 'special',
    count: 'special',
    hours: 'specialHours',
    studies: 'specialStudies',
  },
  {
    type: 'missionary',
    count: 'missionary',
    hours: 'missionaryHours',
    studies: 'missionaryStudies',
  },
] as const;

export const MONTHLY_KEYS = [
  ...LINES.flatMap((l) => [l.count, l.hours, l.studies].filter(Boolean)),
  'active',
  'inactive',
] as string[];

/** One person behind a difference, and what was entered since. */
export interface MonthlyDriftPerson {
  id: string;
  name: string;
  change: 'added' | 'removed';
}

export interface MonthlySent {
  confirmed: boolean;
  sentOn: string | null;
  savedByName: string | null;
  savedAt: string;
  updatedAt: string;
}

export interface MonthlyDrift {
  key: string;
  sent: number | null;
  now: number | null;
  /** For «active» and «inactive»: who is counted now and was not, or the reverse. */
  people: MonthlyDriftPerson[];
}

/** What was entered after the month was sent, with the person's name. */
export interface MonthlyLateFact extends LateFact {
  name: string;
}

export type SummaryWithSent = ServiceReportSummary & {
  sent: MonthlySent | null;
  drift: MonthlyDrift[];
  late: MonthlyLateFact[];
};

function flatten(s: ServiceReportSummary): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const line of LINES) {
    const c = s.categories.find((x) => x.pioneerType === line.type);
    out[line.count] = c?.count ?? 0;
    if (line.hours) out[line.hours] = c?.hours ?? 0;
    out[line.studies] = c?.bibleStudies ?? 0;
  }
  out.active = s.totalActivePublishers;
  out.inactive = s.totalInactivePublishers;
  return out;
}

/** The summary as it was sent: the stored numbers in the shape the screen reads. */
function unflatten(
  base: ServiceReportSummary,
  f: Record<string, number | null>,
): ServiceReportSummary {
  const categories = base.categories.map((c) => {
    const line = LINES.find((l) => l.type === c.pioneerType);
    if (!line) return c;
    return {
      ...c,
      count: f[line.count] ?? 0,
      hours: line.hours ? (f[line.hours] ?? 0) : null,
      bibleStudies: f[line.studies] ?? 0,
    };
  });
  const active = f.active ?? 0;
  const inactive = f.inactive ?? 0;
  const reporters = categories.reduce((n, c) => n + c.count, 0);
  const studies = categories.reduce((n, c) => n + c.bibleStudies, 0);
  const pioneers = categories.filter((c) => c.pioneerType !== 'none');
  const pioneerCount = pioneers.reduce((n, c) => n + c.count, 0);
  const pioneerHours = pioneers.reduce((n, c) => n + (c.hours ?? 0), 0);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    ...base,
    categories,
    totalActivePublishers: active,
    totalInactivePublishers: inactive,
    averages: {
      pioneerHours: pioneerCount > 0 ? round1(pioneerHours / pioneerCount) : 0,
      bibleStudies: reporters > 0 ? round1(studies / reporters) : 0,
      submittedPct: active > 0 ? Math.round((reporters / active) * 100) : 0,
      activePct:
        active + inactive > 0
          ? Math.round((active / (active + inactive)) * 100)
          : 0,
    },
  };
}

/**
 * THE MONTHLY SUMMARY (S-1) AS IT WENT TO THE BRANCH.
 *
 * Closing a month is the secretary saying «done, sent». Until now that froze
 * the reports against editing and nothing else: the figures on the page went
 * on being worked out afresh, so a correction made by the secretary himself a
 * week later quietly changed a sheet already filed. Now closing keeps the
 * figures as they stood, the page shows those, and anything entered since is
 * set beside them by name.
 *
 * A month nobody closed is frozen by the app once its deadline has passed —
 * marked as the app's, not as sent.
 */
@Injectable()
export class MonthlySentService {
  private readonly logger = new Logger(MonthlySentService.name);

  constructor(
    @InjectRepository(ReportSnapshot)
    private readonly snapshots: Repository<ReportSnapshot>,
    @InjectRepository(ServiceReport)
    private readonly reportsRepo: Repository<ServiceReport>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly reports: ServiceReportsService,
    private readonly audit: AuditLogService,
    private readonly clock: CongregationClock,
  ) {}

  /** Closed by a person: what the reports say now is what was sent. */
  async saveSent(
    tenantId: string,
    userId: string,
    reportMonth: string,
  ): Promise<void> {
    await this.keep(tenantId, reportMonth, userId);
  }

  /**
   * The nightly round: the month whose deadline has passed is frozen if
   * nobody closed it. Returns how many months were frozen.
   */
  async nightly(): Promise<number> {
    const all = await this.congregations.find({ select: { id: true } });
    let frozen = 0;
    for (const cong of all) {
      const tz = await this.clock.timezoneOf(cong.id);
      const month = monthKey(lastClosedReportMonth(new Date(), tz)).slice(0, 7);
      if (await this.find(cong.id, month)) continue;
      // Only a month the congregation actually collected: a congregation that
      // started using the app last week has no S-1 for last spring to freeze.
      const any = await this.reportsRepo.count({
        where: { congregationId: cong.id, reportMonth: `${month}-01` },
      });
      if (any === 0) continue;
      try {
        await this.keep(cong.id, `${month}-01`, null);
        frozen += 1;
      } catch (e) {
        this.logger.warn(
          `S-1 freeze failed for ${cong.id} ${month}: ${String(e)}`,
        );
      }
    }
    return frozen;
  }

  /**
   * The summary as the screen should show it: what was sent where something
   * was, with every difference from today's reports named.
   */
  async withSent(
    tenantId: string,
    live: ServiceReportSummary,
  ): Promise<SummaryWithSent> {
    const month = live.reportMonth.slice(0, 7);
    const row = await this.find(tenantId, month);
    if (!row) return { ...live, sent: null, drift: [], late: [] };

    const now = flatten(live);
    const sent = row.figures ?? {};
    const keys = MONTHLY_KEYS.filter((k) => (sent[k] ?? null) !== now[k]);
    // Who is behind today's figures — asked only when a list has moved.
    const nowMembers: SummaryMembers =
      keys.includes('active') || keys.includes('inactive')
        ? (await this.reports.computeSummary(tenantId, live.reportMonth))
            .members
        : {};

    const changedPeople = new Map<string, MonthlyDriftPerson[]>();
    const ids = new Set<string>();
    for (const key of ['active', 'inactive']) {
      if (!keys.includes(key)) continue;
      const then = new Set(row.members?.[key] ?? []);
      const today = new Set(nowMembers[key] ?? []);
      const people: MonthlyDriftPerson[] = [
        ...[...today]
          .filter((id) => !then.has(id))
          .map((id) => ({ id, name: '', change: 'added' as const })),
        ...[...then]
          .filter((id) => !today.has(id))
          .map((id) => ({ id, name: '', change: 'removed' as const })),
      ];
      people.forEach((p) => ids.add(p.id));
      changedPeople.set(key, people);
    }

    const late = keys.length
      ? await this.lateSince(tenantId, month, row.updatedAt, ids)
      : [];
    late.forEach((f) => ids.add(f.publisherId));
    const names = await this.namesOf(tenantId, [...ids]);

    return {
      ...unflatten(live, sent),
      // Whether the month is open for editing is today's fact, not the sheet's.
      closed: live.closed,
      sent: {
        confirmed: row.confirmed,
        sentOn: row.sentOn,
        savedByName: row.savedById
          ? await this.nameOfUser(row.savedById)
          : null,
        savedAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      drift: keys.map((key) => ({
        key,
        sent: sent[key] ?? null,
        now: now[key],
        people: (changedPeople.get(key) ?? [])
          .map((p) => ({ ...p, name: names.get(p.id) ?? '' }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      })),
      late: late.map((f) => ({ ...f, name: names.get(f.publisherId) ?? '' })),
    };
  }

  find(tenantId: string, month: string): Promise<ReportSnapshot | null> {
    return this.snapshots.findOne({
      where: {
        congregationId: tenantId,
        kind: 'monthly',
        period: month.slice(0, 7),
      },
    });
  }

  /** Keep the month as the reports say now — by a person, or by the app. */
  private async keep(
    tenantId: string,
    reportMonth: string,
    userId: string | null,
  ): Promise<void> {
    const { summary, members } = await this.reports.computeSummary(
      tenantId,
      reportMonth,
    );
    const month = summary.reportMonth.slice(0, 7);
    const before = await this.find(tenantId, month);
    // The app never overwrites what a person saved.
    if (before?.confirmed && userId === null) return;

    const row =
      before ??
      this.snapshots.create({
        congregationId: tenantId,
        kind: 'monthly',
        period: month,
      });
    const wasShape = before ? this.journalShape(before) : null;
    row.confirmed = userId !== null;
    row.sentOn =
      userId !== null
        ? todayIn(new Date(), await this.clock.timezoneOf(tenantId))
        : null;
    row.figures = flatten(summary);
    row.members = members;
    row.appointments = await this.appointmentsOf(tenantId, members);
    row.savedById = userId;
    const saved = await this.snapshots.save(row);

    const shape = this.journalShape(saved);
    if (wasShape) {
      const changed = Object.keys(shape).filter(
        (k) => JSON.stringify(shape[k]) !== JSON.stringify(wasShape[k]),
      );
      await this.audit.logRawUpdate({
        tenantId,
        entityType: 'monthly_report',
        entityId: saved.id,
        actorUserId: userId,
        changedFields: changed,
        before: Object.fromEntries(changed.map((k) => [k, wasShape[k]])),
        after: Object.fromEntries(changed.map((k) => [k, shape[k]])),
      });
    } else {
      await this.audit.logCreate({
        tenantId,
        entityType: 'monthly_report',
        entityId: saved.id,
        actorUserId: userId,
        after: shape,
      });
    }
  }

  /**
   * What was entered after the sheet was kept that bears on it: this month's
   * reports, the six-month window's for the people whose «active» or
   * «inactive» changed, and departures entered late.
   */
  private async lateSince(
    tenantId: string,
    month: string,
    since: Date,
    people: Set<string>,
  ): Promise<LateFact[]> {
    const from = `${addMonthKey(month, -5)}-01`;
    const rows = await this.reportsRepo.find({
      where: {
        congregationId: tenantId,
        reportMonth: Between(from, `${month}-01`),
      },
      withDeleted: true,
    });
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
    const reportFacts = reportsAsOf(
      rows,
      journal.map((e) => ({
        entityId: e.entityId,
        action: e.action,
        at: e.createdAt,
        before: e.beforeJson
          ? (JSON.parse(e.beforeJson) as Record<string, unknown>)
          : null,
      })),
      since,
    ).late.filter(
      (f) => f.reportMonth?.slice(0, 7) === month || people.has(f.publisherId),
    );
    const cards = await this.publishersRepo.find({
      where: { congregationId: tenantId },
      withDeleted: true,
    });
    const nextMonth = `${addMonthKey(month, 1)}-01`;
    const departures = publishersAsOf(cards, since).late.filter(
      (f) =>
        (f.kind === 'departure_entered' && (f.day ?? '') < nextMonth) ||
        (f.kind === 'card_created' && people.has(f.publisherId)),
    );
    return [...reportFacts, ...departures].sort((a, b) =>
      a.at.localeCompare(b.at),
    );
  }

  private journalShape(row: ReportSnapshot): Record<string, unknown> {
    const out: Record<string, unknown> = {
      sentOn: row.sentOn,
      confirmed: row.confirmed,
    };
    for (const k of MONTHLY_KEYS) out[k] = row.figures?.[k] ?? null;
    return out;
  }

  private async appointmentsOf(
    tenantId: string,
    members: SummaryMembers,
  ): Promise<Record<string, string>> {
    const ids = [...new Set(Object.values(members).flat())];
    if (ids.length === 0) return {};
    const cards = await this.publishersRepo.find({
      where: { congregationId: tenantId, id: In(ids) },
      withDeleted: true,
      select: ['id', 'appointment'],
    });
    return Object.fromEntries(cards.map((c) => [c.id, c.appointment]));
  }

  private async namesOf(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const cards = await this.publishersRepo.find({
      where: { congregationId: tenantId, id: In(ids) },
      withDeleted: true,
      select: ['id', 'firstName', 'lastName'],
    });
    return new Map(
      cards.map((c) => [
        c.id,
        [c.lastName, c.firstName].filter(Boolean).join(' ').trim(),
      ]),
    );
  }

  private async nameOfUser(userId: string): Promise<string | null> {
    const card = await this.publishersRepo.findOne({
      where: { userId },
      withDeleted: true,
      select: ['id', 'firstName', 'lastName'],
    });
    return card
      ? [card.lastName, card.firstName].filter(Boolean).join(' ').trim()
      : null;
  }
}
