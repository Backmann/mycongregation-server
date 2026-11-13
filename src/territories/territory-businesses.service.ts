import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Territory } from '../entities/territory.entity';
import { TerritoryBusiness } from '../entities/territory-business.entity';
import {
  TerritoryBusinessVisit,
  type BusinessVisitState,
} from '../entities/territory-business-visit.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import { Congregation } from '../entities/congregation.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { todayIn } from '../common/congregation-clock';
import { TerritoryAccessService } from './territory-access.service';
import { TerritoryAssignmentsService } from './territory-assignments.service';
import { boxOf, pointInside } from './geometry';
import {
  BUSINESS_KINDS,
  businessGroup,
  handKind,
  type BusinessGroup,
} from './business-kinds';
import { walkOrder } from './business-order';
import type { AddBusinessesDto, EditBusinessDto } from './dto/business.dto';

/** More than any business territory holds; a guard against a runaway add. */
const MAX_BUSINESSES = 400;

export interface BusinessRow {
  id: string;
  /** Its place in the walking order, from 1. */
  n: number;
  name: string;
  kind: string;
  group: BusinessGroup | 'other';
  lon: number | null;
  lat: number | null;
  fromMap: boolean;
  /** Taken from the map, and the map no longer has it (keepers only). */
  gone?: boolean;
  visit: { state: BusinessVisitState; onDate: string } | null;
}

/**
 * The list of a business territory (13 November 2026; mockup «Деловые
 * территории»). The territory servant keeps it — from the map's places or
 * by hand; whoever sees the territory while it is given out (its holder, his
 * group, a meeting's people) marks «visited» or «closed, again later». The
 * marks belong to that assignment and go when the territory comes back.
 */
@Injectable()
export class TerritoryBusinessesService {
  constructor(
    private readonly access: TerritoryAccessService,
    private readonly given: TerritoryAssignmentsService,
    private readonly audit: AuditLogService,
    private readonly dataSource: DataSource,
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    @InjectRepository(TerritoryBusiness)
    private readonly businesses: Repository<TerritoryBusiness>,
    @InjectRepository(TerritoryBusinessVisit)
    private readonly visits: Repository<TerritoryBusinessVisit>,
    @InjectRepository(TerritoryAssignment)
    private readonly assignments: Repository<TerritoryAssignment>,
  ) {}

  // ------------------------------------------------------------ reading --

  /**
   * The list in walking order with this assignment's marks. Keepers and the
   * committee always; anyone else while the territory is theirs to see
   * (holder, group, a meeting going there).
   */
  async list(user: AuthenticatedUser, territoryId: string) {
    const { t, assignmentId, keeps } = await this.seen(user, territoryId);
    const rows = await this.businesses.find({
      where: { territoryId: t.id, congregationId: user.congregationId },
    });
    const marks = assignmentId
      ? await this.visits.find({
          where: {
            assignmentId,
            businessId: In(rows.map((r) => r.id)),
          },
        })
      : [];
    const markOf = new Map(marks.map((v) => [v.businessId, v]));
    const gone = keeps
      ? await this.goneFromMap(user.congregationId, rows)
      : null;
    const items: BusinessRow[] = walkOrder(rows).map((r, i) => {
      const v = markOf.get(r.id);
      return {
        id: r.id,
        n: i + 1,
        name: r.name,
        kind: r.kind,
        group: businessGroup(r.kind) ?? 'other',
        lon: r.lon,
        lat: r.lat,
        fromMap: r.osmId !== null,
        ...(gone ? { gone: gone.has(r.id) } : {}),
        visit: v ? { state: v.state, onDate: v.onDate } : null,
      };
    });
    return {
      territoryId: t.id,
      number: t.number,
      assignmentId,
      items,
      visited: items.filter((i) => i.visit?.state === 'visited').length,
    };
  }

