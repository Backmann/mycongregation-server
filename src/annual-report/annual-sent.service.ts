import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { ReportSnapshot } from '../entities/report-snapshot.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { todayIn } from '../common/congregation-clock';
import { MeetingAttendanceService } from '../meeting-attendance/meeting-attendance.service';
import { AnnualReportService } from './annual-report.service';
import type {
  AnnualFigures,
  CountedPublisher,
  LastMonthCollection,
} from './annual-figures';
import type { LateFact } from './as-of';

/**
 * The figures of the S-10 that are lists of people — every one of them can be
 * opened, and every difference can be explained by name.
 */
export const ANNUAL_LIST_KEYS = [
  'active',
  'becameInactive',
  'reactivated',
  'deaf',
  'blind',
  'imprisoned',
] as const;
export type AnnualListKey = (typeof ANNUAL_LIST_KEYS)[number];

/** And the two that are not: the attendance averages. */
export const ANNUAL_NUMBER_KEYS = [
  ...ANNUAL_LIST_KEYS,
  'midweekAverage',
  'weekendAverage',
] as const;
export type AnnualNumberKey = (typeof ANNUAL_NUMBER_KEYS)[number];

export type AnnualNumbers = Record<AnnualNumberKey, number | null>;

/** One person behind a difference between what was sent and what is now. */
export interface DriftPerson {
  id: string;
  name: string;
  /** Counted now and not then ('added'), or then and not now ('removed'). */
  change: 'added' | 'removed';
  /** What was entered after the figures were sent that bears on them. */
  reasons: LateFact[];
}

export interface DriftLine {
  key: AnnualNumberKey;
  sent: number | null;
  now: number | null;
  /** Empty for the attendance averages, which are not lists of people. */
  people: DriftPerson[];
}

export interface AnnualSentView {
  startYear: number;
  /**
   * The last day to save what was sent: 20 September. The secretary files
   * the annual report between 1 and 20 September (Lionel, 1 October 2026);
   * from the next day the app freezes its own figures if nobody has.
   */
  freezeOn: string;
  /** What the reports and the attendance record say today. */
  now: AnnualNumbers;
  sent: null | {
    confirmed: boolean;
    sentOn: string | null;
    figures: AnnualNumbers;
    /** Who stood behind each list figure when it was saved. */
    members: Record<AnnualListKey, CountedPublisher[]>;
    savedByName: string | null;
    savedAt: string;
    updatedAt: string;
  };
  /** Only the lines where what was sent and what is now differ. */
  drift: DriftLine[];
  /** August's collection: who has not reported, and whose «active» it decides. */
  lastMonth: LastMonthCollection;
}

/**
 * The last day the year's report is the secretary's to save: 20 September.
 *
 * It was 20 October at first, reasoning from September's reports; but the
 * annual report is filed between 1 and 20 September, every year, and a task
 * still open a month later only taught people to ignore it.
 */
function freezeDay(startYear: number): string {
  return `${startYear + 1}-09-20`;
}

/** The calendar day before `day` (YYYY-MM-DD). */
function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether something entered later can have moved this figure. «Active» looks
 * at March–August only; the six-month questions look across the whole year;
 * the circumstances are marks on the card that the journal does not keep, so
 * no report explains them. A card typed in or a departure entered bears on
 * every list.
 */
function bearsOn(key: AnnualListKey, f: LateFact, startYear: number): boolean {
  if (f.kind === 'card_created' || f.kind === 'departure_entered') return true;
  if (!f.reportMonth) return false;
  if (key === 'deaf' || key === 'blind' || key === 'imprisoned') return false;
  if (key === 'active') {
    const m = f.reportMonth.slice(0, 7);
    return m >= `${startYear + 1}-03` && m <= `${startYear + 1}-08`;
  }
  return true;
}

function fullName(p: Pick<Publisher, 'lastName' | 'firstName'>): string {
  return [p.lastName, p.firstName].filter(Boolean).join(' ').trim();
}

/**
 * THE ANNUAL REPORT AS IT WENT TO THE BRANCH.
 *
 * Saving is the secretary saying «this is what I sent». The numbers are his to
 * type — the app offers its own, but the form he filed may say otherwise, and
 * the record has to agree with the form, not with the app. Beside them the
 * app keeps who it counted on the day BEFORE sending, so that whatever arrives
 * afterwards — on the day itself included — is named when the figures part.
 */
