import { PublisherStatus } from './enums/publisher-status.enum';

/**
 * Who is active, who is irregular, who is inactive — and from WHEN each person
 * is counted at all.
 *
 * ONE module, because the same two questions are asked from four places: the
 * status on the card, the «missed N months» flag on the group screen, whether
 * a person still owes this month's report, and the annual congregation report.
 * They were four separate answers, and they disagreed: a brother who had
 * handed in a report every month for a year turned INACTIVE the night his
 * baptism date was entered, because one of the copies read «start counting at
 * baptism» while he had been reporting as an unbaptized publisher all along.
 *
 * The rules, as the congregation states them:
 *
 *   - A HANDED-IN REPORT COUNTS AT ONCE, including for the month still being
 *     collected. A report is a fact; the calendar is not evidence about it.
 *   - A MISS COUNTS ONLY IN A CLOSED MONTH — no report at all, or a report
 *     saying the publisher did not share. Silence in a month whose deadline
 *     has not passed means nothing: he is not late yet.
 *   - COUNTING BEGINS when the person began to report: as an unbaptized
 *     publisher, at baptism, or with their first report, whichever is earliest.
 *     Baptism is a step forward in a life already being counted, never a reset.
 *   - SIX CLOSED MONTHS without sharing makes a person inactive — and when he
 *     hands in a report again, COUNTING BEGINS AFRESH from that month. Without
 *     that restart the three statuses contradict one another: a man returning
 *     after half a year of silence would outrank a brother who missed a single
 *     month, because one report out of seven beats five out of six.
 */

/** Months as `YYYY-MM`; all arithmetic here is on that form. */
export type MonthKey = string;

export function monthKeyOfDate(date: Date): MonthKey {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function addMonthKey(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const mon = total - year * 12 + 1;
  return `${year}-${String(mon).padStart(2, '0')}`;
}

/** Every month from `from` to `to` inclusive; empty when `to` is earlier. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    cursor = addMonthKey(cursor, 1);
  }
  return out;
}

/**
 * The month a publisher's reporting life begins — the EARLIEST of everything
 * we know, never the latest.
 *
 * Before this, the answer was chosen by appointment: the ministry start for an
 * unbaptized publisher, the baptism date for everybody else. So the day a
 * brother was marked baptized, the year he had already served stopped being
 * counted. The app makes that worse by clearing the ministry-start field when
 * the appointment changes, which is why the first report is asked for too: for
 * a card whose earlier date is already lost, it is the only honest evidence
 * that the person was reporting before.
 */
export function resolveReportingStartMonth(input: {
  ministryStartDate?: string | null;
  baptismDate?: string | null;
  firstReportMonth?: MonthKey | null;
}): MonthKey | null {
  const candidates = [
    input.ministryStartDate?.slice(0, 7),
    input.baptismDate?.slice(0, 7),
    input.firstReportMonth?.slice(0, 7),
  ].filter((m): m is string => !!m && /^\d{4}-\d{2}$/.test(m));
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, m) => (m < earliest ? m : earliest));
}

/** How many closed months a person is judged on at most. */
export const STATUS_WINDOW_MONTHS = 6;

export interface ServiceStatusInput {
  /** Months the publisher shared in the ministry, as `YYYY-MM`. */
  participated: ReadonlySet<MonthKey>;
  /** Where counting begins; null when nothing is known about the person. */
  startMonth: MonthKey | null;
  /** The last month whose collection window has closed. */
  lastClosedMonth: MonthKey;
  /**
   * The month being collected right now. Reports for it count as sharing;
   * silence in it counts as nothing at all.
   */
  collectedMonth: MonthKey;
}

/**
 * The month counting restarts from — the person's own start, moved forward if
 * six closed months of silence completed and a report came in afterwards.
 *
 * Exported because the annual report asks the same question about a finished
 * year and must not answer it differently.
 */
export function effectiveStartMonth(input: ServiceStatusInput): MonthKey {
  const { participated, startMonth, lastClosedMonth, collectedMonth } = input;
  // Nothing known about the person: judge him on the plain six closed months,
  // which is what the window would have been anyway.
  const base =
    startMonth ?? addMonthKey(lastClosedMonth, -(STATUS_WINDOW_MONTHS - 1));

  let run = 0;
  let restart: MonthKey | null = null;
  let lapsed = false;
  for (const month of monthRange(base, collectedMonth)) {
    if (participated.has(month)) {
      // A report ends the run — and if the run had already completed six, this
      // is the month the person's counting begins again.
      if (lapsed) {
        restart = month;
        lapsed = false;
      }
      run = 0;
      continue;
    }
    // Silence only counts where the month has closed.
    if (month > lastClosedMonth) continue;
    run += 1;
    if (run >= STATUS_WINDOW_MONTHS) lapsed = true;
  }

  // Still lapsed at the end: nothing has restarted, so the original start
  // stands and the window below will find no sharing in it.
  return restart ?? base;
}