  /**
   * The map's businesses inside the territory not yet on its list
   * (keepers). Grouped by the app; here in walking order.
   */
  async suggest(user: AuthenticatedUser, territoryId: string) {
    await this.access.mustKeep(user);
    const t = await this.businessTerritory(user, territoryId);
    const settings = await this.dataSource.manager.findOne(TerritorySettings, {
      where: { congregationId: user.congregationId },
    });
    const [x0, y0, x1, y1] = boxOf(t.geometry);
    const places = await this.dataSource.query<
      { osm_id: string; kind: string; name: string; lon: number; lat: number }[]
    >(
      `SELECT osm_id, kind, name, lon, lat FROM map_places
        WHERE congregation_id = $1 AND kind = ANY($2)
          AND lat BETWEEN $3 AND $4 AND lon BETWEEN $5 AND $6`,
      [user.congregationId, BUSINESS_KINDS, y0, y1, x0, x1],
    );
    const have = new Set(
      (
        await this.businesses.find({
          where: { territoryId: t.id },
          select: { osmId: true },
        })
      )
        .map((b) => b.osmId)
        .filter((x): x is string => x !== null),
    );
    const inside = places
      .filter((p) => !have.has(String(p.osm_id)))
      .filter((p) => pointInside([p.lon, p.lat], t.geometry))
      .map((p) => ({
        id: String(p.osm_id),
        osmId: String(p.osm_id),
        name: p.name,
        kind: p.kind,
        group: businessGroup(p.kind)!,
        lon: p.lon,
        lat: p.lat,
      }));
    return {
      builtAt: settings?.housesBuiltAt ?? null,
      places: walkOrder(inside).map(({ id: _id, ...p }) => p),
    };
  }

  // ------------------------------------------------------------ keeping --

  /**
   * Adds to the list: places of the map by their id (name, kind and point
   * are the map's, whatever was sent), or businesses typed by hand.
   */
  async add(
    user: AuthenticatedUser,
    territoryId: string,
    dto: AddBusinessesDto,
  ) {
    await this.access.mustKeep(user);
    const t = await this.businessTerritory(user, territoryId);
    const tenantId = user.congregationId;
    const fromMap = (dto.items ?? []).filter((i) => i.osmId);
    const byHand = (dto.items ?? []).filter((i) => !i.osmId);
    const already = await this.businesses.count({
      where: { territoryId: t.id },
    });
    if (already + (dto.items ?? []).length > MAX_BUSINESSES) {
      throw new BadRequestException(
        refusal('TERRITORY_BUSINESSES_MANY', 'Too many businesses.', {
          max: MAX_BUSINESSES,
        }),
      );
    }
    const places = fromMap.length
      ? await this.dataSource.query<
          {
            osm_id: string;
            kind: string;
            name: string;
            lon: number;
            lat: number;
          }[]
        >(
          `SELECT osm_id, kind, name, lon, lat FROM map_places
            WHERE congregation_id = $1 AND osm_id = ANY($2::bigint[])`,
          [tenantId, fromMap.map((i) => i.osmId)],
        )
      : [];
    const have = new Set(
      (
        await this.businesses.find({
          where: { territoryId: t.id },
          select: { osmId: true },
        })
      ).map((b) => b.osmId),
    );
    const rows: TerritoryBusiness[] = [];
    for (const p of places) {
      const id = String(p.osm_id);
      if (have.has(id) || !businessGroup(p.kind)) continue;
      have.add(id);
      rows.push(
        this.businesses.create({
          congregationId: tenantId,
          territoryId: t.id,
          osmId: id,
          name: p.name.slice(0, 160),
          kind: p.kind,
          lon: p.lon,
          lat: p.lat,
          createdByUserId: user.id,
        }),
      );
    }
    for (const i of byHand) {
      const name = (i.name ?? '').trim();
      if (!name) {
        throw new BadRequestException(
          refusal('INVALID_FIELD', 'A business needs a name.', {
            field: 'name',
          }),
        );
      }
      const point = this.pointOf(i.lon, i.lat, t);
      rows.push(
        this.businesses.create({
          congregationId: tenantId,
          territoryId: t.id,
          osmId: null,
          name: name.slice(0, 160),
          kind: handKind(i.kind ?? 'other'),
          lon: point?.[0] ?? null,
          lat: point?.[1] ?? null,
          createdByUserId: user.id,
        }),
      );
    }
    if (rows.length === 0) return { added: 0 };
    await this.businesses.save(rows);
    await this.audit.logFact({
      tenantId,
      entityType: 'territory',
      entityId: t.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: {
        number: t.number,
        businessesAdded: rows.length,
        ...(rows.length === 1 ? { business: rows[0].name } : {}),
      },
    });
    return { added: rows.length };
  }

