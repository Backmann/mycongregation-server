import type { WeekReadiness } from '../readiness/readiness.service';
import { addDaysISO } from '../common/week-rules';

/**
 * What the lines of the «Собрание» contents say under each door (27
 * September) — the pure part, so every rule is pinned by a test.
 *
 * Each figure is taken from the SAME source as the screen behind its door:
 * the programme and the duties from the readiness count (the one the
 * Programme badge reads), the absences as the absences list returns them to
 * this person, the cleaning from the cleaning rows. A caption that disagreed
 * with the screen it opens would be worse than the plain description it
 * replaces.
 */

/**
 * How far ahead the programme line looks, in weeks — this week and the next
 * three. Four is the horizon every brother should be able to see his part in
 * (Lionel, 28 September); eight made a line nobody could act on this week.
 */
export const PROGRAMME_WINDOW_WEEKS = 4;

export interface ProgrammeSummary {
  windowWeeks: number;
  /** Meetings in the window whose programme is loaded but not all assigned. */
  notReady: number;
  /** Date of the last meeting whose programme is loaded, or null. */
  loadedUntil: string | null;
}

/**
 * The programme, judged as the Programme judges it: a meeting with its
 * programme loaded and a part without a person is not ready. Meetings of
 * today that have passed still count — the day is not over for the list.
 * A meeting with no programme loaded at all is not «unready», it is not yet
 * imported; the line says how far the programme reaches instead.
 */
export function programmeSummary(
  weeks: WeekReadiness[],
  todayISO: string,
): ProgrammeSummary {
  let notReady = 0;
  let loadedUntil: string | null = null;
  for (const w of weeks) {
    for (const m of w.meetings) {
      if (m.date < todayISO) continue;
      if (!m.programme.loaded) continue;
      if (!loadedUntil || m.date > loadedUntil) loadedUntil = m.date;
      if (m.programme.assigned < m.programme.total) notReady += 1;
    }
  }
  return { windowWeeks: PROGRAMME_WINDOW_WEEKS, notReady, loadedUntil };
}

export interface NextDuties {
  date: string;
  kind: 'midweek' | 'weekend';
  assigned: number;
  total: number;
}

/**
 * The duties of the next meeting from today. Only COUNTED, never judged —
 * «то назначают, то нет» (decided 20 September): no word «не готово», and the
 * app draws it without the amber of something to do.
 */
export function nextMeetingDuties(
  weeks: WeekReadiness[],
  todayISO: string,
): NextDuties | null {
  for (const w of weeks) {
    for (const m of [...w.meetings].sort((a, b) =>
      a.date.localeCompare(b.date),
    )) {
      if (m.date < todayISO) continue;
      return {
        date: m.date,
        kind: m.kind,
        assigned: m.duties.assigned,
        total: m.duties.total,
      };
    }
  }
  return null;
}

export interface AbsenceRow {
  publisherId: string;
  startDate: string;
  endDate: string | null;
}

export interface AbsencesSummary {
  /** The list this person sees is everyone's. */
  readAll: boolean;
  /** Away today — only when the list is everyone's. */
  awayNow: number | null;
  /** The person's own away-period under way, or the next one. */
  mine: { startDate: string; endDate: string | null } | null;
}

/**
 * `rows` are what the absences list returns to this person — already only
 * the current and future ones, already only his own unless he reads all.
 * Several records of one person over the same days are one person away.
 */
export function absencesSummary(
  rows: AbsenceRow[],
  todayISO: string,
  readAll: boolean,
  myPublisherId: string | null,
): AbsencesSummary {
  const away = new Set(
    rows
      .filter(
        (a) =>
          a.startDate <= todayISO && (a.endDate ?? a.startDate) >= todayISO,
      )
      .map((a) => a.publisherId),
  );
  const own = rows
    .filter((a) => !!myPublisherId && a.publisherId === myPublisherId)
    .filter((a) => (a.endDate ?? a.startDate) >= todayISO)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return {
    readAll,
    awayNow: readAll ? away.size : null,
    mine: own ? { startDate: own.startDate, endDate: own.endDate } : null,
  };
}

export interface CleaningRow {
  weekStartDate: string;
  slotType: string;
  serviceGroupId: string | null;
  thoroughPlannedAt: Date | null;
}

export interface CleaningSummary {
  /** Who cleans after the meetings this week, and who does the weekly one. */
  thisWeek: {
    afterMeeting: string | null;
    thorough: string | null;
    /**
     * The congregation meets this week. A convention week has no meetings
     * and so no cleaning after them — an empty slot there is no gap.
     */
    meetingsHeld: boolean;
  };
  /** The person's own group's next cleaning, this week included. */
  mine: {
    weekStart: string;
    slot: string;
    plannedAt: string | null;
  } | null;
}

export function cleaningSummary(
  rows: CleaningRow[],
  groupName: (id: string) => string | null,
  thisMonday: string,
  myGroupId: string | null,
  meetingsHeld: boolean,
): CleaningSummary {
  const of = (slot: string) => {
    const r = rows.find(
      (x) => x.weekStartDate === thisMonday && x.slotType === slot,
    );
    return r?.serviceGroupId ? groupName(r.serviceGroupId) : null;
  };
  const mineRow = myGroupId
    ? rows
        .filter(
          (r) =>
            r.serviceGroupId === myGroupId && r.weekStartDate >= thisMonday,
        )
        .sort(
          (a, b) =>
            a.weekStartDate.localeCompare(b.weekStartDate) ||
            // After the meetings before the weekly one within a week.
            a.slotType.localeCompare(b.slotType),
        )[0]
    : undefined;
  return {
    thisWeek: {
      afterMeeting: of('after_meeting'),
      thorough: of('thorough'),
      meetingsHeld,
    },
    mine: mineRow
      ? {
          weekStart: mineRow.weekStartDate,
          slot: mineRow.slotType,
          plannedAt: mineRow.thoroughPlannedAt
            ? mineRow.thoroughPlannedAt.toISOString()
            : null,
        }
      : null,
  };
}

/** The Monday after the window, for range queries whose end is exclusive. */
export function windowEnd(thisMonday: string, weeks: number): string {
  return addDaysISO(thisMonday, 7 * weeks);
}
