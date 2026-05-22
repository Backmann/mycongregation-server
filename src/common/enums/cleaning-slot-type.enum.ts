/**
 * Cleaning slots tracked per week (see docs/BACKLOG.md Feature C).
 *
 * - after_meeting: light cleaning after both midweek + weekend meetings, done
 *   by ONE service group (groups take turns week to week).
 * - thorough: the weekly thorough cleaning, group chosen manually.
 * - general: once-a-year general cleaning involving the WHOLE congregation —
 *   a per-week marker, no single group (serviceGroupId stays null).
 */
export enum CleaningSlotType {
  AFTER_MEETING = 'after_meeting',
  THOROUGH = 'thorough',
  GENERAL = 'general',
}

export const CLEANING_SLOT_TYPES: CleaningSlotType[] = [
  CleaningSlotType.AFTER_MEETING,
  CleaningSlotType.THOROUGH,
  CleaningSlotType.GENERAL,
];
