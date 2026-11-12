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
import { TerritoryShape } from '../entities/territory-shape.entity';
import { TerritoryBoundary } from '../entities/territory-boundary.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import {
  boxAround,
  houseShift,
  type HouseShift,
  type HousePoint,
} from './houses';
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
    return this.apply(user, this.changesOf(id, dto), 'edit');
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
    return this.apply(
      user,
      batch.map((s) => ({
        id: s.territoryId,
        geometry: s.geometry,
        updatedAt: null,
      })),
      'undo',
    );
  }

  private async apply(
    user: AuthenticatedUser,
    changes: Change[],
    reason: 'edit' | 'undo',
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
      for (const c of changed) {
        const t = rows.get(c.id)!;
        await m.save(
          m.create(TerritoryShape, {
            congregationId: tenantId,
            territoryId: t.id,
            geometry: t.geometry,
            reason,
            editId,
            createdByUserId: user.id,
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
      return { report, changed, rows, after };
    });
    const numbers = result.changed.map((c) => result.rows.get(c.id)!.number);
    for (const c of result.changed) {
      const t = result.rows.get(c.id)!;
      const r = result.report.territories.find((x) => x.id === c.id)!;
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
        },
      });
    }
    return {
      ...result.report,
      saved: result.changed.length,
      updated: result.after.map((t) => ({
        id: t.id,
        updatedAt: t.updatedAt,
      })),
    };
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
   * The houses of the register round the given outlines, or null while the
   * register has not been built for this congregation.
   */
  private async housesAround(
    m: EntityManager,
    tenantId: string,
    shapes: TerritoryGeometry[],
  ): Promise<HousePoint[] | null> {
    const settings = await m.findOne(TerritorySettings, {
      where: { congregationId: tenantId },
    });
    if (!settings?.housesBuiltAt) return null;
    const [x0, y0, x1, y1] = boxAround(shapes);
    const rows = await m.query<{ lon: number; lat: number }[]>(
      `SELECT lon, lat FROM map_houses
        WHERE congregation_id = $1 AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
      [tenantId, y0, y1, x0, x1],
    );
    return rows.map((r) => [r.lon, r.lat]);
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
    const houses = await this.housesAround(m, tenantId, [
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
