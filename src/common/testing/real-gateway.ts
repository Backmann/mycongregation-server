import { NotificationsService } from '../../notifications/notifications.service';
import { isKnownNotificationType } from '../../notifications/notification-types';
import { clockStub } from './clock-stub';
import { memRepo, MemRepo } from './mem-repo';

/**
 * The REAL notification gateway over tables in memory.
 *
 * For tests of a sender: what matters is what a PERSON receives — in which
 * language, how many times, by push or by post — and that is decided in the
 * gateway, not in the sender. A stub of `notify` would show what the sender
 * asked for and nothing of what came of it. Only the transport is a recorder
 * here: `pushes` is what reached a device, `letters` what went by post.
 */
export function realGateway(opts: {
  users: MemRepo<any>;
  publishers: MemRepo<any>;
  /** People with no device at all: the gateway may then write a letter. */
  noDevice?: string[];
  /** Rows of notification_preferences. */
  preferences?: any[];
  timezone?: string;
}) {
  const outbox = memRepo<any>([], {
    unique: ['congregationId', 'userId', 'dedupeKey'],
  });
  const pushes: { userId: string; title: string; body: string; data: any }[] =
    [];
  const letters: { to: string; title: string; body: string }[] = [];
  const notifications = new NotificationsService(
    outbox as any,
    memRepo<any>(opts.preferences ?? []) as any,
    {
      sendToUsers: async (
        _tenant: string,
        ids: string[],
        title: string,
        body: string,
        data: any,
      ) => {
        const reach = new Map<string, string>();
        for (const userId of ids) {
          if (opts.noDevice?.includes(userId)) {
            reach.set(userId, 'no_device');
            continue;
          }
          pushes.push({ userId, title, body, data });
          reach.set(userId, 'phone');
        }
        return reach;
      },
    } as any,
    clockStub(opts.timezone ?? 'Europe/Berlin'),
    opts.users as any,
    opts.publishers as any,
    {
      sendNotice: async (
        to: string,
        _lang: string,
        m: { title: string; body: string },
      ) => {
        letters.push({ to, title: m.title, body: m.body });
        return true;
      },
    } as any,
  );
  // A sender tested through the real gateway must use a type the app knows
  // where to lead: the gateway only logs it, a test fails on it.
  const notify = notifications.notify.bind(notifications);
  notifications.notify = async (input) => {
    if (!isKnownNotificationType(input.data?.type)) {
      throw new Error(
        `notification type «${String(input.data?.type)}» is not in NOTIFICATION_TYPES`,
      );
    }
    return notify(input);
  };
  const to = (userId: string) => pushes.filter((p) => p.userId === userId);
  return { notifications, outbox, pushes, letters, to };
}
