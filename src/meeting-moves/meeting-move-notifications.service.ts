import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Publisher } from '../entities/publisher.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { CongregationClock } from '../common/congregation-clock.service';
import type { MeetingKind } from '../common/week-rules';
import { labelOf } from '../assignment-reminders/digest';
import {
  minutesUntil,
  moveMessage,
  moveMessageForAssignee,
  MoveForMessage,
} from './meeting-move-messages';

/** One thing a person has at the meeting, as the digest words it (labelOf). */
export type AssignedItem = Parameters<typeof labelOf>[0];

export interface Assigned {
  publisherId: string;
  userId: string | null;
  /** «Фамилия Имя», as the app lists people. */
  name: string;
  items: AssignedItem[];
}

/** The kind in the outbox: never switched off — a moved meeting must reach everyone. */
export const MOVE_KIND = 'meeting_move';

/** Inside this many minutes before either day, said at once, even at night. */
export const URGENT_WITHIN_MINUTES = 24 * 60;

/**
 * Telling the congregation that a meeting moved (4 November 2026), as
 * agreed with Lionel:
 *
 *  - everyone in the congregation who can sign in gets ONE notice;
 *  - whoever has a part or a duty at that meeting gets his own notice
 *    INSTEAD, naming what he has — not two;
 *  - a move within a day of either the old or the new start is said at once,
 *    even at night; otherwise the usual quiet hours hold;
 *  - a meeting moved after the fact is told to nobody;
 *  - moving it back is told again, to everyone.
 *
 * Never throws: the move is saved whatever happens to the message.
 */
@Injectable()
export class MeetingMoveNotificationsService {
  private readonly logger = new Logger(MeetingMoveNotificationsService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Duty)
    private readonly duties: Repository<Duty>,
    private readonly notifications: NotificationsService,
    private readonly clock: CongregationClock,
  ) {}

  async announce(input: {
    tenantId: string;
    week: string;
    kind: MeetingKind;
    move: MoveForMessage;
    past: boolean;
    now?: Date;
  }): Promise<void> {
    const { tenantId, week, kind, move, past } = input;
    const now = input.now ?? new Date();
    if (past) return;
    try {
      const tz = await this.clock.timezoneOf(tenantId);
      const urgent =
        minutesUntil(move.from, now, tz) <= URGENT_WITHIN_MINUTES ||
        minutesUntil(move.to, now, tz) <= URGENT_WITHIN_MINUTES;
      // One press, one announcement: moved, moved again, moved back are each
      // said, and a retried request inside ten seconds is not said twice.
      const press = Math.floor(now.getTime() / 10_000).toString(36);
      const keyHead = `move:${week}:${kind}:${move.back ? 'back' : 'to'}:${press}`;
      const data = {
        type: 'schedule_changed',
        eventType: kind,
        weekStartDate: week,
      };

      const mine = await this.assigneesOf(tenantId, week, kind);
      const members = await this.users.find({
        where: {
          congregationId: tenantId,
          isActive: true,
          deletedAt: IsNull(),
        },
        select: { id: true },
      });
      const everyone = members.map((u) => u.id).filter((id) => !mine.has(id));

      if (everyone.length > 0) {
        await this.notifications.notify({
          tenantId,
          userIds: everyone,
          text: (lang) => moveMessage(move, lang),
          kind: MOVE_KIND,
          key: keyHead,
          data,
          urgent,
        });
      }
      for (const [userId, items] of mine) {
        await this.notifications.notify({
          tenantId,
          userIds: [userId],
          text: (lang) =>
            moveMessageForAssignee(
              move,
              items.map((x) => labelOf(x, lang)),
              lang,
            ),
          kind: MOVE_KIND,
          key: `${keyHead}:${userId}`,
          data,
          urgent,
        });
      }
    } catch (err) {
      this.logger.warn(
        `meeting move ${week} ${kind}: not announced: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Who has something at that meeting, by account: a published part (as the
   * one giving it or his assistant) or a duty. A draft part was never told to
   * him, so he hears it with everyone.
   */
  private async assigneesOf(
    tenantId: string,
    week: string,
    kind: MeetingKind,
  ): Promise<Map<string, AssignedItem[]>> {
    const out = new Map<string, AssignedItem[]>();
    for (const a of await this.assignedAt(tenantId, week, kind, false)) {
      if (!a.userId) continue;
      out.set(a.userId, [...(out.get(a.userId) ?? []), ...a.items]);
    }
    return out;
  }

  /**
   * Everyone with a part or a duty at that meeting, by card — with drafts
   * when asked (the mover wants to know about a draft part too; the
   * announcement does not tell it). One reader for both, so the warning on
   * the confirm screen and the notices name the same people.
   */
  async assignedAt(
    tenantId: string,
    week: string,
    kind: MeetingKind,
    withDrafts: boolean,
  ): Promise<Assigned[]> {
    const [parts, duties] = await Promise.all([
      this.assignments.find({
        where: {
          congregationId: tenantId,
          weekStartDate: week,
          eventType: kind as Assignment['eventType'],
          ...(withDrafts ? {} : { status: AssignmentStatus.PUBLISHED }),
          deletedAt: IsNull(),
        },
        order: { partOrder: 'ASC' },
      }),
      this.duties.find({
        where: {
          congregationId: tenantId,
          weekStartDate: week,
          eventType: kind as Duty['eventType'],
          publisherId: Not(IsNull()),
        },
      }),
    ]);
    const byPublisher = new Map<string, AssignedItem[]>();
    const add = (id: string | null, item: AssignedItem) => {
      if (!id) return;
      byPublisher.set(id, [...(byPublisher.get(id) ?? []), item]);
    };
    for (const a of parts) {
      const base = {
        type: 'part' as const,
        labelKey: a.partKey,
        labelTitle: a.partTitle,
        slot: null,
      };
      add(a.publisherId, { ...base, assistant: false });
      add(a.assistantPublisherId, { ...base, assistant: true });
    }
    const mics = duties.filter(
      (d) => String(d.dutyType) === 'microphone',
    ).length;
    for (const d of duties) {
      const type = String(d.dutyType);
      add(d.publisherId, {
        type: 'duty',
        labelKey: type,
        labelTitle: d.customLabel,
        assistant: false,
        slot: type === 'microphone' && mics > 1 ? d.slotIndex + 1 : null,
      });
    }
    if (byPublisher.size === 0) return [];
    const cards = await this.publishers.find({
      where: { congregationId: tenantId, id: In([...byPublisher.keys()]) },
      select: { id: true, userId: true, firstName: true, lastName: true },
    });
    return cards.map((c) => ({
      publisherId: c.id,
      userId: c.userId ?? null,
      name: [c.lastName, c.firstName].filter(Boolean).join(' '),
      items: byPublisher.get(c.id) ?? [],
    }));
  }
}
