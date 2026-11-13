import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { Territory, TerritoryGeometry } from '../entities/territory.entity';
import { TerritoryShape } from '../entities/territory-shape.entity';
import { TerritoryBoundary } from '../entities/territory-boundary.entity';
import {
  TerritoryAssignment,
  TerritoryMethod,
} from '../entities/territory-assignment.entity';
import { TerritoryNoCall } from '../entities/territory-no-call.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Congregation } from '../entities/congregation.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { NO_CALL_REVIEW_DAYS } from './territory-no-calls.service';
import { todayIn } from '../common/congregation-clock';
import { TerritoryAccessService } from './territory-access.service';
import {
  boxOf,
  boxesMeet,
  checkGeometry,
  areaShareOutside,
  GeometryError,
  pointInside,
  metresToOutline,
} from './geometry';
import { sharedGround } from './reshape';
import {
  addDays,
  keptFrom,
  serviceYearOf,
  serviceYearStart,
  TERM_DAYS,
} from './service-year';
import type { EditTerritoryDto } from './dto/card.dto';
import type { TerritoryCategory } from '../entities/territory.entity';
import type {
  ImportAssignmentsDto,
  ImportBoundaryDto,
  ImportNoCallsDto,
  ImportTerritoriesDto,
} from './dto/import.dto';

const norm = (n: string): string => n.trim().toLowerCase();
const PG_UNIQUE_VIOLATION = '23505';
/** A place of houses outside every territory, shown from this many on. */
const GAP_SPOT_MIN = 10;
const GAP_SPOTS = 40;
/** A gap's cell: about 300 m each way in this part of the world. */
const GAP_CELL_X = 0.0045;
const GAP_CELL_Y = 0.0028;
/** Houses a cell needs to join its neighbours into one spot. */
const GAP_CELL_DENSE = 3;

export interface TerritoryGaps {
  builtAt: Date | null;
  hasBoundary: boolean;
  /** Houses inside the boundary that no residential territory holds. */
  houses: number;
  /** Of those, inside a business territory. */
  inBusiness: number;
  /** Spots found, of which the largest GAP_SPOTS are listed. */
  spotCount?: number;
  spots: {
    lon: number;
    lat: number;
    houses: number;
    inBusiness: number;
    near: string | null;
    nearId: string | null;
    nearMetres: number | null;
  }[];
}

/**
 * The territory section (11 November 2026). This first stage holds the
 * records and brings them over from the congregation's earlier tools; giving
 * out, the holder's own view and printing come next.
 */
@Injectable()
export class TerritoriesService {
  constructor(
    private readonly access: TerritoryAccessService,
    private readonly audit: AuditLogService,
    private readonly dataSource: DataSource,
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    @InjectRepository(TerritoryShape)
    private readonly shapes: Repository<TerritoryShape>,
    @InjectRepository(TerritoryBoundary)
    private readonly boundaries: Repository<TerritoryBoundary>,
    @InjectRepository(TerritoryAssignment)
    private readonly assignments: Repository<TerritoryAssignment>,
    @InjectRepository(TerritoryNoCall)
    private readonly noCalls: Repository<TerritoryNoCall>,
    @InjectRepository(TerritorySettings)
    private readonly settings: Repository<TerritorySettings>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(ServiceGroup)
    private readonly groups: Repository<ServiceGroup>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
  ) {}

