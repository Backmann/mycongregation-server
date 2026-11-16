import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { todayIn } from '../common/congregation-clock';
import { refusal } from '../common/errors/refusal';
import { Congregation } from '../entities/congregation.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { TerritoryNoCall } from '../entities/territory-no-call.entity';
import {
  TerritoryRecut,
  TerritoryRecutProposal,
  TerritoryRecutRemark,
} from '../entities/territory-recut.entity';
import { TerritoryShape } from '../entities/territory-shape.entity';
import { Territory, TerritoryGeometry } from '../entities/territory.entity';
import type { RecutApplyDto, RecutHoldDto } from './dto/recut.dto';
import { boxOf, GeometryError } from './geometry';
import { housesAround, housesIn } from './houses';
import { joinAll, partsOfCut } from './recut';
import {
  joinStanding,
  oldestWorked,
  placeNoCalls,
  type OfficialAddress,
} from './recut-apply';
import { ReshapeError } from './reshape';
import { addDays } from './service-year';
import { TerritoryAccessService } from './territory-access.service';
import { addressKey, borderPrint } from './territory-recut.service';

const norm = (n: string): string => n.trim().toLowerCase();

/** What stands between a decided proposal and applying it now. */
export type ApplyBlock =
  | 'notApproved'
  | 'gone'
  | 'held'
  | 'meeting'
  | 'changed'
  | 'shape'
  | 'number';

/** What «Применить» would do now (board 6a of the mockup). */
export interface RecutApplyCheck {
  proposalId: string;
  kind: 'cut' | 'merge';
  updatedAt: string;
  blocks: ApplyBlock[];
  /** A number already taken by another territory: which one. */
  takenNumber: string | null;
  parts: { number: string; homes: number | null; keeps: boolean }[];
  /** The day every part (or the joined one) counts as last worked. */
  lastWorkedOn: string | null;
  /** A cut: each address and the part the register puts it in; null — the keeper chooses. */
  noCalls: { id: string; address: string; part: number | null }[];
  /** A join: addresses that would be twice in the joined one — kept once. */
  noCallsTwice: number;
  /** A join: free of all, and those still out. */
  standing: {
    free: number;
    total: number;
    waiting: { number: string; since: string }[];
  } | null;
  holdIds: string[];
}

/** A territory of a decided proposal, as the keepers' screens show it. */
export interface RecutWaiting {
  territoryId: string;
  number: string;
  proposalId: string;
  kind: 'cut' | 'merge';
  /** All of the proposal's territories, in its order. */
  numbers: string[];
  free: number;
  total: number;
  waiting: { number: string; since: string }[];
  /** Held back for the join: not to be given out. */
  hold: boolean;
  /** Free of all, nothing else stands in the way: it can be applied now. */
  ready: boolean;
}

/** Kept with the applied outlines, for «Вернуть как было». */
interface RecutDetail {
  proposalId: string;
  kind: 'cut' | 'merge';
  kept: string;
  before: {
    geometry: TerritoryGeometry;
    lastCompletedOn: string | null;
    workedFrom: string | null;
  };
  made: string[];
  archived: string[];
  noCalls: { id: string; from: string; to: string }[];
}

/**
 * Applying a decided proposal of the re-cutting draft (16 November 2026,
 * step 5): the cut into all its parts at once, or the join of all its
 * territories, as the service committee decided it — only when every
 * territory is free, no meeting goes to it and no border moved since. One
 * «Вернуть как было» undoes it all, while no part has been given out.
 *
 * A join waits until all its territories are free together: one that comes
 * back meanwhile can be held back, and is then not given out again unless
 * the keeper chooses to (territory-assignments.service assign).
 *
 * The numbers and S-13 work as in the editor (territory-reshape.service):
 * a cut keeps the number and history on one part, the others take new
 * numbers and the whole's last-worked day; a join keeps one number, counts
 * as last worked on the oldest day, and the others go out of use with
 * their S-13 rows kept.
 */
