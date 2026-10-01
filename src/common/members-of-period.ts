import { addMonthKey } from './service-status-rule';

/**
 * WHO BELONGED TO THE CONGREGATION FOR A PERIOD THAT HAS ENDED.
 *
 * One answer for every report about the past, because the reports about the
 * past disagreed. The monthly summary (S-1) asked "was he still here when the
 * month ended", the annual report (S-10) asked "is he here today", and the
 * group report did not ask at all. So two brothers who served the whole of
 * 2025/26 and moved away on 1 September 2026 — entered on the 27th — vanished
 * from the ANNUAL report for the year they had served in full, and the figure
 * already sent to the branch no longer matched the app.
 *
 * A departure is recorded as removedAt (the day the person left, as entered)
 * plus a soft delete (the moment it was entered). The day they LEFT decides;
 * the moment somebody got round to entering it does not. Leaving on or after
 * the first day after the period means they were here for all of it.
 */
type Departure = {
  removedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  restoredAt?: Date | string | null;
};

/** Calendar day of a stored date or timestamp, as YYYY-MM-DD. */
function dayOf(v: Date | string): string {
  return (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
}

/**
 * Whether a publisher was still in the congregation when `reportMonth`
 * (YYYY-MM-01) ended.
 */
export function memberAtEndOf(reportMonth: string): (p: Departure) => boolean {
  const nextMonth = `${addMonthKey(reportMonth.slice(0, 7), 1)}-01`;
  return (p) => {
    // Put back on the roll: restoring leaves the old departure date on the
    // card (it is history), so without this a brother who came back would
    // count as gone for ever.
    if (!p.deletedAt && p.restoredAt) return true;
    const gone = p.removedAt ?? p.deletedAt ?? null;
    if (!gone) return true;
    return dayOf(gone) >= nextMonth;
  };
}

/**
 * Whether a publisher belonged to the congregation on 31 August that closed
 * the service year beginning in September of `startYear` — the line the
 * annual report (S-10) is drawn at.
 */
export function memberAtServiceYearEnd(
  startYear: number,
): (p: Departure) => boolean {
  return memberAtEndOf(`${startYear + 1}-08-01`);
}
