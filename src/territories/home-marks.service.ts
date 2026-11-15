import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Territory } from '../entities/territory.entity';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TerritoryAccessService } from './territory-access.service';
import { boxOf, pointInside } from './geometry';
import { officialUse, type OfficialUse } from './official-use';
import type { HomeMarkDto } from './dto/home-mark.dto';

/** A mark stands on the house whose middle is this close (as in the database). */
const MARK_M = 6;
/** Within this, an official address is a house's own, or names where it stands. */
const ADDRESS_M = 40;

const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
const KY = 110_540;
const metres = (a: [number, number], b: [number, number]) =>
  Math.hypot((a[0] - b[0]) * kx(a[1]), (a[1] - b[1]) * KY);

/** One building of a territory, as the keepers look at it. */
export interface TerritoryHouse {
  /** The map's id of the house, as text. */
  key: string;
  lon: number;
  lat: number;
  areaM2: number;
  numbers: string | null;
  /** «Ahornweg 12» — its own official address; null when it has none. */
  label: string | null;
  /** Without an address of its own: the nearest one and how far. */
  near: { label: string; m: number } | null;
  /** The cadastre's word, and what it means for us; null: unknown. */
  official: string | null;
  use: OfficialUse | null;
  /** Counted as a home now (the mark, else the rule). */
  home: boolean;
  /** What the rule says, without a mark. */
  byRule: boolean;
  /** The keepers' mark; null: none. */
  mark: boolean | null;
  /**
   * A further piece of a building the map draws in several: counted with
   * that house («Ahornweg 12»); null when it is not one.
   */
  pieceOf: string | null;
}

export interface TerritoryHomes {
  territory: { id: string; number: string };
  counts: {
    homes: number;
    notHomes: number;
    /** The cadastre unsure, or not knowing the building. */
    unsure: number;
    marked: number;
    /** Marks whose building is no longer on the map. */
    gone: number;
  };
  houses: TerritoryHouse[];
  /** Marks standing on no building any more: to be taken back. */
  gone: { lon: number; lat: number; home: boolean; markedAt: string }[];
}

/**
 * The homes of a territory and the keepers' marks on them (15 November
 * 2026): «a home» or «not a home» over the rule — a correction of the
 * map, about buildings only. The marks live in map_home_marks; the
 * database applies them (apply_home_marks), so every count of homes —
 * divisions, sizes, the survey — follows at once.
 */
@Injectable()
export class HomeMarksService {
  constructor(
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    private readonly dataSource: DataSource,
    private readonly access: TerritoryAccessService,
    private readonly audit: AuditLogService,
  ) {}

  private async territoryOf(user: AuthenticatedUser, id: string) {
    const t = await this.territories.findOne({
      where: { id, congregationId: user.congregationId, archivedAt: IsNull() },
    });
    if (!t) {
      throw new NotFoundException('Territory not found');
    }
    return t;
  }

