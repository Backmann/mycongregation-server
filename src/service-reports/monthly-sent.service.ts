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
import {
  collectedReportMonth,
  lastClosedReportMonth,
  monthKey,
  REPORT_CLOSING_DAY,
} from '../common/report-month-window';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { addMonthKey } from '../common/service-status-rule';
import { carryKeyPublisher, keptSheetsOf } from './late-carry';
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

/** The S-1 form's lines, by the names the journal shows. */
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
] as const;
// Special pioneers and missionaries are not lines of the form: they report to
// the branch themselves (instruction, point 14; the form for September 2026
// has these three blocks only). Sheets kept before 30 October 2026 still hold
// their figures under 'special…' and 'missionary…'; nothing reads them.

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
  /**
   * A report of this month handed in after sending that goes on no line —
   * «did not share». The counted ones are under the summary's lateOut.
   */
  notCounted?: boolean;
}

export type SummaryWithSent = ServiceReportSummary & {
  sent: MonthlySent | null;
  drift: MonthlyDrift[];
  late: MonthlyLateFact[];
};

/** One month on the three totals cards. */
export interface S21TotalsMonth {
  /** YYYY-MM. */
  month: string;
  /**
   * sent — kept by a person as what went to the branch; frozen — kept by the
   * app; collecting — reports still coming in; closed — closed but never
   * kept (before sheets began, 1 October 2026): its figures are the reports
   * as they are now; open — past, never closed nor kept; none — nothing
   * recorded; future — not yet.
   */
  state:
    | 'sent'
    | 'frozen'
    | 'collecting'
    | 'closed'
    | 'open'
    | 'none'
    | 'future';
  /** Card 1: regular, special pioneers and missionaries in the field. */
  pioneers: {
    count: number;
    hours: number;
    studies: number;
    /** Of the count: special pioneers and missionaries. */
    directToBranch: number;
  };
  /** Card 2: auxiliary pioneers. */
  auxiliary: { count: number; hours: number; studies: number };
  /** Card 3: all other publishers. Their reports carry no hours. */
  publishers: { count: number; studies: number };
  /** Late reports of earlier months counted in this month, per card. */
  late: { pioneers: number; auxiliary: number; publishers: number };
}

export interface S21Totals {
  /** The service year, named by its end: 2027 is September 2026–August 2027. */
  serviceYear: number;
  /** The month whose reports are being handed in now, YYYY-MM. */
  collecting: string;
  months: S21TotalsMonth[];
}

