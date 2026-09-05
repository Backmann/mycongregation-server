import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { PioneerType } from '../common/enums/pioneer-type.enum';

/** The kinds of pioneering a spell records. Auxiliary has its own table. */
const PERMANENT: PioneerType[] = [
  PioneerType.REGULAR,
  PioneerType.SPECIAL,
  PioneerType.MISSIONARY,
];

/** YYYY-MM-01 for the month a date falls in. */
function monthStart(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

/**
 * Spells follow the card, always and only through here.
 *
 * The migration filled in the past; nothing filled in the future. Appointing a
 * pioneer wrote the card and no spell, so the first man appointed after the
 * migration would have vanished from the pioneer lines of the monthly figures —
 * the figures that go to the branch — silently, once the readers moved onto
 * spells. That is why the readers were held back until this existed.
 *
 * Three rules, each one settled deliberately:
 *
 *   - CORRECTING a date moves the open spell's start; it does not open a
 *     second one. A secretary fixing September to August is saying «I wrote it
 *     down wrong», not «he served twice» — the same distinction the app already
 *     makes when a report is edited rather than filed again. The journal keeps
 *     the old value.
 *   - REMOVING the appointment CLOSES the spell, it never deletes it. A
 *     congregation's records are not thrown away — the same reason a report is
 *     taken back softly and two years of history are shown while everything is
 *     kept.
 *   - The last month of a spell is the month the appointment ENDED IN, not the
 *     month before. Somebody removed on 5 September served part of September.
 */
@Injectable()
export class PioneerSpellsService {
  private readonly logger = new Logger(PioneerSpellsService.name);

  constructor(
    @InjectRepository(PioneerSpell)
    private readonly repo: Repository<PioneerSpell>,
  ) {}

  /** Every spell of one publisher, oldest first. */
  async forPublisher(
    congregationId: string,
    publisherId: string,
  ): Promise<PioneerSpell[]> {
    return this.repo.find({
      where: { congregationId, publisherId },
      order: { startMonth: 'ASC' },
    });
  }

  /**
   * Bring the spells into line with what the card now says.
   *
   * `todayIso` is the congregation's own date, not the server's — the same
   * care the auxiliary closing takes, and for the same reason: this WRITES,
   * and a wrong day stays in the data.
   */
  async syncWithCard(opts: {
    congregationId: string;
    publisherId: string;
    pioneerType: PioneerType;
    pioneerSince: string | null;
    todayIso: string;
    actorUserId?: string | null;
  }): Promise<{
    opened?: PioneerSpell;
    closed?: PioneerSpell;
    moved?: boolean;
  }> {
    const {
      congregationId,
      publisherId,
      pioneerType,
      pioneerSince,
      todayIso,
      actorUserId,
    } = opts;

    const open = await this.repo.findOne({
      where: { congregationId, publisherId, endMonth: IsNull() },
      order: { startMonth: 'DESC' },
    });
    const isPioneerNow = PERMANENT.includes(pioneerType);

    // No longer a pioneer: close what is open, at the month it ended in.
    if (!isPioneerNow) {
      if (!open) return {};
      open.endMonth = monthStart(todayIso);
      const closed = await this.repo.save(open);
      return { closed };
    }

    const startsAt = monthStart(pioneerSince ?? todayIso);

    // Newly a pioneer, or a kind that is not the open spell's kind: the old
    // spell ends and a new one begins. Changing from regular to special is two
    // spells, not one amended — those are different appointments.
    if (!open || open.pioneerType !== pioneerType) {
      let closed: PioneerSpell | undefined;
      if (open) {
        // The month before the new one starts, so the two never overlap.
        const [y, m] = startsAt.split('-').map(Number);
        const py = m === 1 ? y - 1 : y;
        const pm = m === 1 ? 12 : m - 1;
        open.endMonth = `${py}-${String(pm).padStart(2, '0')}-01`;
        closed = await this.repo.save(open);
      }
      const opened = await this.repo.save(
        this.repo.create({
          congregationId,
          publisherId,
          pioneerType,
          startMonth: startsAt,
          endMonth: null,
          createdBy: actorUserId ?? null,
        }),
      );
      return { opened, closed };
    }

    // Same kind, different date: a correction. Move the start; do not open a
    // second spell, and never leave the two disagreeing.
    if (open.startMonth.slice(0, 10) !== startsAt) {
      open.startMonth = startsAt;
      await this.repo.save(open);
      return { moved: true };
    }

    return {};
  }
}
