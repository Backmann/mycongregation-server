import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Repository } from 'typeorm';
import { AuxiliaryPioneer } from '../entities/auxiliary-pioneer.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { AuxPioneerApplication } from '../entities/aux-pioneer-application.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { AuxiliaryPioneersService } from './auxiliary-pioneers.service';
import {
  goalOf,
  isActiveInMonth,
  monthKeyOf,
  monthsInRange,
  type ReducedReason,
} from './auxiliary-pioneer-hours';

/**
 * One month of one person in the history (29 October 2026):
 * - `reported` — the month is over or under way and his report came, with hours;
 * - `awaiting` — the month has begun and no report with hours yet;
 * - `ahead`    — the month has not begun;
 * - `pending`  — asked for in an application still before the committee.
 */
export type AuxCellState = 'reported' | 'awaiting' | 'ahead' | 'pending';

export interface AuxCell {
  month: string; // YYYY-MM
  goal: 15 | 30;
  hours: number | null;
  state: AuxCellState;
  /** The month belongs to an open («until cancelled») period. */
  untilCancelled: boolean;
}

export interface AuxYearRow {
  publisherId: string;
  name: string;
  /** He has an open period that reaches into this year. */
  untilCancelled: boolean;
  cells: AuxCell[];
  /** Months served in this year (pending ones not counted). */
  months: number;
  /** Hours reported for those months. */
  hours: number;
}

export interface AuxYearView {
  /** The calendar year the service year begins in: 2026 → Sep 2026 – Aug 2027. */
  year: number;
  /** The service years there is anything for, newest first. */
  years: number[];
  months: string[];
  current: string;
  reducible: { month: string; reasons: ReducedReason[] }[];
  counts: { month: string; serving: number; pending: number }[];
  rows: AuxYearRow[];
  totals: { people: number; months: number; hours: number };
}

export interface AuxCardView {
  totalMonths: number;
  /** The first service year he served in; null when never. */
  since: number | null;
  pending: {
    id: string;
    months: string[];
    untilCancelled: boolean;
    reducedMonths: string[];
  } | null;
  years: {
    year: number;
    cells: AuxCell[];
    hours: number;
    /** Some month of this year came from a paper application. */
    paper: boolean;
  }[];
}

function serviceYearOf(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  return m >= 9 ? y : y - 1;
}

function yearMonths(year: number): string[] {
  return monthsInRange(`${year}-09-01`, `${year + 1}-08-01`);
}

/**
 * THE HISTORY BY SERVICE YEARS (29 October 2026) — the committee's working
 * screen reads a year at a time: who served which month, with what goal, and
 * how many hours came in; and a publisher's card reads the same for one man,
 * year after year. Kept beside the periods rather than inside them: it is a
 * reading of periods, reports and pending applications together.
 */
@Injectable()
export class AuxYearService {
  constructor(
    @InjectRepository(AuxiliaryPioneer)
    private readonly periods: Repository<AuxiliaryPioneer>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(ServiceReport)
    private readonly reports: Repository<ServiceReport>,
    @InjectRepository(AuxPioneerApplication)
    private readonly apps: Repository<AuxPioneerApplication>,
    private readonly clock: CongregationClock,
    private readonly aux: AuxiliaryPioneersService,
  ) {}

