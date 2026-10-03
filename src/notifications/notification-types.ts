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
  'cart_published',
  'cart_dobor_request',
  'cart_cancel',
  'outgoing_talk',
  'test',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const KNOWN: ReadonlySet<string> = new Set(NOTIFICATION_TYPES);

export const isKnownNotificationType = (type: unknown): boolean =>
  typeof type === 'string' && KNOWN.has(type);
