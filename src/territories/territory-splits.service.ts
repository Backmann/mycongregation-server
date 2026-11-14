import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { Territory } from '../entities/territory.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { TerritorySplit } from '../entities/territory-split.entity';
import { TerritoryStreetMark } from '../entities/territory-street-mark.entity';
import { TerritoryNoCall } from '../entities/territory-no-call.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Congregation } from '../entities/congregation.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { todayIn } from '../common/congregation-clock';
import { TerritoryAccessService } from './territory-access.service';
import { TerritoryAssignmentsService } from './territory-assignments.service';
import { boxOf, pointInside } from './geometry';
import { addDays } from './service-year';
import { mondayOf } from '../common/week';
import {
  FAR_M,
  findAddress,
  partOf,
  partsOfAddress,
  rangesOf,
  splitStreets,
  streetsWithHouses,
  type House,
  type PlanPart,
  type PlanStreet,
  type Pt,
  type SplitMode,
} from './split';

/** Fewer is no division; more than this and a part is a street or two. */
export const MIN_PARTS = 2;
export const MAX_PARTS = 8;
/** …and a piece cut for evenness keeps at least this many doors. */
const PIECE_FLOOR = 4;

const PART_RE = /^p\.([0-9a-f]{32})\.([1-8])\.(\d{8})\.([0-9a-f]{32})$/;

const dashes = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** A street of a part as it is shown: walked or not. */
export interface PartStreetView {
  key: string;
  name: string;
  from: string | null;
  to: string | null;
  piece: number;
  pieces: number;
  side: PlanStreet['side'];
  range: PlanStreet['range'];
  /** Odd and even numbers each on their own: «1–35», «2–40». */
  ranges: PlanStreet['ranges'];
  houses: number;
  doors: number;
  lines: Pt[][];
  /** Its houses, to draw as dots. Public map data. */
  dots: Pt[];
  /** When it was marked walked; null: not yet. */
  walkedAt: string | null;
}

export interface PartView {
  n: number;
  houses: number;
  doors: number;
  start: Pt | null;
  smaller: boolean;
  /** In walking order. */
  streets: PartStreetView[];
  /** Nothing walked yet: another pair may still take one of its streets. */
  untouched: boolean;
}

/** How a division is asked for (13 November 2026, «Пары на участке»). */
export interface DivideOptions {
  parts: number;
  mode?: SplitMode;
  /** Parts (1-based) that asked to be smaller. */
  smaller?: number[];
}

/** What a page without login may show: one part of one day, no more. */
export interface SharedPart {
  number: string;
  locality: string | null;
  geometry: Territory['geometry'];
  day: string;
  parts: number;
  mode: SplitMode;
  /** The common start of «pairs near»: where everyone sets off. */
  start: Pt | null;
  part: PartView;
  others: {
    n: number;
    untouched: boolean;
    streets: Pick<
      PartStreetView,
      'key' | 'name' | 'range' | 'ranges' | 'side' | 'houses'
    >[];
  }[];
  /** How many «не посещать» addresses lie on this part's streets; never which. */
  noCalls: number;
  congregationId: string;
  mapReady: boolean;
}

/**
 * A territory divided between groups for one day (13 November 2026; mockup
 * «Участок на группы»).
 *
 *  - Whoever sees the territory today divides it: the whole section, its
 *    holder, his group, the people of a meeting going there. The first
 *    division of the day holds for everyone; doing it again (or moving a
 *    street to another part) is for the one who divided, the holder, the
 *    conductor of today's meeting there and the keepers.
 *  - Each part reaches its group in the app, by a link without login that
 *    works on that day only, or on paper.
 *  - «Street walked» is marked by whoever walks it — in the app or by the
 *    part's link — and seen by every part; only the time, never who. A new
 *    division leaves the walked houses out, so the next outing goes on
 *    where the last stopped. Everything goes when the territory comes back.
 *  - A part's link never carries the «не посещать» addresses, only how many
 *    lie on its streets; the app shows them to those who see the territory.
 */
