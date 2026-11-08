/**
 * One person's agenda: everything they hold, and the big events of the
 * congregation, each on its real day and hour (7 November 2026).
 *
 * ONE source for «what do I have, and when». Until now every reader worked it
 * out on its own: «Мои назначения» got a week and a meeting kind and guessed
 * the day in the app; reminders asked the week rules; nothing knew that a
 * part in a convention week is never given. The calendar feed and the new
 * Home read this instead, so the three cannot disagree.
 */

export type AgendaKind =
  /** A part of the programme (own or as assistant), the Memorial's included. */
  | 'part'
  /** A duty at a meeting: microphone, attendant, audio/video … */
  | 'duty'
  /** The hall after a meeting, or the thorough cleaning on its planned day. */
  | 'cleaning'
  /** A shift at a cart or stand. */
  | 'cart'
  /** A meeting for field service the person conducts (or goes to with the visiting service overseer). */
  | 'field_service'
  /** A public talk our brother gives in another congregation. */
  | 'outgoing_talk'
  /** A lunch for the visiting speaker. */
  | 'guest_lunch'
  /** Something of the circuit overseer's visit that is the person's: a lunch, his service, the elders' or pioneers' meeting with him. */
  | 'co_visit'
  /** The pioneers' meeting with an elder. */
  | 'pioneer_meeting'
  /** A duty at the pioneer school. */
  | 'pioneer_school'
  /** A meeting of the body of elders. */
  | 'elders_meeting'
  /** A big event of the congregation: convention, assembly, visit, Memorial. */
  | 'event';

export type AgendaState =
  /** Goes ahead as planned. */
  | 'ok'
  /** The meeting it belongs to is not held that week: the assignment stands in the programme, but nobody will give it. */
  | 'not_held'
  /** The person has said they are away that day. */
  | 'away';

export type NotHeldReason =
  /** A convention or circuit assembly that week. */
  | 'congress'
  /** The Memorial takes this meeting. */
  | 'memorial'
  /** An event flagged «no usual meeting that day». */
  | 'replaced'
  /** The congregation has no meeting day on record for it. */
  | 'no_day';

export interface AgendaItem {
  /**
   * Stable across reads: `<kind>:<row id>[:<more>]`. The calendar keeps an
   * event by it, so an hour changed in the programme moves the event instead
   * of adding a second one.
   */
  id: string;
  kind: AgendaKind;
  /** Something the person holds, or an event of the whole congregation. */
  scope: 'mine' | 'event';
  /** YYYY-MM-DD, the congregation's own calendar. */
  date: string;
  /** Last day, for an event of several days; null otherwise. */
  endDate: string | null;
  /** HH:mm, or null for a whole day. */
  start: string | null;
  /** HH:mm, or null when the end is not known. */
  end: string | null;
  /** In the reader's language, ready to show. */
  title: string;
  /** The rest of the programme's line, when the title alone does not say it (the reading, the theme). */
  detail: string | null;
  /**
   * The meeting this belongs to: the same key for every part, duty and
   * cleaning of one meeting, and for the Memorial's event — so a calendar can
   * show the meeting once with «your part» inside.
   */
  meetingKey: string | null;
  /** Which meeting: midweek, weekend or the Memorial. */
  meeting: 'midweek' | 'weekend' | 'memorial' | null;
  /** Assistant to the student, rather than the student. */
  asAssistant: boolean;
  /** The others in it with the person, «First Last». Empty when nobody, or when names are not wanted. */
  with: string[];
  place: string | null;
  mapUrl: string | null;
  state: AgendaState;
  notHeldReason: NotHeldReason | null;
  /** For an event: its type (`regional_convention`, `memorial` …). */
  eventType: string | null;
}

export interface Agenda {
  /** Null when the login is not linked to a publisher card. */
  publisherId: string | null;
  from: string;
  to: string;
  items: AgendaItem[];
}
