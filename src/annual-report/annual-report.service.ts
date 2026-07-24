import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { ServiceReport } from '../entities/service-report.entity';
import { Publisher } from '../entities/publisher.entity';
import { reportedMinistry } from '../common/reported-ministry';

/**
 * Figures for the annual congregation report (S-10), computed for one service
 * year — September through August.
 *
 * DELIBERATELY SEPARATE from the publisher status the rest of the app keeps.
 * That status is a rolling, present-tense pastoral judgement: it asks "who is
 * this person now" and looks at a moving window. The annual report asks
 * different questions about a finished year, and its "inactive" explicitly
 * excludes anyone who lapsed in an earlier year and never came back. The two
 * agree most of the time and differ silently, which in a form signed and
 * handed over is the worst kind of wrong. So nothing here reads the status
 * field; everything is derived from the reports themselves. The only thing
 * shared with the rest of the app is `reportedMinistry`, the plain fact of
 * whether a month was reported — the same fact, aggregated differently.
 */

/** A publisher who counts towards one of the figures, kept so a reader can look. */
export interface CountedPublisher {
  id: string;
  name: string;
  /** The month that put them in this group, where one applies. */
  month?: string;
}

/** How many reports came in for a month — the shape of the year, plainly. */
export interface MonthlyReporters {
  month: string;
  count: number;
}

export interface AnnualFigures {
  startYear: number;
  /**
   * Reports received per month, September through August.
   *
   * NOT a judgement about who failed to report: this app cannot tell "did not
   * share" from "not collected yet", and a warning built on that guess would
   * be an inference dressed as a fact — in a form that goes to the circuit
   * overseer, the worst kind. The figures are given instead, so a secretary
   * filing in early September sees for himself that August stands at twelve
   * where every other month stands at forty, and knows the year is not in yet.
   */
  monthlyReporters: MonthlyReporters[];
  /** Reported at least one month between March and August. */
  active: CountedPublisher[];
  /** Completed six consecutive unreported months WITHIN this service year. */
  becameInactive: CountedPublisher[];
  /** Were inactive and reported again within this service year. */
  reactivated: CountedPublisher[];
  deaf: CountedPublisher[];
  blind: CountedPublisher[];
  imprisoned: CountedPublisher[];
}

@Injectable()
export class AnnualReportService {
  constructor(
    @InjectRepository(ServiceReport)
    private readonly reportsRepo: Repository<ServiceReport>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
  ) {}

  async figures(tenantId: string, startYear: number): Promise<AnnualFigures> {
    const yearMonths = monthsOfServiceYear(startYear);
    // Six months of run-up as well: deciding whether somebody BECAME inactive
    // in September means looking at the six months before it, and telling that
    // apart from "was already inactive coming in" needs one month more still.
    const from = addMonths(yearMonths[0], -7);
    const to = yearMonths[11];

    const [reports, publishers] = await Promise.all([
      this.reportsRepo.find({
        where: { congregationId: tenantId, reportMonth: Between(from, to) },
      }),
      this.publishersRepo.find({ where: { congregationId: tenantId } }),
    ]);

    // publisher → the set of months they reported ministry in
    const reportedBy = new Map<string, Set<string>>();
    for (const r of reports) {
      if (!reportedMinistry(r)) continue;
      const key = r.reportMonth.slice(0, 7);
      const set = reportedBy.get(r.publisherId) ?? new Set<string>();
      set.add(key);
      reportedBy.set(r.publisherId, set);
    }

    const monthlyReporters: MonthlyReporters[] = yearMonths.map((m) => ({
      month: `${m}-01`,
      count: reports.filter(
        (r) => r.reportMonth.slice(0, 7) === m && reportedMinistry(r),
      ).length,
    }));

    const active: CountedPublisher[] = [];
    const becameInactive: CountedPublisher[] = [];
    const reactivated: CountedPublisher[] = [];
    const deaf: CountedPublisher[] = [];
    const blind: CountedPublisher[] = [];
    const imprisoned: CountedPublisher[] = [];

    for (const p of publishers) {
      if (p.removedAt) continue;
      const who = { id: p.id, name: fullName(p) };
      const months = reportedBy.get(p.id) ?? new Set<string>();

      // Active: reported at least once March–August of this service year.
      if (marchToAugust(startYear).some((m) => months.has(m))) {
        active.push(who);
      }

      // Inactive as of month M: none of M and the five before it reported.
      const inactiveAt = (m: string) =>
        lastSixMonths(m).every((x) => !months.has(x));

      for (const m of yearMonths) {
        // Became inactive here: inactive now, not inactive a month ago. That
        // second half is what keeps out someone who lapsed years ago and never
        // returned — their run completed long before this year.
        if (inactiveAt(m) && !inactiveAt(addMonths(m, -1))) {
          becameInactive.push({ ...who, month: m });
          break;
        }
      }

      for (const m of yearMonths) {
        // Resumed here: reported this month, having been inactive last month.
        if (months.has(m) && inactiveAt(addMonths(m, -1))) {
          reactivated.push({ ...who, month: m });
          break;
        }
      }

      if (p.isDeaf) deaf.push(who);
      if (p.isBlind) blind.push(who);
      if (p.isImprisoned) imprisoned.push(who);
    }

    return {
      startYear,
      monthlyReporters,
      active,
      becameInactive,
      reactivated,
      deaf,
      blind,
      imprisoned,
    };
  }
}

function fullName(p: Publisher): string {
  return [p.lastName, p.firstName].filter(Boolean).join(' ').trim();
}

/** The twelve months of a service year as YYYY-MM, September first. */
export function monthsOfServiceYear(startYear: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const y = startYear + (i < 4 ? 0 : 1);
    const m = ((8 + i) % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/** March through August of the service year — the window "active" is judged on. */
function marchToAugust(startYear: number): string[] {
  return [3, 4, 5, 6, 7, 8].map(
    (m) => `${startYear + 1}-${String(m).padStart(2, '0')}`,
  );
}

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** The month itself and the five before it. */
function lastSixMonths(ym: string): string[] {
  return [0, 1, 2, 3, 4, 5].map((i) => addMonths(ym, -i));
}
