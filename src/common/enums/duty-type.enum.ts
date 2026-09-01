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

/**
 * The duties of the Memorial evening — a STARTING POINT, not a rule.
 *
 * A different evening wants different hands: brothers at the main hall and the
 * foyer rather than one attendant, and several at the parking. The names are
 * one congregation's, taken from a sheet it actually sends round; another hall
 * — and the Memorial is sometimes held in a rented room — needs other ones.
 *
 * They are `custom` duties, so the label is free text and the congregation can
 * rename, remove or add without a release. `count` becomes that many slots of
 * the same label, which is how the microphones already work: replacing one of
 * the three at the parking is then ordinary work on a row rather than editing
 * inside a field.
 */
export const MEMORIAL_DUTIES: {
  label: string;
  count: number;
  notes?: string;
}[] = [
  { label: 'Главный зал', count: 1 },
  { label: 'Фойе', count: 1 },
  { label: 'Микрофон', count: 1 },
  { label: 'Аппаратура', count: 1 },
  { label: 'Zoom', count: 1 },
  { label: 'Стоянка', count: 1, notes: 'Светоотражающие жилетки' },
  { label: 'Левый ряд', count: 1 },
  { label: 'Средний ряд', count: 1 },
  { label: 'Правый ряд', count: 1 },
  { label: 'Маленький зал', count: 1 },
];
