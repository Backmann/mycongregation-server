import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { reportedMinistry } from '../common/reported-ministry';
import { resolveReportingStartMonth } from '../common/service-status-rule';
import { memberAtServiceYearEnd } from '../common/members-of-period';

/**
 * Figures for the annual congregation report (S-10), computed for one service
 * year — September through August.
 *
 * DELIBERATELY SEPARATE from the publisher status the rest of the app keeps.
 * That status is a rolling, present-tense pastoral judgement: it asks "who is
 * this person now" and looks at a moving window. The annual report asks
 * different questions about a finished year, and its "inactive" explicitly
 * excludes anyone who lapsed in an earlier year and never came back. The two
 * agree most of the time and differ silently, which in a form signed and
 * handed over is the worst kind of wrong. So nothing here reads the status
 * field; everything is derived from the reports themselves. The only thing
 * shared with the rest of the app is `reportedMinistry`, the plain fact of
 * whether a month was reported — the same fact, aggregated differently.
 */

/** A publisher who counts towards one of the figures, kept so a reader can look. */
export interface CountedPublisher {
  id: string;
  name: string;
  /** The month that put them in this group, where one applies. */
  month?: string;
}

/** How many reports came in for a month — the shape of the year, plainly. */
export interface MonthlyReporters {
  month: string;
  count: number;
}

export interface AnnualFigures {
  startYear: number;
  /**
   * Reports received per month, September through August.
   *
   * NOT a judgement about who failed to report: this app cannot tell "did not
   * share" from "not collected yet", and a warning built on that guess would
   * be an inference dressed as a fact — in a form that goes to the circuit
   * overseer, the worst kind. The figures are given instead, so a secretary
   * filing in early September sees for himself that August stands at twelve
   * where every other month stands at forty, and knows the year is not in yet.
   */
  monthlyReporters: MonthlyReporters[];
  /** Reported at least one month between March and August. */
  active: CountedPublisher[];
  /** Completed six consecutive unreported months WITHIN this service year. */
  becameInactive: CountedPublisher[];
  /** Were inactive and reported again within this service year. */
  reactivated: CountedPublisher[];
  /**
   * Not on the form: who is inactive RIGHT NOW, by the six-month rule.
   *
   * The form asks for an EVENT — whose sixth silent month fell inside this
   * year — and says in as many words not to count anyone who became inactive
   * in an earlier year and is still inactive. That is the figure above. But
   * the elders also want the plain present-tense list, and answering one
   * question with the other is how a form gets filled in wrongly. So both are
   * given, and the screen says which is which.
   */
  inactiveNow: CountedPublisher[];
  /**
   * Silent since the first month the app holds records for — so WHEN their
   * break began is not in the data.
   *
   * The form draws its line by when the sixth silent month fell: inside this
   * year it counts, in an earlier year it does not. For these publishers that
   * month is on paper, from before the app kept reports, and no arithmetic
   * here can recover it. Answering either way would put a wrong number on a
   * signed form, so they are handed to the secretary by name instead.
   */
  lapseUnknown: CountedPublisher[];
  deaf: CountedPublisher[];
  blind: CountedPublisher[];
  imprisoned: CountedPublisher[];
}

/** What the figures need to know about a report — nothing more. */
export interface AnnualReportRow {
  publisherId: string;
  /** YYYY-MM-DD, the first of the month reported on. */
  reportMonth: string;
  servedThisMonth?: boolean | null;
  hoursReported?: number | null;
}

/** What the figures need to know about a card — nothing more. */
export interface AnnualPublisher {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  appointment: PublisherAppointment | string;
  ministryStartDate?: string | null;
  baptismDate?: string | null;
  removedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  createdAt?: Date | string | null;
  isDeaf?: boolean;
  isBlind?: boolean;
  isImprisoned?: boolean;
}

/**
 * The S-10 figures for one service year, from the rows handed in.
 *
 * Pure on purpose: the same arithmetic answers "what do the reports say now"
 * and "what did they say on 3 September", and the second question is only
 * honest if it is asked of exactly the same rules as the first.
 *
 * `publishers` is EVERY card, departed ones included; who belongs to the year
 * is decided here. `judgeUntil` (YYYY-MM) is the last month whose collection
 * had closed at the moment asked about.
 */