@Injectable()
export class TerritorySplitsService {
  constructor(
    private readonly access: TerritoryAccessService,
    private readonly given: TerritoryAssignmentsService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    @InjectRepository(TerritoryAssignment)
    private readonly assignments: Repository<TerritoryAssignment>,
    @InjectRepository(TerritorySplit)
    private readonly splits: Repository<TerritorySplit>,
    @InjectRepository(TerritoryStreetMark)
    private readonly marks: Repository<TerritoryStreetMark>,
    @InjectRepository(TerritoryNoCall)
    private readonly noCalls: Repository<TerritoryNoCall>,
    @InjectRepository(TerritorySettings)
    private readonly settings: Repository<TerritorySettings>,
    @InjectRepository(FieldServiceMeeting)
    private readonly meetings: Repository<FieldServiceMeeting>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
  ) {}

  // ------------------------------------------------------------ reading --

  /** Today's division of a territory, its marks and who may do what. */
  async ofToday(user: AuthenticatedUser, territoryId: string) {
    const s = await this.seen(user, territoryId);
    const today = await this.today(user.congregationId);
    const split = await this.splits.findOne({
      where: { assignmentId: s.a.id, day: today },
    });
    const marks = await this.marks.find({ where: { assignmentId: s.a.id } });
    const walked = walkedHomes(marks);
    const calls = await this.noCalls.find({
      where: { territoryId: s.t.id, congregationId: user.congregationId },
      order: { notedOn: 'DESC' },
    });
    const houses = await this.housesOf(s.t);
    const total = houses.length;
    return {
      number: s.t.number,
      locality: s.t.locality,
      geometry: s.t.geometry,
      category: s.t.category,
      assignmentId: s.a.id,
      day: today,
      houses: total,
      walked: walked.size,
      lastWalkedAt: lastOf(marks),
      mayRedo: !split || this.mayRedo(user, s, split),
      // «Все улицы пройдены — отметить участок пройденным?»: the holder and
      // the keepers may end it (assignments/:id/complete), nobody else.
      mayComplete: s.keeps || s.holds,
      split: split
        ? {
            id: split.id,
            mode: split.mode,
            start: split.start,
            parts: upgrade(split.parts).map((p) => {
              const view = partView(p, marks, walked);
              const mine = calls.filter((c) => {
                const on = partsOfAddress(upgrade(split.parts), c.address);
                return on.length === 0 || on.includes(p.n);
              });
              return {
                ...view,
                // In the app only: the address, and where it is when known.
                noCalls: mine.map((c) => ({
                  id: c.id,
                  address: c.address,
                  at: findAddress(
                    c.address,
                    p.streets.map((x) => ({ name: x.name, lines: x.lines })),
                    houses,
                  ),
                })),
              };
            }),
            leftOut: split.leftOut,
            byMe: split.madeByUserId === user.id,
          }
        : null,
    };
  }

  // ----------------------------------------------------------- dividing --

