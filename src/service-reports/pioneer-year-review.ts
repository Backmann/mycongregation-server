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
  /** Bible studies reported that month, when known. */
  bibleStudies?: number | null;
  note: string | null;
}

/** A stretch of regular pioneering, first and last month inclusive. */
export interface PioneerSpan {
  /** `YYYY-MM-01`. */
  start: string;
  /** `YYYY-MM-01`, or null while it runs. */
  end: string | null;
}

/**
 * One month of the window as the committee reads it on the pioneer's card
 * (28 September: «при раскрытии пионера — его история за эти месяцы»).
 *
 *   reported   — a report with hours;
 *   zero       — a report came, with no hours (ill, credit in the note…) —
 *                NOT the same as no report, and it used to be shown as one;
 *   missing    — the month is over, he was a pioneer, and no report came;
 *   collecting — the month now being handed in;
 *   upcoming   — not reached yet;
 *   notPioneer — he was not a regular pioneer that month.
 */
export type PioneerMonthState =
  | 'reported'
  | 'zero'
  | 'missing'
  | 'collecting'
  | 'upcoming'
  | 'notPioneer';

export interface PioneerMonthLine {
  reportMonth: string;
  state: PioneerMonthState;
  hours: number | null;
  bibleStudies: number | null;
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
   * Comparing him with 600 would accuse him of a shortfall he could not have
   * avoided; since 28 September he is measured pro rata to his months
   * (Lionel's rule), not left without a measure.
   */
  startedMidYear: boolean;
  /**
   * His pioneering ended before the window did — the last month he served,
   * or null. The months after it are not his to answer for: until 28
   * September they were counted as missing and measured against the whole
   * year. Measured pro rata, like `startedMidYear`.
   */
  endedIn: string | null;
  /** Hours reported in the window, in the months he was a pioneer. */
  hours: number;
  /** Months of the window with hours from him. */
  monthsReported: number;
  /**
   * Hours per reported month.
   *
   * The tendency, which the totals hide: on 20 August a man at 480 hours may
   * be a steady 48 a month with two months still to come, or 60 a month who
   * stopped in May. The first needs nothing, the second needs a visit.
   */
  pace: number | null;
  /**
   * How far from the goal FOR THE MONTHS COUNTED — 50 a month. Over a whole
   * finished year that is 600; in February it is 50 × the months that are in;
   * for a pioneer of part of the year, 50 × HIS months. Null before any.
   */
  toGoal: number | null;
  /** The same for the minimum that lets him carry on (560 a year, pro rata). */
  toMinimum: number | null;
  /**
   * What is left to 560 for the whole year, and per remaining month — the
   * figure a conversation in March is about («осталось 200, по 33 в месяц»).
   * Null once the year is over, or when the year does not apply to him.
   */
  yearLeftToMinimum: number | null;
  /** 560 for a pioneer of the whole year; pro rata to his months otherwise. */
  yearMinimum: number;
  /** His months of the window that are over — what his measure is taken over. */
  countedMonths: number;
  /** His own measure: 560/12 and 50 × his counted months; null when none. */
  expectedMinimum: number | null;
  expectedGoal: number | null;
  perMonthToMinimum: number | null;
  /**
   * Месяцы окна, за которые от него НЕТ отчёта (законченные, в пору его
   * пионерского служения). Месяц, сданный с нулём, сюда не входит — он сдан.
   */
  missingMonths: string[];
  /**
   * Ниже мерки — и это ОКОНЧАТЕЛЬНО для посчитанных месяцев: все их отчёты
   * пришли. В законченном году это «не дотянул до 560»; в феврале — «отстаёт
   * от темпа».
   */
  short: boolean;
  /**
   * Ниже мерки по тому, что сдано, но не всё сдано. Не «отстаёт», а «пока не
   * хватает, и мы ещё не всё знаем».
   */
  shortSoFar: boolean;
  /** Only the months where he wrote something — that is where credit lives. */
  notes: { reportMonth: string; note: string }[];
  /** Every month of the window, in the order the service year runs. */
  months: PioneerMonthLine[];
}

export interface PioneerYearReview {
  serviceYear: number;
  firstMonth: string;
  lastMonth: string;
  /**
   * The last month the review looks at: August for the year, February for
   * the review in the middle of it.
   */
  throughMonth: string;
  /** 'year' — September to August; 'part' — September to `throughMonth`. */
  window: 'year' | 'part';
  /** Months in the window. */
  windowMonths: number;
  /**
   * How many of the window's months have finished by today — what the
   * measure is taken over. (Kept under its old name: how many of the twelve
   * when the window is the year.)
   */
  monthsElapsed: number;
  /** Every month of the window is over — the numbers are final once all are in. */
  windowComplete: boolean;
  /** 50 × counted months, and 560/12 × counted months, rounded. */
  expectedGoal: number;
  expectedMinimum: number;
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
const firstOf = (iso: string) => `${iso.slice(0, 7)}-01`;

/** The month of the mid-year review: the window runs September to February. */
export const MID_YEAR_THROUGH_MONTH = 2;

/**
 * @param today `YYYY-MM-DD` in the congregation's own timezone.
 * @param opts.through the last month to look at (`YYYY-MM-01`) — February for
 *   the review in the middle of the year; the whole year when left out.
 */
export function reviewPioneerYear(
  serviceYear: number,
  today: string,
  people: {
    publisherId: string;
    displayName: string;
    pioneerSince: string | null;
    /** His regular-pioneer spells; when absent, «since pioneerSince». */
    spans?: PioneerSpan[];
    months: PioneerMonthHours[];
  }[],
  opts: { through?: string } = {},
): PioneerYearReview {
  const year = monthsOfServiceYear(serviceYear);
  const firstMonth = year[0];
  const lastMonth = year[11];
  const through =
    opts.through && opts.through >= firstMonth && opts.through < lastMonth
      ? firstOf(opts.through)
      : lastMonth;
  const months = year.filter((m) => m <= through);
  const thisMonth = firstOf(today);

  const counted = months.filter((m) => m < thisMonth);
  const monthsElapsed = counted.length;
  const windowComplete = monthsElapsed === months.length;
  const collectingMonth =
    thisMonth >= firstMonth && thisMonth <= lastMonth ? thisMonth : null;
  const goalFor = (n: number) => PIONEER_MONTH_PACE * n;
  const minimumFor = (n: number) => Math.round((PIONEER_YEAR_MINIMUM * n) / 12);

  const rows: PioneerYearRow[] = people.flatMap((person) => {
    const spans: PioneerSpan[] =
      person.spans && person.spans.length > 0
        ? person.spans.map((sp) => ({
            start: firstOf(sp.start),
            end: sp.end ? firstOf(sp.end) : null,
          }))
        : [
            {
              start: person.pioneerSince
                ? firstOf(person.pioneerSince)
                : firstMonth,
              end: null,
            },
          ];
    const pioneerIn = (m: string) =>
      spans.some((sp) => sp.start <= m && (!sp.end || sp.end >= m));

    const byMonth = new Map(
      person.months
        .filter((m) => m.reportMonth >= firstMonth && m.reportMonth <= through)
        .map((m) => [firstOf(m.reportMonth), m]),
    );
    const served = months.filter(pioneerIn);
    // Not a pioneer in any month of the window — appointed in March, say,
    // and the window is September to February: he has no place in it.
    if (served.length === 0) return [];
    const startedMidYear = !pioneerIn(firstMonth);
    const lastServed = served[served.length - 1] ?? null;
    const endedIn =
      lastServed && lastServed < through && !pioneerIn(through)
        ? lastServed
        : null;

    const lines: PioneerMonthLine[] = months.map((m) => {
      const r = byMonth.get(m);
      const hours = r?.hours ?? null;
      const state: PioneerMonthState = !pioneerIn(m)
        ? 'notPioneer'
        : r && (hours ?? 0) > 0
          ? 'reported'
          : r
            ? 'zero'
            : m === thisMonth
              ? 'collecting'
              : m > thisMonth
                ? 'upcoming'
                : 'missing';
      return {
        reportMonth: m,
        state,
        hours,
        bibleStudies: r?.bibleStudies ?? null,
        note: r?.note?.trim() ? r.note.trim() : null,
      };
    });

    // Only his pioneer months count: hours from before he was appointed or
    // after he stopped were a publisher's, not a pioneer's.
    const mine = lines.filter((l) => l.state !== 'notPioneer');
    const hours = round1(mine.reduce((sum, l) => sum + (l.hours ?? 0), 0));
    const monthsReported = mine.filter((l) => l.state === 'reported').length;
    const missingMonths = mine
      .filter((l) => l.state === 'missing')
      .map((l) => l.reportMonth);

    /**
     * The measure, pro rata to the months he was a pioneer (28 September,
     * Lionel: «если он служит не с начала служебного года, а позже, время
     * считается пропорционально месяцам»). For a pioneer of the whole window
     * this is the window's own measure; for one appointed in March or who
     * stopped in December, the months of the window that are over AND were his.
     * Until then such a man had no measure at all.
     */
    const countedMine = mine.filter((l) => l.reportMonth < thisMonth).length;
    const measured = countedMine > 0;
    const expectedMin = minimumFor(countedMine);
    const expectedGoal = goalFor(countedMine);
    const below = measured && hours < expectedMin;
    // For the whole year: 560 × (his months of the year) / 12, and what is
    // left of it over his months still to come. None once he has stopped.
    const yearOver = thisMonth > lastMonth;
    const hisYear = year.filter(pioneerIn);
    const hisMonthsLeft = hisYear.filter((m) => m >= thisMonth).length;
    const yearLeft =
      !yearOver && hisMonthsLeft > 0
        ? Math.max(0, minimumFor(hisYear.length) - hours)
        : null;

    return [
      {
        publisherId: person.publisherId,
        displayName: person.displayName,
        pioneerSince: person.pioneerSince,
        startedMidYear,
        endedIn,
        hours,
        monthsReported,
        pace: monthsReported > 0 ? round1(hours / monthsReported) : null,
        toGoal: measured ? Math.max(0, round1(expectedGoal - hours)) : null,
        toMinimum: measured ? Math.max(0, round1(expectedMin - hours)) : null,
        yearLeftToMinimum: yearLeft,
        perMonthToMinimum:
          yearLeft !== null ? Math.ceil(yearLeft / hisMonthsLeft) : null,
        yearMinimum: minimumFor(hisYear.length),
        countedMonths: countedMine,
        expectedMinimum: measured ? expectedMin : null,
        expectedGoal: measured ? expectedGoal : null,
        missingMonths,
        short: below && missingMonths.length === 0,
        shortSoFar: below && missingMonths.length > 0,
        notes: lines
          .filter((l) => l.note !== null && l.state !== 'notPioneer')
          .map((l) => ({ reportMonth: l.reportMonth, note: l.note as string })),
        months: lines,
      },
    ];
  });

  /**
   * Кому внимание в первую очередь.
   *
   * Сперва те, у кого год собран и порог не взят — про них уже всё известно.
   * За ними те, кому не хватает по сданному, но год ещё не полон: с ними
   * разговор другой — сперва спросить про отчёт. Остальные по имени.
   */
  const rank = (r: PioneerYearRow) => (r.short ? 0 : r.shortSoFar ? 1 : 2);
  rows.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra < 2) return a.hours - b.hours;
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    serviceYear,
    firstMonth,
    lastMonth,
    throughMonth: through,
    window: through === lastMonth ? 'year' : 'part',
    windowMonths: months.length,
    monthsElapsed,
    windowComplete,
    expectedGoal: goalFor(monthsElapsed),
    expectedMinimum: minimumFor(monthsElapsed),
    collectingMonth,
    rows,
  };
}

/**
 * Which year and which window the review opens on when the link names none
 * (28 September).
 *
 * The YEAR. From 1 September the running year is a new one with no reports
 * in it — opened then, every pioneer stood at zero, and the list was a list
 * of false alarms. The year that ended is what the brothers look at while
 * August is handed in (the review task runs 20 August – 20 September), and
 * the new year has its first month only once September's reports are due on
 * the 20th of October. So until 20 October the ended year opens.
 *
 * The WINDOW. The review in the middle of the year (the task from 15
 * February) looks at September to February; it is read until the February
 * reports are in, in March. From 1 February to 30 April the running year
 * opens on that window; otherwise on the whole year.
 *
 * Either is only the first view: the screen switches both.
 */
export function pioneerReviewDefaults(
  today: string,
  year?: number,
  window?: 'half' | 'year',
): { serviceYear: number; window: 'half' | 'year' } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const running = m >= 9 ? y + 1 : y;
  const inAutumnGrace = m === 9 || (m === 10 && d <= 20);
  const serviceYear = year ?? (inAutumnGrace ? running - 1 : running);
  const midYearSeason = serviceYear === running && m >= 2 && m <= 4;
  return {
    serviceYear,
    window: window ?? (midYearSeason ? 'half' : 'year'),
  };
}
