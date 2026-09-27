import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { User } from '../entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { coerceLanguage } from '../common/i18n/supported-languages';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';
import { specialTalkMessage } from '../special-events/event-messages';
import { mondayOf } from '../common/week';

/** The same category as the congregation's events: «События собрания». */
export const SPECIAL_TALK_KIND = 'special_event';

/**
 * Говорит собранию о специальной речи — один раз, когда её тема записана.
 *
 * Повод сказать ещё раз — только другая тема или другой день: ключ собран из
 * них, поэтому правка гостеприимства или заметки молчит, а перенос речи на
 * неделю позже будет сказан заново. Прошедшее не объявляется.
 */
@Injectable()
export class SpecialTalkNotificationsService {
  private readonly logger = new Logger(SpecialTalkNotificationsService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly clock: CongregationClock,
    private readonly notifications: NotificationsService,
  ) {}

  static keyOf(entry: { id: string; specialTheme: string; date: string }) {
    const digest = createHash('sha1')
      .update(`${entry.specialTheme}|${entry.date}`)
      .digest('hex')
      .slice(0, 12);
    return `special-talk:${entry.id}:${digest}`;
  }

  /** Never throws: the entry is saved, a failed message must not undo that. */
  async announceIfNew(
    entry: TalkExchange,
    was: { specialTheme: string | null; date: string } | null,
  ): Promise<void> {
    try {
      const theme = entry.specialTheme?.trim();
      if (!theme) return;
      if (entry.direction !== TalkExchangeDirection.INCOMING) return;
      if (entry.status === TalkExchangeStatus.DID_NOT_HAPPEN) return;
      if (was && was.specialTheme?.trim() === theme && was.date === entry.date)
        return;
      const today = await this.clock.todayFor(entry.congregationId);
      if (entry.date < today) return;

      const rows = await this.users.find({
        where: {
          congregationId: entry.congregationId,
          isActive: true,
          deletedAt: IsNull(),
        },
        select: { id: true, uiLanguage: true },
      });
      const byLang = new Map<ReturnType<typeof coerceLanguage>, string[]>();
      for (const u of rows) {
        const lang = coerceLanguage(u.uiLanguage);
        byLang.set(lang, [...(byLang.get(lang) ?? []), u.id]);
      }
      for (const [lang, userIds] of byLang) {
        const msg = specialTalkMessage(theme, entry.date, lang);
        await this.notifications.notify({
          tenantId: entry.congregationId,
          userIds,
          title: msg.title,
          body: msg.body,
          kind: SPECIAL_TALK_KIND,
          key: SpecialTalkNotificationsService.keyOf({
            id: entry.id,
            specialTheme: theme,
            date: entry.date,
          }),
          data: {
            type: 'special_talk',
            weekStartDate: mondayOf(entry.date),
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `special talk ${entry.id}: not announced: ${(err as Error).message}`,
      );
    }
  }
}