  private async today(congregationId: string): Promise<string> {
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone);
  }

  /** What the app shows: the door, and what is behind it. */
  async accessOf(user: AuthenticatedUser) {
    const a = await this.access.of(user);
    const verifiedAt = a.verified
      ? await this.access.verifiedAt(user.congregationId)
      : null;
    const count = a.seesAll
      ? await this.territories.count({
          where: { congregationId: user.congregationId, archivedAt: IsNull() },
        })
      : 0;
    const settings = await this.settings.findOne({
      where: { congregationId: user.congregationId },
      select: { congregationId: true, mapBuiltAt: true },
    });
    // The app asks for the map file only once it is there.
    const mapReady = !!settings?.mapBuiltAt;
    return { ...a, verifiedAt, territories: count, mapReady };
  }

  /** Every territory in use, with who has it now. */
  async list(user: AuthenticatedUser) {
    await this.access.mustSeeAll(user);
    const tenantId = user.congregationId;
    const rows = await this.territories.find({
      where: { congregationId: tenantId, archivedAt: IsNull() },
      order: { number: 'ASC' },
    });
    const open = await this.assignments.find({
      where: {
        congregationId: tenantId,
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
    });
    const lastDone = await this.assignments
      .createQueryBuilder('a')
      .select('a.territory_id', 'territoryId')
      // As text: a raw date column comes back as a JS Date.
      .addSelect('MAX(a.completed_on)::text', 'last')
      // A joined territory counts only what was worked after the join.
      .innerJoin('territories', 't', 't.id = a.territory_id')
      .where('a.congregation_id = :tenantId', { tenantId })
      .andWhere('(t.worked_from IS NULL OR a.completed_on >= t.worked_from)')
      .groupBy('a.territory_id')
      .getRawMany<{ territoryId: string; last: string | null }>();
    const lastOf = new Map(lastDone.map((r) => [r.territoryId, r.last]));
    const openOf = new Map(open.map((a) => [a.territoryId, a]));
    // A group's territory held by someone who no longer oversees the group:
    // the keeper is offered to hand it on (11 November 2026).
    const groupIds = [
      ...new Set(open.map((a) => a.forGroupId).filter(Boolean)),
    ] as string[];
    const groups = groupIds.length
      ? await this.groups.find({
          where: { id: In(groupIds), congregationId: tenantId },
          select: { id: true, overseerPublisherId: true },
        })
      : [];
    const overseerOf = new Map(
      groups.map((g) => [g.id, g.overseerPublisherId]),
    );
    const overseerIds = [
      ...new Set(groups.map((g) => g.overseerPublisherId).filter(Boolean)),
    ] as string[];
    const overseerName = new Map(
      (overseerIds.length
        ? await this.publishers.find({
            where: { id: In(overseerIds), congregationId: tenantId },
            select: { id: true, displayName: true },
          })
        : []
      ).map((p) => [p.id, p.displayName]),
    );
    const handOnOf = (a: TerritoryAssignment) => {
      if (!a.forGroupId) return null;
      const to = overseerOf.get(a.forGroupId);
      if (!to || to === a.publisherId) return null;
      return { publisherId: to, name: overseerName.get(to) ?? '' };
    };
    return rows.map((t) => {
      const a = openOf.get(t.id);
      const done = [t.lastCompletedOn, lastOf.get(t.id) ?? null]
        .filter((d): d is string => !!d)
        .sort()
        .pop();
      return {
        id: t.id,
        number: t.number,
        locality: t.locality,
        kind: t.kind,
        category: t.category,
        geometry: t.geometry,
        // The outline editor sends it back: a change in between is refused.
        updatedAt: t.updatedAt,
        lastCompletedOn: done ?? null,
        holder: a
          ? {
              assignmentId: a.id,
              publisherId: a.publisherId,
              name: a.holderName,
              forGroupName: a.forGroupName,
              assignedOn: a.assignedOn,
              dueOn: a.dueOn,
              handOnTo: handOnOf(a),
            }
          : null,
      };
    });
  }

  /**
   * A month of the territories (11 November 2026), for the service
   * committee: given out, worked and handed back in that month, and how
   * things stand now. `month` 'YYYY-MM'; the last full month when left out.
   */
  async summary(user: AuthenticatedUser, month?: string) {
    await this.access.mustSeeAll(user);
    return this.summaryOf(user.congregationId, month);
  }

  async summaryOf(congregationId: string, month?: string) {
    const today = await this.today(congregationId);
    const m = month ?? previousMonth(today);
    const from = `${m}-01`;
    const to = lastDayOf(m);
    const count = async (column: string) =>
      Number(
        (
          await this.assignments
            .createQueryBuilder('a')
            .select('COUNT(*)', 'n')
            .where('a.congregation_id = :congregationId', { congregationId })
            // Brought-over lines count too: they are the congregation's own
            // history with their real days (12 November 2026 — October read
            // «0 given, 0 worked» right after the records came over).
            .andWhere(`a.${column} BETWEEN :from AND :to`, { from, to })
            .getRawOne<{ n: string }>()
        )?.n ?? 0,
      );
    const rows = await this.territories.find({
      where: { congregationId, archivedAt: IsNull() },
      select: { id: true, lastCompletedOn: true },
    });
    const open = await this.assignments.find({
      where: { congregationId, completedOn: IsNull(), returnedOn: IsNull() },
      select: { id: true, territoryId: true, dueOn: true },
    });
    const lastDone = await this.assignments
      .createQueryBuilder('a')
      .select('a.territory_id', 'territoryId')
      .addSelect('MAX(a.completed_on)::text', 'last')
      .innerJoin('territories', 't', 't.id = a.territory_id')
      .where('a.congregation_id = :congregationId', { congregationId })
      .andWhere('(t.worked_from IS NULL OR a.completed_on >= t.worked_from)')
      .groupBy('a.territory_id')
      .getRawMany<{ territoryId: string; last: string | null }>();
    const lastOf = new Map(lastDone.map((r) => [r.territoryId, r.last]));
    const held = new Set(open.map((a) => a.territoryId));
    const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    const idle = rows.filter((t) => {
      if (held.has(t.id)) return false;
      const done = [t.lastCompletedOn, lastOf.get(t.id) ?? null]
        .filter((d): d is string => !!d)
        .sort()
        .pop();
      return !done || done < yearAgo;
    }).length;
    return {
      month: m,
      given: await count('assigned_on'),
      worked: await count('completed_on'),
      returned: await count('returned_on'),
      total: rows.length,
      held: held.size,
      overdue: open.filter((a) => a.dueOn !== null && a.dueOn < today).length,
      idle,
    };
  }

  /**
   * What the S-13 «Данные о назначении участков» of one service year holds
   * (11 November 2026): every territory in use, the day it was last worked
   * before the year began, and the year's assignments in order — those given
   * out in the year and those carried over into it with their old day. Only
   * the kept years (current and previous); only once the records are
   * confirmed. The app lays it out on the form.
   */
  async s13(
    user: AuthenticatedUser,
    serviceYear?: number,
    category: TerritoryCategory = 'residential',
  ) {
    const a = await this.access.mustSeeAll(user);
    if (!a.verified) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_OPEN', 'The records are not confirmed yet.'),
      );
    }
    const tenantId = user.congregationId;
    const today = await this.today(tenantId);
    const current = serviceYearOf(today);
    const year = serviceYear ?? current;
    if (year !== current && year !== current - 1) {
      throw new BadRequestException(
        refusal('TERRITORY_PAST_YEAR', 'Only the kept service years.'),
      );
    }
    const from = serviceYearStart(year);
    const to = addDays(serviceYearStart(year + 1), -1);
    // Business territories have a sheet of their own (12 November 2026).
    const rows = await this.territories.find({
      where: { congregationId: tenantId, archivedAt: IsNull(), category },
    });
    const all = await this.assignments.find({
      where: { congregationId: tenantId },
      order: { assignedOn: 'ASC', createdAt: 'ASC' },
    });
    const byTerritory = new Map<string, TerritoryAssignment[]>();
    for (const x of all) {
      const list = byTerritory.get(x.territoryId) ?? [];
      list.push(x);
      byTerritory.set(x.territoryId, list);
    }
    return {
      serviceYear: year,
      from,
      to,
      territories: rows.map((t) => {
        const list = byTerritory.get(t.id) ?? [];
        const before = [
          t.lastCompletedOn && t.lastCompletedOn < from
            ? t.lastCompletedOn
            : null,
          ...list
            .map((x) => x.completedOn)
            .filter(
              (d): d is string =>
                !!d && d < from && (!t.workedFrom || d >= t.workedFrom),
            ),
        ]
          .filter((d): d is string => !!d)
          .sort()
          .pop();
        const inYear = list.filter((x) => {
          if (x.assignedOn > to) return false;
          const end = x.completedOn ?? x.returnedOn;
          return !end || end >= from;
        });
        return {
          number: t.number,
          lastCompletedBefore: before ?? null,
          assignments: inYear.map((x) => ({
            holderName: x.holderName,
            forGroupName: x.forGroupName,
            assignedOn: x.assignedOn,
            // A day after the year's end belongs to the next sheet.
            completedOn:
              x.completedOn && x.completedOn <= to ? x.completedOn : null,
            method: x.completedOn && x.completedOn <= to ? x.method : null,
          })),
        };
      }),
    };
  }

  /** One territory with its kept history and its «не беспокоить» addresses. */
  // ------------------------------------------------------------ the card --

  /** The territory servant, once the records are confirmed. */
  private async mustKeepOpen(user: AuthenticatedUser): Promise<void> {
    const a = await this.access.mustKeep(user);
    if (!a.verified) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_OPEN', 'The records are not confirmed yet.'),
      );
    }
  }

  private numberTaken(number: string): ConflictException {
    return new ConflictException(
      refusal(
        'TERRITORY_NUMBER_TWICE',
        'Another territory in use has this number.',
        { number },
      ),
    );
  }

  /**
   * The card corrected by hand (12 November 2026): number, place, kind of
   * area, note. A new number shows on every line of the S-13 at once; the
   * old one stays in the journal.
   */
  async editCard(user: AuthenticatedUser, id: string, dto: EditTerritoryDto) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const t = await this.territories.findOne({
      where: { id, congregationId: tenantId, archivedAt: IsNull() },
    });
    if (!t) throw new NotFoundException('Territory not found');
    const before = { number: t.number, locality: t.locality, kind: t.kind };
    const noteBefore = t.note;
    if (dto.number !== undefined) {
      const n = dto.number.trim();
      if (!n) throw this.numberTaken(n);
      if (norm(n) !== norm(t.number)) {
        const others = await this.territories.find({
          where: { congregationId: tenantId, archivedAt: IsNull() },
          select: { id: true, number: true },
        });
        if (others.some((o) => o.id !== t.id && norm(o.number) === norm(n))) {
          throw this.numberTaken(n);
        }
      }
      t.number = n;
    }
    if (dto.locality !== undefined) t.locality = dto.locality?.trim() || null;
    if (dto.kind !== undefined)
      t.kind = (dto.kind as Territory['kind']) ?? null;
    if (dto.note !== undefined) t.note = dto.note?.trim() || null;
    try {
      await this.territories.save(t);
    } catch (e) {
      if ((e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw this.numberTaken(t.number);
      }
      throw e;
    }
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: t.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: {
        before,
        after: { number: t.number, locality: t.locality, kind: t.kind },
        noteChanged: noteBefore !== t.note,
      },
    });
    return {
      id: t.id,
      number: t.number,
      locality: t.locality,
      kind: t.kind,
      category: t.category,
      note: t.note,
    };
  }

  /**
   * Out of use (12 November 2026): only a territory nobody holds. Its S-13
   * lines and history stay until they age out; its number is free again.
   */
  async archive(user: AuthenticatedUser, id: string) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const t = await this.territories.findOne({
      where: { id, congregationId: tenantId, archivedAt: IsNull() },
    });
    if (!t) throw new NotFoundException('Territory not found');
    const held = await this.assignments.count({
      where: {
        territoryId: t.id,
        congregationId: tenantId,
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
    });
    if (held > 0) {
      throw new ConflictException(
        refusal('TERRITORY_HELD', 'Take the territory back first.'),
      );
    }
    t.archivedAt = new Date();
    await this.territories.save(t);
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: t.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { archived: true, number: t.number },
    });
    return { id: t.id, archivedAt: t.archivedAt };
  }

  /** Back into use, if its number is still free. */
  async restore(user: AuthenticatedUser, id: string) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const t = await this.territories.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!t || !t.archivedAt) throw new NotFoundException('Territory not found');
    const others = await this.territories.find({
      where: { congregationId: tenantId, archivedAt: IsNull() },
      select: { id: true, number: true },
    });
    if (others.some((o) => norm(o.number) === norm(t.number))) {
      throw this.numberTaken(t.number);
    }
    t.archivedAt = null;
    try {
      await this.territories.save(t);
    } catch (e) {
      if ((e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw this.numberTaken(t.number);
      }
      throw e;
    }
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: t.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { archived: false, number: t.number },
    });
    return { id: t.id, archivedAt: null };
  }

  /** The territories out of use, for the territory servant. */
  async archived(user: AuthenticatedUser) {
    await this.mustKeepOpen(user);
    const rows = await this.territories.find({
      where: { congregationId: user.congregationId, archivedAt: Not(IsNull()) },
      select: {
        id: true,
        number: true,
        locality: true,
        category: true,
        archivedAt: true,
      },
      order: { number: 'ASC' },
    });
    return rows;
  }

  async detail(user: AuthenticatedUser, id: string) {
    await this.access.mustSeeAll(user);
    const t = await this.territories.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!t) throw new NotFoundException('Territory not found');
    const history = await this.assignments.find({
      where: { territoryId: t.id },
      order: { assignedOn: 'DESC' },
    });
    const noCalls = await this.noCalls.find({
      where: { territoryId: t.id },
      order: { notedOn: 'DESC' },
    });
    // «Last worked» as the list counts it (a joined territory only after
    // the join), so the screen does not work it out again on its own.
    const lastWorkedOn =
      [
        t.lastCompletedOn,
        ...history
          .map((a) => a.completedOn)
          .filter((d) => !!d && (!t.workedFrom || d >= t.workedFrom)),
      ]
        .filter((d): d is string => !!d)
        .sort()
        .pop() ?? null;
    return {
      ...t,
      lastWorkedOn,
      assignments: history,
      noCalls: noCalls.map((n) => ({
        id: n.id,
        address: n.address,
        surname: n.surname,
        notedOn: n.notedOn,
        reviewOn: n.reviewOn,
      })),
    };
  }

  /** The congregation's boundary in force, or null. */
  async boundary(user: AuthenticatedUser) {
    await this.access.mustSeeAll(user);
    return this.currentBoundary(user.congregationId);
  }

  private currentBoundary(congregationId: string) {
    return this.boundaries.findOne({
      where: { congregationId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * What the reconciliation screen must show before the records are
   * confirmed: territories reaching past the boundary, territories laid over
   * each other, holders without a card, and more than one open assignment.
   */
  async checks(user: AuthenticatedUser) {
    await this.access.mustSeeAll(user);
    const tenantId = user.congregationId;
    const rows = await this.territories.find({
      where: { congregationId: tenantId, archivedAt: IsNull() },
      order: { number: 'ASC' },
    });
    const boundary = await this.currentBoundary(tenantId);
    const outside = boundary
      ? rows
          // The share of its ground outside (12 November 2026); a border
          // drawn a hair across is not worth the keeper's time.
          .map((t) => ({
            number: t.number,
            share: Math.round(
              areaShareOutside(t.geometry, boundary.geometry) * 100,
            ),
          }))
          .filter((r) => r.share >= 1)
      : [];
    // Laid over each other: by the ground they share (12 November 2026),
    // a per cent of the smaller one or more, and only within one kind — a
    // business territory lies over homes by design. Corners alone missed an
    // outline slid over its neighbour.
    const boxes = rows.map((t) => boxOf(t.geometry));
    const overlapping: [string, string][] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[i].category !== rows[j].category) continue;
        if (!boxesMeet(boxes[i], boxes[j])) continue;
        if (sharedGround(rows[i].geometry, rows[j].geometry) >= 0.01) {
          overlapping.push([rows[i].number, rows[j].number]);
        }
      }
    }
    const noCard = await this.assignments.count({
      where: { congregationId: tenantId, publisherId: IsNull() },
    });
    return {
      hasBoundary: !!boundary,
      outsideBoundary: outside,
      overlapping,
      assignmentsWithoutCard: noCard,
    };
  }

  /**
   * Houses no territory holds (12 November 2026): from the register, inside
   * the congregation's boundary, in no residential territory. Grouped into
   * spots of about 300 m so the keeper sees places, not 12 000 dots; each
   * spot names the nearest territory. Farms between towns may be outside on
   * purpose — the screen says so; it only shows where they are.
   */
  /**
   * Houses no residential territory holds (12–13 November 2026).
   *
   * The register's houses inside the boundary, less those inside a
   * residential territory. Close ones are joined into spots: a cell of about
   * 300 m with at least three such houses is dense, dense cells that touch
   * (sides or corners) are one spot, and a spot of ten houses or more is
   * listed — so one gap along a border is one spot, not five, and farms
   * scattered across the fields stay only in the total. Each spot names the
   * residential territory whose border is closest, and how many of its
   * houses a business territory holds (an industrial estate looks like
   * houses in the register, which knows outlines, not uses).
   *
   * It reads every house inside the boundary (about a second for a city),
   * so the answer is kept until the register, the boundary or an outline
   * changes.
   */
  async gaps(user: AuthenticatedUser): Promise<TerritoryGaps> {
    await this.access.mustKeep(user);
    const tenantId = user.congregationId;
    const settings = await this.settings.findOne({
      where: { congregationId: tenantId },
    });
    const boundary = await this.currentBoundary(tenantId);
    if (!settings?.housesBuiltAt || !boundary) {
      return {
        builtAt: settings?.housesBuiltAt ?? null,
        hasBoundary: !!boundary,
        houses: 0,
        inBusiness: 0,
        spots: [],
      };
    }
    const rows = await this.territories.find({
      where: { congregationId: tenantId, archivedAt: IsNull() },
      select: { id: true, number: true, geometry: true, category: true },
      order: { id: 'ASC' },
    });
    const sig = createHash('sha1')
      .update(String(settings.housesBuiltAt.getTime()))
      .update(JSON.stringify(boundary.geometry))
      .update(JSON.stringify(rows.map((t) => [t.id, t.category, t.geometry])))
      .digest('hex');
    const kept = this.gapsKept.get(tenantId);
    if (kept && kept.sig === sig) return kept.value;

    const value = await this.countGaps(
      tenantId,
      settings.housesBuiltAt,
      boundary.geometry,
      rows,
    );
    this.gapsKept.set(tenantId, { sig, value });
    return value;
  }

  private readonly gapsKept = new Map<
    string,
    { sig: string; value: TerritoryGaps }
  >();

  private async countGaps(
    tenantId: string,
    builtAt: Date,
    border: TerritoryGeometry,
    rows: Pick<Territory, 'id' | 'number' | 'geometry' | 'category'>[],
  ): Promise<TerritoryGaps> {
    const homes = rows.filter((t) => t.category === 'residential');
    const shops = rows.filter((t) => t.category === 'business');
    const boxesOf = (list: typeof rows) => list.map((t) => boxOf(t.geometry));
    const homeBoxes = boxesOf(homes);
    const shopBoxes = boxesOf(shops);
    const within = (
      p: [number, number],
      list: typeof rows,
      boxes: [number, number, number, number][],
    ) =>
      list.some(
        (t, i) =>
          p[0] >= boxes[i][0] &&
          p[0] <= boxes[i][2] &&
          p[1] >= boxes[i][1] &&
          p[1] <= boxes[i][3] &&
          pointInside(p, t.geometry),
      );
    const [bx0, by0, bx1, by1] = boxOf(border);
    const houses = await this.dataSource.query<{ lon: number; lat: number }[]>(
      `SELECT lon, lat FROM map_houses
        WHERE congregation_id = $1 AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
      [tenantId, by0, by1, bx0, bx1],
    );
    type Cell = {
      cx: number;
      cy: number;
      n: number;
      x: number;
      y: number;
      shop: number;
    };
    const cells = new Map<string, Cell>();
    let total = 0;
    let inBusiness = 0;
    for (const h of houses) {
      const p: [number, number] = [h.lon, h.lat];
      if (!pointInside(p, border)) continue;
      if (within(p, homes, homeBoxes)) continue;
      total += 1;
      const shop = within(p, shops, shopBoxes);
      if (shop) inBusiness += 1;
      const cx = Math.floor(p[0] / GAP_CELL_X);
      const cy = Math.floor(p[1] / GAP_CELL_Y);
      const key = `${cx}:${cy}`;
      const c = cells.get(key) ?? { cx, cy, n: 0, x: 0, y: 0, shop: 0 };
      c.n += 1;
      c.x += p[0];
      c.y += p[1];
      if (shop) c.shop += 1;
      cells.set(key, c);
    }
    // Dense cells that touch are one spot.
    const dense = new Map([...cells].filter(([, c]) => c.n >= GAP_CELL_DENSE));
    const seen = new Set<string>();
    const groups: Cell[][] = [];
    for (const [key] of dense) {
      if (seen.has(key)) continue;
      const group: Cell[] = [];
      const stack = [key];
      seen.add(key);
      while (stack.length) {
        const c = dense.get(stack.pop()!)!;
        group.push(c);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const k = `${c.cx + dx}:${c.cy + dy}`;
            if (dense.has(k) && !seen.has(k)) {
              seen.add(k);
              stack.push(k);
            }
          }
        }
      }
      groups.push(group);
    }
    const spots = groups
      .map((g) => {
        const n = g.reduce((s, c) => s + c.n, 0);
        return {
          n,
          x: g.reduce((s, c) => s + c.x, 0) / n,
          y: g.reduce((s, c) => s + c.y, 0) / n,
          shop: g.reduce((s, c) => s + c.shop, 0),
        };
      })
      .filter((g) => g.n >= GAP_SPOT_MIN)
      .sort((a, b) => b.n - a.n);
    const listed = spots.slice(0, GAP_SPOTS).map((g) => {
      const p: [number, number] = [g.x, g.y];
      let near: (typeof homes)[number] | null = null;
      let metres = Infinity;
      for (const t of homes) {
        const d = metresToOutline(p, t.geometry);
        if (d < metres) {
          metres = d;
          near = t;
        }
      }
      return {
        lon: Math.round(g.x * 1e6) / 1e6,
        lat: Math.round(g.y * 1e6) / 1e6,
        houses: g.n,
        inBusiness: g.shop,
        near: near?.number ?? null,
        nearId: near?.id ?? null,
        nearMetres: near ? Math.round(metres) : null,
      };
    });
    return {
      builtAt,
      hasBoundary: true,
      houses: total,
      inBusiness,
      spotCount: spots.length,
      spots: listed,
    };
  }

  // ------------------------------------------------------------- import ----

  /** The import is open only to keepers, and only before confirming. */
  private async mustImport(user: AuthenticatedUser): Promise<void> {
    const a = await this.access.mustKeep(user);
    if (a.verified) {
      throw new ConflictException(
        refusal(
          'TERRITORY_IMPORT_CLOSED',
          'The records are confirmed; the import is closed.',
        ),
      );
    }
  }

  private geometryOf(raw: unknown, number: string): TerritoryGeometry {
    try {
      return checkGeometry(raw);
    } catch (e) {
      if (e instanceof GeometryError) {
        throw new BadRequestException(
          refusal('TERRITORY_GEOMETRY', `${number}: ${e.message}`, {
            number,
            reason: e.message,
          }),
        );
      }
      throw e;
    }
  }

  async importBoundary(user: AuthenticatedUser, dto: ImportBoundaryDto) {
    await this.mustImport(user);
    const geometry = this.geometryOf(dto.geometry, 'boundary');
    const saved = await this.boundaries.save(
      this.boundaries.create({
        congregationId: user.congregationId,
        geometry,
        description: dto.description ? { ...dto.description } : null,
        validFrom: dto.validFrom ?? null,
        createdByUserId: user.id,
      }),
    );
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory_boundary',
      entityId: saved.id,
      action: 'CREATE',
      actorUserId: user.id,
      detail: { validFrom: saved.validFrom },
    });
    return { id: saved.id };
  }

  /** Territories by number: new ones are added, known ones updated. */
  async importTerritories(user: AuthenticatedUser, dto: ImportTerritoriesDto) {
    await this.mustImport(user);
    const tenantId = user.congregationId;
    const seen = new Set<string>();
    for (const item of dto.items) {
      const key = norm(item.number);
      if (seen.has(key)) {
        throw new BadRequestException(
          refusal('TERRITORY_NUMBER_TWICE', `${item.number} appears twice`, {
            number: item.number,
          }),
        );
      }
      seen.add(key);
    }
    const checked = dto.items.map((item) => ({
      item,
      geometry: this.geometryOf(item.geometry, item.number),
    }));
    const existing = await this.territories.find({
      where: { congregationId: tenantId, archivedAt: IsNull() },
    });
    const byNumber = new Map(existing.map((t) => [norm(t.number), t]));
    let created = 0;
    let updated = 0;
    await this.dataSource.transaction(async (m) => {
      for (const { item, geometry } of checked) {
        const known = byNumber.get(norm(item.number));
        if (!known) {
          const t = await m.save(
            m.create(Territory, {
              congregationId: tenantId,
              number: item.number.trim(),
              locality: item.locality?.trim() || null,
              kind: (item.kind as Territory['kind']) ?? null,
              geometry,
              lastCompletedOn: item.lastCompletedOn ?? null,
            }),
          );
          await m.save(
            m.create(TerritoryShape, {
              congregationId: tenantId,
              territoryId: t.id,
              geometry,
              reason: 'import',
              createdByUserId: user.id,
            }),
          );
          created++;
        } else {
          const changed =
            JSON.stringify(known.geometry) !== JSON.stringify(geometry);
          known.locality = item.locality?.trim() || null;
          known.kind = (item.kind as Territory['kind']) ?? known.kind;
          known.lastCompletedOn = item.lastCompletedOn ?? known.lastCompletedOn;
          if (changed) {
            known.geometry = geometry;
            await m.save(
              m.create(TerritoryShape, {
                congregationId: tenantId,
                territoryId: known.id,
                geometry,
                reason: 'import',
                createdByUserId: user.id,
              }),
            );
          }
          await m.save(known);
          updated++;
        }
      }
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory_import',
      entityId: tenantId,
      action: 'CREATE',
      actorUserId: user.id,
      detail: { territories: { created, updated } },
    });
    return { created, updated };
  }

  /**
   * The assignments of the territories named in the batch replace what an
   * earlier import brought for them. Only the kept service years come in;
   * older lines are counted and left out (their last «worked» date travels
   * as the territory's own lastCompletedOn).
   */
  async importAssignments(user: AuthenticatedUser, dto: ImportAssignmentsDto) {
    await this.mustImport(user);
    const tenantId = user.congregationId;
    const today = await this.today(tenantId);
    const from = keptFrom(today);
    const numbers = [...new Set(dto.items.map((i) => norm(i.number)))];
    const known = await this.territories.find({
      where: { congregationId: tenantId, archivedAt: IsNull() },
    });
    const byNumber = new Map(known.map((t) => [norm(t.number), t]));
    for (const n of numbers) {
      if (!byNumber.has(n)) {
        throw new BadRequestException(
          refusal('TERRITORY_UNKNOWN', `No territory ${n}`, { number: n }),
        );
      }
    }
    const pubIds = [
      ...new Set(dto.items.map((i) => i.publisherId).filter(Boolean)),
    ] as string[];
    const pubs = pubIds.length
      ? await this.publishers.find({
          where: { id: In(pubIds), congregationId: tenantId },
          select: { id: true },
        })
      : [];
    const pubOk = new Set(pubs.map((p) => p.id));
    const groupIds = [
      ...new Set(dto.items.map((i) => i.forGroupId).filter(Boolean)),
    ] as string[];
    const groups = groupIds.length
      ? await this.groups.find({
          where: { id: In(groupIds), congregationId: tenantId },
        })
      : [];
    const groupName = new Map(groups.map((g) => [g.id, g.name]));

    let skipped = 0;
    const keep: TerritoryAssignment[] = [];
    const openPer = new Map<string, number>();
    for (const i of dto.items) {
      const end = i.completedOn ?? i.returnedOn ?? null;
      const bad = (why: string) =>
        new BadRequestException(
          refusal('TERRITORY_DATES', `${i.number}: ${why}`, {
            number: i.number,
            assignedOn: i.assignedOn,
          }),
        );
      if (i.completedOn && i.returnedOn) throw bad('worked and returned');
      if (i.assignedOn > today || (end && end > today)) throw bad('future');
      if (end && end < i.assignedOn) throw bad('ends before it starts');
      if (i.publisherId && !pubOk.has(i.publisherId)) {
        throw new BadRequestException(
          refusal('TERRITORY_HOLDER_UNKNOWN', `${i.number}: unknown card`, {
            number: i.number,
          }),
        );
      }
      if (end && end < from) {
        skipped++;
        continue;
      }
      const t = byNumber.get(norm(i.number))!;
      if (!end) {
        const n = (openPer.get(t.id) ?? 0) + 1;
        openPer.set(t.id, n);
        if (n > 1) {
          throw new BadRequestException(
            refusal('TERRITORY_TWO_OPEN', `${i.number}: two open`, {
              number: i.number,
            }),
          );
        }
      }
      keep.push(
        this.assignments.create({
          congregationId: tenantId,
          territoryId: t.id,
          publisherId: i.publisherId ?? null,
          holderName: i.holderName.trim(),
          forGroupId:
            i.forGroupId && groupName.has(i.forGroupId) ? i.forGroupId : null,
          forGroupName: i.forGroupId
            ? (groupName.get(i.forGroupId) ?? null)
            : null,
          assignedOn: i.assignedOn,
          dueOn: end ? null : addDays(i.assignedOn, TERM_DAYS),
          completedOn: i.completedOn ?? null,
          returnedOn: i.returnedOn ?? null,
          method:
            (i.method as TerritoryMethod) ??
            (i.completedOn ? 'door_to_door' : null),
          imported: true,
          createdByUserId: user.id,
        }),
      );
    }
    const territoryIds = numbers.map((n) => byNumber.get(n)!.id);
    await this.dataSource.transaction(async (m) => {
      await m.delete(TerritoryAssignment, {
        congregationId: tenantId,
        territoryId: In(territoryIds),
        imported: true,
      });
      await m.save(keep);
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory_import',
      entityId: tenantId,
      action: 'CREATE',
      actorUserId: user.id,
      detail: { assignments: { saved: keep.length, skipped } },
    });
    return { saved: keep.length, skipped };
  }

  /** «Не беспокоить» of the territories named replace earlier ones. */
  async importNoCalls(user: AuthenticatedUser, dto: ImportNoCallsDto) {
    await this.mustImport(user);
    const tenantId = user.congregationId;
    const known = await this.territories.find({
      where: { congregationId: tenantId, archivedAt: IsNull() },
    });
    const byNumber = new Map(known.map((t) => [norm(t.number), t]));
    const today = await this.today(tenantId);
    const rows = dto.items.map((i) => {
      const t = byNumber.get(norm(i.number));
      if (!t) {
        throw new BadRequestException(
          refusal('TERRITORY_UNKNOWN', `No territory ${i.number}`, {
            number: i.number,
          }),
        );
      }
      if (i.notedOn > today) {
        throw new BadRequestException(
          refusal('TERRITORY_DATES', `${i.number}: future`, {
            number: i.number,
          }),
        );
      }
      return this.noCalls.create({
        congregationId: tenantId,
        territoryId: t.id,
        address: i.address.trim(),
        surname: i.surname?.trim() || null,
        notedOn: i.notedOn,
        reviewOn: addDays(i.notedOn, NO_CALL_REVIEW_DAYS),
        createdByUserId: user.id,
      });
    });
    const ids = [...new Set(rows.map((r) => r.territoryId))];
    await this.dataSource.transaction(async (m) => {
      if (ids.length) {
        await m.delete(TerritoryNoCall, {
          congregationId: tenantId,
          territoryId: In(ids),
        });
      }
      await m.save(rows);
    });
    return { saved: rows.length };
  }

  /** Start the import over: everything brought in so far goes. */
  async reset(user: AuthenticatedUser) {
    await this.mustImport(user);
    const tenantId = user.congregationId;
    await this.dataSource.transaction(async (m) => {
      await m.delete(TerritoryAssignment, { congregationId: tenantId });
      await m.delete(TerritoryNoCall, { congregationId: tenantId });
      await m.delete(TerritoryShape, { congregationId: tenantId });
      await m.delete(Territory, { congregationId: tenantId });
      await m.delete(TerritoryBoundary, { congregationId: tenantId });
    });
    await this.audit.logFact({
      tenantId,
      entityType: 'territory_import',
      entityId: tenantId,
      action: 'DELETE',
      actorUserId: user.id,
      detail: { reset: true },
    });
    return { ok: true };
  }

  /**
   * «Данные проверены»: the section opens to the service committee, and the
   * import closes. Refused while there is nothing to confirm.
   */
  async verify(user: AuthenticatedUser) {
    await this.mustImport(user);
    const tenantId = user.congregationId;
    const count = await this.territories.count({
      where: { congregationId: tenantId, archivedAt: IsNull() },
    });
    if (count === 0) {
      throw new BadRequestException(
        refusal('TERRITORY_NONE', 'There are no territories to confirm.'),
      );
    }
    const now = new Date();
    await this.settings.save(
      this.settings.create({
        congregationId: tenantId,
        verifiedAt: now,
        verifiedByUserId: user.id,
      }),
    );
    await this.audit.logFact({
      tenantId,
      entityType: 'territory_settings',
      entityId: tenantId,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { verified: true, territories: count },
    });
    return { verifiedAt: now };
  }
}

/** 'YYYY-MM' of the month before the one `today` is in. */
function previousMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The last day of a 'YYYY-MM' month. */
function lastDayOf(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
