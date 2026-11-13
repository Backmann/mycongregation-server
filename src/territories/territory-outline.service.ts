import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { Territory, TerritoryGeometry } from '../entities/territory.entity';
import {
  TerritoryShape,
  type ReshapeDetail,
} from '../entities/territory-shape.entity';
import { TerritoryNoCall } from '../entities/territory-no-call.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { todayIn } from '../common/congregation-clock';
import { addressKey } from './territory-no-calls.service';
import { outlineChangedWords } from './territory-words';
import { TerritoryBoundary } from '../entities/territory-boundary.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import { housesAround, houseShift, type HouseShift } from './houses';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { TerritoryAccessService } from './territory-access.service';
import {
  areaShareOutside,
  boxOf,
  boxesMeet,
  checkGeometry,
  GeometryError,
  overlapShare,
} from './geometry';
import type { OutlineDto } from './dto/outline.dto';

/**
 * How much of a territory somebody holds may change hands while he has it
 * (12 November 2026): a small correction is fine, the holder is warned; more
 * than a tenth of his ground going elsewhere waits until it comes back.
 */
export const HELD_SHARE_LIMIT = 0.1;

/** About 25 km: a town and its villages, not the whole register at once. */
const MAX_HOUSES_BOX = 0.35;
const MAX_HOUSES = 60000;

/** Ground two territories may share before it counts as lying over. */
const OVERLAP_LIMIT = 0.01;

const pct = (share: number): number => Math.round(share * 100);

interface NoCallMove {
  id: string;
  to: string;
  /** Undo: only if it is still in this territory. */
  onlyFrom?: string | null;
}

interface Change {
  id: string;
  geometry: TerritoryGeometry;
  /** Null: no check (undo puts back what was there). */
  updatedAt: string | null;
}

/** What a change would do, for the editor's panel and for the refusal. */
export interface OutlineReport {
  territories: {
    id: string;
    number: string;
    held: boolean;
    /** Percent of its ground that goes elsewhere. */
    leaving: number;
    /** Percent of its new ground that was not its own. */
    gaining: number;
    /**
     * Houses of the register (12 November 2026): in it before, leaving,
     * coming. Null until the register is built from the map.
     */
    houses: HouseShift | null;
    /**
     * Held, and more than a tenth goes elsewhere — counted in houses when
     * the register has some in it, else in ground.
     */
    /** The share (percent) the 10 % rule looks at: of its houses, else of its ground. */
    heldShare: number;
    tooMuch: boolean;
    /** Percent of its new ground outside the congregation's boundary. */
    outsideBoundary: number;
  }[];
  /** New overlaps only: those there before are the checks screen's. */
  overlaps: [string, string][];
}

/**
 * Boundaries drawn again by hand (12 November 2026). A border shared by two
 * neighbours moves in both at once, so a change carries the territory and
 * the neighbours it touched; their earlier outlines are kept together and
 * «undo» puts them all back. Refused: someone else changed one of them in
 * the meantime, a new overlap with a territory of the same kind, more than a
 * tenth of a held territory going elsewhere.
 */
@Injectable()
export class TerritoryOutlineService {
  constructor(
    private readonly access: TerritoryAccessService,
    private readonly audit: AuditLogService,
    private readonly dataSource: DataSource,
    @InjectRepository(TerritoryShape)
    private readonly shapes: Repository<TerritoryShape>,
    private readonly notifications: NotificationsService,
  ) {}

