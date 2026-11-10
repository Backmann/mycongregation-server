import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { User } from '../entities/user.entity';
import { INVITE_ONLY_TYPES, inviteesOf, isInvited } from './invitations';

/** One invited person busy on an event's days — for those who plan. */
export interface BusyInvited {
  publisherId: string;
  /** First day, YYYY-MM-DD. */
  date: string;
  /** Last day, YYYY-MM-DD (the first for a one-day event). */
  endDate: string;
  /** The event's kind — the app names it; the event itself is not sent. */
  type: string;
}

/**
 * Who is invited to an event that is for the invited only — see
 * invitations.ts for the rule. The cards are read fresh each time: an
 * appointment or a pioneer start changes who is invited, and nothing is
 * stored that could fall behind.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
  ) {}

  /** The cards invited to this event; empty for an event for everybody. */
  async invitedPublishers(
    e: Pick<SpecialEvent, 'congregationId' | 'type' | 'date'>,
  ): Promise<Publisher[]> {
    const who = inviteesOf(e.type);
    if (!who) return [];
    const cards = await this.publishers.find({
      where: { congregationId: e.congregationId, deletedAt: IsNull() },
    });
    return cards.filter((p) => isInvited(p, who, e.date.slice(0, 10)));
  }

  /** The logins of the invited — whom to tell. */
  async invitedUserIds(
    e: Pick<SpecialEvent, 'congregationId' | 'type' | 'date'>,
  ): Promise<string[]> {
    return (await this.invitedPublishers(e))
      .map((p) => p.userId)
      .filter((id): id is string => !!id);
  }

  /** The card of a login, or null (an account not linked to one). */
  async cardOf(congregationId: string, userId: string) {
    return this.publishers.findOne({
      where: { congregationId, userId, deletedAt: IsNull() },
    });
  }

  /**
   * Is this login invited to this event? An event for everybody: yes.
   * Without a card nobody is invited — there is nothing to be invited as.
   */
  isFor(
    e: Pick<SpecialEvent, 'type' | 'date'>,
    card: Publisher | null,
  ): boolean {
    const who = inviteesOf(e.type);
    if (!who) return true;
    return !!card && isInvited(card, who, e.date.slice(0, 10));
  }

  /**
   * The invited busy between two days, both included: for the planners'
   * pickers, which mark them «busy: …» as they mark an absence. Only who and
   * when and the kind — not the place, the hours or the note.
   */
  async busy(
    congregationId: string,
    from: string,
    to: string,
  ): Promise<BusyInvited[]> {
    const types = Object.keys(INVITE_ONLY_TYPES);
    const rows = await this.events.find({
      where: {
        congregationId,
        type: In(types),
        date: LessThanOrEqual(to),
        deletedAt: IsNull(),
      },
    });
    const out: BusyInvited[] = [];
    for (const e of rows) {
      const end = (e.endDate ?? e.date).slice(0, 10);
      if (end < from) continue;
      for (const p of await this.invitedPublishers(e)) {
        out.push({
          publisherId: p.id,
          date: e.date.slice(0, 10),
          endDate: end,
          type: e.type!,
        });
      }
    }
    return out;
  }

  /** How many are invited — for those who keep the events. */
  async invitedCount(
    e: Pick<SpecialEvent, 'congregationId' | 'type' | 'date'>,
  ): Promise<number> {
    return (await this.invitedPublishers(e)).length;
  }

  /** Users by id, for their language. */
  usersByIds(ids: string[]) {
    return ids.length
      ? this.users.find({
          where: { id: In(ids), isActive: true, deletedAt: IsNull() },
          select: { id: true, uiLanguage: true },
        })
      : Promise.resolve([] as User[]);
  }
}