@Injectable()
export class AnnualSentService {
  constructor(
    @InjectRepository(ReportSnapshot)
    private readonly snapshots: Repository<ReportSnapshot>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    private readonly annual: AnnualReportService,
    private readonly attendance: MeetingAttendanceService,
    private readonly audit: AuditLogService,
    private readonly clock: CongregationClock,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(ElderTaskCalendarLog)
    private readonly taskLog: Repository<ElderTaskCalendarLog>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
  ) {}

  /**
   * The nightly round, for every congregation: from 1 September put «save
   * what was sent» on the secretary's list; from 21 September freeze the
   * year if nobody has. Returns how many things it did.
   */
  async nightly(): Promise<number> {
    const all = await this.congregations.find({ select: { id: true } });
    let done = 0;
    for (const cong of all) {
      const today = await this.clock.todayFor(cong.id);
      const [y, m] = today.split('-').map(Number);
      // September to December: the year that has just ended began last year.
      if (m < 9) continue;
      const startYear = y - 1;
      if (await this.offerTask(cong.id, startYear, today)) done += 1;
      if (await this.freezeIfDue(cong.id, startYear)) done += 1;
    }
    return done;
  }

  /**
   * «Сохранить отправленный годовой отчёт» — on the secretary's list from 1
   * to 20 September, unless it is saved already.
   *
   * By name, because it is his work and the list should say whose. Deleted on
   * purpose stays deleted for that year — the rule every calendar task obeys.
   */
  private async offerTask(
    tenantId: string,
    startYear: number,
    today: string,
  ): Promise<boolean> {
    const period = String(startYear + 1);
    // A task the app raised and nobody has closed follows the rule when the
    // rule changes — it was due 20 October before 1 October 2026. One moved
    // or closed by a person is left as he left it.
    await this.tasks.update(
      {
        congregationId: tenantId,
        kind: 'annual_report_sent',
        kindPeriod: period,
        status: 'open',
        createdById: IsNull(),
        dueDate: Not(freezeDay(startYear)),
      },
      { dueDate: freezeDay(startYear) },
    );
    if (today > freezeDay(startYear)) return false;
    const offered = await this.taskLog.findOne({
      where: { congregationId: tenantId, kind: 'annual_report_sent', period },
    });
    if (offered) return false;
    const saved = await this.find(tenantId, startYear);
    if (saved?.confirmed) return false;

    const held = await this.responsibilities.find({
      where: { congregationId: tenantId, type: ResponsibilityType.SECRETARY },
    });
    const userIds = held.map((r) => r.userId).filter(Boolean);
    const assignees = userIds.length
      ? await this.publishersRepo.find({
          where: {
            congregationId: tenantId,
            userId: In(userIds),
            removedAt: IsNull(),
          },
        })
      : [];
    await this.tasks.save(
      this.tasks.create({
        congregationId: tenantId,
        // A placeholder: the reader's own app writes the words from `kind`.
        title: 'annual_report_sent',
        details: null,
        area: 'organisation',
        assigneeKind: 'people',
        assignees,
        dueDate: freezeDay(startYear),
        kind: 'annual_report_sent',
        kindPeriod: period,
        status: 'open',
        createdById: null,
      }),
    );
    await this.taskLog.save(
      this.taskLog.create({
        congregationId: tenantId,
        kind: 'annual_report_sent',
        period,
      }),
    );
    return true;
  }

  /** Saved — so the task that asked for it is done, and by whom. */
  private async closeTask(
    tenantId: string,
    startYear: number,
    userId: string,
  ): Promise<void> {
    await this.tasks.update(
      {
        congregationId: tenantId,
        kind: 'annual_report_sent',
        kindPeriod: String(startYear + 1),
        status: 'open',
      },
      { status: 'done', doneAt: new Date(), doneById: userId },
    );
  }

