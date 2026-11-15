import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { todayIn } from '../common/congregation-clock';
import { refusal } from '../common/errors/refusal';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { mondayOf } from '../common/week';
import { Congregation } from '../entities/congregation.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Publisher } from '../entities/publisher.entity';
import { Hall } from '../entities/hall.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import {
  TerritoryRecut,
  TerritoryRecutProposal,
  TerritoryRecutRemark,
  type RecutMeasure,
  type RecutMetric,
} from '../entities/territory-recut.entity';
import {
  Territory,
  type TerritoryGeometry,
} from '../entities/territory.entity';
import { User } from '../entities/user.entity';
import type {
  RecutMeasureDto,
  RecutProposalDto,
  RecutRemarkDto,
} from './dto/recut.dto';
import { boxesMeet, boxOf, GeometryError, pointInside } from './geometry';
import { housesAround, housesIn, type HousePoint } from './houses';
import {
  classOf,
  DEFAULT_MEASURE,
  joinGroups,
  verdictOf,
  type RecutVerdict,
  joinAll,
  measureProblem,
  movedShare,
  paceOf,
  partsOfCut,
  REOPEN_SHARE,
  type RecutPace,
} from './recut';
import { joinTwo, nextNumber, ReshapeError } from './reshape';
import { driveGraph, minutesFrom, minutesInto, nearestOf } from './recut-drive';
import { cutPlan } from './recut-lines';
import { graphOf } from './way';
import { TerritorySplitsService } from './territory-splits.service';
import { addDays } from './service-year';
import {
  TERRITORY_COMMITTEE,
  TerritoryAccessService,
} from './territory-access.service';

const norm = (n: string): string => n.trim().toLowerCase();

/**
 * A border's fingerprint. Not the row's updated_at: giving out and taking
 * back touch the row too, and only a moved border makes a drawn proposal
 * stale.
 */
export function borderPrint(g: TerritoryGeometry): string {
  return createHash('sha1').update(JSON.stringify(g)).digest('hex');
}

const LINE_CODES: Record<ReshapeError['code'], string> = {
  LINE_SHORT: 'TERRITORY_LINE_BAD',
  LINE_CROSSES_ITSELF: 'TERRITORY_LINE_BAD',
  LINE_NOT_THROUGH: 'TERRITORY_LINE_NOT_THROUGH',
  LINE_MANY_PIECES: 'TERRITORY_LINE_MANY',
  NOT_TOUCHING: 'TERRITORY_NOT_TOUCHING',
  SHAPE_WITH_HOLE: 'TERRITORY_JOIN_HOLE',
  SPLIT_FAILED: 'TERRITORY_LINE_BAD',
  JOIN_FAILED: 'TERRITORY_JOIN_FAILED',
};

/** What stands between a proposal and applying it. */
export type RecutBlock =
  | 'notApproved'
  | 'held'
  | 'meeting'
  | 'changed'
  | 'gone'
  | 'shape';

export interface RecutPartView {
  number: string;
  homes: number | null;
  /** Its walk (km), worked out in the background; null until then. */
  walkKm: number | null;
  geometry: TerritoryGeometry;
}

export interface RecutProposalView {
  id: string;
  kind: 'cut' | 'merge';
  queue: number;
  state: 'open' | 'applied';
  territories: {
    id: string;
    number: string;
    held: boolean;
    meetingOn: string | null;
    changed: boolean;
    geometry: TerritoryGeometry | null;
  }[];
  lines: [number, number][][] | null;
  keep: number;
  numbers: string[] | null;
  keepId: string | null;
  /** As the lines cut the territory now; empty when they no longer can. */
  parts: RecutPartView[];
  approvedAt: string | null;
  reopenedAt: string | null;
  appliedAt: string | null;
  blocks: RecutBlock[];
  remarks: {
    mine: boolean;
    by: string;
    ok: boolean;
    text: string | null;
    at: string;
  }[];
}

/** One territory as the measure sees it. */
export interface RecutTerritoryView {
  id: string;
  number: string;
  homes: number | null;
  walkKm: number | null;
  driveMinutes: number | null;
  /** The nearest hall's name. */
  hall: string | null;
  cls: 'city' | 'far';
  /** The keepers' word over the minutes; null: by the minutes. */
  word: 'city' | 'far' | null;
  /** Null until the figures are worked out. */
  verdict: RecutVerdict | null;
  inProposal: boolean;
}

export interface RecutView {
  measure: RecutMeasure;
  /** When the figures were worked out; null: never. */
  metricsAt: string | null;
  /** The figures are being worked out now. */
  computing: boolean;
  /** The walks of the parts are being worked out now. */
  walking: boolean;
  /** How fast a territory is worked through here, by the S-13; null: too few done. */
  pace: RecutPace | null;
  halls: { name: string; found: boolean }[];
  territories: RecutTerritoryView[];
  /** Draws and changes proposals: the territory servant and his assistant. */
  canEdit: boolean;
  /** Records the service committee's decision. */
  canDecide: boolean;
  proposals: RecutProposalView[];
}

/**
 * The draft of re-cutting the territories (15 November 2026): proposals to
 * cut a large territory or join small neighbours, made by the territory
 * servant, looked at by the service committee, decided by it, and applied
 * one by one as the territories are free. Nothing here changes a territory:
 * applying is the cut and join that exist (territory-reshape.service.ts).
 *
 * Remarks are about borders only; they are deleted with the proposal and
 * once it is applied — the decision stays, the discussion does not.
 */