  /** Hours reported, by «publisherId|YYYY-MM». */
  private async hoursOf(
    congregationId: string,
    publisherIds: string[],
    from: string,
    to: string,
  ): Promise<Map<string, number>> {
    if (publisherIds.length === 0) return new Map();
    const rows = await this.reports.find({
      where: {
        congregationId,
        publisherId: In(publisherIds),
        reportMonth: Between(`${from}-01`, `${to}-01`),
        deletedAt: IsNull(),
      },
      select: ['publisherId', 'reportMonth', 'hoursReported'],
    });
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.hoursReported === null || r.hoursReported === undefined) continue;
      out.set(
        `${r.publisherId}|${String(r.reportMonth).slice(0, 7)}`,
        r.hoursReported,
      );
    }
    return out;
  }

  private cellOf(
    p: AuxiliaryPioneer,
    month: string,
    current: string,
    hours: number | undefined,
  ): AuxCell {
    const goal = goalOf(p, month) === 15 ? 15 : 30;
    const state: AuxCellState =
      hours !== undefined ? 'reported' : month > current ? 'ahead' : 'awaiting';
    return {
      month,
      goal,
      hours: hours ?? null,
      state,
      untilCancelled: p.untilCancelled,
    };
  }

  private active(p: AuxiliaryPioneer, month: string): boolean {
    return isActiveInMonth(
      {
        startMonth: p.startMonth,
        endMonth: p.endMonth,
        untilCancelled: p.untilCancelled,
      },
      month,
    );
  }

  async year(congregationId: string, asked?: number): Promise<AuxYearView> {
    const current = monthKeyOf(await this.clock.todayFor(congregationId));
    const thisYear = serviceYearOf(current);
    const all = await this.periods.find({ where: { congregationId } });
    const pendingApps = await this.apps.find({
      where: { congregationId, status: 'pending' },
    });

    // The years there is something for: from the first period to this year,
    // and the next one when something is already planned in it.
    const first = all.reduce(
      (min, p) => Math.min(min, serviceYearOf(p.startMonth.slice(0, 7))),
      thisYear,
    );
    const plannedNext =
      all.some((p) => p.startMonth.slice(0, 7) >= `${thisYear + 1}-09`) ||
      pendingApps.some((a) => a.months.some((m) => m >= `${thisYear + 1}-09`));
    const last = plannedNext ? thisYear + 1 : thisYear;
    const years: number[] = [];
    for (let y = last; y >= first; y--) years.push(y);
    const year =
      asked !== undefined && asked >= first && asked <= last ? asked : thisYear;

    const months = yearMonths(year);
    const from = months[0];
    const to = months[months.length - 1];
    const inYear = all.filter((p) => months.some((m) => this.active(p, m)));
    const pendingInYear = pendingApps.filter((a) =>
      a.months.some((m) => m >= from && m <= to),
    );
    const ids = [
      ...new Set([
        ...inYear.map((p) => p.publisherId),
        ...pendingInYear.map((a) => a.publisherId),
      ]),
    ];
    const names = await this.namesOf(congregationId, ids);
    const hours = await this.hoursOf(congregationId, ids, from, to);

    const rows: AuxYearRow[] = ids.map((id) => {
      const mine = inYear.filter((p) => p.publisherId === id);
      const cells: AuxCell[] = [];
      for (const m of months) {
        const p = mine.find((x) => this.active(x, m));
        if (p) {
          cells.push(this.cellOf(p, m, current, hours.get(`${id}|${m}`)));
          continue;
        }
        const a = pendingInYear.find(
          (x) => x.publisherId === id && x.months.includes(m),
        );
        if (a) {
          cells.push({
            month: m,
            goal: a.reducedMonths.includes(m) ? 15 : 30,
            hours: null,
            state: 'pending',
            untilCancelled: a.untilCancelled,
          });
        }
      }
      const served = cells.filter((c) => c.state !== 'pending');
      return {
        publisherId: id,
        name: names.get(id) ?? '—',
        untilCancelled: mine.some((p) => p.untilCancelled),
        cells,
        months: served.length,
        hours: served.reduce((s, c) => s + (c.hours ?? 0), 0),
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const counts = months.map((m) => ({
      month: m,
      serving: rows.filter((r) =>
        r.cells.some((c) => c.month === m && c.state !== 'pending'),
      ).length,
      pending: rows.filter((r) =>
        r.cells.some((c) => c.month === m && c.state === 'pending'),
      ).length,
    }));
    const servedRows = rows.filter((r) => r.months > 0);
    return {
      year,
      years,
      months,
      current,
      reducible: await this.aux.reducibleMonths(
        congregationId,
        `${from}-01`,
        `${to}-01`,
      ),
      counts,
      rows,
      totals: {
        people: servedRows.length,
        months: servedRows.reduce((s, r) => s + r.months, 0),
        hours: servedRows.reduce((s, r) => s + r.hours, 0),
      },
    };
  }

  /**
   * One publisher, every year he served — for his card. An open period is
   * shown up to the current month and no further: what lies ahead of it is
   * not yet history.
   */
  async card(
    congregationId: string,
    publisherId: string,
  ): Promise<AuxCardView> {
    const current = monthKeyOf(await this.clock.todayFor(congregationId));
    const mine = await this.periods.find({
      where: { congregationId, publisherId },
    });
    const pendingApp = await this.apps.findOne({
      where: { congregationId, publisherId, status: 'pending' },
    });
    const paperApps = await this.apps.find({
      where: {
        congregationId,
        publisherId,
        status: 'approved',
        source: 'paper',
      },
    });
    const paperMonths = new Set(paperApps.flatMap((a) => a.months));

    const allMonths = new Map<string, AuxiliaryPioneer>();
    for (const p of mine) {
      const start = p.startMonth.slice(0, 7);
      const end =
        p.untilCancelled || !p.endMonth
          ? start > current
            ? start
            : current
          : p.endMonth.slice(0, 7);
      for (const m of monthsInRange(`${start}-01`, `${end}-01`)) {
        if (!allMonths.has(m)) allMonths.set(m, p);
      }
    }
    const keys = [...allMonths.keys()].sort();
    const hours =
      keys.length === 0
        ? new Map<string, number>()
        : await this.hoursOf(
            congregationId,
            [publisherId],
            keys[0],
            keys[keys.length - 1],
          );
    const byYear = new Map<number, AuxCell[]>();
    for (const m of keys) {
      const cell = this.cellOf(
        allMonths.get(m)!,
        m,
        current,
        hours.get(`${publisherId}|${m}`),
      );
      const y = serviceYearOf(m);
      byYear.set(y, [...(byYear.get(y) ?? []), cell]);
    }
    const years = [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, cells]) => ({
        year,
        cells,
        hours: cells.reduce((s, c) => s + (c.hours ?? 0), 0),
        paper: cells.some((c) => paperMonths.has(c.month)),
      }));
    return {
      totalMonths: keys.length,
      since: years.length ? years[years.length - 1].year : null,
      pending: pendingApp
        ? {
            id: pendingApp.id,
            months: pendingApp.months,
            untilCancelled: pendingApp.untilCancelled,
            reducedMonths: pendingApp.reducedMonths,
          }
        : null,
      years,
    };
  }

  /**
   * His reports that came in without hours for a month that is now one of
   * auxiliary service — filed before the application was approved. Only
   * months still open: a closed one is the secretary's to correct.
   */
  async reportsWithoutHours(
    congregationId: string,
    publisherId: string,
  ): Promise<{ reportId: string; month: string }[]> {
    const rows = await this.reports.find({
      where: { congregationId, publisherId, hoursReported: IsNull() },
      select: ['id', 'reportMonth'],
    });
    if (rows.length === 0) return [];
    const periods = await this.periods.find({
      where: { congregationId, publisherId },
    });
    const candidates = rows
      .map((r) => ({
        reportId: r.id,
        month: String(r.reportMonth).slice(0, 7),
      }))
      .filter((r) => periods.some((p) => this.active(p, r.month)));
    if (candidates.length === 0) return [];
    const closed = await this.aux.closedAmong(
      congregationId,
      candidates.map((c) => c.month),
    );
    return candidates
      .filter((c) => !closed.has(c.month))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  private async namesOf(
    congregationId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.publishers.find({
      where: { id: In(ids), congregationId },
      select: ['id', 'displayName'],
      withDeleted: true,
    });
    return new Map(rows.map((p) => [p.id, p.displayName]));
  }
}
