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

/**
 * Event `type` values that may open the reduced goal for their month(s). A
 * campaign does so only when it says it does (`auxReducedHours`).
 */
export const REDUCED_HOUR_EVENT_TYPES = [
  'memorial',
  'circuit_overseer_visit',
  'campaign',
] as const;

/** Why a month allows 15 hours. */
export type ReducedReason =
  | 'march_april'
  | 'memorial'
  | 'co_visit'
  | 'campaign';

/** An event as these rules read it. */
export interface ReducedEvent {
  type: string | null;
  date: string;
  endDate: string | null;
  /** A campaign only. */
  auxReducedHours?: boolean;
}

/**
 * The reasons a month allows an auxiliary pioneer to take 15 hours (29
 * October 2026) — empty when it does not. Whether he TAKES them is his
 * choice, kept on the period (`reducedMonths`).
 */
export function reducedReasons(
  monthKey: MonthKey,
  events: ReducedEvent[],
): ReducedReason[] {
  const out = new Set<ReducedReason>();
  const month = Number(monthKey.split('-')[1]);
  if (month === 3 || month === 4) out.add('march_april');
  for (const e of events) {
    if (!monthsInRange(e.date, e.endDate).includes(monthKey)) continue;
    if (e.type === 'memorial') out.add('memorial');
    else if (e.type === 'circuit_overseer_visit') out.add('co_visit');
    else if (e.type === 'campaign' && e.auxReducedHours) out.add('campaign');
  }
  return [...out];
}

/** The goal a period holds for a month: the person's 15, or 30. */
export function goalOf(
  period: { reducedMonths?: string[] | null },
  monthKey: MonthKey,
): number {
  return (period.reducedMonths ?? []).includes(monthKey)
    ? AUX_PIONEER_REDUCED_HOURS
    : AUX_PIONEER_STANDARD_HOURS;
}

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
  // Guard against malformed ranges producing an unbounded loop — and only
  // that. It stood at 24 until 29 October 2026, which quietly cut every
  // longer range short: a sister serving «until cancelled» for thirty months
  // lost her first six from the history and the S-21. A hundred years.
  for (let i = 0; i < 1200; i++) {
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
  events: ReducedEvent[],
): number {
  return reducedReasons(monthKey, events).length > 0
    ? AUX_PIONEER_REDUCED_HOURS
    : AUX_PIONEER_STANDARD_HOURS;
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