@Injectable()
export class TerritoryRecutApplyService {
  constructor(
    private readonly access: TerritoryAccessService,
    private readonly audit: AuditLogService,
    private readonly dataSource: DataSource,
  ) {}

  private async mustEdit(user: AuthenticatedUser) {
    const a = await this.access.mustKeep(user);
    if (!a.verified) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_OPEN', 'The records are not confirmed yet.'),
      );
    }
    return a;
  }

  private async today(m: EntityManager, tenantId: string): Promise<string> {
    const c = await m.findOne(Congregation, {
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone);
  }

  private async recutId(
    m: EntityManager,
    tenantId: string,
  ): Promise<string | null> {
    const r = await m.findOne(TerritoryRecut, {
      where: { congregationId: tenantId },
      select: { id: true },
    });
    return r?.id ?? null;
  }

  private async proposal(
    m: EntityManager,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<TerritoryRecutProposal> {
    const recutId = await this.recutId(m, tenantId);
    if (recutId && lock) {
      await m.query(
        `SELECT id FROM territory_recuts WHERE id = $1 FOR UPDATE`,
        [recutId],
      );
    }
    const p = recutId
      ? await m.findOne(TerritoryRecutProposal, {
          where: { id, recutId, congregationId: tenantId },
        })
      : null;
    if (!p) throw new NotFoundException('Proposal not found');
    return p;
  }

  /** The day a territory was last worked, as the list counts it. */
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

  /** The territories out now, and since when: id → day given out. */
  private async heldSince(
    m: EntityManager,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const open = await m.find(TerritoryAssignment, {
      where: {
        territoryId: In(ids),
        congregationId: tenantId,
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
      select: { territoryId: true, assignedOn: true },
    });
    return new Map(open.map((a) => [a.territoryId, a.assignedOn]));
  }

  /** Territories a meeting goes to today or later. */
  private async withMeeting(
    m: EntityManager,
    tenantId: string,
    ids: string[],
    today: string,
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const meetings = await m.find(FieldServiceMeeting, {
      where: {
        congregationId: tenantId,
        territoryId: In(ids),
        cancelledAt: IsNull(),
      },
      select: {
        id: true,
        territoryId: true,
        weekStartDate: true,
        dayOfWeek: true,
      },
    });
    return new Set(
      meetings
        .filter((x) => addDays(x.weekStartDate, x.dayOfWeek - 1) >= today)
        .map((x) => x.territoryId as string),
    );
  }

  /** The outlines the proposal makes now, or null when they cannot be made. */
  private shapes(
    p: TerritoryRecutProposal,
    ts: Territory[],
  ): TerritoryGeometry[] | null {
    try {
      return p.kind === 'merge'
        ? [joinAll(ts.map((t) => t.geometry))]
        : partsOfCut(ts[0].geometry, p.lines ?? []);
    } catch (e) {
      if (e instanceof ReshapeError || e instanceof GeometryError) return null;
      throw e;
    }
  }

  /**
   * Everything that stands in the way now, and what applying would make.
   * The same checks run again, locked, inside the apply itself.
   */
  private async assess(
    m: EntityManager,
    tenantId: string,
    p: TerritoryRecutProposal,
    lock: boolean,
  ) {
    const ts = await m.find(Territory, {
      where: { id: In(p.territoryIds), congregationId: tenantId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    const byId = new Map(ts.map((t) => [t.id, t]));
    const ordered = p.territoryIds.map((id) => byId.get(id));
    const blocks: ApplyBlock[] = [];
    if (p.state !== 'open') {
      throw new ConflictException(
        refusal('TERRITORY_RECUT_NOT_READY', 'Already applied.', {
          reason: 'applied',
        }),
      );
    }
    if (!p.approvedAt) blocks.push('notApproved');
    if (ordered.some((t) => !t || t.archivedAt)) {
      blocks.push('gone');
      return { blocks, ts: [] as Territory[], shapes: null, takenNumber: null };
    }
    const live = ordered as Territory[];
    const today = await this.today(m, tenantId);
    const held = await this.heldSince(m, tenantId, p.territoryIds);
    if (held.size > 0) blocks.push('held');
    const met = await this.withMeeting(m, tenantId, p.territoryIds, today);
    if (met.size > 0) blocks.push('meeting');
    if (live.some((t) => p.base[t.id] !== borderPrint(t.geometry))) {
      blocks.push('changed');
    }
    const shapes = this.shapes(p, live);
    if (
      !shapes ||
      (p.kind === 'cut' && (p.numbers ?? []).length !== shapes.length - 1)
    ) {
      blocks.push('shape');
    }
    // The new numbers of a cut: still free today.
    let takenNumber: string | null = null;
    if (p.kind === 'cut') {
      const taken = new Set(
        (
          await m.find(Territory, {
            where: { congregationId: tenantId, archivedAt: IsNull() },
            select: { number: true },
          })
        ).map((t) => norm(t.number)),
      );
      takenNumber = (p.numbers ?? []).find((n) => taken.has(norm(n))) ?? null;
      if (takenNumber) blocks.push('number');
    }
    return { blocks, ts: live, shapes, takenNumber, held, today };
  }

  /** The official addresses round some outlines. */
  private async addressesAround(
    m: EntityManager,
    tenantId: string,
    g: TerritoryGeometry,
  ): Promise<OfficialAddress[]> {
    const [x0, y0, x1, y1] = boxOf(g);
    const rows = await m.query<
      { lon: number; lat: number; number: string; street: string }[]
    >(
      `SELECT lon, lat, number, street FROM map_addresses
        WHERE congregation_id = $1 AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
      [tenantId, y0, y1, x0, x1],
    );
    return rows.map((r) => ({
      at: [Number(r.lon), Number(r.lat)] as [number, number],
      street: r.street,
      number: r.number,
    }));
  }

  // ------------------------------------------------------------ check -----

  async check(user: AuthenticatedUser, id: string): Promise<RecutApplyCheck> {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const m = this.dataSource.manager;
    const p = await this.proposal(m, tenantId, id);
    const a = await this.assess(m, tenantId, p, false);
    const parts: RecutApplyCheck['parts'] = [];
    let lastWorkedOn: string | null = null;
    let noCalls: RecutApplyCheck['noCalls'] = [];
    let noCallsTwice = 0;
    let standing: RecutApplyCheck['standing'] = null;
    if (a.ts.length) {
      const homes = a.shapes ? await housesAround(m, tenantId, a.shapes) : null;
      if (p.kind === 'cut') {
        const t = a.ts[0];
        const others = [...(p.numbers ?? [])];
        (a.shapes ?? []).forEach((g, i) =>
          parts.push({
            number: i === p.keep ? t.number : (others.shift() ?? '—'),
            homes: homes ? housesIn(g, homes) : null,
            keeps: i === p.keep,
          }),
        );
        lastWorkedOn = await this.lastWorked(m, t);
        const calls = await m.find(TerritoryNoCall, {
          where: { territoryId: t.id, congregationId: tenantId },
          order: { notedOn: 'DESC' },
        });
        if (calls.length && a.shapes) {
          const addresses = await this.addressesAround(m, tenantId, t.geometry);
          const placed = placeNoCalls(calls, a.shapes, addresses);
          noCalls = calls.map((c, i) => ({
            id: c.id,
            address: c.address,
            part: placed[i].part,
          }));
        }
      } else {
        const kept = a.ts.find((t) => t.id === p.keepId) ?? a.ts[0];
        parts.push({
          number: kept.number,
          homes: homes && a.shapes ? housesIn(a.shapes[0], homes) : null,
          keeps: true,
        });
        const days: (string | null)[] = [];
        for (const t of a.ts) days.push(await this.lastWorked(m, t));
        lastWorkedOn = oldestWorked(days);
        noCallsTwice = await this.twiceInJoin(m, tenantId, kept, a.ts);
        standing = joinStanding(
          a.ts.map((t) => ({
            id: t.id,
            number: t.number,
            heldSince: a.held?.get(t.id) ?? null,
          })),
        );
      }
    }
    return {
      proposalId: p.id,
      kind: p.kind,
      updatedAt: p.updatedAt.toISOString(),
      blocks: a.blocks,
      takenNumber: a.takenNumber,
      parts,
      lastWorkedOn,
      noCalls,
      noCallsTwice,
      standing,
      holdIds: p.holdIds ?? [],
    };
  }

  /** Addresses of the others that the kept one has already: kept once. */
  private async twiceInJoin(
    m: EntityManager,
    tenantId: string,
    kept: Territory,
    ts: Territory[],
  ): Promise<number> {
    const calls = await m.find(TerritoryNoCall, {
      where: { territoryId: In(ts.map((t) => t.id)), congregationId: tenantId },
    });
    const seen = new Set<string>();
    let twice = 0;
    // The kept one's first, as the join keeps them.
    const order = [
      ...calls.filter((c) => c.territoryId === kept.id),
      ...calls.filter((c) => c.territoryId !== kept.id),
    ];
    for (const c of order) {
      const k = JSON.stringify(addressKey(c.address) ?? c.address.trim());
      if (seen.has(k)) twice += 1;
      else seen.add(k);
    }
    return twice;
  }

  // ------------------------------------------------------------ apply -----

  async apply(user: AuthenticatedUser, id: string, dto: RecutApplyDto) {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const editId = randomUUID();
    const result = await this.dataSource.transaction(async (m) => {
      const p = await this.proposal(m, tenantId, id, true);
      if (p.updatedAt.toISOString() !== new Date(dto.updatedAt).toISOString()) {
        throw new ConflictException(
          refusal(
            'TERRITORY_RECUT_STALE',
            'The proposal changed since it was read.',
          ),
        );
      }
      const a = await this.assess(m, tenantId, p, true);
      if (a.blocks.length > 0 || !a.shapes) {
        throw new ConflictException(
          refusal('TERRITORY_RECUT_NOT_READY', 'It cannot be applied now.', {
            reason: a.blocks[0] ?? 'shape',
            number: a.takenNumber ?? '',
          }),
        );
      }
      const detail =
        p.kind === 'cut'
          ? await this.applyCut(m, tenantId, p, a.ts[0], a.shapes, dto)
          : await this.applyJoin(
              m,
              tenantId,
              p,
              a.ts,
              a.shapes[0],
              await this.today(m, tenantId),
            );
      await m.save(
        [detail.kept, ...detail.made, ...detail.archived].map((tid) =>
          m.create(TerritoryShape, {
            congregationId: tenantId,
            territoryId: tid,
            geometry:
              tid === detail.kept
                ? detail.before.geometry
                : (a.ts.find((t) => t.id === tid)?.geometry ??
                  detail.madeShapes.get(tid)!),
            reason: 'recut',
            fromTerritoryIds:
              tid === detail.kept
                ? detail.archived
                : detail.made.includes(tid)
                  ? [detail.kept]
                  : [],
            editId,
            detail: (tid === detail.kept
              ? {
                  proposalId: p.id,
                  kind: p.kind,
                  kept: detail.kept,
                  before: detail.before,
                  made: detail.made,
                  archived: detail.archived,
                  noCalls: detail.noCalls,
                }
              : null) as never,
            createdByUserId: user.id,
          }),
        ),
      );
      await m.update(
        TerritoryRecutProposal,
        { id: p.id },
        { state: 'applied', appliedAt: new Date(), holdIds: [] },
      );
      // The discussion goes once it is applied; the decision stays.
      await m.delete(TerritoryRecutRemark, { proposalId: p.id });
      const numbers = await m.find(Territory, {
        where: { id: In([detail.kept, ...detail.made, ...detail.archived]) },
        select: { id: true, number: true },
      });
      const numberOf = (x: string) =>
        numbers.find((t) => t.id === x)?.number ?? '—';
      return {
        kind: p.kind,
        kept: numberOf(detail.kept),
        made: detail.made.map(numberOf),
        archived: detail.archived.map(numberOf),
        noCalls: detail.noCalls.length,
      };
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: tenantId,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { recut: 'applied', ...result },
    });
    return result;
  }

  private async applyCut(
    m: EntityManager,
    tenantId: string,
    p: TerritoryRecutProposal,
    t: Territory,
    shapes: TerritoryGeometry[],
    dto: RecutApplyDto,
  ) {
    const before = {
      geometry: t.geometry,
      lastCompletedOn: t.lastCompletedOn,
      workedFrom: t.workedFrom,
    };
    // Where each address goes: the register first, the keeper's choice for
    // the rest. One left unplaced is refused, never guessed.
    const calls = await m.find(TerritoryNoCall, {
      where: { territoryId: t.id, congregationId: tenantId },
    });
    const addresses = calls.length
      ? await this.addressesAround(m, tenantId, t.geometry)
      : [];
    const placed = placeNoCalls(calls, shapes, addresses);
    const chosen = new Map((dto.noCalls ?? []).map((n) => [n.id, n.part]));
    const partOf = new Map<string, number>();
    for (const [i, c] of calls.entries()) {
      const part = placed[i].part ?? chosen.get(c.id);
      if (part === undefined || part === null || part >= shapes.length) {
        throw new ConflictException(
          refusal(
            'TERRITORY_RECUT_NO_CALLS',
            'Choose the part of every address.',
            { count: calls.length },
          ),
        );
      }
      partOf.set(c.id, part);
    }
    const lastWorkedOn = await this.lastWorked(m, t);
    const others = [...(p.numbers ?? [])];
    const ids: string[] = [];
    const madeShapes = new Map<string, TerritoryGeometry>();
    for (const [i, g] of shapes.entries()) {
      if (i === p.keep) {
        ids.push(t.id);
        continue;
      }
      const made = await m.save(
        m.create(Territory, {
          congregationId: tenantId,
          number: others.shift()!.trim(),
          locality: t.locality,
          kind: t.kind,
          category: t.category,
          geometry: g,
          lastCompletedOn: lastWorkedOn,
          workedFrom: null,
          note: null,
          archivedAt: null,
        }),
      );
      ids.push(made.id);
      madeShapes.set(made.id, g);
    }
    t.geometry = shapes[p.keep];
    await m.save(t);
    const moved: RecutDetail['noCalls'] = [];
    for (const c of calls) {
      const to = ids[partOf.get(c.id)!];
      if (to === t.id) continue;
      c.territoryId = to;
      await m.save(c);
      moved.push({ id: c.id, from: t.id, to });
    }
    return {
      kept: t.id,
      before,
      made: ids.filter((x) => x !== t.id),
      archived: [] as string[],
      noCalls: moved,
      madeShapes,
    };
  }

  private async applyJoin(
    m: EntityManager,
    tenantId: string,
    p: TerritoryRecutProposal,
    ts: Territory[],
    joined: TerritoryGeometry,
    today: string,
  ) {
    const kept = ts.find((t) => t.id === p.keepId) ?? ts[0];
    const gone = ts.filter((t) => t.id !== kept.id);
    const days: (string | null)[] = [];
    for (const t of ts) days.push(await this.lastWorked(m, t));
    const before = {
      geometry: kept.geometry,
      lastCompletedOn: kept.lastCompletedOn,
      workedFrom: kept.workedFrom,
    };
    kept.geometry = joined;
    kept.lastCompletedOn = oldestWorked(days);
    kept.workedFrom = today;
    await m.save(kept);
    for (const g of gone) {
      g.archivedAt = new Date();
      await m.save(g);
    }
    // «Не посещать» go to the kept one, except an address it has already.
    const keys = new Set(
      (
        await m.find(TerritoryNoCall, {
          where: { territoryId: kept.id, congregationId: tenantId },
        })
      ).map((n) => JSON.stringify(addressKey(n.address) ?? n.address.trim())),
    );
    const moved: RecutDetail['noCalls'] = [];
    for (const g of gone) {
      for (const n of await m.find(TerritoryNoCall, {
        where: { territoryId: g.id, congregationId: tenantId },
      })) {
        const k = JSON.stringify(addressKey(n.address) ?? n.address.trim());
        if (keys.has(k)) continue;
        keys.add(k);
        n.territoryId = kept.id;
        await m.save(n);
        moved.push({ id: n.id, from: g.id, to: kept.id });
      }
    }
    return {
      kept: kept.id,
      before,
      made: [] as string[],
      archived: gone.map((g) => g.id),
      noCalls: moved,
      madeShapes: new Map<string, TerritoryGeometry>(),
    };
  }

  // ------------------------------------------------------------- undo -----

  /**
   * «Вернуть как было»: the whole application undone, while no part has
   * been given out since and nothing else changed their outlines.
   */
  async unapply(user: AuthenticatedUser, id: string) {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const result = await this.dataSource.transaction(async (m) => {
      const p = await this.proposal(m, tenantId, id, true);
      if (p.state !== 'applied') {
        throw new ConflictException(
          refusal('TERRITORY_NOTHING_TO_UNDO', 'It is not applied.'),
        );
      }
      const head = await m
        .createQueryBuilder(TerritoryShape, 's')
        .where('s.congregation_id = :tenantId', { tenantId })
        .andWhere(`s.reason = 'recut'`)
        .andWhere(`s.detail ->> 'proposalId' = :id`, { id })
        .orderBy('s.created_at', 'DESC')
        .getOne();
      const d = head?.detail as unknown as RecutDetail | undefined;
      if (!head?.editId || !d) {
        throw new ConflictException(
          refusal('TERRITORY_NOTHING_TO_UNDO', 'Nothing to undo.'),
        );
      }
      const all = [d.kept, ...d.made, ...d.archived];
      for (const tid of all) {
        const last = await m.findOne(TerritoryShape, {
          where: { territoryId: tid, congregationId: tenantId },
          order: { createdAt: 'DESC' },
        });
        if (last?.editId !== head.editId) {
          throw new ConflictException(
            refusal('TERRITORY_CHANGED', 'It changed since.'),
          );
        }
      }
      const given = await m
        .createQueryBuilder(TerritoryAssignment, 'a')
        .where('a.territory_id IN (:...ids)', { ids: [d.kept, ...d.made] })
        .andWhere('a.created_at > :at', { at: head.createdAt })
        .getCount();
      if (given > 0) {
        throw new ConflictException(
          refusal('TERRITORY_UNDO_GIVEN', 'Given out since; cannot undo.'),
        );
      }
      // Addresses go back — those still where the application put them; one
      // added since to a made part stops the undo (it would be lost).
      for (const n of d.noCalls) {
        await m.update(
          TerritoryNoCall,
          { id: n.id, congregationId: tenantId, territoryId: n.to },
          { territoryId: n.from },
        );
      }
      if (d.made.length) {
        const left = await m.count(TerritoryNoCall, {
          where: { territoryId: In(d.made), congregationId: tenantId },
        });
        if (left > 0) {
          throw new ConflictException(
            refusal('TERRITORY_CHANGED', 'Addresses were added since.'),
          );
        }
      }
      const kept = await m.findOneOrFail(Territory, {
        where: { id: d.kept, congregationId: tenantId },
      });
      kept.geometry = d.before.geometry;
      kept.lastCompletedOn = d.before.lastCompletedOn;
      kept.workedFrom = d.before.workedFrom;
      await m.save(kept);
      if (d.archived.length) {
        const back = await m.find(Territory, {
          where: { id: In(d.archived), congregationId: tenantId },
        });
        const taken = new Set(
          (
            await m.find(Territory, {
              where: { congregationId: tenantId, archivedAt: IsNull() },
              select: { number: true },
            })
          ).map((t) => norm(t.number)),
        );
        for (const t of back) {
          if (taken.has(norm(t.number))) {
            throw new ConflictException(
              refusal('TERRITORY_NUMBER_TWICE', 'Its number is in use.', {
                number: t.number,
              }),
            );
          }
          t.archivedAt = null;
          await m.save(t);
        }
      }
      for (const tid of d.made) {
        await m.delete(TerritoryShape, { territoryId: tid });
        await m.delete(Territory, { id: tid, congregationId: tenantId });
      }
      // The undo is recorded: the latest outline then says «unrecut».
      const undoId = randomUUID();
      const now = await m.find(Territory, {
        where: { id: In([d.kept, ...d.archived]) },
      });
      await m.save(
        now.map((t) =>
          m.create(TerritoryShape, {
            congregationId: tenantId,
            territoryId: t.id,
            geometry: t.geometry,
            reason: 'unrecut',
            editId: undoId,
            createdByUserId: user.id,
          }),
        ),
      );
      // Back in the draft as it was decided; the borders it was drawn on are
      // the same again.
      await m.update(
        TerritoryRecutProposal,
        { id: p.id },
        { state: 'open', appliedAt: null },
      );
      return { kind: d.kind, number: kept.number };
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: tenantId,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { recut: 'unapplied', ...result },
    });
    return result;
  }

  // ------------------------------------------------------------- holds ----

  /** Held back for a join, or let go. */
  async hold(user: AuthenticatedUser, id: string, dto: RecutHoldDto) {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const number = await this.dataSource.transaction(async (m) => {
      const p = await this.proposal(m, tenantId, id, true);
      if (
        p.state !== 'open' ||
        p.kind !== 'merge' ||
        !p.territoryIds.includes(dto.territoryId)
      ) {
        throw new ConflictException(
          refusal('TERRITORY_RECUT_NOT_READY', 'Only a join holds back.', {
            reason: 'hold',
          }),
        );
      }
      const set = new Set(p.holdIds ?? []);
      if (dto.hold) set.add(dto.territoryId);
      else set.delete(dto.territoryId);
      await m.update(
        TerritoryRecutProposal,
        { id: p.id },
        { holdIds: [...set] },
      );
      const t = await m.findOne(Territory, {
        where: { id: dto.territoryId, congregationId: tenantId },
        select: { id: true, number: true },
      });
      return t?.number ?? '—';
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: dto.territoryId,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { recut: dto.hold ? 'held' : 'released', number },
    });
    return this.waiting(user);
  }

  /**
   * The territories of decided proposals not applied yet, for the keepers'
   * screens: the list, giving out, taking back.
   */
  async waiting(user: AuthenticatedUser): Promise<RecutWaiting[]> {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const m = this.dataSource.manager;
    const recutId = await this.recutId(m, tenantId);
    if (!recutId) return [];
    const ps = await m.find(TerritoryRecutProposal, {
      where: { recutId, state: 'open' },
      order: { queue: 'ASC', createdAt: 'ASC' },
    });
    const decided = ps.filter((p) => p.approvedAt);
    const ids = [...new Set(decided.flatMap((p) => p.territoryIds))];
    if (ids.length === 0) return [];
    const ts = await m.find(Territory, {
      where: { id: In(ids), congregationId: tenantId },
    });
    const byId = new Map(ts.map((t) => [t.id, t]));
    const held = await this.heldSince(m, tenantId, ids);
    const today = await this.today(m, tenantId);
    const met = await this.withMeeting(m, tenantId, ids, today);
    const out: RecutWaiting[] = [];
    for (const p of decided) {
      const live = p.territoryIds.map((x) => byId.get(x));
      if (live.some((t) => !t || t.archivedAt)) continue;
      const list = live as Territory[];
      const s = joinStanding(
        list.map((t) => ({
          id: t.id,
          number: t.number,
          heldSince: held.get(t.id) ?? null,
        })),
      );
      const ready =
        s.waiting.length === 0 &&
        !list.some((t) => met.has(t.id)) &&
        list.every((t) => p.base[t.id] === borderPrint(t.geometry)) &&
        this.shapes(p, list) !== null;
      for (const t of list) {
        out.push({
          territoryId: t.id,
          number: t.number,
          proposalId: p.id,
          kind: p.kind,
          numbers: list.map((x) => x.number),
          ...s,
          hold: (p.holdIds ?? []).includes(t.id),
          ready,
        });
      }
    }
    return out;
  }
}