export function computeAnnualFigures(input: {
  startYear: number;
  judgeUntil: string;
  reports: AnnualReportRow[];
  publishers: AnnualPublisher[];
}): AnnualFigures {
  const { startYear, judgeUntil, publishers } = input;
  const yearMonths = monthsOfServiceYear(startYear);
  // Six months of run-up as well: deciding whether somebody BECAME inactive
  // in September means looking at the six months before it, and telling that
  // apart from "was already inactive coming in" needs one month more still.
  const firstMonth = addMonths(yearMonths[0], -7);
  const reports = input.reports.filter((r) => {
    const m = r.reportMonth.slice(0, 7);
    return m >= firstMonth && m <= yearMonths[11];
  });
  const judgeable = yearMonths.filter((m) => m <= judgeUntil);
  /** The latest month of THIS year we may judge — the year's end, or today's. */
  const judgeUntilInYear = judgeable[judgeable.length - 1] ?? yearMonths[0];

  // publisher → the set of months they reported ministry in
  const reportedBy = new Map<string, Set<string>>();
  // publisher → the earliest month we hold ANY record for.
  //
  // Silence and ignorance look identical in this data, and telling them
  // apart is the whole of two bugs Lionel found. Before this, a publisher
  // whose history in the app began in March read as inactive for every month
  // before it, so his first report counted as a return from inactivity —
  // and eighty-two brothers who had served faithfully for years were listed
  // as having come back. A publisher who transferred in from another
  // congregation looked the same way, though he had never stopped.
  //
  // So a status change is only asserted where the months it rests on are
  // actually covered. Where they are not, nothing is claimed.
  // WHICH MONTHS THIS CONGREGATION HAS DATA FOR AT ALL.
  //
  // A month with no report rows anywhere is not a month of silence — it is a
  // month before the app was keeping reports. Judging it turns the start of
  // record-keeping into a congregation-wide lapse: with data beginning in
  // September 2025, every publisher's September report looked like a return
  // from six months of inactivity. It showed up for exactly the two people
  // whose cards carried a baptism date, and it would have spread to everyone
  // else as those dates were filled in — the fix for one thing quietly
  // arming another.
  const covered = new Set<string>();
  for (const r of reports) covered.add(r.reportMonth.slice(0, 7));
  /** The first month the congregation has any record for, if any. */
  const firstCovered = [...covered].sort().find(() => true) ?? null;
  /** Is every month this question looks back over actually recorded? */
  const dataCovers = (from: string, to: string) => {
    for (let m = from; m <= to; m = addMonths(m, 1)) {
      if (!covered.has(m)) return false;
    }
    return true;
  };

  const firstKnown = new Map<string, string>();
  for (const r of reports) {
    const key = r.reportMonth.slice(0, 7);
    const seen = firstKnown.get(r.publisherId);
    if (!seen || key < seen) firstKnown.set(r.publisherId, key);
    if (!reportedMinistry(r)) continue;
    const set = reportedBy.get(r.publisherId) ?? new Set<string>();
    set.add(key);
    reportedBy.set(r.publisherId, set);
  }

  const monthlyReporters: MonthlyReporters[] = yearMonths.map((m) => ({
    month: `${m}-01`,
    count: reports.filter(
      (r) => r.reportMonth.slice(0, 7) === m && reportedMinistry(r),
    ).length,
  }));

  const active: CountedPublisher[] = [];
  const becameInactive: CountedPublisher[] = [];
  const reactivated: CountedPublisher[] = [];
  const inactiveNow: CountedPublisher[] = [];
  const lapseUnknown: CountedPublisher[] = [];
  const deaf: CountedPublisher[] = [];
  const blind: CountedPublisher[] = [];
  const imprisoned: CountedPublisher[] = [];

  // WHO THIS YEAR IS ABOUT: the congregation as it stood on 31 August.
  //
  // It used to be the congregation as it stands TODAY, so the report for a
  // finished year moved whenever life went on in the next one. Two brothers
  // who served all of 2025/26 and moved on 1 September 2026 dropped out of
  // «Активные» for 2025/26 the day their departure was entered — after the
  // figure had gone to the branch. Leaving after the year does not change
  // the year.
  //
  // And somebody who joined after it is not part of it: a brother who moved
  // IN in September has no reports here for the year, and the six-month rule
  // would read that as a lapse. A card typed in late for somebody who was
  // here all along still counts — his reports for the year say so.
  const isMember = memberAtServiceYearEnd(startYear);
  const yearEndDay = `${startYear + 1}-08-31`;
  const reportedInYear = new Set(
    reports
      .filter((r) => yearMonths.includes(r.reportMonth.slice(0, 7)))
      .map((r) => r.publisherId),
  );
  const belongs = (p: AnnualPublisher) =>
    p.appointment !== PublisherAppointment.STUDENT &&
    isMember(p) &&
    (reportedInYear.has(p.id) ||
      !p.createdAt ||
      dayOf(p.createdAt) <= yearEndDay);

  for (const p of publishers) {
    if (!belongs(p)) continue;
    const who = { id: p.id, name: fullName(p) };
    const months = reportedBy.get(p.id) ?? new Set<string>();

    // Active: reported at least once March–August of this service year.
    if (marchToAugust(startYear).some((m) => months.has(m))) {
      active.push(who);
    }

    // Inactive as of month M: none of M and the five before it reported.
    const inactiveAt = (m: string) =>
      lastSixMonths(m).every((x) => !months.has(x));

    // Do we hold enough history to say anything about month M at all? The
    // six months it looks back over must be covered, and so must the month
    // before them — that is what separates "became inactive here" from "was
    // already inactive when our records begin".
    // The same answer the rest of the app gives: the earliest of the
    // ministry start, the baptism and the first report we hold. It used to
    // be the first report alone, which made a brother who transferred in —
    // or whose card was typed up mid-year — look like somebody with no past.
    const horizon = resolveReportingStartMonth({
      ministryStartDate: p.ministryStartDate,
      baptismDate: p.baptismDate,
      firstReportMonth: firstKnown.get(p.id) ?? null,
    });
    // Two conditions, and both must hold. The person must have been
    // reporting for the whole stretch the question looks at, and WE must
    // hold the months it looks at.
    const knowable = (m: string) =>
      horizon !== null &&
      addMonths(m, -6) >= horizon &&
      dataCovers(addMonths(m, -6), m);

    for (const m of judgeable) {
      // Became inactive here: inactive now, not inactive a month ago. That
      // second half is what keeps out someone who lapsed years ago and never
      // returned — their run completed long before this year.
      if (!knowable(m)) continue;
      if (inactiveAt(m) && !inactiveAt(addMonths(m, -1))) {
        becameInactive.push({ ...who, month: m });
        break;
      }
    }

    for (const m of judgeable) {
      // Resumed here: reported this month, having been inactive last month —
      // and only where the silence before it is something we actually
      // recorded rather than merely failed to have.
      if (!knowable(m)) continue;
      if (months.has(m) && inactiveAt(addMonths(m, -1))) {
        reactivated.push({ ...who, month: m });
        break;
      }
    }

    // Inactive as things stand — the same six-month rule, asked once, at the
    // last month we are entitled to judge. Not for the form (see the field's
    // note); for the elders, who ask a different question than the branch.
    if (
      judgeable.length > 0 &&
      dataCovers(addMonths(judgeUntilInYear, -5), judgeUntilInYear) &&
      (horizon === null || horizon <= judgeUntilInYear) &&
      inactiveAt(judgeUntilInYear)
    ) {
      inactiveNow.push({ ...who, month: judgeUntilInYear });
    }

    // Never reported in anything we hold. He is plainly inactive — but the
    // month his break began is on paper, before the records start, and the
    // form's line runs exactly through that month.
    if (
      firstCovered !== null &&
      judgeable.length > 0 &&
      (reportedBy.get(p.id)?.size ?? 0) === 0 &&
      (horizon === null || horizon <= firstCovered)
    ) {
      lapseUnknown.push({ ...who, month: firstCovered });
    }

    if (p.isDeaf) deaf.push(who);
    if (p.isBlind) blind.push(who);
    if (p.isImprisoned) imprisoned.push(who);
  }

  return {
    startYear,
    monthlyReporters,
    active,
    becameInactive,
    reactivated,
    inactiveNow,
    lapseUnknown,
    deaf,
    blind,
    imprisoned,
  };
}

function fullName(p: AnnualPublisher): string {
  return [p.lastName, p.firstName].filter(Boolean).join(' ').trim();
}

/** The twelve months of a service year as YYYY-MM, September first. */
export function monthsOfServiceYear(startYear: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const y = startYear + (i < 4 ? 0 : 1);
    const m = ((8 + i) % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/** March through August of the service year — the window "active" is judged on. */
function marchToAugust(startYear: number): string[] {
  return [3, 4, 5, 6, 7, 8].map(
    (m) => `${startYear + 1}-${String(m).padStart(2, '0')}`,
  );
}

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** The month itself and the five before it. */
function lastSixMonths(ym: string): string[] {
  return [0, 1, 2, 3, 4, 5].map((i) => addMonths(ym, -i));
}

/** Calendar day of a stored date or timestamp, as YYYY-MM-DD. */
function dayOf(v: Date | string): string {
  return (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
}
