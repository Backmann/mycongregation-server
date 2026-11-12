import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import {
  Territory,
  TerritoryGeometry,
  type TerritoryCategory,
} from '../entities/territory.entity';
import {
  TerritoryShape,
  type ReshapeDetail,
} from '../entities/territory-shape.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { TerritoryNoCall } from '../entities/territory-no-call.entity';
import { TerritoryBoundary } from '../entities/territory-boundary.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { todayIn } from '../common/congregation-clock';
import { Congregation } from '../entities/congregation.entity';
import { TerritoryAccessService } from './territory-access.service';
import {
  areaShareOutside,
  boxOf,
  boxesMeet,
  checkGeometry,
  GeometryError,
  overlapShare,
} from './geometry';
import { housesAround, housesIn } from './houses';
import {
  areaM2,
  joinTwo,
  nextNumber,
  ReshapeError,
  splitByLine,
} from './reshape';
import { addressKey } from './territory-no-calls.service';
import type { CreateTerritoryDto, MergeDto, SplitDto } from './dto/reshape.dto';

const norm = (n: string): string => n.trim().toLowerCase();

/** A line as the editor sends it: [lon, lat] numbers on the map. */
function lineOf(raw: number[][]): [number, number][] {
  const ok = raw.every(
    (p) =>
      Array.isArray(p) &&
      p.length >= 2 &&
      Number.isFinite(Number(p[0])) &&
      Number.isFinite(Number(p[1])) &&
      Math.abs(Number(p[0])) <= 180 &&
      Math.abs(Number(p[1])) <= 90,
  );
  if (!ok) {
    throw new ConflictException(
      refusal('TERRITORY_LINE_BAD', 'The line is [lon, lat] points.'),
    );
  }
  return raw.map((p) => [Number(p[0]), Number(p[1])]);
}
const PG_UNIQUE_VIOLATION = '23505';
/** Ground two territories may share before it counts as lying over. */
const OVERLAP_LIMIT = 0.01;

const LINE_CODES: Record<ReshapeError['code'], string> = {
  LINE_SHORT: 'TERRITORY_LINE_BAD',
  LINE_CROSSES_ITSELF: 'TERRITORY_LINE_BAD',
  LINE_NOT_THROUGH: 'TERRITORY_LINE_NOT_THROUGH',
  LINE_MANY_PIECES: 'TERRITORY_LINE_MANY',
  NOT_TOUCHING: 'TERRITORY_NOT_TOUCHING',
  SHAPE_WITH_HOLE: 'TERRITORY_JOIN_HOLE',
};

/**
 * Cutting a territory in two, joining two into one, making a new one
 * (12 November 2026, the editor's step 3). Only free territories are cut or
 * joined: the holder's territory never changes into another under his hand.
 *
 * A cut keeps the number and the S-13 history on the part the territory
 * servant chooses; the other part gets a new number and the date it was
 * last worked. A join keeps the number he chooses and counts as last worked
 * on the older of the two dates; the other territory goes out of use with
 * its S-13 lines kept. Each can be undone while nothing happened since.
 */
@Injectable()
export class TerritoryReshapeService {
  constructor(
    private readonly access: TerritoryAccessService,
    private readonly audit: AuditLogService,
    private readonly dataSource: DataSource,
  ) {}

