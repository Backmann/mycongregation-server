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
