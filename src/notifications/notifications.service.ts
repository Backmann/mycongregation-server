import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Or, Repository } from 'typeorm';
import { NotificationOutbox } from '../entities/notification-outbox.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { CongregationClock } from '../common/congregation-clock.service';

/**
 * The congregation's waking hours. Nothing automatic goes out before or after;
 * it waits for the morning instead. These are deliberately generous — the aim
 * is to never wake anybody, not to ration the day.
 */
const QUIET_UNTIL_HOUR = 8; // nothing before 08:00 local
const QUIET_FROM_HOUR = 21; // nothing after 21:00 local

/**
 * The categories a person can switch off, and which kinds belong to each.
 *
 * They are named after the person's life in the congregation, not after our
 * modules — someone deciding what to hear about thinks in terms of "my
 * assignments" and "cleaning", not in terms of which service sends what.
 * A kind nobody mapped falls into `other`, which cannot be switched off:
 * better an occasional unexpected message than silently losing a new kind
 * because nobody remembered to map it.
 */
export const NOTIFICATION_CATEGORIES = [
  'assignments',
  'ministry',
  'cleaning',
  'reports',
  'admin',
  // The congregation's events — new, changed, cancelled, and tomorrow's.
  'events',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function categoryOfKind(kind: string): NotificationCategory | 'other' {
  if (kind === 'schedule' || kind === 'memorial') return 'assignments';
  if (kind === 'field_service_meeting' || kind.startsWith('cart')) {
    return 'ministry';
  }
  if (kind.startsWith('cleaning')) return 'cleaning';
  if (kind === 'report_reminder') return 'reports';
  if (kind === 'status_change') return 'admin';
  if (kind === 'special_event') return 'events';
  return 'other';
}

/** The outbox column that holds the key. */
const KEY_MAX = 96;

/**
 * A key that fits the column, whatever the caller built.
 *
 * Callers compose keys out of ids, and two uuids with a few words between
 * them are already past 96 characters. The insert then failed on length, the
 * failure was read as «already said» — and the Memorial's notices, whose key
 * is 99–100 characters, were never sent at all. A caller should not have to
 * count: a long key keeps its readable head and ends in a digest of the whole,
 * which is as unique as the key was and always fits.
 */
export function fitKey(key: string): string {
  if (key.length <= KEY_MAX) return key;
  const digest = createHash('sha1').update(key).digest('hex');
  return `${key.slice(0, KEY_MAX - digest.length - 1)}:${digest}`;
}

/** Postgres: unique_violation — the one refusal that means «already said». */
function isDuplicate(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

/** What became of one notification for one person. */
export interface DeliveryOutcome {
  status: 'sent' | 'no_device' | 'failed';
  channel: 'phone' | 'web' | null;
}

const TEST_STRINGS: Record<string, { title: string; body: string }> = {
  ru: {
    title: 'Пробное уведомление',
    body: 'Это устройство получает уведомления.',
  },
  en: {
    title: 'Test notification',
    body: 'This device receives notifications.',
  },
  de: {
    title: 'Testbenachrichtigung',
    body: 'Dieses Gerät erhält Benachrichtigungen.',
  },
};

export interface NotifyInput {
  tenantId: string;
  userIds: string[];
  title: string;
  body: string;
  /** Payload the app uses to open the right screen. */
  data: Record<string, any>;
  /** What this is — `report_reminder`, `cleaning`, `cart`, … */
  kind: string;
  /**
   * Identifies the announcement so it is made once. Two calls with the same
   * key for the same person are one notification. Leave it out only for
   * things that may legitimately repeat.
   */
  key?: string;
  /**
   * Deliver even outside waking hours. Reserved for things that lose their
   * meaning by morning; nothing uses it yet, and that is the point.
   */
  urgent?: boolean;
}

/**
 * One door for every automatic notification.
 *
 * Six modules used to call the push service directly, each with its own idea
 * of who should get a thing and when — so the same rule lived in several
 * places and drifted, quiet hours existed nowhere, and only the cleaning
 * reminders bothered to make a repeat impossible. Deciding all of that in one
 * place is the whole point of this service: callers say WHAT and to WHOM, and
 * this decides WHEN, WHETHER IT WAS ALREADY SAID, and writes down that it
 * happened.
 *
 * Recipient resolution deliberately stays with the callers — only they know
 * what "the group's overseer" or "whoever has a part this week" means.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationOutbox)
    private readonly outboxRepo: Repository<NotificationOutbox>,
    @InjectRepository(NotificationPreference)
    private readonly preferencesRepo: Repository<NotificationPreference>,
    private readonly push: PushNotificationsService,
    private readonly clock: CongregationClock,
  ) {}

  /** Wall-clock hour and minute for an instant in an IANA timezone. */
  private static localHourMinute(
    at: Date,
    timezone: string,
  ): { hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    let hour = get('hour');
    if (hour === 24) hour = 0;
    return { hour, minute: get('minute') };
  }

  /**
   * When this may go out: now, or the next 08:00 in the congregation's own
   * time. Returns null for "now".
   */
  static computeNotBefore(
    at: Date,
    timezone: string,
    urgent = false,
  ): Date | null {
    if (urgent) return null;
    const { hour } = NotificationsService.localHourMinute(at, timezone);
    if (hour >= QUIET_UNTIL_HOUR && hour < QUIET_FROM_HOUR) return null;

    // Walk forward in whole hours until the local clock reads 08:00. Doing it
    // by stepping rather than by arithmetic keeps it correct across the days
    // the clocks change, when a local day is not 24 hours long.
    const next = new Date(at.getTime());
    next.setUTCMinutes(0, 0, 0);
    for (let i = 0; i < 48; i += 1) {
      next.setUTCHours(next.getUTCHours() + 1);
      const local = NotificationsService.localHourMinute(next, timezone);
      if (local.hour === QUIET_UNTIL_HOUR) return next;
    }
    return null; // pathological timezone: better late than never
  }

  /**
   * Hand a notification to the outbox. Sends it straight away when the hour is
   * decent, otherwise leaves it for the morning. Never throws: a notification
   * that cannot be delivered must not break whatever was being done.
   */
  async notify(input: NotifyInput): Promise<void> {
    const recipients = [...new Set(input.userIds.filter(Boolean))];
    if (recipients.length === 0) return;

    try {
      const tz = await this.clock.timezoneOf(input.tenantId);
      const notBefore = NotificationsService.computeNotBefore(
        new Date(),
        tz,
        input.urgent,
      );

      const category = categoryOfKind(input.kind);
      const switchedOff =
        category === 'other'
          ? new Set<string>()
          : new Set(
              (
                await this.preferencesRepo.find({
                  where: {
                    userId: In(recipients),
                    category,
                    enabled: false,
                  },
                  select: { userId: true },
                })
              ).map((p) => p.userId),
            );

      for (const userId of recipients) {
        // Asked not to hear about this. Nothing is written: an outbox row for
        // something deliberately not sent would make the ledger lie about
        // what the congregation actually receives.
        if (switchedOff.has(userId)) continue;
        const row = this.outboxRepo.create({
          congregationId: input.tenantId,
          userId,
          title: input.title,
          body: input.body,
          data: input.data,
          kind: input.kind,
          dedupeKey: input.key ? fitKey(input.key) : null,
          notBefore,
          status: 'pending',
          channel: null,
          sentAt: null,
        });
        try {
          await this.outboxRepo.insert(row);
        } catch (err: any) {
          // Unique violation on the dedupe key: already said. Not an error.
          if (isDuplicate(err)) continue;
          // Anything else is a notification that was NOT sent and must not
          // pass for one that was said before. Every insert failure used to
          // land in the branch above, which is how a whole kind stayed silent
          // for months without one line in the log.
          this.logger.error(
            `outbox insert failed for tenant=${input.tenantId} ` +
              `kind=${input.kind}: ${err?.message ?? err}`,
          );
          continue;
        }
        if (!notBefore) await this.deliver(row);
      }
    } catch (err: any) {
      this.logger.warn(
        `notify failed for tenant=${input.tenantId} kind=${input.kind}: ${
          err?.message ?? err
        }`,
      );
    }
  }

  /** Send one row and record what happened. */
  private async deliver(row: NotificationOutbox): Promise<DeliveryOutcome> {
    try {
      // The dedupe key travels WITH the message.
      //
      // A browser groups notifications by a `tag`, and one with a tag already
      // on screen REPLACES it. The service worker had no way to tell two
      // messages apart — everything without a publisherId shared the tag
      // 'notification' — so a cleaning reminder followed by a task assignment
      // left only the task, and the first was gone before it was read.
      //
      // The key that keeps this row from being sent twice is exactly the
      // right name for it: the same announcement replaces itself, different
      // ones sit side by side. It was already computed and stored here; it
      // simply never left the database.
      const reach = await this.push.sendToUsers(
        row.congregationId,
        [row.userId],
        row.title,
        row.body,
        row.dedupeKey
          ? { ...row.data, notificationKey: row.dedupeKey }
          : row.data,
      );
      // The row says what happened to THIS person, not that a send was
      // attempted. «sent» for somebody with no device made the ledger useless
      // for the one question it exists to answer.
      const where = reach?.get(row.userId) ?? 'no_device';
      const outcome: DeliveryOutcome =
        where === 'phone' || where === 'web'
          ? { status: 'sent', channel: where }
          : { status: where, channel: null };
      await this.outboxRepo.update(
        { id: row.id },
        {
          status: outcome.status,
          channel: outcome.channel,
          sentAt: outcome.status === 'sent' ? new Date() : null,
        },
      );
      return outcome;
    } catch (err: any) {
      await this.outboxRepo.update({ id: row.id }, { status: 'failed' });
      this.logger.warn(
        `delivery failed for outbox=${row.id}: ${err?.message ?? err}`,
      );
      return { status: 'failed', channel: null };
    }
  }

  /**
   * «Отправить пробное» — the person asks whether THIS works, now.
   *
   * It skips the two things every other notification respects: the waking
   * hours (somebody pressing a button is awake) and the category switches (a
   * test is not news he can have opted out of). It is written to the ledger
   * like everything else, so an administrator can see when a person last
   * tried and what came of it.
   */
  async sendTest(
    tenantId: string,
    userId: string,
    language: string | null | undefined,
  ): Promise<DeliveryOutcome> {
    const text = TEST_STRINGS[language ?? ''] ?? TEST_STRINGS.ru;
    const row = this.outboxRepo.create({
      congregationId: tenantId,
      userId,
      title: text.title,
      body: text.body,
      data: { type: 'test' },
      kind: 'test',
      dedupeKey: null,
      notBefore: null,
      status: 'pending',
      channel: null,
      sentAt: null,
    });
    try {
      await this.outboxRepo.insert(row);
    } catch (err: any) {
      this.logger.error(`test insert failed: ${err?.message ?? err}`);
      return { status: 'failed', channel: null };
    }
    return this.deliver(row);
  }

  /**
   * Deliver everything whose hour has come. Called by the scheduler; this is
   * what turns "wait until morning" into an actual send.
   */
  async deliverDue(now = new Date()): Promise<{ sent: number }> {
    const due = await this.outboxRepo.find({
      where: {
        status: 'pending',
        notBefore: Or(IsNull(), LessThanOrEqual(now)),
      },
      take: 500,
      order: { createdAt: 'ASC' },
    });
    for (const row of due) await this.deliver(row);
    return { sent: due.length };
  }

  /**
   * Forget what was sent long ago. The dedupe keys only need to outlive the
   * thing they describe, and a ledger nobody prunes becomes its own problem.
   */
  async cleanupOld(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const res = await this.outboxRepo
      .createQueryBuilder()
      .delete()
      .where('status IN (:...done)', { done: ['sent', 'no_device', 'failed'] })
      .andWhere('created_at < :cutoff', { cutoff })
      .execute();
    return res.affected ?? 0;
  }

  /**
   * What this person hears about. Everything is on unless they turned it off,
   * so a fresh account needs no rows at all.
   */
  async getPreferences(userId: string): Promise<Record<string, boolean>> {
    const rows = await this.preferencesRepo.find({ where: { userId } });
    const off = new Map(rows.map((r) => [r.category, r.enabled]));
    return Object.fromEntries(
      NOTIFICATION_CATEGORIES.map((c) => [c, off.get(c) ?? true]),
    );
  }

  /** Store a choice. Turning something back on removes the row rather than
   * keeping a `true` around — the absence IS the default. */
  async setPreference(
    userId: string,
    category: string,
    enabled: boolean,
  ): Promise<Record<string, boolean>> {
    if (!NOTIFICATION_CATEGORIES.includes(category as NotificationCategory)) {
      return this.getPreferences(userId);
    }
    if (enabled) {
      await this.preferencesRepo.delete({ userId, category });
    } else {
      const existing = await this.preferencesRepo.findOne({
        where: { userId, category },
      });
      if (existing) {
        await this.preferencesRepo.update(
          { id: existing.id },
          { enabled: false },
        );
      } else {
        await this.preferencesRepo.insert({ userId, category, enabled: false });
      }
    }
    return this.getPreferences(userId);
  }

  /** Volume by kind over a window — for seeing whether it is getting noisier. */
  async countByKind(
    tenantId: string,
    since: Date,
  ): Promise<{ kind: string; count: number }[]> {
    const rows = await this.outboxRepo
      .createQueryBuilder('o')
      .select('o.kind', 'kind')
      .addSelect('COUNT(*)', 'count')
      .where('o.congregation_id = :tenantId', { tenantId })
      .andWhere('o.created_at >= :since', { since })
      .groupBy('o.kind')
      .getRawMany<{ kind: string; count: string }>();
    return rows.map((r) => ({ kind: r.kind, count: Number(r.count) }));
  }
}