  /**
   * Divides the houses not walked yet into `parts` parts. A division of
   * today already there is kept unless `again` is asked by someone who may.
   */
  async divide(
    user: AuthenticatedUser,
    territoryId: string,
    opts: DivideOptions,
    again: boolean,
  ) {
    const s = await this.seen(user, territoryId);
    // A business territory is walked by its list, not by streets.
    if (s.t.category === 'business') {
      throw new ConflictException(
        refusal(
          'TERRITORY_SPLIT_BUSINESS',
          'A business territory is walked by its list.',
        ),
      );
    }
    const today = await this.today(user.congregationId);
    const had = await this.splits.findOne({
      where: { assignmentId: s.a.id, day: today },
    });
    if (had && !again) {
      throw new ConflictException(
        refusal('TERRITORY_SPLIT_EXISTS', 'The territory is divided today.'),
      );
    }
    if (had && !this.mayRedo(user, s, had)) {
      throw new ForbiddenException(
        refusal('TERRITORY_SPLIT_NOT_YOURS', 'Someone else divided it.'),
      );
    }
    const marks = await this.marks.find({ where: { assignmentId: s.a.id } });
    const plan = await this.plan(s.t, opts, walkedHomes(marks), today);
    const saved = await this.dataSource.transaction(async (m) => {
      if (had) await m.delete(TerritorySplit, { id: had.id });
      return m.save(
        m.create(TerritorySplit, {
          congregationId: user.congregationId,
          territoryId: s.t.id,
          assignmentId: s.a.id,
          day: today,
          parts: plan.parts,
          leftOut: plan.left,
          mode: plan.mode,
          start: plan.start,
          madeByUserId: user.id,
        }),
      );
    });
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory',
      entityId: s.t.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: {
        split: had ? 'again' : 'made',
        mode: saved.mode,
        parts: saved.parts.length,
        doors: saved.parts.map((p) => p.doors),
      },
    });
    return this.ofToday(user, territoryId);
  }

  /**
   * A division as it would be, saved nowhere (13 November 2026): to look
   * before handing out, the evening before, or to check the territories.
   * The keepers may look at any territory, given out or not.
   */
  async preview(
    user: AuthenticatedUser,
    territoryId: string,
    opts: DivideOptions,
  ) {
    const access = await this.access.of(user);
    let t: Territory;
    let walked = new Set<string>();
    if (access.seesAll && access.verified) {
      const found = await this.territories.findOne({
        where: {
          id: territoryId,
          congregationId: user.congregationId,
          archivedAt: IsNull(),
        },
      });
      if (!found) throw new NotFoundException('Territory not found');
      t = found;
      const open = await this.assignments.findOne({
        where: {
          territoryId: t.id,
          completedOn: IsNull(),
          returnedOn: IsNull(),
        },
        select: { id: true },
      });
      if (open)
        walked = walkedHomes(
          await this.marks.find({ where: { assignmentId: open.id } }),
        );
    } else {
      const s = await this.seen(user, territoryId);
      t = s.t;
      walked = walkedHomes(
        await this.marks.find({ where: { assignmentId: s.a.id } }),
      );
    }
    if (t.category === 'business') {
      throw new ConflictException(
        refusal(
          'TERRITORY_SPLIT_BUSINESS',
          'A business territory is walked by its list.',
        ),
      );
    }
    const plan = await this.plan(
      t,
      opts,
      walked,
      await this.today(user.congregationId),
    );
    return {
      mode: plan.mode,
      start: plan.start,
      startFrom: plan.startFrom,
      leftOut: plan.left,
      houses: plan.houses,
      numbered: plan.numbered,
      parts: plan.parts.map((p) => partView(p, [], new Set())),
    };
  }

  /** The division itself, from the houses not walked yet. */
  private async plan(
    t: Territory,
    opts: DivideOptions,
    walked: Set<string>,
    today: string,
  ) {
    const n = Math.max(MIN_PARTS, Math.min(MAX_PARTS, Math.floor(opts.parts)));
    const mode: SplitMode = opts.mode === 'own' ? 'own' : 'near';
    const all = await this.housesOf(t);
    const houses = all.filter((h) => !walked.has(h.id));
    if (all.length > 0 && houses.length === 0) {
      throw new ConflictException(
        refusal('TERRITORY_ALL_WALKED', 'Every street is walked.'),
      );
    }
    const streets = await this.streetsNear(t);
    // No piece heavier than a pair's share: one long street cannot hold a
    // part up (14 November 2026, the check of every territory).
    const doors = houses.reduce(
      (a, h) => a + Math.max(1, h.numbers?.length ?? 0),
      0,
    );
    const { streets: named, left } = streetsWithHouses(streets, houses, {
      maxDoors: Math.max(PIECE_FLOOR, Math.ceil(doors / n)),
    });
    if (named.length === 0) {
      throw new ConflictException(
        refusal('TERRITORY_NO_STREETS', 'The map has no streets here yet.'),
      );
    }
    // The common start: today's meeting place there, found on our own map.
    const address = await this.meetingAddress(t, today);
    const found = address ? findAddress(address, streets, all) : null;
    const smaller = (opts.smaller ?? []).filter((x) => x >= 1 && x <= n);
    const parts = splitStreets(named, n, { mode, start: found, smaller })
      .filter((p) => p.streets.length > 0)
      .map((p, i) => ({ ...p, n: i + 1 }));
    return {
      parts,
      left,
      mode,
      start: found ?? parts[0]?.start ?? null,
      startFrom: found ? ('meeting' as const) : ('middle' as const),
      houses: houses.length,
      numbered: houses.filter((h) => h.numbers?.length).length,
    };
  }

  /** The address of today's published meeting that goes to this territory. */
  private async meetingAddress(
    t: Territory,
    today: string,
  ): Promise<string | null> {
    const rows = await this.meetings.find({
      where: {
        congregationId: t.congregationId,
        territoryId: t.id,
        weekStartDate: mondayOf(today),
        cancelledAt: IsNull(),
        publishedAt: Not(IsNull()),
      },
      select: { id: true, weekStartDate: true, dayOfWeek: true, address: true },
    });
    const m = rows.find(
      (r) => addDays(r.weekStartDate, r.dayOfWeek - 1) === today,
    );
    return m?.address ?? null;
  }

  /**
   * Today's division taken away (13 November 2026): divided by mistake, or
   * the pairs did not come. Its links stop at once; the «walked» marks stay —
   * every pair saw them and the holder needs them. For whoever may divide again.
   */
  async remove(user: AuthenticatedUser, splitId: string) {
    const { split, s } = await this.splitSeen(user, splitId);
    if (!this.mayRedo(user, s, split)) {
      throw new ForbiddenException(
        refusal('TERRITORY_SPLIT_NOT_YOURS', 'Someone else divided it.'),
      );
    }
    await this.splits.delete({ id: split.id });
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory',
      entityId: s.t.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { split: 'removed' },
    });
    return this.ofToday(user, s.t.id);
  }

  /**
   * A pair done early takes a street from another pair — only from a pair
   * that has not started (nothing of its part ticked), so nobody loses a
   * street half walked. Both pairs see the street move.
   */
  async take(
    user: AuthenticatedUser,
    splitId: string,
    key: string,
    to: number,
  ) {
    const { split, s } = await this.splitSeen(user, splitId);
    await this.takeInto(split, key, to);
    return this.ofToday(user, s.t.id);
  }

  private async takeInto(split: TerritorySplit, key: string, to: number) {
    const parts = upgrade(split.parts);
    const from = parts.find((p) => p.streets.some((x) => x.key === key));
    const dest = parts.find((p) => p.n === to);
    if (!from || !dest) throw new NotFoundException('Street not found');
    if (from.n === dest.n) return;
    const marks = await this.marks.find({
      where: { assignmentId: split.assignmentId },
    });
    const walked = walkedHomes(marks);
    const started = from.streets.some((x) =>
      x.homes.some((h) => walked.has(h)),
    );
    if (started) {
      throw new ConflictException(
        refusal('TERRITORY_PART_STARTED', 'That pair has started its streets.'),
      );
    }
    const street = from.streets.find((x) => x.key === key)!;
    split.parts = parts.map((p) =>
      p.n === from.n
        ? keep(
            p,
            partOf(
              p.n,
              p.streets.filter((x) => x.key !== key),
              split.start,
            ),
          )
        : p.n === dest.n
          ? keep(p, partOf(p.n, [...p.streets, street], split.start))
          : p,
    );
    await this.splits.save(split);
  }

  /** One street (or piece) to another part: by hand, after dividing. */
  async move(
    user: AuthenticatedUser,
    splitId: string,
    key: string,
    to: number,
  ) {
    const { split, s } = await this.splitSeen(user, splitId);
    if (!this.mayRedo(user, s, split)) {
      throw new ForbiddenException(
        refusal('TERRITORY_SPLIT_NOT_YOURS', 'Someone else divided it.'),
      );
    }
    const parts = upgrade(split.parts);
    const from = parts.find((p) => p.streets.some((x) => x.key === key));
    const dest = parts.find((p) => p.n === to);
    if (!from || !dest) throw new NotFoundException('Street not found');
    if (from.n !== dest.n) {
      const street = from.streets.find((x) => x.key === key)!;
      split.parts = parts.map((p) =>
        p.n === from.n
          ? keep(
              p,
              partOf(
                p.n,
                p.streets.filter((x) => x.key !== key),
                split.start,
              ),
            )
          : p.n === dest.n
            ? keep(p, partOf(p.n, [...p.streets, street], split.start))
            : p,
      );
      await this.splits.save(split);
    }
    return this.ofToday(user, s.t.id);
  }

  // ------------------------------------------------------------ marking --

  async mark(
    user: AuthenticatedUser,
    splitId: string,
    key: string,
    walked: boolean,
  ) {
    const { split, s } = await this.splitSeen(user, splitId);
    await this.setMark(split, key, walked);
    return this.ofToday(user, s.t.id);
  }

  private async setMark(split: TerritorySplit, key: string, walked: boolean) {
    const street = upgrade(split.parts)
      .flatMap((p) => p.streets)
      .find((x) => x.key === key);
    if (!street) throw new NotFoundException('Street not found');
    const had = await this.marks.findOne({
      where: { assignmentId: split.assignmentId, streetKey: key },
    });
    if (!walked) {
      // Undo a wrong tap: only this street's houses, not an earlier
      // outing's on a street of the same name.
      if (!had) return;
      const own = new Set(street.homes);
      const rest = had.homes.filter((h) => !own.has(h));
      if (rest.length) await this.marks.update({ id: had.id }, { homes: rest });
      else await this.marks.delete({ id: had.id });
      return;
    }
    if (had) {
      had.homes = [...new Set([...had.homes, ...street.homes])];
      await this.marks.save(had);
      return;
    }
    await this.marks.save(
      this.marks.create({
        congregationId: split.congregationId,
        assignmentId: split.assignmentId,
        streetKey: key,
        homes: street.homes,
        markedAt: new Date(),
      }),
    );
  }

  // -------------------------------------------------------------- links --

  /**
   * A link without login to one part, for the group that walks it: signed,
   * not stored, good on the day of the division only. Anyone who sees the
   * division may hand it out.
   */
  async partLink(user: AuthenticatedUser, splitId: string, n: number) {
    const { split } = await this.splitSeen(user, splitId);
    if (!split.parts.some((p) => p.n === n)) {
      throw new NotFoundException('Part not found');
    }
    const hexId = split.id.replace(/-/g, '');
    const day = split.day.replace(/-/g, '');
    return {
      path: `/p/p.${hexId}.${n}.${day}.${this.sign(hexId, n, day)}`,
      day: split.day,
    };
  }

  /** The page behind a part's link; null for every link that does not work. */
  async shared(token: string): Promise<SharedPart | null> {
    const found = await this.byToken(token);
    if (!found) return null;
    const { split, n, t, settings } = found;
    const marks = await this.marks.find({
      where: { assignmentId: split.assignmentId },
    });
    const parts = upgrade(split.parts);
    const part = parts.find((p) => p.n === n)!;
    const calls = await this.noCalls.find({
      where: { territoryId: t.id, congregationId: split.congregationId },
    });
    const noCalls = calls.filter((c) => {
      const on = partsOfAddress(parts, c.address);
      return on.length === 0 || on.includes(n);
    }).length;
    return {
      number: t.number,
      locality: t.locality,
      geometry: t.geometry,
      day: split.day,
      parts: split.parts.length,
      mode: split.mode,
      start: split.start,
      part: partView(part, marks, walkedHomes(marks)),
      // The other pairs' streets not started yet: a pair done early may take one.
      others: parts
        .filter((p) => p.n !== n)
        .map((p) => ({
          n: p.n,
          untouched: !p.streets.some((x) =>
            x.homes.some((h) => walkedHomes(marks).has(h)),
          ),
          streets: p.streets.map((x) => ({
            key: x.key,
            name: x.name,
            range: x.range,
            ranges: rangesFor(x),
            side: x.side,
            houses: x.houses,
          })),
        })),
      noCalls,
      congregationId: split.congregationId,
      mapReady: !!settings.mapBuiltAt,
    };
  }

  /** A street of another pair taken from a part's link, into that part. */
  async takeShared(token: string, key: string) {
    const found = await this.byToken(token);
    if (!found) return null;
    await this.takeInto(found.split, key, found.n);
    return this.shared(token);
  }

  /** «Walked» from a part's link: only the streets of that part. */
  async markShared(token: string, key: string, walked: boolean) {
    const found = await this.byToken(token);
    if (!found) return null;
    const part = upgrade(found.split.parts).find((p) => p.n === found.n)!;
    if (!part.streets.some((x) => x.key === key)) return null;
    await this.setMark(found.split, key, walked);
    return this.shared(token);
  }

  private async byToken(token: string) {
    const m = PART_RE.exec(token);
    if (!m) return null;
    const [, hexId, nText, day, sig] = m;
    const n = Number(nText);
    const want = Buffer.from(this.sign(hexId, n, day));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const split = await this.splits.findOne({ where: { id: dashes(hexId) } });
    if (!split || !split.parts.some((p) => p.n === n)) return null;
    // The day of the division only: in the congregation's own time.
    if (split.day.replace(/-/g, '') !== day) return null;
    if (split.day !== (await this.today(split.congregationId))) return null;
    const a = await this.assignments.findOne({
      where: { id: split.assignmentId },
    });
    if (!a || a.completedOn || a.returnedOn) return null;
    const t = await this.territories.findOne({
      where: {
        id: split.territoryId,
        congregationId: split.congregationId,
        archivedAt: IsNull(),
      },
    });
    if (!t) return null;
    const settings = await this.settings.findOne({
      where: { congregationId: split.congregationId },
    });
    if (!settings?.verifiedAt) return null;
    return { split, n, t, settings };
  }

  private sign(hexId: string, n: number, day: string): string {
    const secret = this.config.get<string>('jwt.secret');
    if (!secret) throw new Error('jwt.secret is not configured');
    return createHmac('sha256', secret)
      .update(`territory-part|${hexId}|${n}|${day}`)
      .digest('hex')
      .slice(0, 32);
  }

  // ------------------------------------------------------------- inside --

  /**
   * The territory and its open assignment, if the user sees it today: the
   * whole section, or as its holder, his group, a meeting going there.
   */
  private async seen(user: AuthenticatedUser, territoryId: string) {
    const access = await this.access.of(user);
    const t = await this.territories.findOne({
      where: {
        id: territoryId,
        congregationId: user.congregationId,
        archivedAt: IsNull(),
      },
    });
    if (!t) throw new NotFoundException('Territory not found');
    const me = await this.access.person(user);
    let meetingId: string | null = null;
    let assignmentId: string | null = null;
    if (access.seesAll && access.verified) {
      const open = await this.assignments.findOne({
        where: {
          territoryId: t.id,
          congregationId: user.congregationId,
          completedOn: IsNull(),
          returnedOn: IsNull(),
        },
        select: { id: true },
      });
      assignmentId = open?.id ?? null;
    }
    const seen = (await this.given.mine(user)).find((x) => x.id === t.id);
    if (seen) {
      assignmentId = seen.assignment.id;
      meetingId = seen.meeting?.id ?? null;
    } else if (!(access.seesAll && access.verified)) {
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Not your territory.', {
          responsibilities: [],
        }),
      );
    }
    if (!assignmentId) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_GIVEN', 'The territory is not given out.'),
      );
    }
    const a = await this.assignments.findOneOrFail({
      where: { id: assignmentId },
    });
    let conducts = false;
    if (meetingId && me.publisherId) {
      const m = await this.meetings.findOne({
        where: { id: meetingId },
        select: { id: true, conductorPublisherId: true },
      });
      conducts = m?.conductorPublisherId === me.publisherId;
    }
    return {
      t,
      a,
      keeps: access.keeps && access.verified,
      holds: !!me.publisherId && a.publisherId === me.publisherId,
      conducts,
    };
  }

  private async splitSeen(user: AuthenticatedUser, splitId: string) {
    const split = await this.splits.findOne({
      where: { id: splitId, congregationId: user.congregationId },
    });
    if (!split) throw new NotFoundException('Division not found');
    const s = await this.seen(user, split.territoryId);
    // A division of another day, or of an assignment since ended, is gone.
    if (
      split.assignmentId !== s.a.id ||
      split.day !== (await this.today(user.congregationId))
    ) {
      throw new NotFoundException('Division not found');
    }
    return { split, s };
  }

  private mayRedo(
    user: AuthenticatedUser,
    s: { keeps: boolean; holds: boolean; conducts: boolean },
    split: TerritorySplit,
  ): boolean {
    return s.keeps || s.holds || s.conducts || split.madeByUserId === user.id;
  }

  /** The houses of the register inside the territory. */
  private async housesOf(t: Territory): Promise<House[]> {
    const [x0, y0, x1, y1] = boxOf(t.geometry);
    const rows = await this.dataSource.query<
      { osm_id: string; lon: number; lat: number; numbers: string | null }[]
    >(
      `SELECT osm_id, lon, lat, numbers FROM map_houses
        WHERE congregation_id = $1 AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
      [t.congregationId, y0, y1, x0, x1],
    );
    return rows
      .map((r) => ({
        id: String(r.osm_id),
        at: [r.lon, r.lat] as Pt,
        numbers: r.numbers ? r.numbers.split(';').filter(Boolean) : [],
      }))
      .filter((h) => pointInside(h.at, t.geometry));
  }

  /** The named streets that may serve the territory's houses. */
  private async streetsNear(t: Territory) {
    const [x0, y0, x1, y1] = boxOf(t.geometry);
    // FAR_M round the box, in degrees (generously: a degree east is shorter).
    const dy = FAR_M / 110_540;
    const dx = FAR_M / (111_320 * Math.cos((y0 * Math.PI) / 180));
    return this.dataSource.query<
      { name: string; kind: string; lines: Pt[][] }[]
    >(
      `SELECT name, kind, lines FROM map_streets
        WHERE congregation_id = $1
          AND east >= $2 AND west <= $3 AND north >= $4 AND south <= $5`,
      [t.congregationId, x0 - dx, x1 + dx, y0 - dy, y1 + dy],
    );
  }

  private async today(congregationId: string): Promise<string> {
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone);
  }
}

/**
 * The odd and even ranges of a street of a plan; a division saved before
 * 14 November 2026 has none, and gets them from its numbers.
 */
function rangesFor(x: PlanStreet): PlanStreet['ranges'] {
  if (x.ranges) return x.ranges;
  const nums = x.nums ?? [];
  return nums.length && nums.length * 2 >= x.houses
    ? rangesOf(nums)
    : { odd: null, even: null };
}

function walkedHomes(marks: TerritoryStreetMark[]): Set<string> {
  return new Set(marks.flatMap((m) => m.homes));
}

function lastOf(marks: TerritoryStreetMark[]): string | null {
  const t = marks.map((m) => m.markedAt.getTime());
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
}

/**
 * A division saved before 13 November 2026 evening holds parts of the first
 * shape: no doors, sides, ranges or dots. Read with plain defaults.
 */
export function upgrade(parts: PlanPart[]): PlanPart[] {
  return parts.map((p) => ({
    ...p,
    doors: p.doors ?? p.houses,
    streets: p.streets.map((x) => ({
      ...x,
      side: x.side ?? null,
      range: x.range ?? null,
      ranges: rangesFor(x),
      doors: x.doors ?? x.houses,
      dots: x.dots ?? [],
      nums: x.nums ?? [],
    })),
  }));
}

/** A part recounted after a street moved, keeping what was asked of it. */
function keep(was: PlanPart, now: PlanPart): PlanPart {
  return was.smaller ? { ...now, smaller: true } : now;
}

/**
 * A part as shown: a street counts as walked when every house of it is in a
 * mark — so a mark from an earlier day's division still counts.
 */
function partView(
  p: PlanPart,
  marks: TerritoryStreetMark[],
  walked: Set<string>,
): PartView {
  const streets = p.streets.map((x) => {
    const done = x.homes.length > 0 && x.homes.every((h) => walked.has(h));
    const at = done
      ? marks
          .filter((m) => x.homes.some((h) => m.homes.includes(h)))
          .map((m) => m.markedAt.getTime())
      : [];
    return {
      key: x.key,
      name: x.name,
      from: x.from,
      to: x.to,
      piece: x.piece,
      pieces: x.pieces,
      side: x.side ?? null,
      range: x.range ?? null,
      ranges: rangesFor(x),
      houses: x.houses,
      doors: x.doors ?? x.houses,
      lines: x.lines,
      dots: x.dots ?? [],
      walkedAt: at.length ? new Date(Math.max(...at)).toISOString() : null,
    };
  });
  return {
    n: p.n,
    houses: p.houses,
    doors: p.doors ?? p.houses,
    start: p.start,
    smaller: !!p.smaller,
    streets,
    untouched: !p.streets.some((x) => x.homes.some((h) => walked.has(h))),
  };
}
