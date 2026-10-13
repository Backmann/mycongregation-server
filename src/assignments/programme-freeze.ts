import { addDaysISO, WeekRules } from '../common/week-rules';

/**
 * The programme of a meeting becomes the RECORD a week after the meeting
 * (decision of 30 September 2026, built 13 October 2026).
 *
 * Until then every past week stayed open: anybody with the section could
 * rewrite who gave which part a year ago, and the history the app counts
 * from — «when did he last have a part» — moved with it. Duties, field
 * service, the Memorial and the circuit visit were already frozen; the
 * programme, the most read of them all, was not.
 *
 * Seven days of grace, not none: the week after a meeting is when the
 * programme is put right — who actually stood in for whom, the talk that
 * was given instead. The meeting's own day counts by the week's rules (the
 * circuit visit moves the midweek meeting, the Memorial takes one), so a
 * meeting moved by a visit freezes a week after the day it was really held.
 *
 * This file is the rule and nothing else — no repositories, no clock — so
 * the server's guard and its answer to the app are the same arithmetic.
 */

export const PROGRAMME_GRACE_DAYS = 7;

/** One meeting's standing: its day, the last day it may change, and now. */
export interface ProgrammeLock {
  /** The meeting's own day (or the week's Sunday when it had none). */
  meetingDate: string;
  /** The last day the programme may still be changed, inclusive. */
  editableUntil: string;
  /**
   * The meeting has taken place (its day is before today). Nothing about
   * it is news any more: no message goes out, and the planning helpers
   * (chairman → prayer, Treasures → microphone) stay still.
   */
  held: boolean;
  /** Past `editableUntil` — the record. */
  frozen: boolean;
}

/**
 * The day a meeting's programme belongs to.
 *
 * A meeting the week does not hold — a convention week, or the one the
 * Memorial takes — still has rows that may need putting right; it is
 * judged by the day it would have had, else by the week's Sunday, so that
 * no week stays open for ever.
 */
export function programmeDayOf(rules: WeekRules, eventType: string): string {
  const sunday = addDaysISO(rules.weekStart, 6);
  if (eventType === 'midweek' || eventType === 'weekend') {
    const held = rules.meetings.find((m) => m.kind === eventType);
    return held?.date ?? rules.dateOf(eventType) ?? sunday;
  }
  if (eventType === 'memorial') {
    return rules.memorial?.date ?? sunday;
  }
  return sunday;
}

export function programmeLock(
  rules: WeekRules,
  eventType: string,
  today: string,
): ProgrammeLock {
  const meetingDate = programmeDayOf(rules, eventType);
  const editableUntil = addDaysISO(meetingDate, PROGRAMME_GRACE_DAYS);
  return {
    meetingDate,
    editableUntil,
    held: meetingDate < today,
    frozen: today > editableUntil,
  };
}