/**
 * The status, and WHY — the same arithmetic, said out loud.
 *
 * A grey «неактивный» badge is a conclusion with its reasoning thrown away,
 * and on 3 September that cost a day: neither the secretary nor Lionel could
 * see that Maxim's counting had been reset to his baptism, so the badge looked
 * like a bug in the reports rather than a bug in the start date. The screen can
 * now show what the rule actually did — which months were weighed, from when
 * the person is counted, and, for somebody sliding towards inactive, WHICH
 * month would be the sixth and what service year it falls in.
 *
 * Computed here, beside the rule, so an explanation can never drift from the
 * decision it explains.
 */
export interface ServiceStatusReasons {
  status: PublisherStatus;
  /** First and last closed month weighed, `YYYY-MM`; null when none yet. */
  windowFrom: MonthKey | null;
  windowTo: MonthKey | null;
  /** Closed months in the window, and how many of them had ministry. */
  expected: number;
  served: number;
  /** Where counting begins — after a restart, the month he came back. */
  startMonth: MonthKey | null;
  /** True when the start moved because six closed months had passed silent. */
  restarted: boolean;
  /**
   * If he stays silent, the month his sixth consecutive silent month falls in
   * — the month the annual report would name. Null when he is not silent now.
   */
  sixthSilentMonth: MonthKey | null;
}

/** The service year a month belongs to: September starts a new one. */
export function serviceYearOf(month: MonthKey): number {
  const [y, m] = month.split('-').map(Number);
  return m >= 9 ? y : y - 1;
}

export function explainServiceStatus(
  input: ServiceStatusInput,
): ServiceStatusReasons {
  const { participated, startMonth, lastClosedMonth } = input;
  const status = computeServiceStatus(input);
  const start = effectiveStartMonth(input);
  const windowFloor = addMonthKey(lastClosedMonth, -(STATUS_WINDOW_MONTHS - 1));
  const windowStart = start > windowFloor ? start : windowFloor;
  const nothingClosedYet = windowStart > lastClosedMonth;

  const window = nothingClosedYet
    ? []
    : monthRange(windowStart, lastClosedMonth);
  const served = window.filter((m) => participated.has(m)).length;

  // How many silent closed months he has run up, counting back from the last
  // closed one; the sixth of them is the month the form would name.
  let silent = 0;
  for (let m = lastClosedMonth; m >= windowStart; m = addMonthKey(m, -1)) {
    if (participated.has(m)) break;
    silent += 1;
  }
  const sixthSilentMonth =
    silent > 0 && silent < STATUS_WINDOW_MONTHS
      ? addMonthKey(lastClosedMonth, STATUS_WINDOW_MONTHS - silent)
      : null;

  return {
    status,
    windowFrom: nothingClosedYet ? null : windowStart,
    windowTo: nothingClosedYet ? null : lastClosedMonth,
    expected: window.length,
    served,
    startMonth: start,
    restarted: !!startMonth && start > startMonth,
    sixthSilentMonth,
  };
}

/**
 * The status itself.
 *
 * Read it as: how many closed months has this person been answerable for, and
 * in how many of them (plus the month still open) did he share?
 */
export function computeServiceStatus(
  input: ServiceStatusInput,
): PublisherStatus {
  const { participated, lastClosedMonth, collectedMonth } = input;
  const start = effectiveStartMonth(input);
  const windowFloor = addMonthKey(lastClosedMonth, -(STATUS_WINDOW_MONTHS - 1));
  const windowStart = start > windowFloor ? start : windowFloor;

  // Nothing has closed for this person yet — someone who began this month, or
  // who has just resumed. He owes nothing, so he is not behind on anything.
  if (windowStart > lastClosedMonth) return PublisherStatus.ACTIVE;

  // The comparison is CLOSED months against closed months. A report for the
  // month still being collected is a fact and it is used — it can end a lapse
  // and it keeps a returning publisher off «inactive» — but it must not pay
  // for a month he actually missed. Counting it into the same total let a
  // brother who skipped June come out active because he handed in August.
  const expected = monthRange(windowStart, lastClosedMonth).length;
  const servedClosed = monthRange(windowStart, lastClosedMonth).filter((m) =>
    participated.has(m),
  ).length;
  const servedOpen = monthRange(
    addMonthKey(lastClosedMonth, 1),
    collectedMonth,
  ).filter((m) => participated.has(m)).length;

  if (servedClosed === 0) {
    // Nothing in the closed window. Six months of that is inactive — and when
    // it IS six, the restart above has already moved the window, so reaching
    // here with a report in hand means a shorter silence and a man who is
    // plainly still serving.
    return servedOpen > 0
      ? PublisherStatus.IRREGULAR
      : PublisherStatus.INACTIVE;
  }
  if (servedClosed >= expected) return PublisherStatus.ACTIVE;
  return PublisherStatus.IRREGULAR;
}
