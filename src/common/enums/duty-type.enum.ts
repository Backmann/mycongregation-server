/**
 * Meeting duty types. Stored as a varchar column (like ResponsibilityType) so
 * new types can be added by extending this enum WITHOUT a schema migration.
 *
 * Eligibility for a duty is the per-publisher capability flag `duty_<type>`
 * (e.g. duty_security), matching the keys in the app's capabilities matrix.
 * CUSTOM is an ad-hoc, one-week duty with a free-text label and no capability
 * requirement (anyone may be assigned).
 *
 * MICROPHONE is the only multi-slot type: a congregation has
 * MeetingSettings.microphoneSlots microphone slots (default 2). All other
 * predefined types are single-slot (slotIndex 0). CUSTOM uses an incrementing
 * slotIndex so several custom duties can coexist in one meeting.
 */
export enum DutyType {
  SECURITY = 'security',
  ATTENDANT = 'attendant',
  MICROPHONE = 'microphone',
  AV = 'av',
  ZOOM = 'zoom',
  STAGE = 'stage',
  VENTILATION = 'ventilation',
  CUSTOM = 'custom',
}

/**
 * Single-slot predefined duties generated for every meeting, in display order.
 * MICROPHONE is inserted after ATTENDANT with one row per microphone slot, so
 * it is intentionally not in this list.
 */
export const SINGLE_SLOT_DUTIES_BEFORE_MIC: DutyType[] = [
  DutyType.SECURITY,
  DutyType.ATTENDANT,
];

export const SINGLE_SLOT_DUTIES_AFTER_MIC: DutyType[] = [
  DutyType.AV,
  DutyType.ZOOM,
  DutyType.STAGE,
  DutyType.VENTILATION,
];
