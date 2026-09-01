export enum EventType {
  MIDWEEK = 'midweek',
  WEEKEND = 'weekend',
  /**
   * The Memorial — a meeting like the other two, and treated as one.
   *
   * It was very nearly given machinery of its own: a table for its duties, a
   * card to edit them, a starting list, add and remove buttons. All of that
   * already exists for the two ordinary meetings, and the reasons for building
   * it again did not survive reading the code — a duty can carry a free label
   * (`custom`), several people can stand at one place (that is how the
   * microphones work), and a duty already has a `notes` field.
   *
   * Naming the Memorial as a third KIND OF MEETING gets the whole duties
   * section, its buttons, its counters and its printing for nothing; the
   * attendance table, keyed by the same field, gains the separate figure the
   * annual reckoning wants; and there is one mechanism to look after instead
   * of two.
   *
   * What stays in `memorial_items` is what a duty genuinely cannot express:
   * the order of the evening — chairman, songs by number, the three prayers,
   * the speaker and the theme.
   */
  MEMORIAL = 'memorial',
  CLEANING = 'cleaning',
  AV_DUTY = 'av_duty',
  PUBLIC_WITNESSING = 'public_witnessing',
}

/**
 * The meetings that HAVE duties — one list, so a form cannot disagree with the
 * others about what it will accept.
 *
 * Three DTOs spelled `['midweek', 'weekend']` out by hand, and naming the
 * Memorial a third kind did not touch them: they are strings, so the type
 * checker had nothing to object to. The first thing anybody saw was the app
 * refusing to create its duties with «eventType must be one of the following
 * values: midweek, weekend».
 */
export const DUTY_MEETINGS = [
  EventType.MIDWEEK,
  EventType.WEEKEND,
  EventType.MEMORIAL,
] as const;
