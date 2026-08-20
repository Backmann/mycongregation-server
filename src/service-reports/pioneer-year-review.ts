/**
 * Where each regular pioneer stands in the service year.
 *
 * Pure arithmetic on months and hours — no database, no permissions, so the
 * rules can be read and tested on their own. The rules themselves are the
 * congregation's, not ours: 600 hours is the year's goal, and 560 with credit
 * is what lets somebody carry on pioneering. We compute both distances and let
 * the service committee decide; the screen never says «снять» about a person.
 *
 * CREDIT HOURS ARE NOT MODELLED, deliberately. A pioneer writes them in the
 * note on his own report, and the brothers read them there. Inventing a field
 * for it would mean inventing rules about who may grant credit and how much —
 * a decision that is not the application's to make.
 */

/** The year's goal. */
export const PIONEER_YEAR_GOAL = 600;
/** Hours (with any credit) that let a pioneer continue. */
export const PIONEER_YEAR_MINIMUM = 560;
/** The monthly pace that adds up to the goal over twelve months. */
export const PIONEER_MONTH_PACE = 50;

export interface PioneerMonthHours {
  /** `YYYY-MM-01`. */
  reportMonth: string;
  hours: number | null;
  note: string | null;
}

export interface PioneerYearRow {
  publisherId: string;
  displayName: string;
  /** When this person became a regular pioneer, if it is known. */
  pioneerSince: string | null;
  /**
   * True when the pioneering began after the service year did.
   *
   * Then the year's numbers do not apply to him: he was not a pioneer for
   * twelve months, and comparing him with 600 would accuse him of a shortfall
   * he could not have avoided. The screen shows what he did and says since
   * when — no target, no highlight.
   */
  startedMidYear: boolean;
  /** Hours reported so far in this service year. */
  hours: number;
  /** Months of this year that have a report from him. */
  monthsReported: number;
  /**
   * Hours per reported month.
   *
   * The tendency, which the totals hide: on 20 August a man at 480 hours may
   * be a steady 48 a month with two months still to come, or 60 a month who
   * stopped in May. The first needs nothing, the second needs a visit.
   */
  pace: number | null;
  /** How far from the year's goal — null when the year does not apply to him. */
  toGoal: number | null;
  /** How far from the minimum that allows him to continue. */
  toMinimum: number | null;
  /** Below the minimum with the months counted so far. */
  short: boolean;
  /** Only the months where he wrote something — that is where credit lives. */
  notes: { reportMonth: string; note: string }[];
}

export interface PioneerYearReview {
  serviceYear: number;
  firstMonth: string;
  lastMonth: string;
  /** How many of the twelve months have finished by today. */
  monthsElapsed: number;
  /**
   * The month currently being collected, if the year is still running.
   *
   * Named out loud because it is the difference between «he is behind» and
   * «August has not been handed in yet» — and this screen is read at exactly
   * the moment that distinction decides something about a person.
   */
  collectingMonth: string | null;
  rows: PioneerYearRow[];
}

const monthsOfServiceYear = (serviceYear: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(serviceYear - 1, 8 + i, 1));
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`,
    );
  }
  return out;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * @param today `YYYY-MM-DD` in the congregation's own timezone.
 */
export function reviewPioneerYear(
  serviceYear: number,
  today: string,
  people: {
    publisherId: string;
    displayName: string;
    pioneerSince: string | null;
    months: PioneerMonthHours[];
  }[],
): PioneerYearReview {
  const months = monthsOfServiceYear(serviceYear);
  const firstMonth = months[0];
  const lastMonth = months[11];
  const thisMonth = `${today.slice(0, 7)}-01`;

  const elapsed = months.filter((m) => m < thisMonth).length;
  const monthsElapsed = Math.min(12, elapsed);
  const collectingMonth =
    thisMonth >= firstMonth && thisMonth <= lastMonth ? thisMonth : null;

  const rows: PioneerYearRow[] = people.map((person) => {
    const inYear = person.months.filter(
      (m) => m.reportMonth >= firstMonth && m.reportMonth <= lastMonth,
    );
    const hours = inYear.reduce((sum, m) => sum + (m.hours ?? 0), 0);
    // A month counts as reported when it carries hours — a regular pioneer's
    // report always does. A month reported with nothing but a note is not a
    // month of pioneering, and averaging over it would flatter the pace.
    const monthsReported = inYear.filter((m) => (m.hours ?? 0) > 0).length;
    const startedMidYear =
      !!person.pioneerSince && person.pioneerSince > firstMonth;

    return {
      publisherId: person.publisherId,
      displayName: person.displayName,
      pioneerSince: person.pioneerSince,
      startedMidYear,
      hours: round1(hours),
      monthsReported,
      pace: monthsReported > 0 ? round1(hours / monthsReported) : null,
      toGoal: startedMidYear ? null : Math.max(0, PIONEER_YEAR_GOAL - hours),
      toMinimum: startedMidYear
        ? null
        : Math.max(0, PIONEER_YEAR_MINIMUM - hours),
      short: !startedMidYear && hours < PIONEER_YEAR_MINIMUM,
      notes: inYear
        .filter((m) => (m.note ?? '').trim() !== '')
        .map((m) => ({ reportMonth: m.reportMonth, note: m.note!.trim() })),
    };
  });

  // Whoever needs attention first: those below the minimum, the furthest below
  // at the top; then everybody else by name.
  rows.sort((a, b) => {
    if (a.short !== b.short) return a.short ? -1 : 1;
    if (a.short && b.short) return a.hours - b.hours;
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    serviceYear,
    firstMonth,
    lastMonth,
    monthsElapsed,
    collectingMonth,
    rows,
  };
}