  private async mustKeepOpen(user: AuthenticatedUser): Promise<void> {
    const a = await this.access.mustKeep(user);
    if (!a.verified) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_OPEN', 'The records are not confirmed yet.'),
      );
    }
  }

  private changesOf(id: string, dto: OutlineDto): Change[] {
    const read = (raw: unknown, what: string) => {
      try {
        return checkGeometry(raw);
      } catch (e) {
        if (e instanceof GeometryError) {
          throw new ConflictException(
            refusal('TERRITORY_GEOMETRY', `${what}: ${e.message}`, {
              number: what,
            }),
          );
        }
        throw e;
      }
    };
    const out: Change[] = [
      { id, geometry: read(dto.geometry, id), updatedAt: dto.updatedAt },
    ];
    for (const n of dto.neighbours ?? []) {
      if (out.some((c) => c.id === n.id)) continue;
      out.push({
        id: n.id,
        geometry: read(n.geometry, n.id),
        updatedAt: n.updatedAt,
      });
    }
    return out;
  }

  /** What the change would do, without saving it. */
  async check(user: AuthenticatedUser, id: string, dto: OutlineDto) {
    await this.mustKeepOpen(user);
    const changes = this.changesOf(id, dto);
    return this.dataSource.transaction(async (m) => {
      const { report } = await this.assess(m, user.congregationId, changes);
      return report;
    });
  }

  async save(user: AuthenticatedUser, id: string, dto: OutlineDto) {
    await this.mustKeepOpen(user);
    return this.apply(
      user,
      this.changesOf(id, dto),
      'edit',
      (dto.noCallMoves ?? []).map((n) => ({ id: n.id, to: n.to })),
    );
  }

  /**
   * Puts back the outlines from before the territory's last change by hand,
   * the neighbours' too. Only while none of them changed since.
   */
  async undo(user: AuthenticatedUser, id: string) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const latest = await this.shapes.findOne({
      where: { territoryId: id, congregationId: tenantId },
      order: { createdAt: 'DESC' },
    });
    if (!latest || latest.reason !== 'edit' || !latest.editId) {
      throw new ConflictException(
        refusal('TERRITORY_NOTHING_TO_UNDO', 'No change by hand to undo.'),
      );
    }
    const batch = await this.shapes.find({
      where: { editId: latest.editId, congregationId: tenantId },
    });
    for (const s of batch) {
      const last = await this.shapes.findOne({
        where: { territoryId: s.territoryId, congregationId: tenantId },
        order: { createdAt: 'DESC' },
      });
      if (last?.editId !== latest.editId) {
        throw new ConflictException(
          refusal('TERRITORY_CHANGED', 'A neighbour changed since.'),
        );
      }
    }
    // The addresses moved with that change go back where they were — those
    // still where the change put them.
    const back = batch.flatMap((s) =>
      (s.detail?.noCalls ?? []).map((n) => ({
        id: n.id,
        to: n.from,
        onlyFrom: n.to ?? null,
      })),
    );
    return this.apply(
      user,
      batch.map((s) => ({
        id: s.territoryId,
        geometry: s.geometry,
        updatedAt: null,
      })),
      'undo',
      back,
    );
  }

  private async apply(
    user: AuthenticatedUser,
    changes: Change[],
    reason: 'edit' | 'undo',
    moves: NoCallMove[] = [],
  ) {
    const tenantId = user.congregationId;
    const editId = randomUUID();
    const result = await this.dataSource.transaction(async (m) => {
      const { report, rows } = await this.assess(m, tenantId, changes, true);
      for (const c of changes) {
        const t = rows.get(c.id)!;
        if (
          c.updatedAt &&
          t.updatedAt.toISOString() !== new Date(c.updatedAt).toISOString()
        ) {
          throw new ConflictException(
            refusal(
              'TERRITORY_CHANGED',
              `${t.number} changed in the meantime.`,
              { number: t.number },
            ),
          );
        }
      }
      const tooMuch = report.territories.find((r) => r.tooMuch);
      if (tooMuch) {
        throw new ConflictException(
          refusal(
            'TERRITORY_HELD_SHAPE',
            `${tooMuch.number} is held; ${tooMuch.heldShare}% would go elsewhere.`,
            { number: tooMuch.number, share: tooMuch.heldShare },
          ),
        );
      }
      if (report.overlaps.length > 0) {
        const [a, b] = report.overlaps[0];
        throw new ConflictException(
          refusal('TERRITORY_OVERLAP', `${a} would lie over ${b}.`, {
            number: a,
            other: b,
          }),
        );
      }
      const changed = changes.filter(
        (c) =>
          JSON.stringify(rows.get(c.id)!.geometry) !==
          JSON.stringify(c.geometry),
      );
      const moved = await this.moveNoCalls(
        m,
        tenantId,
        changed.map((c) => c.id),
        moves,
        reason === 'undo',
      );
      for (const [i, c] of changed.entries()) {
        const t = rows.get(c.id)!;
        // The first outline kept carries the moves, for an undo to reverse.
        const detail: ReshapeDetail | null =
          i === 0 && reason === 'edit' && moved.length > 0
            ? {
                noCalls: moved.map((n) => ({
                  id: n.id,
                  from: n.from,
                  to: n.to,
                })),
              }
            : null;
        await m.save(
          m.create(TerritoryShape, {
            congregationId: tenantId,
            territoryId: t.id,
            geometry: t.geometry,
            reason,
            editId,
            createdByUserId: user.id,
            detail,
          }),
        );
        await m.update(
          Territory,
          { id: t.id, congregationId: tenantId },
          { geometry: c.geometry },
        );
      }
      const after = await m.find(Territory, {
        where: { id: In(changes.map((c) => c.id)) },
        select: { id: true, updatedAt: true },
      });
      return { report, changed, rows, after, moved };
    });
    const numberOf = (id: string) => result.rows.get(id)?.number ?? '';
    for (const n of result.moved) {
      await this.audit.logFact({
        tenantId,
        entityType: 'territory_no_call',
        entityId: n.id,
        action: 'UPDATE',
        actorUserId: user.id,
        detail: {
          territory: numberOf(n.from),
          changed: ['territory'],
          movedTo: numberOf(n.to),
        },
      });
    }
    const told = await this.tellHolders(
      tenantId,
      result.report.territories.filter((r) =>
        result.changed.some((c) => c.id === r.id),
      ),
    );
    const numbers = result.changed.map((c) => result.rows.get(c.id)!.number);
    for (const c of result.changed) {
      const t = result.rows.get(c.id)!;
      const r = result.report.territories.find((x) => x.id === c.id)!;
      const out = result.moved.filter((n) => n.from === t.id).length;
      await this.audit.logFact({
        tenantId,
        entityType: 'territory',
        entityId: t.id,
        action: 'UPDATE',
        actorUserId: user.id,
        detail: {
          outline: reason,
          number: t.number,
          with: numbers.filter((n) => n !== t.number),
          leaving: r.leaving,
          gaining: r.gaining,
          ...(out > 0 ? { noCallsMoved: out } : {}),
          ...(told.includes(t.id) ? { holderTold: true } : {}),
        },
      });
    }
    return {
      ...result.report,
      saved: result.changed.length,
      noCallsMoved: result.moved.length,
      holdersTold: told.map(numberOf),
      updated: result.after.map((t) => ({
        id: t.id,
        updatedAt: t.updatedAt,
      })),
    };
  }

  /**
   * «Не посещать» addresses the new border puts in another of the changed
   * territories (13 November 2026), moved in the same transaction as the
   * outlines: a border reset or never saved leaves them where they were.
   * Only between territories this change touches. On undo the way back is
   * taken by those still where the change put them; the rest stay.
   */
  private async moveNoCalls(
    m: EntityManager,
    tenantId: string,
    changedIds: string[],
    moves: NoCallMove[],
    lenient: boolean,
  ): Promise<{ id: string; from: string; to: string }[]> {
    if (moves.length === 0) return [];
    const rows = await m.find(TerritoryNoCall, {
      where: { id: In(moves.map((n) => n.id)), congregationId: tenantId },
    });
    const byId = new Map(rows.map((n) => [n.id, n]));
    const done: { id: string; from: string; to: string }[] = [];
    const refuse = (why: string) =>
      new ConflictException(refusal('TERRITORY_NO_CALL_MOVE', why));
    for (const mv of moves) {
      const n = byId.get(mv.id);
      if (lenient) {
        if (!n || n.territoryId === mv.to) continue;
        if (mv.onlyFrom && n.territoryId !== mv.onlyFrom) continue;
      } else {
        if (!n) throw refuse('No such address.');
        if (n.territoryId === mv.to) continue;
        if (
          !changedIds.includes(n.territoryId) ||
          !changedIds.includes(mv.to)
        ) {
          throw refuse('Only between the territories whose border moved.');
        }
      }
      const there = await m.find(TerritoryNoCall, {
        where: { territoryId: mv.to, congregationId: tenantId },
      });
      const key = addressKey(n.address);
      if (there.some((o) => o.id !== n.id && addressKey(o.address) === key)) {
        if (lenient) continue;
        throw new ConflictException(
          refusal('TERRITORY_NO_CALL_TWICE', 'This address is already noted.'),
        );
      }
      done.push({ id: n.id, from: n.territoryId, to: mv.to });
      await m.update(
        TerritoryNoCall,
        { id: n.id, congregationId: tenantId },
        { territoryId: mv.to },
      );
      n.territoryId = mv.to;
    }
    return done;
  }

  /**
   * The holder of a territory whose border moved hears of it (13 November
   * 2026): his map in the app is already the new one, a paper map is not.
   * Only for a change he would notice — a whole per cent of ground or a
   * house — and once a day per territory, so a change and its undo on the
   * same day are one message. A group's territory has no one person to tell.
   * Returns the territories whose holder was told.
   */
  private async tellHolders(
    tenantId: string,
    changed: OutlineReport['territories'],
  ): Promise<string[]> {
    const noticed = changed.filter(
      (r) =>
        r.held &&
        (r.leaving >= 1 ||
          r.gaining >= 1 ||
          (r.houses !== null && (r.houses.leaving > 0 || r.houses.coming > 0))),
    );
    if (noticed.length === 0) return [];
    const m = this.dataSource.manager;
    const open = await m.find(TerritoryAssignment, {
      where: {
        territoryId: In(noticed.map((r) => r.id)),
        congregationId: tenantId,
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
      select: { territoryId: true, publisherId: true },
    });
    const people = await m.find(Publisher, {
      where: {
        id: In(open.map((a) => a.publisherId).filter((x): x is string => !!x)),
        congregationId: tenantId,
      },
      select: { id: true, userId: true },
    });
    const userOf = new Map(people.map((p) => [p.id, p.userId]));
    const c = await m.findOne(Congregation, {
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });
    const today = todayIn(new Date(), c?.timezone);
    const told: string[] = [];
    for (const r of noticed) {
      const a = open.find((x) => x.territoryId === r.id);
      const userId = a?.publisherId ? userOf.get(a.publisherId) : null;
      if (!userId) continue;
      await this.notifications.notify({
        tenantId,
        userIds: [userId],
        kind: 'territory_outline_changed',
        key: `territory-outline:${r.id}:${today}`,
        text: (lang) => outlineChangedWords(r.number, lang),
        data: { type: 'territory', territoryId: r.id },
      });
      told.push(r.id);
    }
    return told;
  }

  /**
   * The houses of the register in a box (12 November 2026), for the editor:
   * splitting by houses, houses changing hands. The box is
   * «west,south,east,north» and at most about 25 km across.
   */
  async housesIn(user: AuthenticatedUser, boxText: string | undefined) {
    await this.mustKeepOpen(user);
    const box = (boxText ?? '').split(',').map(Number);
    const [x0, y0, x1, y1] = box;
    if (
      box.length !== 4 ||
      box.some((v) => !Number.isFinite(v)) ||
      x1 <= x0 ||
      y1 <= y0 ||
      x1 - x0 > MAX_HOUSES_BOX ||
      y1 - y0 > MAX_HOUSES_BOX
    ) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'box: west,south,east,north', {
          field: 'box',
        }),
      );
    }
    const settings = await this.dataSource.manager.findOne(TerritorySettings, {
      where: { congregationId: user.congregationId },
    });
    if (!settings?.housesBuiltAt) return { builtAt: null, houses: [] };
    const rows = await this.dataSource.query<{ lon: number; lat: number }[]>(
      `SELECT lon, lat FROM map_houses
        WHERE congregation_id = $1 AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5
        LIMIT ${MAX_HOUSES}`,
      [user.congregationId, y0, y1, x0, x1],
    );
    return {
      builtAt: settings.housesBuiltAt,
      // Six decimals: ten centimetres, and a third shorter on the wire.
      houses: rows.map((r) => [
        Math.round(r.lon * 1e6) / 1e6,
        Math.round(r.lat * 1e6) / 1e6,
      ]),
    };
  }

  /**
   * Reads the territories involved (locked when saving), and works out what
   * the change does. Neighbours must be of the same kind as the territory:
   * a business territory lies over residential streets by design.
   */
  private async assess(
    m: EntityManager,
    tenantId: string,
    changes: Change[],
    lock = false,
  ): Promise<{ report: OutlineReport; rows: Map<string, Territory> }> {
    const ids = changes.map((c) => c.id);
    const found = await m.find(Territory, {
      where: { id: In(ids), congregationId: tenantId, archivedAt: IsNull() },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    const rows = new Map(found.map((t) => [t.id, t]));
    const main = rows.get(changes[0].id);
    if (!main) throw new NotFoundException('Territory not found');
    for (const c of changes.slice(1)) {
      const t = rows.get(c.id);
      if (!t || t.category !== main.category) {
        throw new ConflictException(
          refusal(
            'TERRITORY_NOT_NEIGHBOUR',
            'Only territories of the same kind in use share a border.',
          ),
        );
      }
    }
    const held = new Set(
      (
        await m.find(TerritoryAssignment, {
          where: {
            territoryId: In(ids),
            congregationId: tenantId,
            completedOn: IsNull(),
            returnedOn: IsNull(),
          },
          select: { territoryId: true },
        })
      ).map((a) => a.territoryId),
    );
    const boundary = await m.findOne(TerritoryBoundary, {
      where: { congregationId: tenantId },
      order: { createdAt: 'DESC' },
    });
    const houses = await housesAround(m, tenantId, [
      ...changes.map((c) => c.geometry),
      ...changes.map((c) => rows.get(c.id)!.geometry),
    ]);
    const territories = changes.map((c) => {
      const t = rows.get(c.id)!;
      const leaving = areaShareOutside(t.geometry, c.geometry);
      const isHeld = held.has(t.id);
      const shift = houses ? houseShift(t.geometry, c.geometry, houses) : null;
      // The decision of 12 November 2026 is about buildings; ground only
      // where the register has none (no map yet, or fields).
      const share =
        shift && shift.before > 0 ? shift.leaving / shift.before : leaving;
      return {
        id: t.id,
        number: t.number,
        held: isHeld,
        leaving: pct(leaving),
        gaining: pct(areaShareOutside(c.geometry, t.geometry)),
        houses: shift,
        heldShare: pct(share),
        tooMuch: isHeld && share > HELD_SHARE_LIMIT,
        outsideBoundary: boundary
          ? pct(areaShareOutside(c.geometry, boundary.geometry))
          : 0,
      };
    });

    // New overlaps with the others of the same kind, and among the changed.
    const others = await m.find(Territory, {
      where: {
        congregationId: tenantId,
        archivedAt: IsNull(),
        category: main.category,
      },
      select: { id: true, number: true, geometry: true },
    });
    const newOf = new Map(changes.map((c) => [c.id, c.geometry]));
    const pairs: [string, string][] = [];
    for (const c of changes) {
      const box = boxOf(c.geometry);
      for (const o of others) {
        if (o.id === c.id) continue;
        // A pair of two changed ones is looked at once.
        if (newOf.has(o.id) && o.id < c.id) continue;
        const oNew = newOf.get(o.id) ?? o.geometry;
        if (!boxesMeet(box, boxOf(oNew))) continue;
        const now = overlapShare(c.geometry, oNew);
        if (now < OVERLAP_LIMIT) continue;
        // An overlap there before is the checks screen's; only a grown one
        // is this change's doing.
        const before = overlapShare(rows.get(c.id)!.geometry, o.geometry);
        if (now <= before + OVERLAP_LIMIT / 2) continue;
        pairs.push([rows.get(c.id)!.number, o.number]);
      }
    }
    return { report: { territories, overlaps: pairs }, rows };
  }
}
