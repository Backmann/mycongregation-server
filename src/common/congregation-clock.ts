/**
 * What the date and the time are FOR A CONGREGATION.
 *
 * Almost every rule in this app is written in calendar days: the duties of a
 * week that has passed cannot be edited, an absence that ended yesterday is
 * gone from the list, the attendance card closes at midnight of the meeting's
 * own day, a report month closes on the 20th. Every one of those needs an
 * answer to "what day is it here", and "here" is the congregation, not the
 * server.
 *
 * The same four-line `berlinToday()` had been copied into four services, each
 * time under a comment that said "in the congregation's timezone" above a line
 * that said Europe/Berlin. Two other services did read the congregation's own
 * timezone — each with its own private helper. Six copies, two answers.
 *
 * This is the pure half: given a moment and a timezone, it answers. The
 * timezone itself comes from CongregationClock, which knows how to look it up.
 */

/**
 * Used when a congregation has no timezone on record. Every congregation in
 * the app so far is German, and this is what the code has always assumed —
 * so the fallback keeps today's behaviour exactly, and only a congregation
 * that states otherwise gets something different.
 */
export const DEFAULT_CONGREGATION_TIMEZONE = 'Europe/Berlin';

function formatterFor(
  timezone: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const tz = timezone || DEFAULT_CONGREGATION_TIMEZONE;
  try {
    return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: tz });
  } catch {
    // An unusable timezone string must never take a request or a cron down.
    return new Intl.DateTimeFormat('en-CA', {
      ...options,
      timeZone: DEFAULT_CONGREGATION_TIMEZONE,
    });
  }
}

/** Calendar date in the congregation's own timezone. */
export function localDateParts(
  now: Date,
  timezone?: string | null,
): { year: number; month: number; day: number } {
  const parts = formatterFor(timezone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * The congregation's own date as 'YYYY-MM-DD'.
 *
 * Dates are compared as strings all over this codebase — `meetingDate <
 * today`, `endDate >= today` — because a string comparison of this shape has
 * no timezone left in it to go wrong, and it survives the summer-time change
 * without a special case.
 */
export function todayIn(now: Date, timezone?: string | null): string {
  const { year, month, day } = localDateParts(now, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Minutes since midnight in the congregation's own timezone. */
export function minutesOfDayIn(now: Date, timezone?: string | null): number {
  const parts = formatterFor(timezone, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const hour = get('hour') === 24 ? 0 : get('hour');
  return hour * 60 + get('minute');
}
