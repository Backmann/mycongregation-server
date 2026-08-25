/**
 * What a week actually holds.
 *
 * Which meetings a congregation holds in a given week is not a property of the
 * settings alone — a convention week has none, a circuit visit moves the
 * midweek one, the Memorial takes one of them away. That question was being
 * answered in two places with two different answers: `meetingsOfWeek` inside
 * the attendance service, and `week-rules.ts` in the app. They agreed about
 * the weekend and disagreed about everything else, and neither of them was
 * right about a convention.
 *
 * So the rule lives here, once, named, with nothing else in it: no database,
 * no timezone, no i18n — calendar strings in, calendar strings out.
 *
 * THE RULES, in the order they are applied:
 *
 *  1. A convention or a circuit assembly TOUCHING the week ⇒ the congregation
 *     holds NO meetings that week at all — neither midweek nor weekend, and
 *     regardless of which days of the week the event itself covers. A regional
 *     convention runs Friday to Sunday and the midweek meeting is on Thursday;
 *     that meeting is not held either. The old server rule asked whether the
 *     event covered the meeting's own date, so it kept the Thursday meeting
 *     and asked the secretary to record attendance at it.
 *
 *  2. A circuit-overseer visit ⇒ the midweek meeting moves. The day is on the
 *     event (`coMidweekDow`); Tuesday is only the default, not a fixture. The
 *     weekend meeting does not move.
 *
 *  3. The Memorial ⇒ ONE meeting gives way, chosen by the KIND OF DAY the
 *     Memorial falls on: on a weekday the midweek meeting, at the weekend the
 *     weekend meeting. Not "the meeting on the same day" — the Memorial can
 *     fall on a Tuesday while the midweek meeting is a Thursday, and it is
 *     still the midweek meeting that goes. The other meeting that week is held
 *     as usual.
 *
 * Rule 1 wins over rule 3: in a convention week there is nothing left for the
 * Memorial to displace.
 */

/** ISO day of week: 1 = Monday … 7 = Sunday. */
export function isoDowOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Add days to a calendar date, staying a calendar date. */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type MeetingKind = 'midweek' | 'weekend';

/** Only the fields the rules need — every caller has at least these. */
export interface WeekEvent {
  type?: string | null;
  date: string;
  endDate?: string | null;
  /** Weekday the midweek meeting moves to during a visit (1=Mon…7=Sun). */
  coMidweekDow?: number | null;
}

/** Only the fields the rules need from a meeting-settings version. */
export interface WeekSettingsVersion {
  effectiveFrom: string;
  midweekDow?: number | null;
  weekendDow?: number | null;
}

/** A convention or a circuit assembly — both cancel the week's meetings. */
export function isCongressEvent(e: WeekEvent): boolean {
  return e.type === 'regional_convention' || e.type === 'circuit_assembly';
}

/** The events touching a week, from a longer list. */
export function eventsOfWeek(
  events: WeekEvent[],
  weekStart: string,
): WeekEvent[] {
  const weekEnd = addDaysISO(weekStart, 6);
  return events.filter(
    (e) => e.date <= weekEnd && (e.endDate ?? e.date) >= weekStart,
  );
}

/** The settings version in force for a week. */
export function versionForWeek<T extends WeekSettingsVersion>(
  versions: T[],
  weekStart: string,
): T | null {
  let found: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= weekStart) found = v;
  }
  return found ?? versions[0] ?? null;
}

export interface WeekRules {
  /** Monday of the week these rules describe. */
  weekStart: string;
  /** The settings version in force, or null when none is recorded. */
  version: WeekSettingsVersion | null;
  /** The circuit-overseer visit touching this week, if any. */
  coVisit: WeekEvent | null;
  /** The convention or assembly touching this week, if any. */
  congress: WeekEvent | null;
  /** The Memorial falling inside this week, if any. */
  memorial: WeekEvent | null;
  /** False in a convention week: the congregation does not meet at all. */
  meetingsHeld: boolean;
  /** Which meeting the Memorial takes, or null when there is no Memorial. */
  memorialTakes: MeetingKind | null;
  /** Weekday of a meeting (1=Mon…7=Sun), the visit's shift included. */
  dowOf: (kind: MeetingKind) => number | null;
  /** Calendar date of a meeting, or null when it has no day. */
  dateOf: (kind: MeetingKind) => string | null;
  /** The meetings actually held that week, in order. */
  meetings: { date: string; kind: MeetingKind }[];
  /** Days covered by the convention or assembly, within this week. */
  congressDays: string[];
}

export function weekRules(input: {
  weekStart: string;
  versions: WeekSettingsVersion[];
  /** All known events; narrowed to the week here. */
  events: WeekEvent[];
}): WeekRules {
  const { weekStart } = input;
  const events = eventsOfWeek(input.events, weekStart);
  const version = versionForWeek(input.versions, weekStart);

  const congress = events.find(isCongressEvent) ?? null;
  const coVisit =
    events.find((e) => e.type === 'circuit_overseer_visit') ?? null;
  // The Memorial must fall INSIDE the week to displace one of its meetings —
  // unlike a convention, which cancels the week merely by touching it.
  const weekEnd = addDaysISO(weekStart, 6);
  const memorial =
    events.find(
      (e) => e.type === 'memorial' && e.date >= weekStart && e.date <= weekEnd,
    ) ?? null;

  const meetingsHeld = !congress;

  const memorialTakes: MeetingKind | null = memorial
    ? isoDowOf(memorial.date) >= 6
      ? 'weekend'
      : 'midweek'
    : null;

  const dowOf = (kind: MeetingKind): number | null => {
    if (kind === 'weekend') return version?.weekendDow ?? null;
    if (coVisit) return coVisit.coMidweekDow ?? 2;
    return version?.midweekDow ?? null;
  };

  const dateOf = (kind: MeetingKind): string | null => {
    const dow = dowOf(kind);
    return dow ? addDaysISO(weekStart, dow - 1) : null;
  };

  const meetings: { date: string; kind: MeetingKind }[] = [];
  if (meetingsHeld && version) {
    for (const kind of ['midweek', 'weekend'] as const) {
      if (memorialTakes === kind) continue;
      const date = dateOf(kind);
      if (date) meetings.push({ date, kind });
    }
  }

  const congressDays: string[] = [];
  if (congress) {
    const end = congress.endDate ?? congress.date;
    for (let i = 0; i < 7; i++) {
      const day = addDaysISO(weekStart, i);
      if (day >= congress.date && day <= end) congressDays.push(day);
    }
  }

  return {
    weekStart,
    version,
    coVisit,
    congress,
    memorial,
    meetingsHeld,
    memorialTakes,
    dowOf,
    dateOf,
    meetings,
    congressDays,
  };
}