  private async mustKeepOpen(user: AuthenticatedUser): Promise<void> {
    const a = await this.access.mustKeep(user);
    if (!a.verified) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_OPEN', 'The records are not confirmed yet.'),
      );
    }
  }

  private shapeRefused(e: unknown): never {
    if (e instanceof ReshapeError) {
      throw new ConflictException(
        refusal(LINE_CODES[e.code] as 'TERRITORY_LINE_BAD', e.message),
      );
    }
    if (e instanceof GeometryError) {
      throw new ConflictException(
        refusal('TERRITORY_GEOMETRY', e.message, { number: '' }),
      );
    }
    throw e;
  }

  private async active(
    m: EntityManager,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<Territory> {
    const t = await m.findOne(Territory, {
      where: { id, congregationId: tenantId, archivedAt: IsNull() },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!t) throw new NotFoundException('Territory not found');
    return t;
  }

  private async mustBeFree(
    m: EntityManager,
    tenantId: string,
    t: Territory,
  ): Promise<void> {
    const held = await m.count(TerritoryAssignment, {
      where: {
        territoryId: t.id,
        congregationId: tenantId,
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
    });
    if (held > 0) {
      throw new ConflictException(
        refusal('TERRITORY_HELD', `${t.number} is held.`, {
          number: t.number,
        }),
      );
    }
  }

  private mustBeAsRead(t: Territory, updatedAt: string | undefined): void {
    if (
      updatedAt &&
      t.updatedAt.toISOString() !== new Date(updatedAt).toISOString()
    ) {
      throw new ConflictException(
        refusal('TERRITORY_CHANGED', `${t.number} changed in the meantime.`, {
          number: t.number,
        }),
      );
    }
  }

  /** The day it was last worked, as the list counts it. */
  private async lastWorked(
    m: EntityManager,
    t: Territory,
  ): Promise<string | null> {
    const [row] = await m.query<{ last: string | null }[]>(
      `SELECT MAX(completed_on)::text AS last FROM territory_assignments
        WHERE territory_id = $1 AND ($2::date IS NULL OR completed_on >= $2::date)`,
      [t.id, t.workedFrom],
    );
    return (
      [t.lastCompletedOn, row?.last ?? null]
        .filter((d): d is string => !!d)
        .sort()
        .pop() ?? null
    );
  }

  private async numbersInUse(
    m: EntityManager,
    tenantId: string,
  ): Promise<string[]> {
    return (
      await m.find(Territory, {
        where: { congregationId: tenantId, archivedAt: IsNull() },
        select: { number: true },
      })
    ).map((t) => t.number);
  }

  private async mustBeFreeNumber(
    m: EntityManager,
    tenantId: string,
    number: string,
  ): Promise<string> {
    const n = number.trim();
    const taken = await this.numbersInUse(m, tenantId);
    if (!n || taken.some((x) => norm(x) === norm(n))) {
      throw new ConflictException(
        refusal('TERRITORY_NUMBER_TWICE', 'This number is in use.', {
          number: n,
        }),
      );
    }
    return n;
  }

  async suggestNumber(user: AuthenticatedUser, like: string | undefined) {
    await this.mustKeepOpen(user);
    const taken = await this.numbersInUse(
      this.dataSource.manager,
      user.congregationId,
    );
    return { number: nextNumber(like?.trim() || 'Новый', taken) };
  }

  // ------------------------------------------------------------- cut -----

  async splitCheck(user: AuthenticatedUser, id: string, line: number[][]) {
    await this.mustKeepOpen(user);
    const m = this.dataSource.manager;
    const t = await this.active(m, user.congregationId, id);
    let parts: [TerritoryGeometry, TerritoryGeometry];
    try {
      parts = splitByLine(t.geometry, lineOf(line));
    } catch (e) {
      this.shapeRefused(e);
    }
    const houses = await housesAround(m, user.congregationId, [t.geometry]);
    const out = parts.map((g) => ({
      geometry: g,
      areaM2: Math.round(areaM2(g)),
      houses: houses ? housesIn(g, houses) : null,
    }));
    // The part with more houses keeps the number; without the register,
    // the larger one.
    const keep =
      (out[0].houses ?? out[0].areaM2) >= (out[1].houses ?? out[1].areaM2)
        ? 0
        : 1;
    const taken = await this.numbersInUse(m, user.congregationId);
    return {
      parts: out,
      keep,
      newNumber: nextNumber(t.number, taken),
      lastWorkedOn: await this.lastWorked(m, t),
    };
  }

  async split(user: AuthenticatedUser, id: string, dto: SplitDto) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const editId = randomUUID();
    const result = await this.dataSource.transaction(async (m) => {
      const t = await this.active(m, tenantId, id, true);
      this.mustBeAsRead(t, dto.updatedAt);
      await this.mustBeFree(m, tenantId, t);
      let parts: [TerritoryGeometry, TerritoryGeometry];
      try {
        parts = splitByLine(t.geometry, lineOf(dto.line));
      } catch (e) {
        this.shapeRefused(e);
      }
      const keep = dto.keep === 1 ? 1 : 0;
      const number = await this.mustBeFreeNumber(m, tenantId, dto.newNumber);
      const lastWorkedOn = await this.lastWorked(m, t);
      const whole = t.geometry;
      const made = await m.save(
        m.create(Territory, {
          congregationId: tenantId,
          number,
          locality: t.locality,
          kind: t.kind,
          category: t.category,
          geometry: parts[1 - keep],
          lastCompletedOn: lastWorkedOn,
          workedFrom: null,
          note: null,
          archivedAt: null,
        }),
      );
      t.geometry = parts[keep];
      await m.save(t);
      // «Не посещать» named for the new part go there; the rest stay.
      const own = await m.find(TerritoryNoCall, {
        where: { territoryId: t.id, congregationId: tenantId },
      });
      const toNew = new Set(
        (dto.noCalls ?? []).filter((n) => n.part !== keep).map((n) => n.id),
      );
      const moved: { id: string; from: string }[] = [];
      for (const n of own) {
        if (!toNew.has(n.id)) continue;
        n.territoryId = made.id;
        await m.save(n);
        moved.push({ id: n.id, from: t.id });
      }
      const detail: ReshapeDetail = { made: made.id, noCalls: moved };
      await m.save([
        m.create(TerritoryShape, {
          congregationId: tenantId,
          territoryId: t.id,
          geometry: whole,
          reason: 'split',
          editId,
          detail,
          createdByUserId: user.id,
        }),
        m.create(TerritoryShape, {
          congregationId: tenantId,
          territoryId: made.id,
          geometry: made.geometry,
          reason: 'split',
          fromTerritoryIds: [t.id],
          editId,
          createdByUserId: user.id,
        }),
      ]);
      return { kept: t, made, moved: moved.length };
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: result.kept.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: {
        split: true,
        number: result.kept.number,
        made: result.made.number,
        noCallsMoved: result.moved,
      },
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: result.made.id,
      action: 'CREATE',
      actorUserId: user.id,
      detail: { splitFrom: result.kept.number, number: result.made.number },
    });
    return {
      kept: { id: result.kept.id, number: result.kept.number },
      made: { id: result.made.id, number: result.made.number },
    };
  }

  // ------------------------------------------------------------ join -----

  private async joinParts(
    m: EntityManager,
    tenantId: string,
    id: string,
    otherId: string,
    lock = false,
  ) {
    const a = await this.active(m, tenantId, id, lock);
    const b = await this.active(m, tenantId, otherId, lock);
    if (a.id === b.id || a.category !== b.category) {
      throw new ConflictException(
        refusal(
          'TERRITORY_NOT_NEIGHBOUR',
          'Only two territories of the same kind are joined.',
        ),
      );
    }
    let joined: TerritoryGeometry;
    try {
      joined = joinTwo(a.geometry, b.geometry);
    } catch (e) {
      this.shapeRefused(e);
    }
    return { a, b, joined };
  }

  async mergeCheck(user: AuthenticatedUser, id: string, otherId: string) {
    await this.mustKeepOpen(user);
    const m = this.dataSource.manager;
    const tenantId = user.congregationId;
    const { a, b, joined } = await this.joinParts(m, tenantId, id, otherId);
    const houses = await housesAround(m, tenantId, [joined]);
    const side = async (t: Territory) => ({
      id: t.id,
      number: t.number,
      updatedAt: t.updatedAt,
      lastWorkedOn: await this.lastWorked(m, t),
      houses: houses ? housesIn(t.geometry, houses) : null,
      noCalls: await m.count(TerritoryNoCall, {
        where: { territoryId: t.id, congregationId: tenantId },
      }),
      held:
        (await m.count(TerritoryAssignment, {
          where: {
            territoryId: t.id,
            congregationId: tenantId,
            completedOn: IsNull(),
            returnedOn: IsNull(),
          },
        })) > 0,
    });
    const sa = await side(a);
    const sb = await side(b);
    return {
      geometry: joined,
      houses: houses ? housesIn(joined, houses) : null,
      territories: [sa, sb],
      // Never worked counts as the oldest of all.
      lastWorkedOn:
        sa.lastWorkedOn && sb.lastWorkedOn
          ? [sa.lastWorkedOn, sb.lastWorkedOn].sort()[0]
          : null,
    };
  }

  async merge(user: AuthenticatedUser, id: string, dto: MergeDto) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const editId = randomUUID();
    const result = await this.dataSource.transaction(async (m) => {
      const { a, b, joined } = await this.joinParts(
        m,
        tenantId,
        id,
        dto.otherId,
        true,
      );
      this.mustBeAsRead(a, dto.updatedAt);
      this.mustBeAsRead(b, dto.otherUpdatedAt);
      await this.mustBeFree(m, tenantId, a);
      await this.mustBeFree(m, tenantId, b);
      const kept = dto.keepId === b.id ? b : a;
      const gone = kept === a ? b : a;
      const keptWas = await this.lastWorked(m, kept);
      const goneWas = await this.lastWorked(m, gone);
      const older = keptWas && goneWas ? [keptWas, goneWas].sort()[0] : null;
      const today = await this.today(m, tenantId);
      const before = {
        geometry: kept.geometry,
        lastCompletedOn: kept.lastCompletedOn,
        workedFrom: kept.workedFrom,
      };
      kept.geometry = joined;
      kept.lastCompletedOn = older;
      kept.workedFrom = today;
      await m.save(kept);
      gone.archivedAt = new Date();
      await m.save(gone);
      // «Не посещать» go to the kept one, except an address it already has.
      const keptKeys = new Set(
        (
          await m.find(TerritoryNoCall, {
            where: { territoryId: kept.id, congregationId: tenantId },
          })
        ).map((n) => addressKey(n.address)),
      );
      const moved: { id: string; from: string }[] = [];
      for (const n of await m.find(TerritoryNoCall, {
        where: { territoryId: gone.id, congregationId: tenantId },
      })) {
        if (keptKeys.has(addressKey(n.address))) continue;
        n.territoryId = kept.id;
        await m.save(n);
        moved.push({ id: n.id, from: gone.id });
      }
      const detail: ReshapeDetail & { before: typeof before } = {
        archived: gone.id,
        noCalls: moved,
        before,
      };
      await m.save([
        m.create(TerritoryShape, {
          congregationId: tenantId,
          territoryId: kept.id,
          geometry: before.geometry,
          reason: 'merge',
          fromTerritoryIds: [gone.id],
          editId,
          detail,
          createdByUserId: user.id,
        }),
        m.create(TerritoryShape, {
          congregationId: tenantId,
          territoryId: gone.id,
          geometry: gone.geometry,
          reason: 'merge',
          editId,
          createdByUserId: user.id,
        }),
      ]);
      return { kept, gone, moved: moved.length, older };
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: result.kept.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: {
        merged: result.gone.number,
        number: result.kept.number,
        lastWorkedOn: result.older,
        noCallsMoved: result.moved,
      },
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: result.gone.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { archived: true, mergedInto: result.kept.number },
    });
    return {
      kept: { id: result.kept.id, number: result.kept.number },
      archived: { id: result.gone.id, number: result.gone.number },
    };
  }

  private async today(m: EntityManager, tenantId: string): Promise<string> {
    const c = await m.findOne(Congregation, {
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone);
  }

  // ------------------------------------------------------------- new -----

  private async newCheck(
    m: EntityManager,
    tenantId: string,
    raw: unknown,
    category: TerritoryCategory,
  ) {
    let g: TerritoryGeometry;
    try {
      g = checkGeometry(raw);
    } catch (e) {
      this.shapeRefused(e);
    }
    const others = await m.find(Territory, {
      where: { congregationId: tenantId, archivedAt: IsNull(), category },
      select: { id: true, number: true, geometry: true },
    });
    const box = boxOf(g);
    const overlapsWith = others
      .filter(
        (o) =>
          boxesMeet(box, boxOf(o.geometry)) &&
          overlapShare(g, o.geometry) >= OVERLAP_LIMIT,
      )
      .map((o) => o.number);
    const houses = await housesAround(m, tenantId, [g]);
    let free: number | null = null;
    if (houses) {
      const inside = houses.filter((h) => housesIn(g, [h]) === 1);
      free = inside.filter(
        (h) =>
          !others.some(
            (o) =>
              boxesMeet(boxOf(o.geometry), [h[0], h[1], h[0], h[1]]) &&
              housesIn(o.geometry, [h]) === 1,
          ),
      ).length;
    }
    const boundary = await m.findOne(TerritoryBoundary, {
      where: { congregationId: tenantId },
      order: { createdAt: 'DESC' },
    });
    return {
      geometry: g,
      areaM2: Math.round(areaM2(g)),
      houses: houses ? housesIn(g, houses) : null,
      /** Houses inside that no territory of this kind holds yet. */
      freeHouses: free,
      overlaps: overlapsWith,
      outsideBoundary: boundary
        ? Math.round(areaShareOutside(g, boundary.geometry) * 100)
        : 0,
    };
  }

  async createCheck(
    user: AuthenticatedUser,
    raw: unknown,
    category: TerritoryCategory,
  ) {
    await this.mustKeepOpen(user);
    return this.newCheck(
      this.dataSource.manager,
      user.congregationId,
      raw,
      category,
    );
  }

  async create(user: AuthenticatedUser, dto: CreateTerritoryDto) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const category = (dto.category ?? 'residential') as TerritoryCategory;
    const editId = randomUUID();
    const made = await this.dataSource
      .transaction(async (m) => {
        const check = await this.newCheck(m, tenantId, dto.geometry, category);
        if (check.overlaps.length > 0) {
          throw new ConflictException(
            refusal('TERRITORY_OVERLAP', 'It lies over another territory.', {
              number: dto.number.trim(),
              other: check.overlaps[0],
            }),
          );
        }
        const number = await this.mustBeFreeNumber(m, tenantId, dto.number);
        const t = await m.save(
          m.create(Territory, {
            congregationId: tenantId,
            number,
            locality: dto.locality?.trim() || null,
            kind: (dto.kind as Territory['kind']) ?? null,
            category,
            geometry: check.geometry,
            lastCompletedOn: null,
            workedFrom: null,
            note: null,
            archivedAt: null,
          }),
        );
        await m.save(
          m.create(TerritoryShape, {
            congregationId: tenantId,
            territoryId: t.id,
            geometry: t.geometry,
            reason: 'new',
            editId,
            detail: { made: t.id },
            createdByUserId: user.id,
          }),
        );
        return t;
      })
      .catch((e: unknown) => {
        if ((e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
          throw new ConflictException(
            refusal('TERRITORY_NUMBER_TWICE', 'This number is in use.', {
              number: dto.number.trim(),
            }),
          );
        }
        throw e;
      });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: made.id,
      action: 'CREATE',
      actorUserId: user.id,
      detail: { number: made.number, category: made.category },
    });
    return { id: made.id, number: made.number };
  }

  // ------------------------------------------------------------ undo -----

  /**
   * Puts back the last cut, join or new territory this one took part in —
   * while none of the territories involved changed or was given out since.
   */
  async undo(user: AuthenticatedUser, id: string) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const done = await this.dataSource.transaction(async (m) => {
      const latest = await m.findOne(TerritoryShape, {
        where: { territoryId: id, congregationId: tenantId },
        order: { createdAt: 'DESC' },
      });
      if (
        !latest?.editId ||
        !['split', 'merge', 'new'].includes(latest.reason)
      ) {
        throw new ConflictException(
          refusal('TERRITORY_NOTHING_TO_UNDO', 'Nothing to undo.'),
        );
      }
      const batch = await m.find(TerritoryShape, {
        where: { editId: latest.editId, congregationId: tenantId },
      });
      const ids = batch.map((s) => s.territoryId);
      for (const tid of ids) {
        const last = await m.findOne(TerritoryShape, {
          where: { territoryId: tid, congregationId: tenantId },
          order: { createdAt: 'DESC' },
        });
        if (last?.editId !== latest.editId) {
          throw new ConflictException(
            refusal('TERRITORY_CHANGED', 'It changed since.'),
          );
        }
      }
      const given = await m
        .createQueryBuilder(TerritoryAssignment, 'a')
        .where('a.territory_id IN (:...ids)', { ids })
        .andWhere('a.created_at > :at', { at: latest.createdAt })
        .getCount();
      if (given > 0) {
        throw new ConflictException(
          refusal('TERRITORY_UNDO_GIVEN', 'Given out since; cannot undo.'),
        );
      }
      const head = batch.find((s) => s.detail) ?? latest;
      const detail = (head.detail ?? {}) as ReshapeDetail & {
        before?: {
          geometry: TerritoryGeometry;
          lastCompletedOn: string | null;
          workedFrom: string | null;
        };
      };
      for (const n of detail.noCalls ?? []) {
        await m.update(
          TerritoryNoCall,
          { id: n.id, congregationId: tenantId },
          { territoryId: n.from },
        );
      }
      // The undo is recorded too: the latest outline of each territory then
      // says «undone», and a second undo finds nothing to undo.
      const mark = (t: Territory, reason: string) =>
        m.save(
          m.create(TerritoryShape, {
            congregationId: tenantId,
            territoryId: t.id,
            geometry: t.geometry,
            reason,
            editId: randomUUID(),
            createdByUserId: user.id,
          }),
        );
      if (head.reason === 'split') {
        const kept = await this.active(m, tenantId, head.territoryId, true);
        await mark(kept, 'unsplit');
        kept.geometry = head.geometry;
        await m.save(kept);
        if (detail.made) await this.dropMade(m, tenantId, detail.made);
        return { reason: 'split', number: kept.number };
      }
      if (head.reason === 'merge') {
        const kept = await this.active(m, tenantId, head.territoryId, true);
        await mark(kept, 'unmerge');
        const before = detail.before;
        kept.geometry = before?.geometry ?? head.geometry;
        kept.lastCompletedOn = before?.lastCompletedOn ?? kept.lastCompletedOn;
        kept.workedFrom = before?.workedFrom ?? null;
        await m.save(kept);
        if (detail.archived) {
          const gone = await m.findOne(Territory, {
            where: { id: detail.archived, congregationId: tenantId },
          });
          if (gone) {
            const taken = await this.numbersInUse(m, tenantId);
            if (taken.some((x) => norm(x) === norm(gone.number))) {
              throw new ConflictException(
                refusal('TERRITORY_NUMBER_TWICE', 'Its number is in use.', {
                  number: gone.number,
                }),
              );
            }
            gone.archivedAt = null;
            await m.save(gone);
          }
        }
        return { reason: 'merge', number: kept.number };
      }
      // A new one: never given out (checked above), it simply goes.
      const t = await this.active(m, tenantId, head.territoryId, true);
      const ever = await m.count(TerritoryAssignment, {
        where: { territoryId: t.id },
      });
      if (ever > 0) {
        throw new ConflictException(
          refusal('TERRITORY_UNDO_GIVEN', 'Given out since; cannot undo.'),
        );
      }
      await this.dropMade(m, tenantId, t.id);
      return { reason: 'new', number: t.number };
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { undone: done.reason, number: done.number },
    });
    return done;
  }

  /** A territory made by a cut or anew, never given out, removed again. */
  private async dropMade(m: EntityManager, tenantId: string, id: string) {
    const ever = await m.count(TerritoryAssignment, {
      where: { territoryId: id },
    });
    if (ever > 0) {
      throw new ConflictException(
        refusal('TERRITORY_UNDO_GIVEN', 'Given out since; cannot undo.'),
      );
    }
    const left = await m.count(TerritoryNoCall, {
      where: { territoryId: id, congregationId: tenantId },
    });
    if (left > 0) {
      throw new ConflictException(
        refusal('TERRITORY_CHANGED', 'Addresses were added to it since.'),
      );
    }
    await m.delete(TerritoryShape, { territoryId: id });
    await m.delete(Territory, { id, congregationId: tenantId });
  }
}
