import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { refusal } from '../common/errors/refusal';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PioneerSpell } from '../entities/pioneer-spell.entity';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import {
  monthOf,
  monthsInclusive,
  overlaps,
  servedMonths,
} from './pioneer-history';

/** One spell as the card's history shows it — months as YYYY-MM. */
export interface PioneerHistorySpell {
  id: string;
  kind: PioneerType;
  start: string;
  /** Null while it runs — the open spell, which follows the card. */
  end: string | null;
  /** Months in it, up to the current month for the open one. */
  months: number;
}

export interface PioneerHistory {
  spells: PioneerHistorySpell[];
  /** Every permanent month, counted once, up to the current month. */
  totalMonths: number;
  /** The earliest month the app knows of; null when there is no spell. */
  knownFrom: string | null;
}

/** What the secretary writes for a past spell. */
export interface PastSpellInput {
  kind: PioneerType;
  /** YYYY-MM */
  start: string;
  /** YYYY-MM */
  end: string;
}

const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

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
    /**
     * When the card stops being a pioneer's: his last month, YYYY-MM, as the
     * secretary said it (checked by assertEndMonth first). Left out, the
     * month the change is made in.
     */
    endMonth?: string | null;
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
      open.endMonth = opts.endMonth
        ? `${opts.endMonth.slice(0, 7)}-01`
        : monthStart(todayIso);
      const closed = await this.repo.save(open);
      return { closed };
    }

    const startsAt = monthStart(pioneerSince ?? todayIso);

    // A change of kind that would start at or before the open spell's own
    // start would end that spell before it began — and then the whole past
    // reads as the new kind (23 October 2026: a regular pioneer since 2024
    // turned special for every month since 2024, in S-1, S-21 and the
    // pioneer year). Refused here as the last line; the card refuses first.
    this.assertKindChangeDate(open, pioneerType, startsAt);

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

  /**
   * Would changing the card to this kind, from this month, end the open
   * spell before it began? Asked by the card BEFORE it saves — the spell
   * sync afterwards only logs its failures, so a refusal there would leave
   * the card changed and the history silently wrong.
   */
  async assertCardChange(opts: {
    congregationId: string;
    publisherId: string;
    pioneerType: PioneerType;
    pioneerSince: string | null;
    todayIso: string;
  }): Promise<void> {
    if (!PERMANENT.includes(opts.pioneerType)) return;
    const open = await this.repo.findOne({
      where: {
        congregationId: opts.congregationId,
        publisherId: opts.publisherId,
        endMonth: IsNull(),
      },
      order: { startMonth: 'DESC' },
    });
    this.assertKindChangeDate(
      open,
      opts.pioneerType,
      monthStart(opts.pioneerSince ?? opts.todayIso),
    );
  }

  private assertKindChangeDate(
    open: PioneerSpell | null,
    pioneerType: PioneerType,
    startsAt: string,
  ): void {
    if (!open || open.pioneerType === pioneerType) return;
    if (startsAt > open.startMonth.slice(0, 10)) return;
    throw new BadRequestException(
      refusal(
        'PIONEER_KIND_CHANGE_DATE',
        'A new kind of pioneering starts after the current one began; to say the kind was wrong all along, correct it instead.',
        {
          currentSince: open.startMonth.slice(0, 10),
          currentKind: open.pioneerType,
        },
      ),
    );
  }

  /**
   * The last month of the spell that is ending must be one of its own
   * months, and not one still to come (30 October 2026): it may not end
   * before it began, and «he stopped in March» is not said in January.
   */
  async assertEndMonth(opts: {
    congregationId: string;
    publisherId: string;
    endMonth: string;
    todayIso: string;
  }): Promise<void> {
    const open = await this.repo.findOne({
      where: {
        congregationId: opts.congregationId,
        publisherId: opts.publisherId,
        endMonth: IsNull(),
      },
      order: { startMonth: 'DESC' },
    });
    if (!open) return;
    const end = monthOf(opts.endMonth);
    if (end < monthOf(String(open.startMonth))) {
      throw new BadRequestException(
        refusal(
          'PIONEER_END_BEFORE_START',
          'The last month of pioneering cannot come before its first.',
          { start: monthOf(String(open.startMonth)) },
        ),
      );
    }
    if (end > monthOf(opts.todayIso)) {
      throw new BadRequestException(
        refusal(
          'PIONEER_END_FUTURE',
          'The last month of pioneering is this month at the latest.',
        ),
      );
    }
  }

  /**
   * «The kind was written down wrong» — the open spell keeps its months and
   * takes the right kind, nothing is split (23 October 2026). The same
   * distinction the date already has: correcting is not a second
   * appointment. Only between the permanent kinds.
   */
  async correctOpenKind(opts: {
    congregationId: string;
    publisherId: string;
    pioneerType: PioneerType;
  }): Promise<PioneerSpell> {
    const open = await this.repo.findOne({
      where: {
        congregationId: opts.congregationId,
        publisherId: opts.publisherId,
        endMonth: IsNull(),
      },
      order: { startMonth: 'DESC' },
    });
    if (!open || !PERMANENT.includes(opts.pioneerType)) {
      throw new BadRequestException(
        refusal(
          'PIONEER_KIND_CORRECTION_INVALID',
          'Only the kind of an open regular, special or missionary spell can be corrected.',
        ),
      );
    }
    open.pioneerType = opts.pioneerType;
    return this.repo.save(open);
  }

  // ---- The history on the card (30 October 2026) ----------------------
  //
  // The secretary copies earlier pioneering in from the paper S-21 — an
  // earlier stretch, years in another congregation. Only CLOSED spells are
  // written here; the open one follows the card and nothing else, so the
  // two can never disagree about «now».

  /** The whole history of one publisher, as the card shows it. */
  async history(
    congregationId: string,
    publisherId: string,
    todayIso: string,
  ): Promise<PioneerHistory> {
    const rows = (await this.forPublisher(congregationId, publisherId)).filter(
      (r) => PERMANENT.includes(r.pioneerType),
    );
    const now = monthOf(todayIso);
    const spells = rows
      .map((r) => {
        const start = monthOf(String(r.startMonth));
        const end = r.endMonth ? monthOf(String(r.endMonth)) : null;
        return {
          id: r.id,
          kind: r.pioneerType,
          start,
          end,
          months: start > now ? 0 : monthsInclusive(start, end ?? now),
        };
      })
      // Newest first: the card reads from now backwards.
      .sort((a, b) => b.start.localeCompare(a.start));
    return {
      spells,
      totalMonths: servedMonths(rows, `${now}-01`),
      knownFrom: rows.length
        ? rows.map((r) => monthOf(String(r.startMonth))).sort()[0]
        : null,
    };
  }

  /** A past spell, copied in from paper. */
  async addPast(opts: {
    congregationId: string;
    publisherId: string;
    input: PastSpellInput;
    todayIso: string;
    actorUserId?: string | null;
  }): Promise<PioneerSpell> {
    const others = await this.forPublisher(
      opts.congregationId,
      opts.publisherId,
    );
    this.assertPast(opts.input, others, opts.todayIso);
    return this.repo.save(
      this.repo.create({
        congregationId: opts.congregationId,
        publisherId: opts.publisherId,
        pioneerType: opts.input.kind,
        startMonth: `${opts.input.start}-01`,
        endMonth: `${opts.input.end}-01`,
        createdBy: opts.actorUserId ?? null,
      }),
    );
  }

  /** A closed spell, corrected. Returns it as it was and as it is now. */
  async updatePast(opts: {
    congregationId: string;
    publisherId: string;
    spellId: string;
    input: PastSpellInput;
    todayIso: string;
  }): Promise<{ before: PioneerSpell; after: PioneerSpell }> {
    const all = await this.forPublisher(opts.congregationId, opts.publisherId);
    const spell = this.closedSpell(all, opts.spellId);
    const before = { ...spell };
    this.assertPast(
      opts.input,
      all.filter((s) => s.id !== spell.id),
      opts.todayIso,
    );
    spell.pioneerType = opts.input.kind;
    spell.startMonth = `${opts.input.start}-01`;
    spell.endMonth = `${opts.input.end}-01`;
    const after = await this.repo.save(spell);
    return { before, after };
  }

  /** A closed spell written in error. Returns what was removed. */
  async removePast(opts: {
    congregationId: string;
    publisherId: string;
    spellId: string;
  }): Promise<PioneerSpell> {
    const all = await this.forPublisher(opts.congregationId, opts.publisherId);
    const spell = this.closedSpell(all, opts.spellId);
    await this.repo.delete({
      id: spell.id,
      congregationId: opts.congregationId,
    });
    return spell;
  }

  private closedSpell(all: PioneerSpell[], spellId: string): PioneerSpell {
    const spell = all.find((s) => s.id === spellId);
    if (!spell) {
      throw new NotFoundException(
        refusal('PIONEER_SPELL_NOT_FOUND', 'No such spell on this card.'),
      );
    }
    if (!spell.endMonth) {
      throw new BadRequestException(
        refusal(
          'PIONEER_SPELL_OPEN',
          'The spell still running follows the card: change the card instead.',
        ),
      );
    }
    return spell;
  }

  /**
   * A past spell must be a real stretch of the past: a permanent kind, a
   * start not after its end, over by this month, and sharing no month with
   * any other spell — a month is one kind of service or none.
   */
  private assertPast(
    input: PastSpellInput,
    others: PioneerSpell[],
    todayIso: string,
  ): void {
    if (
      !PERMANENT.includes(input.kind) ||
      !MONTH.test(input.start ?? '') ||
      !MONTH.test(input.end ?? '')
    ) {
      throw new BadRequestException(
        refusal(
          'PIONEER_SPELL_INVALID',
          'A past spell is a regular, special or missionary pioneering with a first and a last month (YYYY-MM).',
        ),
      );
    }
    if (input.start > input.end) {
      throw new BadRequestException(
        refusal(
          'PIONEER_SPELL_ORDER',
          'The first month comes before the last one.',
        ),
      );
    }
    if (input.end > monthOf(todayIso)) {
      throw new BadRequestException(
        refusal(
          'PIONEER_SPELL_FUTURE',
          'A past spell is over by this month; the one running now is set on the card.',
        ),
      );
    }
    const clash = others
      .filter((o) => PERMANENT.includes(o.pioneerType))
      .find((o) =>
        overlaps(
          { start: input.start, end: input.end },
          {
            start: String(o.startMonth),
            end: o.endMonth ? String(o.endMonth) : null,
          },
        ),
      );
    if (clash) {
      throw new BadRequestException(
        refusal(
          'PIONEER_SPELL_OVERLAP',
          'These months are already in another spell.',
          {
            start: monthOf(String(clash.startMonth)),
            end: clash.endMonth ? monthOf(String(clash.endMonth)) : null,
            kind: clash.pioneerType,
          },
        ),
      );
    }
  }
}
