/**
 * Auxiliary-pioneer monthly hour goal.
 *
 * The reduced goal of 15 hours applies to:
 *   - March and April (fixed every year), and
 *   - the month of the Memorial, and
 *   - the month(s) touched by a circuit-overseer visit — if the visit week
 *     spans a month boundary, BOTH months qualify.
 * Every other month is 30 hours.
 *
 * The goal is computed (never stored) so it always reflects the current
 * calendar and the events actually entered in the congregation.
 */
export const AUX_PIONEER_REDUCED_HOURS = 15;
export const AUX_PIONEER_STANDARD_HOURS = 30;

/** Event `type` values that grant the reduced goal for their month(s). */
export const REDUCED_HOUR_EVENT_TYPES = [
  'memorial',
  'circuit_overseer_visit',
] as const;

/** A calendar month key like "2026-04". */
export type MonthKey = string;

/** Normalize a YYYY-MM-DD (or Date) to its "YYYY-MM" month key. */
export function monthKeyOf(dateOrIso: string | Date): MonthKey {
  const iso =
    typeof dateOrIso === 'string'
      ? dateOrIso
      : dateOrIso.toISOString().slice(0, 10);
  return iso.slice(0, 7);
}

/** All month keys touched by a [start, end] date range (inclusive). */
export function monthsInRange(
  startIso: string,
  endIso: string | null,
): MonthKey[] {
  const start = startIso.slice(0, 7);
  const end = (endIso ?? startIso).slice(0, 7);
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const out: MonthKey[] = [];
  let y = sy;
  let m = sm;
  // Guard against malformed ranges producing an unbounded loop.
  for (let i = 0; i < 24; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (y === ey && m === em) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Given a target month and the reduced-hour events of the congregation,
 * decide the auxiliary-pioneer hour goal for that month.
 *
 * `events` are the special events whose `type` is in REDUCED_HOUR_EVENT_TYPES;
 * each contributes every month its [date, endDate] range touches (so a visit
 * crossing a month boundary reduces both months).
 */
export function auxiliaryPioneerHourGoal(
  monthKey: MonthKey,
  events: { date: string; endDate: string | null }[],
): number {
  const month = Number(monthKey.split('-')[1]);
  // March (3) and April (4) are always reduced.
  if (month === 3 || month === 4) return AUX_PIONEER_REDUCED_HOURS;

  for (const e of events) {
    if (monthsInRange(e.date, e.endDate).includes(monthKey)) {
      return AUX_PIONEER_REDUCED_HOURS;
    }
  }
  return AUX_PIONEER_STANDARD_HOURS;
}

/**
 * Whether a service period (start month + optional end month, or
 * until-cancelled) is active in the given month.
 */
export function isActiveInMonth(
  period: {
    startMonth: string;
    endMonth: string | null;
    untilCancelled: boolean;
  },
  monthKey: MonthKey,
): boolean {
  const start = period.startMonth.slice(0, 7);
  if (monthKey < start) return false;
  if (period.untilCancelled || !period.endMonth) return true;
  return monthKey <= period.endMonth.slice(0, 7);
}
