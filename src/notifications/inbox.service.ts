import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboxSeen } from '../entities/inbox-seen.entity';
import { NotificationOutbox } from '../entities/notification-outbox.entity';

/** How far back the list reaches. The ledger itself is kept for ninety days. */
export const INBOX_DAYS = 45;
export const INBOX_LIMIT = 60;

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  /** What a tap on it opens — the same payload the notification carried. */
  data: Record<string, unknown>;
  kind: string;
  /** When it was said to this person. */
  at: Date;
  /**
   * Whether any device took it. False is not a fault of the reader's: no
   * device registered, or the send failed — and it is exactly the message
   * this list exists for.
   */
  delivered: boolean;
}

export interface Inbox {
  /** Up to when the person has read the list; null when never opened. */
  seenAt: Date | null;
  items: InboxItem[];
}

/**
 * «Мои уведомления» — everything the app has told a person, kept in the app.
 *
 * A notification was the ONLY carrier of what it said. Swiped away, missed,
 * sent to a phone without Google services or to an iPhone that opens the site
 * from Safari — and nothing anywhere said it had ever been sent. The ledger
 * already held every one of them, with its text, for its addressee; this is
 * the door to it.
 *
 * What is NOT shown:
 *  - what is being held for the morning (quiet hours) — it has not been said
 *    yet, and reading at midnight what will buzz at eight would make the
 *    notification itself look like a repeat;
 *  - test sends — they answer «дойдёт ли», not «что мне сказали»;
 *  - anything of a category the person switched off: no row is written for
 *    those at all (NotificationsService), so there is nothing to show.
 */
@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(NotificationOutbox)
    private readonly outboxRepo: Repository<NotificationOutbox>,
    @InjectRepository(InboxSeen)
    private readonly seenRepo: Repository<InboxSeen>,
  ) {}

  async read(
    congregationId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<Inbox> {
    const since = new Date(now.getTime() - INBOX_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.outboxRepo
      .createQueryBuilder('n')
      .where('n.congregation_id = :congregationId', { congregationId })
      .andWhere('n.user_id = :userId', { userId })
      .andWhere('n.kind <> :test', { test: 'test' })
      .andWhere('n.created_at > :since', { since })
      .andWhere('(n.not_before IS NULL OR n.not_before <= :now)', { now })
      .orderBy('COALESCE(n.sent_at, n.not_before, n.created_at)', 'DESC')
      .limit(INBOX_LIMIT)
      .getMany();
    const seen = await this.seenRepo.findOne({ where: { userId } });
    return {
      seenAt: seen?.seenAt ?? null,
      items: rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        data: n.data ?? {},
        kind: n.kind,
        // Said when it went out; a message held overnight was said in the
        // morning, not when it was written.
        at: n.sentAt ?? n.notBefore ?? n.createdAt,
        delivered: n.status === 'sent',
      })),
    };
  }

  /** The list has been opened: everything in it up to now is read. */
  async markSeen(userId: string, now: Date = new Date()): Promise<void> {
    await this.seenRepo.upsert({ userId, seenAt: now }, ['userId']);
  }
}
