import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { Publisher } from '../entities/publisher.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { SupportedLanguage } from '../common/i18n/supported-languages';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';
import { shortDay } from '../assignment-reminders/digest';

/** Its own kind; filed under «мои назначения» in the gateway. */
export const OUTGOING_TALK_KIND = 'outgoing_talk';

/** What of a journal entry the travelling brother needs to know. */
export interface OutgoingFacts {
  direction: string;
  status: string;
  date: string;
  publisherId: string | null;
  hostCongregationId: string | null;
  publicTalkId: string | null;
  specialTheme: string | null;
}

export function outgoingFacts(e: OutgoingFacts): OutgoingFacts {
  return {
    direction: e.direction,
    status: e.status,
    date: String(e.date).slice(0, 10),
    publisherId: e.publisherId ?? null,
    hostCongregationId: e.hostCongregationId ?? null,
    publicTalkId: e.publicTalkId ?? null,
    specialTheme: e.specialTheme?.trim() || null,
  };
}

/** Is somebody of ours actually going somewhere. */
const live = (f: OutgoingFacts | null): f is OutgoingFacts =>
  !!f &&
  f.direction === TalkExchangeDirection.OUTGOING &&
  !!f.publisherId &&
  f.status !== TalkExchangeStatus.DID_NOT_HAPPEN;

type Tone = 'assigned' | 'changed' | 'cancelled';

const STR: Record<
  SupportedLanguage,
  {
    title: Record<Tone, string>;
    tentative: string;
    cancelledTail: string;
    elsewhere: string;
  }
> = {
  ru: {
    title: {
      assigned: 'Вам назначена речь в другом собрании',
      changed: 'Изменилась ваша речь в другом собрании',
      cancelled: 'Речь в другом собрании отменена',
    },
    tentative: 'предварительно',
    cancelledTail: 'готовиться не нужно',
    elsewhere: 'другое собрание',
  },
  en: {
    title: {
      assigned: 'You have a talk in another congregation',
      changed: 'Your talk in another congregation has changed',
      cancelled: 'Your talk in another congregation is cancelled',
    },
    tentative: 'tentative',
    cancelledTail: 'no need to prepare',
    elsewhere: 'another congregation',
  },
  de: {
    title: {
      assigned: 'Du hast einen Vortrag in einer anderen Versammlung',
      changed: 'Dein Vortrag in einer anderen Versammlung hat sich geändert',
      cancelled: 'Dein Vortrag in einer anderen Versammlung entfällt',
    },
    tentative: 'vorläufig',
    cancelledTail: 'keine Vorbereitung nötig',
    elsewhere: 'andere Versammlung',
  },
};

/**
 * Tells one of OUR brothers that he is to give a talk in another
 * congregation — and when that changes, or falls through.
 *
 * Until 3 October 2026 nothing did. The coordinator wrote the journey into
 * the journal «От нас», an absence appeared on the brother's card, and the
 * brother himself heard of it only if somebody told him by word of mouth —
 * while a part at home was announced, recalled five times and cancelled
 * properly.
 *
 * WHAT IS COMPARED is what he needs to know: who goes, the day, where, and
 * which talk. A changed note or hospitality says nothing to him and sends
 * nothing. A new man in his place is two messages: the new one is assigned,
 * the old one is told not to prepare.
 *
 * The evening reminders (a week before and the evening before) are the
 * digest's work; this is only the word at the moment of the change.
 */
@Injectable()
export class OutgoingTalkNotificationsService {
  private readonly logger = new Logger(OutgoingTalkNotificationsService.name);

  constructor(
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(ExternalCongregation)
    private readonly hosts: Repository<ExternalCongregation>,
    @InjectRepository(PublicTalk)
    private readonly publicTalks: Repository<PublicTalk>,
    private readonly clock: CongregationClock,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * `now` is the entry as saved (null when it was removed), `was` what it
   * held before (null when it is new). Never throws: the journal is saved, a
   * message that failed must not undo that.
   */
  async announce(
    congregationId: string,
    entryId: string,
    now: OutgoingFacts | null,
    was: OutgoingFacts | null,
  ): Promise<void> {
    try {
      const after = live(now) ? now : null;
      const before = live(was) ? was : null;
      if (!after && !before) return;
      const today = await this.clock.todayFor(congregationId);

      const sameMan =
        !!after && !!before && after.publisherId === before.publisherId;
      const moved =
        sameMan &&
        (after.date !== before.date ||
          after.hostCongregationId !== before.hostCongregationId ||
          after.publicTalkId !== before.publicTalkId ||
          after.specialTheme !== before.specialTheme ||
          after.status !== before.status);

      // The man who is going: told when he is new to it, or when it moved.
      if (after && after.date >= today && (!sameMan || moved)) {
        await this.say(
          congregationId,
          entryId,
          after,
          sameMan ? 'changed' : 'assigned',
        );
      }
      // The man who was going and no longer is.
      if (before && before.date >= today && !sameMan) {
        await this.say(congregationId, entryId, before, 'cancelled');
      }
    } catch (err) {
      this.logger.warn(
        `outgoing talk ${entryId}: not announced: ${(err as Error).message}`,
      );
    }
  }

  private async say(
    congregationId: string,
    entryId: string,
    f: OutgoingFacts,
    tone: Tone,
  ): Promise<void> {
    const card = await this.publishers.findOne({
      where: { id: f.publisherId as string, congregationId },
      select: { id: true, userId: true },
    });
    if (!card?.userId) return;
    const host = f.hostCongregationId
      ? await this.hosts.findOne({
          where: { id: f.hostCongregationId, congregationId },
        })
      : null;
    const talk = f.publicTalkId
      ? await this.publicTalks.findOne({ where: { id: f.publicTalkId } })
      : null;
    const what = talk
      ? `№${talk.number} «${talk.title}»`
      : f.specialTheme
        ? `«${f.specialTheme}»`
        : null;

    // One press, one message — and the next press is news again (the same
    // rule as the schedule's: a key built from the facts would swallow «to
    // him, to another, back to him»). Ten seconds absorb a double tap.
    const stamp = Math.floor(Date.now() / 10_000).toString(36);

    await this.notifications.notify({
      tenantId: congregationId,
      userIds: [card.userId],
      text: (l) => {
        const s = STR[l];
        const day = shortDay(f.date, l);
        const at =
          tone !== 'cancelled' && host?.meetingTime
            ? `, ${host.meetingTime.slice(0, 5)}`
            : '';
        const parts = [`${day}${at}`, host?.name ?? s.elsewhere];
        if (tone === 'cancelled') {
          return {
            title: s.title.cancelled,
            body: `${parts.join(' · ')} — ${s.cancelledTail}`,
          };
        }
        if (what) parts.push(what);
        if (f.status === TalkExchangeStatus.TENTATIVE) parts.push(s.tentative);
        return { title: s.title[tone], body: parts.join(' · ') };
      },
      kind: OUTGOING_TALK_KIND,
      key: `outgoing-talk:${entryId}:${tone}:${stamp}`,
      data: { type: 'outgoing_talk', date: f.date },
      // His own assignment: with no device to take it, it goes by post.
      emailFallback: true,
    });
  }
}
