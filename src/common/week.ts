/**
 * The Monday a date belongs to.
 *
 * The app counts in weeks everywhere — a meeting week, a schedule week, the
 * week a local-needs topic was used — and every one of them is keyed by its
 * Monday. This had been written out four separate times, and not identically:
 * two copies parse the date as UTC and one parses it in the SERVER's local
 * time, which lands on a different Monday whenever the server sits west of
 * Greenwich and the date is a Sunday. A week is not a thing that should have
 * two answers.
 *
 * Dates here are plain calendar strings, deliberately: 'YYYY-MM-DD' in, the
 * same shape out, no timezone left in the value to go wrong later.
 */

/** Monday (YYYY-MM-DD) of the ISO week containing the given calendar date. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`mondayOf: not a calendar date: ${dateStr}`);
  }
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=Mon..7=Sun
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}
