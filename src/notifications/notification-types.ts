/**
 * EVERY `data.type` a notification may carry.
 *
 * The type is what a tap is led by: the app has a table from type to screen
 * (lib/push-notifications.ts, and a second copy in the service worker). The
 * two sides were never compared, and on 3 October 2026 four types turned out
 * to lead nowhere — «задача на завтра» among them, from the very first day.
 *
 * So the list lives here, in one place. The gateway reports a type that is
 * not on it, and the app's gate (scripts/check-notification-routes.mjs) reads
 * this file and fails when a type has no destination. A new kind of
 * notification is therefore three lines in three places, and forgetting any
 * of them is caught before it ships.
 *
 * One per line, in quotes — the app's gate reads them as text.
 */
export const NOTIFICATION_TYPES = [
  'publisher_status_change',
  'task_assigned',
  'task_tomorrow',
  'task_soon',
  'task_overdue',
  'agenda_approved',
  'elders_meeting_tomorrow',
  'report_reminder',
  'schedule_published',
  'schedule_changed',
  'memorial_published',
  'memorial_tomorrow',
  'special_event',
  'special_talk',
  'field_service_meeting',
  'cleaning_after_meeting',
  'cleaning_weekly_monday',
  'cleaning_weekly_planned',
  'cleaning_general_planned',
  'assignment_reminder',
  'meeting_gaps',
  'meeting_not_held',
  'cart_published',
  'cart_dobor_request',
  'cart_cancel',
  // The stand, made personal (2 November 2026): sign-up open for everyone
  // approved; put on, changed or taken off; who stands with one changed; a
  // partner who cannot come; a place free again; called off or on again;
  // and for whoever arranges — sign-up closing, a plan not published, a
  // town permit ending.
  'cart_open',
  'cart_assigned',
  'cart_changed',
  'cart_unassigned',
  'cart_crew_changed',
  'cart_partner_cancel',
  'cart_place_free',
  'cart_shift_cancelled',
  'cart_shift_restored',
  'cart_signup_reminder',
  'cart_collect_due',
  'cart_unpublished',
  'cart_permit',
  'outgoing_talk',
  // A trip of ours that needs a brother, or has come into question.
  'talk_exchange_attention',
  // A «Местные потребности» part still without a topic — the coordinator.
  'local_needs_reminder',
  // An application to serve as an auxiliary pioneer: for the committee and
  // an elder in an open place; and its approval, for the applicant.
  'aux_application',
  'aux_application_approved',
  // A publisher ended his own «until cancelled» — for the committee.
  'aux_stopped',
  // A month became auxiliary after his report came in without hours.
  'aux_report_hours',
  // The annual meeting of the elders with the pioneers — invited, conducting.
  'pioneer_meeting',
  // Today's meeting still without its attendance figure, at 20:00.
  'attendance_due',
  // A new kind of failure met in the app — for the administrator.
  'client_error',
  // The two people of a part agreeing when to prepare it.
  'pair_prep',
  'test',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const KNOWN: ReadonlySet<string> = new Set(NOTIFICATION_TYPES);

export const isKnownNotificationType = (type: unknown): boolean =>
  typeof type === 'string' && KNOWN.has(type);
