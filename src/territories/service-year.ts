/**
 * Service years run 1 September to 31 August and are named by the year they
 * end in: 1 September 2025 – 31 August 2026 is the service year 2026.
 *
 * The S-13 is kept for the current and the previous service year only (the
 * branch's records table, 11 November 2026), so «kept from» is the first day
 * of the previous one.
 */

/** The service year a 'YYYY-MM-DD' date falls in. */
export function serviceYearOf(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 9 ? year + 1 : year;
}

/** First day of a service year, 'YYYY-MM-DD'. */
export function serviceYearStart(serviceYear: number): string {
  return `${serviceYear - 1}-09-01`;
}

/** The first day whose records are still kept, seen from `today`. */
export function keptFrom(today: string): string {
  return serviceYearStart(serviceYearOf(today) - 1);
}

/** 'YYYY-MM-DD' plus whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A territory is given for four months (about 120 days). */
export const TERM_DAYS = 120;
