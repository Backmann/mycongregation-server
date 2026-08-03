/**
 * When a report month stops being "still being collected" and becomes a
 * settled fact.
 *
 * A calendar month ending is not the same event as its reports being in.
 * Reports for July are handed in during August, up to the 20th — which is why
 * the reminder jobs chase publishers on the 1st-10th, group overseers on the
 * 5th/7th/10th and the secretary as late as the 19th. Until that day passes,
 * a publisher with no July report has not missed anything; he is simply not
 * late yet.
 *
 * Reading "the month is over" as "the report is missing" is what made the whole
 * congregation turn irregular every 1st of the month and active again as the
 * reports were typed in — an artefact of the calendar, not a fact about anyone.
 *
 * This module is the ONE place that answers the question. It is pure: it takes
 * the moment and the congregation's timezone and returns months, so it can be
 * tested without a clock and without a database.
 */

/**
 * The day of the month by which reports for the previous month are handed in.
 * The reminder crons in ReportRemindersService are built around the same
 * deadline (the secretary's last nudge is the 19th); if this ever moves, those
 * cron days move with it.
 */
export const REPORT_CLOSING_DAY = 20;

/**
 * Used when a congregation has no timezone on record. The rest of the app
 * already assumes Berlin in the same situation (attendance, report reminders),
 * so this keeps one answer rather than inventing a second.
 */
export const DEFAULT_CONGREGATION_TIMEZONE = 'Europe/Berlin';

/** Calendar date in the congregation's own timezone. */
export function localDateParts(
  now: Date,
  timezone?: string | null,
): { year: number; month: number; day: number } {
  const tz = timezone || DEFAULT_CONGREGATION_TIMEZONE;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch {
    // An unusable timezone string must not take the status pipeline down.
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_CONGREGATION_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  }
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** First day of a month as a UTC date, the shape report months are held in. */
export function monthStartUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/**
 * The most recent month whose collection window has closed.
 *
 * Before the closing day, the month that just ended is still being collected,
 * so the last SETTLED month is the one before it. On the closing day and after,
 * the month that just ended counts.
 *
 *   3 August  -> June   (July is still being collected)
 *   19 August -> June
 *   20 August -> July   (the deadline has passed)
 *   31 August -> July
 */
export function lastClosedReportMonth(
  now: Date,
  timezone?: string | null,
  closingDay: number = REPORT_CLOSING_DAY,
): Date {
  const { year, month, day } = localDateParts(now, timezone);
  const monthsBack = day >= closingDay ? 1 : 2;
  return new Date(Date.UTC(year, month - 1 - monthsBack, 1));
}

/**
 * The month whose reports are being collected right now — always the previous
 * calendar month in the congregation's own timezone. In August that is July,
 * whether or not the 20th has passed; whether it is LATE is a different
 * question, answered by comparing it with lastClosedReportMonth.
 */
export function collectedReportMonth(
  now: Date,
  timezone?: string | null,
): Date {
  const { year, month } = localDateParts(now, timezone);
  return new Date(Date.UTC(year, month - 2, 1));
}

/**
 * Whether today is the day the window moves — the one day in the month when a
 * status may change because a month closed rather than because someone did
 * something.
 *
 * The nightly sweep is silent every other night on purpose (see
 * PublishersService.recomputeStatus): waking the group overseer at four in the
 * morning to say that time has passed is the wrong trade. But the day the
 * month actually closes is the one night the change IS news, so that is the
 * night the sweep speaks.
 *
 * The sweep runs once a day, so the local date advances by exactly one on each
 * run — the closing day is hit exactly once per month in any timezone.
 */
export function isMonthClosingDay(
  now: Date,
  timezone?: string | null,
  closingDay: number = REPORT_CLOSING_DAY,
): boolean {
  return localDateParts(now, timezone).day === closingDay;
}

/** 'YYYY-MM-01' for a month start, the form report months are stored in. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}-01`;
}

/**
 * The day reports for `reportMonth` are due — the closing day of the month
 * after it, as 'YYYY-MM-DD'. A label for people to read; whether the deadline
 * has actually passed is answered by comparing the month with
 * lastClosedReportMonth, so there is only ever one piece of arithmetic.
 */
export function reportDeadlineDate(
  reportMonth: string,
  closingDay: number = REPORT_CLOSING_DAY,
): string {
  const start = new Date(`${reportMonth.slice(0, 7)}-01T00:00:00Z`);
  const due = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, closingDay),
  );
  return `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}-${String(due.getUTCDate()).padStart(2, '0')}`;
}