@Injectable()
export class TerritoryRecutService {
  private readonly logger = new Logger(TerritoryRecutService.name);
  /** Congregations whose figures are being worked out now. */
  private readonly computing = new Set<string>();
  /** Congregations whose parts' walks are being worked out now. */
  private readonly walking = new Set<string>();

  constructor(
    private readonly access: TerritoryAccessService,
    private readonly audit: AuditLogService,
    private readonly dataSource: DataSource,
    private readonly splits: TerritorySplitsService,
  ) {}

  // ---------------------------------------------------------- access -----

  private async mustSee(user: AuthenticatedUser) {
    const a = await this.access.mustSeeAll(user);
    if (!a.verified) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_OPEN', 'The records are not confirmed yet.'),
      );
    }
    return a;
  }

  private async mustEdit(user: AuthenticatedUser) {
    const a = await this.access.mustKeep(user);
    if (!a.verified) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_OPEN', 'The records are not confirmed yet.'),
      );
    }
    return a;
  }

  /** A member of the service committee: he records its decision. */
  private async decides(user: AuthenticatedUser): Promise<boolean> {
    const n = await this.dataSource.manager.count(Responsibility, {
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(TERRITORY_COMMITTEE),
      },
    });
    return n > 0;
  }

  // ----------------------------------------------------------- reads -----

  private async recutOf(
    m: EntityManager,
    tenantId: string,
    create: boolean,
  ): Promise<TerritoryRecut | null> {
    const found = await m.findOne(TerritoryRecut, {
      where: { congregationId: tenantId },
    });
    if (found || !create) return found;
    await m
      .createQueryBuilder()
      .insert()
      .into(TerritoryRecut)
      .values({ congregationId: tenantId, measure: DEFAULT_MEASURE })
      .orIgnore()
      .execute();
    return m.findOneOrFail(TerritoryRecut, {
      where: { congregationId: tenantId },
    });
  }

  private async today(m: EntityManager, tenantId: string): Promise<string> {
    const c = await m.findOne(Congregation, {
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone);
  }

  async view(user: AuthenticatedUser): Promise<RecutView> {
    const a = await this.mustSee(user);
    const m = this.dataSource.manager;
    const tenantId = user.congregationId;
    const recut = await this.recutOf(m, tenantId, false);
    const proposals = recut
      ? await m.find(TerritoryRecutProposal, {
          where: { recutId: recut.id },
          order: { queue: 'ASC', createdAt: 'ASC' },
        })
      : [];
    const ids = [...new Set(proposals.flatMap((p) => p.territoryIds))];
    const territories = ids.length
      ? await m.find(Territory, {
          where: { id: In(ids), congregationId: tenantId },
        })
      : [];
    const byId = new Map(territories.map((t) => [t.id, t]));
    const held = new Set(
      (ids.length
        ? await m.find(TerritoryAssignment, {
            where: {
              territoryId: In(ids),
              congregationId: tenantId,
              completedOn: IsNull(),
              returnedOn: IsNull(),
            },
            select: { territoryId: true },
          })
        : []
      ).map((x) => x.territoryId),
    );
    const today = await this.today(m, tenantId);
    const meetingOn = new Map<string, string>();
    if (ids.length) {
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
      for (const x of meetings) {
        const day = addDays(x.weekStartDate, x.dayOfWeek - 1);
        if (day < today || !x.territoryId) continue;
        const was = meetingOn.get(x.territoryId);
        if (!was || day < was) meetingOn.set(x.territoryId, day);
      }
    }
    const live = territories.filter((t) => !t.archivedAt);
    const homes = live.length
      ? await housesAround(
          m,
          tenantId,
          live.map((t) => t.geometry),
        )
      : null;
    const remarks = proposals.length
      ? await m.find(TerritoryRecutRemark, {
          where: { proposalId: In(proposals.map((p) => p.id)) },
          order: { createdAt: 'ASC' },
        })
      : [];
    const names = await this.namesOf(
      m,
      tenantId,
      remarks.map((r) => r.userId),
    );

    const walks = recut?.walks ?? {};
    const out: RecutProposalView[] = proposals.map((p) => {
      const ts = p.territoryIds.map((id) => byId.get(id));
      const blocks: RecutBlock[] = [];
      const tViews = p.territoryIds.map((id) => {
        const t = byId.get(id);
        const gone = !t || !!t.archivedAt;
        return {
          id,
          number: t?.number ?? '—',
          held: held.has(id),
          meetingOn: meetingOn.get(id) ?? null,
          changed:
            !gone && p.base[id] !== undefined
              ? p.base[id] !== borderPrint(t.geometry)
              : false,
          geometry: gone ? null : t.geometry,
        };
      });
      let parts: RecutPartView[] = [];
      if (p.state === 'open') {
        if (!p.approvedAt) blocks.push('notApproved');
        if (ts.some((t) => !t || t.archivedAt)) blocks.push('gone');
        if (tViews.some((t) => t.held)) blocks.push('held');
        if (tViews.some((t) => t.meetingOn)) blocks.push('meeting');
        if (tViews.some((t) => t.changed)) blocks.push('changed');
      }
      if (p.state === 'open' && !blocks.includes('gone')) {
        try {
          parts = this.partsOf(p, ts as Territory[], homes, walks);
        } catch (e) {
          if (!(e instanceof ReshapeError || e instanceof GeometryError))
            throw e;
          blocks.push('shape');
        }
      }
      return {
        id: p.id,
        kind: p.kind,
        queue: p.queue,
        state: p.state,
        territories: tViews,
        lines: p.lines,
        keep: p.keep,
        numbers: p.numbers,
        keepId: p.keepId,
        parts,
        approvedAt: p.approvedAt?.toISOString() ?? null,
        reopenedAt: p.reopenedAt?.toISOString() ?? null,
        appliedAt: p.appliedAt?.toISOString() ?? null,
        blocks,
        remarks: remarks
          .filter((r) => r.proposalId === p.id)
          .map((r) => ({
            mine: r.userId === user.id,
            by: names.get(r.userId) ?? '—',
            ok: r.ok,
            text: r.text,
            at: r.updatedAt.toISOString(),
          })),
      };
    });
    // A part whose walk is not known yet: worked out in the background.
    if (
      recut &&
      out.some((p) => p.parts.some((x) => !(borderPrint(x.geometry) in walks)))
    )
      this.startWalks(tenantId);
    const measure = recut?.measure ?? DEFAULT_MEASURE;
    const metrics = recut?.metrics ?? null;
    const inProposal = new Set(
      proposals
        .filter((p) => p.state === 'open')
        .flatMap((p) => p.territoryIds),
    );
    const all = await m.find(Territory, {
      where: {
        congregationId: tenantId,
        archivedAt: IsNull(),
        category: 'residential',
      },
      select: { id: true, number: true },
      order: { number: 'ASC' },
    });
    const territoriesView: RecutTerritoryView[] = all.map((t) => {
      const x = metrics?.territories[t.id];
      const word = recut?.classes?.[t.id] ?? null;
      const cls = classOf(x?.driveMinutes ?? null, word ?? undefined, measure);
      return {
        id: t.id,
        number: t.number,
        homes: x?.homes ?? null,
        walkKm: x?.walkKm ?? null,
        driveMinutes: x?.driveMinutes ?? null,
        hall:
          x && x.hall !== null ? (metrics?.halls[x.hall]?.name ?? null) : null,
        cls,
        word,
        verdict: x ? verdictOf(x.walkKm, cls, measure) : null,
        inProposal: inProposal.has(t.id),
      };
    });
    return {
      measure,
      metricsAt: recut?.metricsAt?.toISOString() ?? null,
      computing: this.computing.has(tenantId),
      walking: this.walking.has(tenantId),
      pace: metrics ? await this.paceOf(m, tenantId, metrics) : null,
      halls: metrics?.halls ?? [],
      territories: territoriesView,
      canEdit: a.keeps,
      canDecide: await this.decides(user),
      proposals: out,
    };
  }

  /** The parts a proposal makes of the territories as they are now. */
  private partsOf(
    p: Pick<
      TerritoryRecutProposal,
      'kind' | 'lines' | 'keep' | 'numbers' | 'keepId'
    >,
    ts: Territory[],
    homes: HousePoint[] | null,
    walks: Record<string, number | null> = {},
  ): RecutPartView[] {
    return this.shapesOf(p, ts).map((x) => ({
      number: x.number,
      homes: homes ? housesIn(x.geometry, homes) : null,
      walkKm: walks[borderPrint(x.geometry)] ?? null,
      geometry: x.geometry,
    }));
  }

  /** The outlines a proposal makes of the territories as they are now. */
  private shapesOf(
    p: Pick<
      TerritoryRecutProposal,
      'kind' | 'lines' | 'keep' | 'numbers' | 'keepId'
    >,
    ts: Territory[],
  ): { number: string; geometry: TerritoryGeometry }[] {
    if (p.kind === 'merge') {
      const g = joinAll(ts.map((t) => t.geometry));
      const kept = ts.find((t) => t.id === p.keepId) ?? ts[0];
      return [{ number: kept.number, geometry: g }];
    }
    const t = ts[0];
    const gs = partsOfCut(t.geometry, p.lines ?? []);
    const others = [...(p.numbers ?? [])];
    return gs.map((g, i) => ({
      number: i === p.keep ? t.number : (others.shift() ?? '—'),
      geometry: g,
    }));
  }

  /**
   * The congregation's pace by its S-13: the territories worked through in
   * the last two years, each by its walk now over the days it was out.
   */
  private async paceOf(
    m: EntityManager,
    tenantId: string,
    metrics: { territories: Record<string, RecutMetric> },
  ): Promise<RecutPace | null> {
    const since = addDays(await this.today(m, tenantId), -730);
    const done = await m.find(TerritoryAssignment, {
      where: {
        congregationId: tenantId,
        completedOn: Not(IsNull()),
      },
      select: { territoryId: true, assignedOn: true, completedOn: true },
    });
    const days = (a: string, b: string) =>
      Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
    return paceOf(
      done
        .filter(
          (d) => d.completedOn! >= since && metrics.territories[d.territoryId],
        )
        .map((d) => ({
          walkKm: metrics.territories[d.territoryId].walkKm,
          days: days(d.assignedOn, d.completedOn!),
        })),
    );
  }

  /** Starts working out the parts' walks, once at a time per congregation. */
  private startWalks(tenantId: string): void {
    if (this.walking.has(tenantId) || this.computing.has(tenantId)) return;
    this.walking.add(tenantId);
    void this.workOutWalks(tenantId)
      .catch((e: unknown) =>
        this.logger.warn(
          `recut walks failed: ${(e as Error)?.message ?? String(e)}`,
        ),
      )
      .finally(() => this.walking.delete(tenantId));
  }

  /**
   * The walk of every part of the open proposals, as the territories are
   * divided (walkOf: the streets with homes and the links between them).
   * Kept by the part's border; keys no part has any more are dropped.
   */
  private async workOutWalks(tenantId: string, fresh = false): Promise<void> {
    const m = this.dataSource.manager;
    const recut = await this.recutOf(m, tenantId, false);
    if (!recut) return;
    const proposals = await m.find(TerritoryRecutProposal, {
      where: { recutId: recut.id, state: 'open' },
    });
    const ids = [...new Set(proposals.flatMap((p) => p.territoryIds))];
    const territories = ids.length
      ? await m.find(Territory, {
          where: {
            id: In(ids),
            congregationId: tenantId,
            archivedAt: IsNull(),
          },
        })
      : [];
    const byId = new Map(territories.map((t) => [t.id, t]));
    const was = fresh ? {} : (recut.walks ?? {});
    const next: Record<string, number | null> = {};
    for (const p of proposals) {
      const ts = p.territoryIds.map((id) => byId.get(id));
      if (ts.some((t) => !t)) continue;
      let shapes: { geometry: TerritoryGeometry }[];
      try {
        shapes = this.shapesOf(p, ts as Territory[]);
      } catch (e) {
        if (e instanceof ReshapeError || e instanceof GeometryError) continue;
        throw e;
      }
      for (const x of shapes) {
        const key = borderPrint(x.geometry);
        if (key in next) continue;
        if (key in was) {
          next[key] = was[key];
          continue;
        }
        try {
          const w = await this.splits.walkOf(tenantId, x.geometry);
          next[key] = round1((w.streetM + w.linkM) / 1000);
        } catch (e) {
          this.logger.warn(
            `recut walk of a part failed: ${(e as Error)?.message ?? String(e)}`,
          );
          next[key] = null;
        }
      }
    }
    await m.update(TerritoryRecut, { id: recut.id }, { walks: next });
  }

  /** The names of those who left remarks, as the congregation knows them. */
  private async namesOf(
    m: EntityManager,
    tenantId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = [...new Set(userIds)];
    if (!ids.length) return out;
    const cards = await m.find(Publisher, {
      where: { congregationId: tenantId, userId: In(ids) },
      select: { id: true, userId: true, firstName: true, lastName: true },
    });
    for (const c of cards)
      if (c.userId) out.set(c.userId, `${c.firstName} ${c.lastName}`.trim());
    const rest = ids.filter((id) => !out.has(id));
    if (rest.length) {
      const users = await m.find(User, {
        where: { congregationId: tenantId, id: In(rest) },
        select: { id: true, loginName: true, displayLabel: true },
      });
      for (const u of users)
        out.set(u.id, u.displayLabel ?? u.loginName ?? '—');
    }
    return out;
  }

  // ---------------------------------------------------------- writes -----

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

  async setMeasure(user: AuthenticatedUser, dto: RecutMeasureDto) {
    await this.mustEdit(user);
    const measure: RecutMeasure = {
      cityMaxKm: dto.cityMaxKm,
      cityTargetKm: dto.cityTargetKm,
      remoteMaxKm: dto.remoteMaxKm,
      remoteTargetKm: dto.remoteTargetKm,
      minKm: dto.minKm,
      remoteMinutes: dto.remoteMinutes,
    };
    const problem = measureProblem(measure);
    if (problem) {
      throw new ConflictException(refusal('TERRITORY_RECUT_MEASURE', problem));
    }
    const tenantId = user.congregationId;
    let reopened = 0;
    await this.dataSource.transaction(async (m) => {
      const recut = (await this.recutOf(m, tenantId, true))!;
      const same = JSON.stringify(recut.measure) === JSON.stringify(measure);
      if (same) return;
      await m.update(TerritoryRecut, { id: recut.id }, { measure });
      // The proposals were judged by the old measure: back to the committee.
      const r = await m.update(
        TerritoryRecutProposal,
        { recutId: recut.id, state: 'open', approvedAt: Not(IsNull()) },
        { approvedAt: null, reopenedAt: new Date() },
      );
      reopened = r.affected ?? 0;
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: tenantId,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { recut: 'measure', ...measure, reopened },
    });
    return this.view(user);
  }

  /** The territories of a proposal, checked; refused when one is missing. */
  private async territoriesOf(
    m: EntityManager,
    tenantId: string,
    dto: RecutProposalDto,
  ): Promise<Territory[]> {
    const ids = [...new Set(dto.territoryIds)];
    if (ids.length !== dto.territoryIds.length) {
      throw new ConflictException(
        refusal('TERRITORY_RECUT_PARTS', 'A territory named twice.'),
      );
    }
    if (dto.kind === 'cut' ? ids.length !== 1 : ids.length < 2) {
      throw new ConflictException(
        refusal(
          'TERRITORY_RECUT_PARTS',
          dto.kind === 'cut'
            ? 'A cut is of one territory.'
            : 'A join is of two territories at least.',
        ),
      );
    }
    const ts = await m.find(Territory, {
      where: { id: In(ids), congregationId: tenantId, archivedAt: IsNull() },
    });
    if (ts.length !== ids.length) {
      throw new NotFoundException('Territory not found');
    }
    if (new Set(ts.map((t) => t.category)).size > 1) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_NEIGHBOUR', 'Territories of different kinds.'),
      );
    }
    return ids.map((id) => ts.find((t) => t.id === id)!);
  }

  /** Refused when a territory is in another open proposal of the draft. */
  private async mustBeOnlyHere(
    m: EntityManager,
    recutId: string,
    ts: Territory[],
    except: string | null,
  ): Promise<void> {
    const open = await m.find(TerritoryRecutProposal, {
      where: { recutId, state: 'open' },
      select: { id: true, territoryIds: true },
    });
    for (const p of open) {
      if (p.id === except) continue;
      const t = ts.find((x) => p.territoryIds.includes(x.id));
      if (t) {
        throw new ConflictException(
          refusal('TERRITORY_IN_PROPOSAL', `${t.number} is in a proposal.`, {
            number: t.number,
          }),
        );
      }
    }
  }

  /** The numbers of a cut: free, and not the same twice. */
  private async mustBeFreeNumbers(
    m: EntityManager,
    tenantId: string,
    recutId: string,
    numbers: string[],
    except: string | null,
  ): Promise<string[]> {
    const clean = numbers.map((n) => n.trim());
    const taken = new Set(
      (
        await m.find(Territory, {
          where: { congregationId: tenantId, archivedAt: IsNull() },
          select: { number: true },
        })
      ).map((t) => norm(t.number)),
    );
    const others = await m.find(TerritoryRecutProposal, {
      where: { recutId, state: 'open', kind: 'cut' },
      select: { id: true, numbers: true },
    });
    for (const p of others)
      if (p.id !== except) for (const n of p.numbers ?? []) taken.add(norm(n));
    const seen = new Set<string>();
    for (const n of clean) {
      if (!n || taken.has(norm(n)) || seen.has(norm(n))) {
        throw new ConflictException(
          refusal('TERRITORY_NUMBER_TWICE', 'This number is in use.', {
            number: n,
          }),
        );
      }
      seen.add(norm(n));
    }
    return clean;
  }

  /** Checks a proposal against the territories as they are, and shapes it. */
  private async shaped(
    m: EntityManager,
    tenantId: string,
    recutId: string,
    dto: RecutProposalDto,
    except: string | null,
  ) {
    const ts = await this.territoriesOf(m, tenantId, dto);
    await this.mustBeOnlyHere(m, recutId, ts, except);
    const base = Object.fromEntries(
      ts.map((t) => [t.id, borderPrint(t.geometry)]),
    );
    if (dto.kind === 'merge') {
      if (!dto.keepId || !dto.territoryIds.includes(dto.keepId)) {
        throw new ConflictException(
          refusal('TERRITORY_RECUT_PARTS', 'The number kept is not joined.'),
        );
      }
      try {
        joinAll(ts.map((t) => t.geometry));
      } catch (e) {
        this.shapeRefused(e);
      }
      return {
        ts,
        fields: {
          kind: 'merge' as const,
          territoryIds: dto.territoryIds,
          base,
          lines: null,
          keep: 0,
          numbers: null,
          keepId: dto.keepId,
          queue: dto.queue ?? 1,
        },
      };
    }
    const lines = (dto.lines ?? []).map((l) => lineOf(l.points));
    let parts: TerritoryGeometry[];
    try {
      parts = partsOfCut(ts[0].geometry, lines);
    } catch (e) {
      this.shapeRefused(e);
    }
    const keep = dto.keep ?? 0;
    if (keep >= parts.length || (dto.numbers ?? []).length !== lines.length) {
      throw new ConflictException(
        refusal(
          'TERRITORY_RECUT_PARTS',
          'One new number for each part but the one kept.',
        ),
      );
    }
    const numbers = await this.mustBeFreeNumbers(
      m,
      tenantId,
      recutId,
      dto.numbers ?? [],
      except,
    );
    return {
      ts,
      fields: {
        kind: 'cut' as const,
        territoryIds: dto.territoryIds,
        base,
        lines,
        keep,
        numbers,
        keepId: null,
        queue: dto.queue ?? 1,
      },
    };
  }

  async create(
    user: AuthenticatedUser,
    dto: RecutProposalDto,
  ): Promise<RecutView>;
  async create(
    user: AuthenticatedUser,
    dto: RecutProposalDto,
    quiet: true,
  ): Promise<null>;
  async create(
    user: AuthenticatedUser,
    dto: RecutProposalDto,
    quiet = false,
  ): Promise<RecutView | null> {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const made = await this.dataSource.transaction(async (m) => {
      const recut = (await this.recutOf(m, tenantId, true))!;
      // One proposal at a time per draft: two keepers drawing at once must
      // not put a territory in two proposals.
      await m.query(
        `SELECT id FROM territory_recuts WHERE id = $1 FOR UPDATE`,
        [recut.id],
      );
      const { ts, fields } = await this.shaped(
        m,
        tenantId,
        recut.id,
        dto,
        null,
      );
      const p = await m.save(
        m.create(TerritoryRecutProposal, {
          congregationId: tenantId,
          recutId: recut.id,
          ...fields,
          state: 'open',
        }),
      );
      return { p, numbers: ts.map((t) => t.number) };
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: tenantId,
      action: 'CREATE',
      actorUserId: user.id,
      detail: {
        recut: 'proposal',
        kind: made.p.kind,
        territories: made.numbers,
        parts: made.p.kind === 'cut' ? (made.p.lines?.length ?? 0) + 1 : 1,
      },
    });
    return quiet ? null : this.view(user);
  }

  async update(user: AuthenticatedUser, id: string, dto: RecutProposalDto) {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const result = await this.dataSource.transaction(async (m) => {
      const recut = (await this.recutOf(m, tenantId, true))!;
      await m.query(
        `SELECT id FROM territory_recuts WHERE id = $1 FOR UPDATE`,
        [recut.id],
      );
      const p = await m.findOne(TerritoryRecutProposal, {
        where: { id, recutId: recut.id, state: 'open' },
      });
      if (!p) throw new NotFoundException('Proposal not found');
      const { ts, fields } = await this.shaped(m, tenantId, recut.id, dto, id);
      let reopen = false;
      if (p.approvedAt) {
        if (
          p.kind !== fields.kind ||
          [...p.territoryIds].sort().join() !==
            [...fields.territoryIds].sort().join()
        ) {
          reopen = true;
        } else if (fields.kind === 'cut') {
          const homes =
            (await housesAround(m, tenantId, [ts[0].geometry])) ?? [];
          let before: TerritoryGeometry[] = [];
          try {
            before = partsOfCut(ts[0].geometry, p.lines ?? []);
          } catch {
            before = [];
          }
          const after = partsOfCut(ts[0].geometry, fields.lines);
          reopen = movedShare(before, after, homes) > REOPEN_SHARE;
        }
      }
      await m.update(
        TerritoryRecutProposal,
        { id },
        {
          ...fields,
          ...(reopen ? { approvedAt: null, reopenedAt: new Date() } : {}),
        },
      );
      return { reopen, numbers: ts.map((t) => t.number), kind: fields.kind };
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: tenantId,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: {
        recut: 'proposal',
        kind: result.kind,
        territories: result.numbers,
        reopened: result.reopen,
      },
    });
    return this.view(user);
  }

  async remove(user: AuthenticatedUser, id: string) {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const p = await this.dataSource.manager.findOne(TerritoryRecutProposal, {
      where: { id, congregationId: tenantId },
    });
    if (!p) throw new NotFoundException('Proposal not found');
    // Its remarks go with it (ON DELETE CASCADE).
    await this.dataSource.manager.delete(TerritoryRecutProposal, { id });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: tenantId,
      action: 'DELETE',
      actorUserId: user.id,
      detail: { recut: 'proposal', kind: p.kind },
    });
    return this.view(user);
  }

  async remark(user: AuthenticatedUser, id: string, dto: RecutRemarkDto) {
    await this.mustSee(user);
    const tenantId = user.congregationId;
    const m = this.dataSource.manager;
    const p = await m.findOne(TerritoryRecutProposal, {
      where: { id, congregationId: tenantId, state: 'open' },
    });
    if (!p) throw new NotFoundException('Proposal not found');
    const text = dto.ok ? null : (dto.text ?? '').trim().slice(0, 500);
    if (!dto.ok && !text) {
      throw new ConflictException(
        refusal('TERRITORY_RECUT_PARTS', 'A remark needs words.'),
      );
    }
    await m.query(
      `INSERT INTO territory_recut_remarks (congregation_id, proposal_id, user_id, ok, text)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (proposal_id, user_id) DO UPDATE
         SET ok = EXCLUDED.ok, text = EXCLUDED.text, updated_at = now()`,
      [tenantId, id, user.id, dto.ok, text],
    );
    return this.view(user);
  }

  async unremark(user: AuthenticatedUser, id: string) {
    await this.mustSee(user);
    await this.dataSource.manager.delete(TerritoryRecutRemark, {
      proposalId: id,
      userId: user.id,
      congregationId: user.congregationId,
    });
    return this.view(user);
  }

  /**
   * The service committee decided at its meeting: one of its members
   * records it. Every open proposal not yet decided is decided now.
   */
  async approve(user: AuthenticatedUser) {
    await this.mustSee(user);
    if (!(await this.decides(user))) {
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Requires the service committee.', {
          responsibilities: TERRITORY_COMMITTEE as ResponsibilityType[],
        }),
      );
    }
    const tenantId = user.congregationId;
    const m = this.dataSource.manager;
    const recut = await this.recutOf(m, tenantId, false);
    const r = recut
      ? await m.update(
          TerritoryRecutProposal,
          { recutId: recut.id, state: 'open', approvedAt: IsNull() },
          { approvedAt: new Date(), reopenedAt: null },
        )
      : { affected: 0 };
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: tenantId,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { recut: 'approved', proposals: r.affected ?? 0 },
    });
    return this.view(user);
  }

  // --------------------------------------------------------- figures -----

  /** The streets and the numbered roads in and round an outline. */
  private async roadsAround(
    m: EntityManager,
    tenantId: string,
    g: TerritoryGeometry,
  ): Promise<[number, number][][]> {
    const [x0, y0, x1, y1] = boxOf(g);
    const rows = await m.query<{ lines: [number, number][][] }[]>(
      `SELECT lines FROM map_streets
        WHERE congregation_id = $1 AND east >= $2 AND west <= $3 AND north >= $4 AND south <= $5
       UNION ALL
       SELECT lines FROM map_roads
        WHERE congregation_id = $1 AND east >= $2 AND west <= $3 AND north >= $4 AND south <= $5`,
      [tenantId, x0, x1, y0, y1],
    );
    return rows.flatMap((r) => r.lines);
  }

  /** A hall on our own map, by its official address; null when not found. */
  private async placeOf(
    m: EntityManager,
    tenantId: string,
    address: string,
  ): Promise<[number, number] | null> {
    const key = addressKey(address);
    if (!key) return null;
    const rows = await m.query<{ lon: number; lat: number; street: string }[]>(
      `SELECT lon, lat, street FROM map_addresses
        WHERE congregation_id = $1 AND lower(replace(number, ' ', '')) = $2`,
      [tenantId, key.number],
    );
    const hit = rows.find((r) => streetKey(r.street) === key.street);
    return hit ? [hit.lon, hit.lat] : null;
  }

  /**
   * Works out every residential territory's figures for the measure: its
   * homes, its walk, and the minutes by car from the nearest hall. Takes a
   * while (a graph of all the roads, a walk per territory — longer than a
   * request may wait): started here, done in the background; the view says
   * `computing` until the new figures are in.
   */
  async computeMetrics(user: AuthenticatedUser) {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    if (!this.computing.has(tenantId)) {
      this.computing.add(tenantId);
      void this.workOutFigures(user)
        .catch((e: unknown) =>
          this.logger.warn(
            `recut figures failed: ${(e as Error)?.message ?? String(e)}`,
          ),
        )
        .finally(() => this.computing.delete(tenantId));
    }
    return this.view(user);
  }

  private async workOutFigures(user: AuthenticatedUser): Promise<void> {
    const tenantId = user.congregationId;
    const m = this.dataSource.manager;
    const territories = await m.find(Territory, {
      where: {
        congregationId: tenantId,
        archivedAt: IsNull(),
        category: 'residential',
      },
    });
    const halls = await m.find(Hall, {
      where: { congregationId: tenantId },
      order: { name: 'ASC' },
    });
    const places = await Promise.all(
      halls.map((h) => this.placeOf(m, tenantId, h.address)),
    );
    const roads = await m.query<
      { kind: string; lines: [number, number][][] }[]
    >(
      // The named streets and the roads with only a number between villages.
      `SELECT kind, lines FROM map_streets WHERE congregation_id = $1
       UNION ALL
       SELECT kind, lines FROM map_roads WHERE congregation_id = $1`,
      [tenantId],
    );
    const g = driveGraph(roads);
    const runs = places.map((p) => {
      if (!p || g.pts.length === 0) return null;
      const i = nearestOf(g, p, 300);
      return i === null ? null : minutesFrom(g, i);
    });
    const out: Record<string, RecutMetric> = {};
    for (const t of territories) {
      const w = await this.splits.walkOf(tenantId, t.geometry);
      let best: { min: number; hall: number } | null = null;
      for (let k = 0; k < runs.length; k++) {
        const r = runs[k];
        if (!r) continue;
        const v = minutesInto(g, r, t.geometry);
        if (v !== null && (!best || v < best.min)) best = { min: v, hall: k };
      }
      out[t.id] = {
        number: t.number,
        homes: w.homes,
        walkKm: round1((w.streetM + w.linkM) / 1000),
        driveMinutes: best ? round1(best.min) : null,
        hall: best ? best.hall : null,
      };
    }
    const recut = (await this.recutOf(m, tenantId, true))!;
    await m.update(
      TerritoryRecut,
      { id: recut.id },
      {
        metrics: {
          halls: halls.map((h, k) => ({ name: h.name, found: !!runs[k] })),
          territories: out,
        },
        metricsAt: new Date(),
      },
    );
    // The map may have changed since: every part's walk afresh.
    await this.workOutWalks(tenantId, true);
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: tenantId,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: {
        recut: 'figures',
        territories: territories.length,
        halls: runs.filter(Boolean).length,
      },
    });
  }

  /** The keepers' word: a territory is city or far, whatever the minutes. */
  async setClass(
    user: AuthenticatedUser,
    territoryId: string,
    cls: 'city' | 'far' | null,
  ) {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const t = await this.dataSource.manager.findOne(Territory, {
      where: {
        id: territoryId,
        congregationId: tenantId,
        archivedAt: IsNull(),
      },
      select: { id: true, number: true },
    });
    if (!t) throw new NotFoundException('Territory not found');
    await this.dataSource.transaction(async (m) => {
      const recut = (await this.recutOf(m, tenantId, true))!;
      const classes = { ...(recut.classes ?? {}) };
      if (cls) classes[t.id] = cls;
      else delete classes[t.id];
      await m.update(TerritoryRecut, { id: recut.id }, { classes });
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: t.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { recut: 'class', number: t.number, cls: cls ?? 'minutes' },
    });
    return this.view(user);
  }

  /**
   * A first draft by the measure: every territory too long is cut — lines
   * of even homes through the emptiest stretch — and the small ones are
   * joined with neighbours. Territories already in a proposal are left
   * alone; what a straight line cannot cut is named for the keeper to draw.
   * Joins are round 1, the five longest cuts round 2, the rest round 3.
   */
  async suggest(user: AuthenticatedUser) {
    await this.mustEdit(user);
    const tenantId = user.congregationId;
    const m = this.dataSource.manager;
    const recut = (await this.recutOf(m, tenantId, true))!;
    if (!recut.metrics) {
      throw new ConflictException(
        refusal('TERRITORY_RECUT_NO_FIGURES', 'Work out the figures first.'),
      );
    }
    const measure = recut.measure;
    const open = await m.find(TerritoryRecutProposal, {
      where: { recutId: recut.id, state: 'open' },
      select: { id: true, territoryIds: true },
    });
    const busy = new Set(open.flatMap((p) => p.territoryIds));
    const territories = (
      await m.find(Territory, {
        where: {
          congregationId: tenantId,
          archivedAt: IsNull(),
          category: 'residential',
        },
      })
    ).filter((t) => recut.metrics!.territories[t.id] && !busy.has(t.id));
    const judged = territories.map((t) => {
      const x = recut.metrics!.territories[t.id];
      const cls = classOf(x.driveMinutes, recut.classes?.[t.id], measure);
      return { t, x, cls, verdict: verdictOf(x.walkKm, cls, measure) };
    });
    const made: string[] = [];
    const byHand: string[] = [];
    // Cuts, the longest first.
    const cuts = judged
      .filter((j) => j.verdict.action === 'cut')
      .sort((a, b) => b.x.walkKm - a.x.walkKm);
    const taken = (
      await m.find(Territory, {
        where: { congregationId: tenantId, archivedAt: IsNull() },
        select: { number: true },
      })
    ).map((t) => t.number);
    for (const p of await m.find(TerritoryRecutProposal, {
      where: { recutId: recut.id, state: 'open', kind: 'cut' },
      select: { id: true, numbers: true },
    }))
      taken.push(...(p.numbers ?? []));
    for (const [rank, j] of cuts.entries()) {
      if (j.verdict.action !== 'cut') continue;
      const homes = (
        (await housesAround(m, tenantId, [j.t.geometry])) ?? []
      ).filter((h) => pointInside(h, j.t.geometry));
      const plan = cutPlan(
        j.t.geometry,
        homes,
        j.verdict.parts,
        graphOf(await this.roadsAround(m, tenantId, j.t.geometry)),
      );
      if (!plan) {
        byHand.push(j.t.number);
        continue;
      }
      const keep = plan.homes.indexOf(Math.max(...plan.homes));
      const numbers: string[] = [];
      for (let i = 1; i < plan.homes.length; i++) {
        const n = nextNumber(j.t.number, taken);
        taken.push(n);
        numbers.push(n);
      }
      try {
        await this.create(
          user,
          {
            kind: 'cut',
            territoryIds: [j.t.id],
            lines: plan.lines.map((points) => ({ points })),
            keep,
            numbers,
            queue: rank < 5 ? 2 : 3,
          },
          true,
        );
      } catch (e) {
        // The lines did not read back as the plan cut them: by hand.
        if (!(e instanceof ConflictException)) throw e;
        byHand.push(j.t.number);
        continue;
      }
      made.push(j.t.number);
    }
    // Joins of the small ones with their neighbours.
    const free = judged.filter((j) => j.verdict.action !== 'cut');
    const touch = new Map<string, boolean>();
    const touches = (a: string, b: string): boolean => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!touch.has(key)) {
        const ta = free.find((j) => j.t.id === a)!.t;
        const tb = free.find((j) => j.t.id === b)!.t;
        let yes = false;
        if (boxesMeet(boxOf(ta.geometry), boxOf(tb.geometry))) {
          try {
            joinTwo(ta.geometry, tb.geometry);
            yes = true;
          } catch {
            yes = false;
          }
        }
        touch.set(key, yes);
      }
      return touch.get(key)!;
    };
    const groups = joinGroups(
      free.map((j) => ({
        id: j.t.id,
        walkKm: j.x.walkKm,
        small: j.verdict.action === 'merge',
        target: j.cls === 'far' ? measure.remoteTargetKm : measure.cityTargetKm,
      })),
      touches,
    );
    for (const ids of groups) {
      const members = ids.map((id) => free.find((j) => j.t.id === id)!);
      const keepId = [...members].sort((a, b) => b.x.walkKm - a.x.walkKm)[0].t
        .id;
      try {
        await this.create(
          user,
          { kind: 'merge', territoryIds: ids, keepId, queue: 1 },
          true,
        );
        made.push(members.map((x) => x.t.number).join('+'));
      } catch (e) {
        if (!(e instanceof ConflictException)) throw e;
        byHand.push(members.map((x) => x.t.number).join('+'));
      }
    }
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: tenantId,
      action: 'CREATE',
      actorUserId: user.id,
      detail: { recut: 'suggested', made: made.length, byHand },
    });
    return { ...(await this.view(user)), suggested: { made, byHand } };
  }
}

/** «Sedanstraße 6, 59065 Hamm» → the street and the number, compared loosely. */
export function addressKey(
  address: string,
): { street: string; number: string } | null {
  const head = address.split(',')[0].trim();
  const m = /^(.*?)\s*(\d+\s*[a-zA-Z]?)\s*$/.exec(head);
  if (!m || !m[1]) return null;
  return {
    street: streetKey(m[1]),
    number: m[2].replace(/\s+/g, '').toLowerCase(),
  };
}

export function streetKey(street: string): string {
  return street
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/str(\.|asse|aße)?(?=\s|$|-)/g, 'str')
    .replace(/[^a-z0-9äöü]/g, '');
}

const round1 = (x: number) => Math.round(x * 10) / 10;

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