  async view(tenantId: string, startYear: number): Promise<AnnualSentView> {
    const [row, current, now, lastMonth] = await Promise.all([
      this.find(tenantId, startYear),
      this.annual.figures(tenantId, startYear),
      this.numbersNow(tenantId, startYear),
      this.annual.lastMonthCollection(tenantId, startYear),
    ]);
    const base = { startYear, freezeOn: freezeDay(startYear), now, lastMonth };
    if (!row) return { ...base, sent: null, drift: [] };

    const names = await this.namesOf(tenantId, [
      ...Object.values(row.members ?? {}).flat(),
      ...ANNUAL_LIST_KEYS.flatMap((k) => current[k].map((p) => p.id)),
    ]);
    const sentFigures = this.numbersOf(row.figures);

    // What was entered after the figures were taken: from the day before they
    // went out, or — for figures the app froze itself — from the day it did.
    const since = row.sentOn
      ? dayBefore(row.sentOn)
      : await this.localDay(tenantId, row.createdAt);
    const differs = ANNUAL_NUMBER_KEYS.filter((k) => sentFigures[k] !== now[k]);
    const late = differs.some((k) =>
      (ANNUAL_LIST_KEYS as readonly string[]).includes(k),
    )
      ? (await this.annual.figuresAsOf(tenantId, startYear, since)).late
      : [];

    const drift: DriftLine[] = differs.map((key) => {
      if (!(ANNUAL_LIST_KEYS as readonly string[]).includes(key)) {
        return { key, sent: sentFigures[key], now: now[key], people: [] };
      }
      const listKey = key as AnnualListKey;
      const then = new Set(row.members?.[listKey] ?? []);
      const today = new Set(current[listKey].map((p) => p.id));
      const person = (id: string, change: DriftPerson['change']) => ({
        id,
        name: names.get(id) ?? '',
        change,
        reasons: late.filter(
          (f) => f.publisherId === id && bearsOn(listKey, f, startYear),
        ),
      });
      return {
        key,
        sent: sentFigures[key],
        now: now[key],
        people: [
          ...[...today]
            .filter((id) => !then.has(id))
            .map((id) => person(id, 'added')),
          ...[...then]
            .filter((id) => !today.has(id))
            .map((id) => person(id, 'removed')),
        ].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      };
    });

    const members = Object.fromEntries(
      ANNUAL_LIST_KEYS.map((k) => [
        k,
        (row.members?.[k] ?? [])
          .map((id) => ({ id, name: names.get(id) ?? '' }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      ]),
    ) as Record<AnnualListKey, CountedPublisher[]>;

    return {
      ...base,
      sent: {
        confirmed: row.confirmed,
        sentOn: row.sentOn,
        figures: sentFigures,
        members,
        savedByName: row.savedById
          ? ((await this.nameOfUser(row.savedById)) ?? null)
          : null,
        savedAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      drift,
    };
  }

  /**
   * «This is what I sent.» The numbers are taken as typed; the people behind
   * them are the app's count on the day before `sentOn`.
   */
  async save(
    tenantId: string,
    userId: string,
    startYear: number,
    input: { sentOn: string; figures: Partial<Record<string, unknown>> },
  ): Promise<AnnualSentView> {
    const today = await this.clock.todayFor(tenantId);
    const yearEnd = `${startYear + 1}-08-31`;
    if (input.sentOn <= yearEnd) {
      throw new BadRequestException(
        'The annual report is sent after the service year has ended.',
      );
    }
    if (input.sentOn > today) {
      throw new BadRequestException('The day it was sent is still ahead.');
    }
    const figures = this.cleanFigures(input.figures);

    const asOf = await this.annual.figuresAsOf(
      tenantId,
      startYear,
      dayBefore(input.sentOn),
    );
    const before = await this.find(tenantId, startYear);
    const row =
      before ??
      this.snapshots.create({
        congregationId: tenantId,
        kind: 'annual',
        period: String(startYear),
      });
    const wasShape = before ? this.journalShape(before) : null;

    row.confirmed = true;
    row.sentOn = input.sentOn;
    row.figures = figures;
    row.members = this.membersOf(asOf);
    row.appointments = await this.appointmentsOf(tenantId, row.members);
    row.savedById = userId;
    const saved = await this.snapshots.save(row);

    const shape = this.journalShape(saved);
    if (wasShape) {
      const changed = Object.keys(shape).filter(
        (k) => JSON.stringify(shape[k]) !== JSON.stringify(wasShape[k]),
      );
      await this.audit.logRawUpdate({
        tenantId,
        entityType: 'annual_report',
        entityId: saved.id,
        actorUserId: userId,
        changedFields: changed,
        before: Object.fromEntries(changed.map((k) => [k, wasShape[k]])),
        after: Object.fromEntries(changed.map((k) => [k, shape[k]])),
      });
    } else {
      await this.audit.logCreate({
        tenantId,
        entityType: 'annual_report',
        entityId: saved.id,
        actorUserId: userId,
        after: shape,
      });
    }
    await this.closeTask(tenantId, startYear, userId);
    return this.view(tenantId, startYear);
  }

  /**
   * Nobody saved what was sent, and the year is past being filed: keep what
   * the app counts today, marked as the app's and not confirmed. Without
   * this the year would go on moving for ever, which is the very thing the
   * snapshot exists to stop. Returns whether anything was frozen.
   */
  async freezeIfDue(tenantId: string, startYear: number): Promise<boolean> {
    const today = await this.clock.todayFor(tenantId);
    // The day after the deadline: 20 September itself is still his to save.
    if (today <= freezeDay(startYear)) return false;
    if (await this.find(tenantId, startYear)) return false;

    const current = await this.annual.figures(tenantId, startYear);
    const row = this.snapshots.create({
      congregationId: tenantId,
      kind: 'annual',
      period: String(startYear),
      confirmed: false,
      sentOn: null,
      figures: await this.numbersNow(tenantId, startYear, current),
      members: this.membersOf(current),
      savedById: null,
    });
    row.appointments = await this.appointmentsOf(tenantId, row.members);
    const saved = await this.snapshots.save(row);
    await this.audit.logCreate({
      tenantId,
      entityType: 'annual_report',
      entityId: saved.id,
      actorUserId: null,
      after: this.journalShape(saved),
    });
    return true;
  }

  /** The figures the app gives today, the attendance averages included. */
  async numbersNow(
    tenantId: string,
    startYear: number,
    known?: AnnualFigures,
  ): Promise<AnnualNumbers> {
    const [figures, attendance, today] = await Promise.all([
      known ?? this.annual.figures(tenantId, startYear),
      this.attendance.serviceYear(tenantId, startYear),
      this.clock.todayFor(tenantId),
    ]);
    // The form: add the monthly averages and divide. A month still ahead is
    // not a gap — the same reading the screen has always given.
    const started = attendance.months.filter(
      (m) => m.month <= `${today.slice(0, 7)}-01`,
    );
    const avg = (pick: (m: (typeof started)[number]) => number | null) => {
      const have = started.map(pick).filter((v): v is number => v !== null);
      return have.length
        ? Math.round(have.reduce((a, b) => a + b, 0) / have.length)
        : null;
    };
    return {
      active: figures.active.length,
      becameInactive: figures.becameInactive.length,
      reactivated: figures.reactivated.length,
      deaf: figures.deaf.length,
      blind: figures.blind.length,
      imprisoned: figures.imprisoned.length,
      midweekAverage: avg((m) => m.midweekAverage),
      weekendAverage: avg((m) => m.weekendAverage),
    };
  }

  find(tenantId: string, startYear: number): Promise<ReportSnapshot | null> {
    return this.snapshots.findOne({
      where: {
        congregationId: tenantId,
        kind: 'annual',
        period: String(startYear),
      },
    });
  }

  private cleanFigures(raw: Partial<Record<string, unknown>>): AnnualNumbers {
    const out = {} as AnnualNumbers;
    for (const k of ANNUAL_NUMBER_KEYS) {
      const v = raw?.[k];
      if (v === null || v === undefined || v === '') {
        out[k] = null;
        continue;
      }
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100000) {
        throw new BadRequestException(`${k} must be a whole number`);
      }
      out[k] = n;
    }
    return out;
  }

  private numbersOf(stored: Record<string, number | null>): AnnualNumbers {
    const out = {} as AnnualNumbers;
    for (const k of ANNUAL_NUMBER_KEYS) out[k] = stored?.[k] ?? null;
    return out;
  }

  private membersOf(f: AnnualFigures): Record<string, string[]> {
    return Object.fromEntries(
      ANNUAL_LIST_KEYS.map((k) => [k, f[k].map((p) => p.id).sort()]),
    );
  }

  private async appointmentsOf(
    tenantId: string,
    members: Record<string, string[]>,
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

  /** What the journal shows: the day sent, whether confirmed, the numbers. */
  private journalShape(row: ReportSnapshot): Record<string, unknown> {
    return {
      sentOn: row.sentOn,
      confirmed: row.confirmed,
      ...this.numbersOf(row.figures),
    };
  }

  private async namesOf(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const cards = await this.publishersRepo.find({
      where: { congregationId: tenantId, id: In(unique) },
      withDeleted: true,
      select: ['id', 'firstName', 'lastName'],
    });
    return new Map(cards.map((c) => [c.id, fullName(c)]));
  }

  private async nameOfUser(userId: string): Promise<string | null> {
    const card = await this.publishersRepo.findOne({
      where: { userId },
      withDeleted: true,
      select: ['id', 'firstName', 'lastName'],
    });
    return card ? fullName(card) : null;
  }

  private async localDay(tenantId: string, at: Date): Promise<string> {
    return todayIn(at, await this.clock.timezoneOf(tenantId));
  }
}