  async edit(user: AuthenticatedUser, id: string, dto: EditBusinessDto) {
    await this.access.mustKeep(user);
    const b = await this.businessOf(user, id);
    const t = await this.businessTerritory(user, b.territoryId);
    const before = b.name;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException(
          refusal('INVALID_FIELD', 'A business needs a name.', {
            field: 'name',
          }),
        );
      }
      b.name = name.slice(0, 160);
    }
    if (dto.kind !== undefined) b.kind = handKind(dto.kind);
    if (dto.lon !== undefined || dto.lat !== undefined) {
      const point = this.pointOf(dto.lon ?? null, dto.lat ?? null, t);
      b.lon = point?.[0] ?? null;
      b.lat = point?.[1] ?? null;
    }
    const saved = await this.businesses.save(b);
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory',
      entityId: t.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: {
        number: t.number,
        businessEdited: saved.name,
        ...(before !== saved.name ? { businessWas: before } : {}),
      },
    });
    return { id: saved.id };
  }

  async remove(user: AuthenticatedUser, id: string) {
    await this.access.mustKeep(user);
    const b = await this.businessOf(user, id);
    const t = await this.territories.findOne({
      where: { id: b.territoryId, congregationId: user.congregationId },
    });
    await this.businesses.delete({ id: b.id });
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory',
      entityId: b.territoryId,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { number: t?.number ?? '', businessRemoved: b.name },
    });
    return { removed: true };
  }

  // ------------------------------------------------------------- marks ---

  /**
   * «Visited», «closed — again later», or neither, while the territory is
   * given out. Only today's date is kept with it, never who.
   */
  async mark(
    user: AuthenticatedUser,
    id: string,
    state: BusinessVisitState | null,
  ) {
    const b = await this.businessOf(user, id);
    const { assignmentId } = await this.seen(user, b.territoryId);
    if (!assignmentId) {
      throw new ConflictException(
        refusal('TERRITORY_NOT_GIVEN', 'The territory is not given out.'),
      );
    }
    const had = await this.visits.findOne({
      where: { businessId: b.id, assignmentId },
    });
    if (state === null) {
      if (had) await this.visits.delete({ id: had.id });
      return { state: null };
    }
    const today = await this.today(user.congregationId);
    if (had) {
      had.state = state;
      had.onDate = today;
      await this.visits.save(had);
    } else {
      await this.visits.save(
        this.visits.create({
          congregationId: user.congregationId,
          businessId: b.id,
          assignmentId,
          state,
          onDate: today,
        }),
      );
    }
    return { state, onDate: today };
  }

  // ------------------------------------------------------------- inside --

  /**
   * The territory and its open assignment, if the user may see it: the
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
      return { t, assignmentId: open?.id ?? null, keeps: access.keeps };
    }
    const mine = await this.given.mine(user);
    const seen = mine.find((x) => x.id === t.id);
    if (!seen) {
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Not your territory.', {
          responsibilities: [],
        }),
      );
    }
    return { t, assignmentId: seen.assignment.id, keeps: false };
  }

  private async businessTerritory(user: AuthenticatedUser, id: string) {
    const t = await this.territories.findOne({
      where: { id, congregationId: user.congregationId, archivedAt: IsNull() },
    });
    if (!t) throw new NotFoundException('Territory not found');
    if (t.category !== 'business') {
      throw new ConflictException(
        refusal(
          'TERRITORY_NOT_BUSINESS',
          'Only a business territory has a list of businesses.',
        ),
      );
    }
    return t;
  }

  private async businessOf(user: AuthenticatedUser, id: string) {
    const b = await this.businesses.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!b) throw new NotFoundException('Business not found');
    return b;
  }

  /** A point sent with a business: inside its territory, or none. */
  private pointOf(
    lon: number | null | undefined,
    lat: number | null | undefined,
    t: Territory,
  ): [number, number] | null {
    if (lon === null || lon === undefined || lat === null || lat === undefined)
      return null;
    if (!pointInside([lon, lat], t.geometry)) {
      throw new BadRequestException(
        refusal('TERRITORY_BUSINESS_OUTSIDE', 'The point is outside.', {
          number: t.number,
        }),
      );
    }
    return [lon, lat];
  }

  /**
   * Businesses taken from the map that the map no longer has — closed, or
   * renamed beyond recognition. Only once the map has been read since they
   * were taken: a list never looks stale before a new map exists.
   */
  private async goneFromMap(
    tenantId: string,
    rows: TerritoryBusiness[],
  ): Promise<Set<string>> {
    const settings = await this.dataSource.manager.findOne(TerritorySettings, {
      where: { congregationId: tenantId },
    });
    const built = settings?.housesBuiltAt;
    const taken = rows.filter(
      (r) => r.osmId !== null && built && r.createdAt < built,
    );
    if (taken.length === 0) return new Set();
    const still = await this.dataSource.query<{ osm_id: string }[]>(
      `SELECT osm_id FROM map_places
        WHERE congregation_id = $1 AND osm_id = ANY($2::bigint[])`,
      [tenantId, taken.map((r) => r.osmId)],
    );
    const there = new Set(still.map((s) => String(s.osm_id)));
    return new Set(
      taken.filter((r) => !there.has(r.osmId as string)).map((r) => r.id),
    );
  }

  private async today(congregationId: string): Promise<string> {
    const c = await this.dataSource.manager.findOne(Congregation, {
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone);
  }
}
