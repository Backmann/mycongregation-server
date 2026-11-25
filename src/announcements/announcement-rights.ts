import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * WHO WRITES THE ANNOUNCEMENTS (R-02, Lionel, 24 November 2026): the
 * coordinator of the body of elders — he answers for them being made — his
 * assistant, and the administrators, «на случай отъезда». Nobody else, not
 * even an elder with no such office: the text may be the council's own.
 */
export const ANNOUNCEMENT_WRITERS: readonly ResponsibilityType[] = [
  ResponsibilityType.BODY_COORDINATOR,
  ResponsibilityType.BODY_COORDINATOR_ASSISTANT,
];

export function isWriter(role: UserRole, held: readonly string[]): boolean {
  if (role === UserRole.ADMIN) return true;
  return held.some((t) =>
    (ANNOUNCEMENT_WRITERS as readonly string[]).includes(t),
  );
}

/** The meetings that have announcements, and the part that reads them. */
export const ANNOUNCEMENT_KINDS = ['midweek', 'weekend'] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

/**
 * The chairman of a meeting is whoever holds its chairman's part in the
 * programme NOW — not whoever held it when the announcement was written. A
 * chairman changed on the day sees the list at once, and the one replaced no
 * longer does.
 */
export function chairmanPart(kind: AnnouncementKind): string {
  return kind === 'midweek' ? 'midweek_chairman' : 'weekend_chairman';
}

/**
 * Kept 30 days after the meeting's week (R-03). Counted from the week's
 * Sunday, so a meeting moved within its week changes nothing; the day before
 * the returned date is the last one still kept.
 */
export const KEEP_DAYS_AFTER_WEEK = 30;

/** The first Monday whose announcements are still kept, seen from today. */
export function keptFromWeek(today: string): string {
  // A week ending (Sunday) on or after today − 30 is kept; its Monday is six
  // days earlier.
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - KEEP_DAYS_AFTER_WEEK - 6);
  return d.toISOString().slice(0, 10);
}