function emptyTotalsMonth(
  month: string,
  state: 'none' | 'future',
): S21TotalsMonth {
  return {
    month,
    state,
    pioneers: { count: 0, hours: 0, studies: 0, directToBranch: 0 },
    auxiliary: { count: 0, hours: 0, studies: 0 },
    publishers: { count: 0, studies: 0 },
    late: { pioneers: 0, auxiliary: 0, publishers: 0 },
  };
}

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
      // The day AFTER the deadline: the form may go to the branch on the
      // 20th itself (instruction, point 14), and a frozen sheet is where late
      // reports are counted from — freezing on the night going INTO the 20th
      // made a report entered and sent that day «late», and it went to the
      // branch twice: in its own month and in the next.
      const month = monthKey(
        lastClosedReportMonth(new Date(), tz, REPORT_CLOSING_DAY + 1),
      ).slice(0, 7);
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

    // A report of this month handed in after it was sent has its own place
    // (lateOut: it goes into the next sheet) — not named twice.
    const lateOut = new Set((live.lateOut ?? []).map((l) => l.publisherId));
    const sentReporters =
      keptSheetsOf([{ period: month, members: row.members }]).get(month)
        ?.reporters ?? new Set<string>();
    const late = keys.length
      ? (await this.lateSince(tenantId, month, row.updatedAt, ids)).filter(
          (f) =>
            !(
              f.kind === 'report_filed' &&
              f.reportMonth?.slice(0, 7) === month &&
              lateOut.has(f.publisherId)
            ),
        )
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
      late: late.map((f) => ({
        ...f,
        name: names.get(f.publisherId) ?? '',
        // Handed in after sending by somebody the sheet does not know, and
        // not among the counted late ones: a late «did not share».
        ...(f.kind === 'report_filed' &&
        f.reportMonth?.slice(0, 7) === month &&
        !sentReporters.has(f.publisherId)
          ? { notCounted: true }
          : {}),
      })),
    };
  }

  /**
   * THE THREE TOTALS CARDS (S-21) OF A SERVICE YEAR (instruction, point 14;
   * Lionel, 30 October 2026: «план Б»).
   *
   * Besides each person's card the secretary keeps three cards with the
   * congregation's total for every month: (1) regular, special pioneers and
   * missionaries in the field, (2) auxiliary pioneers, (3) all other
   * publishers. A month stands on them as it went to the branch: the
   * figures kept when it was sent, a late report in the month whose sheet
   * took it — so cards 2 and 3 are the S-1's own lines, and card 1 is the
   * S-1's regular pioneers plus the special pioneers and missionaries, who
   * report to the branch themselves and are counted by their own month
   * (plus any of theirs that came in late, in the month it was counted).
   */
  async s21Totals(
    tenantId: string,
    user: AuthenticatedUser,
    requestedYear?: number,
  ): Promise<S21Totals> {
    const tz = await this.clock.timezoneOf(tenantId);
    const collecting = monthKey(collectedReportMonth(new Date(), tz)).slice(
      0,
      7,
    );
    const [cy, cm] = collecting.split('-').map(Number);
    const serviceYear =
      requestedYear && requestedYear > 2000 && requestedYear < 3000
        ? requestedYear
        : cm >= 9
          ? cy + 1
          : cy;
    const months: string[] = [];
    for (let i = 0; i < 12; i++) {
      months.push(addMonthKey(`${serviceYear - 1}-09`, i));
    }
    // The permission is the summary's: every elder reads, nobody else.
    const first = await this.reports.getSummary(tenantId, user, months[0]);

    const rows: S21TotalsMonth[] = [];
    for (const month of months) {
      if (month > collecting) {
        rows.push(emptyTotalsMonth(month, 'future'));
        continue;
      }
      const live =
        month === months[0]
          ? first
          : (await this.reports.computeSummary(tenantId, month)).summary;
      const shown = await this.withSent(tenantId, live);
      const line = (k: string) =>
        shown.categories.find((c) => c.pioneerType === k) ?? {
          count: 0,
          hours: 0,
          bibleStudies: 0,
        };
      const regular = line('regular');
      const special = line('special');
      const missionary = line('missionary');
      const aux = line('auxiliary');
      const pubs = line('none');
      const anything =
        !!shown.sent ||
        [regular, special, missionary, aux, pubs].some((c) => c.count > 0);
      if (!anything) {
        rows.push(emptyTotalsMonth(month, 'none'));
        continue;
      }
      const lateOf = (keys: string[]) =>
        (shown.carriedIn ?? []).filter((c) => keys.includes(c.category)).length;
      rows.push({
        month,
        // Months before 1 October 2026 were never kept — sheets began then —
        // yet most were closed and sent. «Closed» says so; only a past month
        // nobody closed is «open».
        state: shown.sent
          ? shown.sent.confirmed
            ? 'sent'
            : 'frozen'
          : month === collecting
            ? 'collecting'
            : live.closed
              ? 'closed'
              : 'open',
        pioneers: {
          count: regular.count + special.count + missionary.count,
          hours:
            (regular.hours ?? 0) +
            (special.hours ?? 0) +
            (missionary.hours ?? 0),
          studies:
            regular.bibleStudies +
            special.bibleStudies +
            missionary.bibleStudies,
          directToBranch: special.count + missionary.count,
        },
        auxiliary: {
          count: aux.count,
          hours: aux.hours ?? 0,
          studies: aux.bibleStudies,
        },
        publishers: { count: pubs.count, studies: pubs.bibleStudies },
        late: {
          pioneers: lateOf(['regular', 'special', 'missionary']),
          auxiliary: lateOf(['auxiliary']),
          publishers: lateOf(['none']),
        },
      });
    }
    return { serviceYear, collecting, months: rows };
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
    const before = await this.find(tenantId, reportMonth.slice(0, 7));
    // Confirming what the app froze: the secretary is saying what really
    // went, so whatever came in after the freeze belongs to this month — it
    // is not late. A sheet a person kept is late-proof the other way round:
    // closing it again never pulls in reports handed in after it was sent.
    const { summary, members } = await this.reports.computeSummary(
      tenantId,
      reportMonth,
      { absorbLate: !!before && !before.confirmed && userId !== null },
    );
    const month = summary.reportMonth.slice(0, 7);
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
    // `carried` holds «card@month» keys; the card id is before the @.
    const ids = [
      ...new Set(
        Object.entries(members).flatMap(([line, list]) =>
          line === 'carried' ? list.map(carryKeyPublisher) : list,
        ),
      ),
    ];
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