  async homesOf(
    user: AuthenticatedUser,
    territoryId: string,
  ): Promise<TerritoryHomes> {
    await this.access.mustKeep(user);
    const t = await this.territoryOf(user, territoryId);
    const cong = user.congregationId;
    const [w, s, e, n] = boxOf(t.geometry);
    // A little round the box: addresses and pieces just over the line.
    const m = 0.0006;
    const rows = await this.dataSource.query<
      {
        key: string;
        lon: number;
        lat: number;
        area_m2: number;
        numbers: string | null;
        official: string | null;
        official_id: string | null;
        home: boolean;
        home_by_rule: boolean;
      }[]
    >(
      `SELECT osm_id::text AS key, lon, lat, area_m2, numbers, official,
              official_id, home, home_by_rule
         FROM map_houses
        WHERE congregation_id = $1
          AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
      [cong, s - m, n + m, w - m, e + m],
    );
    const addresses = await this.dataSource.query<
      { lon: number; lat: number; number: string; street: string }[]
    >(
      `SELECT lon, lat, number, street FROM map_addresses
        WHERE congregation_id = $1
          AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
      [cong, s - m, n + m, w - m, e + m],
    );
    const marks = await this.dataSource.query<
      {
        id: string;
        lon: number;
        lat: number;
        home: boolean;
        updated_at: Date;
      }[]
    >(
      `SELECT id, lon, lat, home, updated_at FROM map_home_marks
        WHERE congregation_id = $1
          AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
      [cong, s - m, n + m, w - m, e + m],
    );
    const found = new Map<string, { markId: string; home: boolean }>();
    for (const f of await this.dataSource.query<
      { mark_id: string; osm_id: string; home: boolean }[]
    >(
      `SELECT mark_id, osm_id::text AS osm_id, home FROM home_marks_found($1)
        WHERE mark_id = ANY($2::uuid[])`,
      [cong, marks.map((x) => x.id)],
    ))
      found.set(f.osm_id, { markId: f.mark_id, home: f.home });
    const foundMarks = new Set([...found.values()].map((f) => f.markId));

    const labelOf = (p: [number, number], numbers: string | null) => {
      const nums = (numbers ?? '')
        .split(';')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      let own: { label: string; m: number } | null = null;
      let near: { label: string; m: number } | null = null;
      for (const a of addresses) {
        const d = metres(p, [a.lon, a.lat]);
        if (d > ADDRESS_M) continue;
        const label = `${a.street} ${a.number}`;
        if (nums.includes(a.number.trim().toLowerCase()) && (!own || d < own.m))
          own = { label, m: d };
        if (!near || d < near.m) near = { label, m: d };
      }
      return { own, near };
    };

    const inside = rows.filter((r) => pointInside([r.lon, r.lat], t.geometry));
    const labels = new Map(
      rows.map((r) => [r.key, labelOf([r.lon, r.lat], r.numbers)]),
    );
    // The house each cadastre building is counted by (the rule's choice).
    const leadOf = new Map<string, string>();
    const shared = new Map<string, number>();
    for (const r of rows) {
      if (!r.official_id) continue;
      shared.set(r.official_id, (shared.get(r.official_id) ?? 0) + 1);
      if (r.home_by_rule && !leadOf.has(r.official_id))
        leadOf.set(r.official_id, r.key);
    }
    const houses: TerritoryHouse[] = inside.map((r) => {
      const use = officialUse(r.official);
      const l = labels.get(r.key)!;
      const lead = r.official_id ? leadOf.get(r.official_id) : undefined;
      const piece =
        !r.home_by_rule &&
        (use === 'home' || use === 'unsure') &&
        (shared.get(r.official_id ?? '') ?? 0) > 1 &&
        lead !== undefined &&
        lead !== r.key;
      const leadLabel = piece ? labels.get(lead!) : null;
      return {
        key: r.key,
        lon: r.lon,
        lat: r.lat,
        areaM2: Math.round(r.area_m2),
        numbers: r.numbers,
        label: l.own?.label ?? null,
        near: l.own
          ? null
          : l.near
            ? { label: l.near.label, m: Math.round(l.near.m) }
            : null,
        official: r.official,
        use,
        home: r.home,
        byRule: r.home_by_rule,
        mark: found.get(r.key)?.home ?? null,
        pieceOf: piece
          ? (leadLabel?.own?.label ?? leadLabel?.near?.label ?? '')
          : null,
      };
    });
    const gone = marks
      .filter(
        (x) => !foundMarks.has(x.id) && pointInside([x.lon, x.lat], t.geometry),
      )
      .map((x) => ({
        lon: x.lon,
        lat: x.lat,
        home: x.home,
        markedAt: new Date(x.updated_at).toISOString(),
      }));
    return {
      territory: { id: t.id, number: t.number },
      counts: {
        homes: houses.filter((h) => h.home).length,
        notHomes: houses.filter((h) => !h.home).length,
        unsure: houses.filter((h) => h.use === 'unsure' || h.use === null)
          .length,
        marked: houses.filter((h) => h.mark !== null).length,
        gone: gone.length,
      },
      houses,
      gone,
    };
  }

  async mark(
    user: AuthenticatedUser,
    territoryId: string,
    dto: HomeMarkDto,
  ): Promise<TerritoryHomes> {
    await this.access.mustKeep(user);
    const t = await this.territoryOf(user, territoryId);
    const cong = user.congregationId;
    const p: [number, number] = [dto.lon, dto.lat];
    if (!pointInside(p, t.geometry)) {
      throw new NotFoundException('No building of this territory here');
    }
    const dLat = MARK_M / KY;
    const dLon = MARK_M / kx(dto.lat);
    await this.dataSource.transaction(async (em) => {
      const [house] = await em.query<
        {
          osm_id: string;
          lon: number;
          lat: number;
          official_id: string | null;
        }[]
      >(
        `SELECT osm_id::text AS osm_id, lon, lat, official_id FROM map_houses
          WHERE congregation_id = $1
            AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5
          ORDER BY power((lon - $6) * ${kx(dto.lat) / KY}, 2) + power(lat - $7, 2)
          LIMIT 1`,
        [
          cong,
          dto.lat - dLat,
          dto.lat + dLat,
          dto.lon - dLon,
          dto.lon + dLon,
          dto.lon,
          dto.lat,
        ],
      );
      // Whatever marks stood on this building, or right here, go first:
      // one mark per building.
      const on = house
        ? await em.query<{ mark_id: string }[]>(
            `SELECT mark_id FROM home_marks_found($1) WHERE osm_id = $2`,
            [cong, house.osm_id],
          )
        : [];
      await em.query(
        `DELETE FROM map_home_marks
          WHERE congregation_id = $1
            AND (id = ANY($2::uuid[])
                 OR (lat BETWEEN $3 AND $4 AND lon BETWEEN $5 AND $6))`,
        [
          cong,
          on.map((x) => x.mark_id),
          dto.lat - dLat,
          dto.lat + dLat,
          dto.lon - dLon,
          dto.lon + dLon,
        ],
      );
      if (dto.home !== null) {
        if (!house) {
          throw new NotFoundException('No building here');
        }
        await em.query(
          `INSERT INTO map_home_marks (congregation_id, official_id, lon, lat, home, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [cong, house.official_id, house.lon, house.lat, dto.home, user.id],
        );
      }
      await em.query(`SELECT apply_home_marks($1)`, [cong]);
    });
    await this.audit.logFact({
      tenantId: cong,
      entityType: 'territory',
      entityId: t.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: {
        number: t.number,
        homeMark: dto.home === null ? 'rule' : dto.home ? 'home' : 'not',
      },
    });
    return this.homesOf(user, territoryId);
  }
}
