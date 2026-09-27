import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { SpecialEvent } from '../entities/special-event.entity';
import { User } from '../entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { MemorialService } from '../memorial/memorial.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { minutesOfDayIn, todayIn } from '../common/congregation-clock';
import { addDaysISO } from '../common/week-rules';
import {
  coerceLanguage,
  SupportedLanguage,
} from '../common/i18n/supported-languages';
import {
  EventChange,
  eventMessage,
  reminderDayOf,
  reminderMessage,
  signatureOf,
} from './event-messages';

/** The reminder goes out from this hour on the evening before … */
export const REMINDER_FROM_HOUR = 18;
/**
 * … and not after this one. A reminder that missed the evening (a server that
 * was down) would otherwise wait for the morning and arrive on the day itself
 * saying «tomorrow». Better none than a wrong one.
 */
export const REMINDER_UNTIL_HOUR = 21;

/** The notification kind — its category, «События собрания», can be turned off. */
export const EVENT_KIND = 'special_event';

/**
 * Tells the whole congregation about its events (27 September).
 *
 * An event is the one thing that changes every member's week — a convention
 * takes the meetings away, a visit moves one — and it used to be learned by
 * opening the right screen at the right time. Now a new event, a change to
 * its days, hours or place, and a cancellation are announced to everyone; and
 * the evening before, everyone is reminded.
 *
 * Only what is still ahead: an event entered for the record, or corrected
 * afterwards, is told to nobody.
 */
@Injectable()
export class EventNotificationsService {
  private readonly logger = new Logger(EventNotificationsService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    private readonly clock: CongregationClock,
    private readonly notifications: NotificationsService,
    private readonly memorial: MemorialService,
  ) {}

  /** Everyone in the congregation who can sign in, by language. */
  private async membersByLanguage(
    congregationId: string,
  ): Promise<Map<SupportedLanguage, string[]>> {
    const rows = await this.users.find({
      where: { congregationId, isActive: true, deletedAt: IsNull() },
      select: { id: true, uiLanguage: true },
    });
    const out = new Map<SupportedLanguage, string[]>();
    for (const u of rows) {
      const lang = coerceLanguage(u.uiLanguage);
      out.set(lang, [...(out.get(lang) ?? []), u.id]);
    }
    return out;
  }

  /** The key that makes one announcement be said once to each person. */
  static keyOf(change: EventChange, e: SpecialEvent, at: Date): string {
    switch (change) {
      case 'created':
        return `event:${e.id}:created`;
      // The signature is hashed: written out it carries the address and the
      // meeting note, and a key longer than the outbox column (96) failed to
      // insert — which notify() reads as «already said», so a change to an
      // event with an address was never announced.
      case 'changed':
        return `event:${e.id}:changed:${createHash('sha1')
          .update(signatureOf(e))
          .digest('hex')
          .slice(0, 16)}`;
      // A cancellation and a return can each happen more than once (cancelled,
      // restored, cancelled again): the moment tells them apart.
      case 'cancelled':
      case 'restored':
        return `event:${e.id}:${change}:${at.toISOString().slice(0, 16)}`;
    }
  }

  /**
   * Announces a change. Never throws — whatever saved the event has saved it,
   * and a failed message must not undo that.
   */
  async announce(
    e: SpecialEvent,
    change: EventChange,
    now: Date = new Date(),
  ): Promise<void> {
    try {
      const today = await this.clock.todayFor(e.congregationId);
      if ((e.endDate ?? e.date) < today) return;
      const byLang = await this.membersByLanguage(e.congregationId);
      for (const [lang, userIds] of byLang) {
        const msg = eventMessage(change, e, lang);
        await this.notifications.notify({
          tenantId: e.congregationId,
          userIds,
          title: msg.title,
          body: msg.body,
          kind: EVENT_KIND,
          key: EventNotificationsService.keyOf(change, e, now),
          data: { type: 'special_event', eventId: e.id },
        });
      }
    } catch (err) {
      this.logger.warn(
        `event ${e.id} ${change}: not announced: ${(err as Error).message}`,
      );
    }
  }

  /**
   * «Tomorrow — …», on the evening before, from 18:00 to 21:00 by the
   * congregation's own clock. Called every quarter of an hour; the key carries
   * the day, so a repeated tick says nothing new.
   */
  async remindEveningBefore(now: Date = new Date()): Promise<number> {
    // Wide enough for every timezone's «tomorrow»; the exact day is checked
    // per congregation below. A visit is reminded on its midweek meeting,
    // which can fall up to six days after its first day.
    const from = addDaysISO(todayIn(now, 'UTC'), -7);
    const to = addDaysISO(todayIn(now, 'UTC'), 2);
    const candidates = await this.events.find({
      where: { date: Between(from, to), deletedAt: IsNull() },
    });

    let sent = 0;
    for (const e of candidates) {
      const tz = await this.clock.timezoneOf(e.congregationId);
      const tomorrow = todayIn(new Date(now.getTime() + 86400000), tz);
      if (reminderDayOf(e) !== tomorrow) continue;
      const minutes = minutesOfDayIn(now, tz);
      if (minutes < REMINDER_FROM_HOUR * 60) continue;
      if (minutes >= REMINDER_UNTIL_HOUR * 60) continue;

      const byLang = await this.membersByLanguage(e.congregationId);
      // Those with a part at the Memorial are told at 19:00 with their part.
      const told =
        e.type === 'memorial'
          ? new Set(await this.memorial.assigneeUserIds(e))
          : new Set<string>();
      for (const [lang, all] of byLang) {
        const userIds = all.filter((id) => !told.has(id));
        if (userIds.length === 0) continue;
        const msg = reminderMessage(e, lang);
        await this.notifications.notify({
          tenantId: e.congregationId,
          userIds,
          title: msg.title,
          body: msg.body,
          kind: EVENT_KIND,
          key: `event:${e.id}:eve:${tomorrow}`,
          data: { type: 'special_event', eventId: e.id },
        });
      }
      sent += 1;
    }
    if (sent > 0) this.logger.log(`event reminders: ${sent}`);
    return sent;
  }
}
