import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Territory } from '../entities/territory.entity';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TerritoryAccessService } from './territory-access.service';
import { boxOf, pointInside } from './geometry';
import { officialUse, type OfficialUse } from './official-use';

type Use = OfficialUse | 'unknown';

/** One building shown to be looked at on the map. */
export interface SurveyHouse {
  lon: number;
  lat: number;
  official: string | null;
  floors: number | null;
  numbers: string | null;
  areaM2: number;
  home: boolean;
  /** The territory it lies in; null: in none. */
  territory: string | null;
}

export interface HomesSurvey {
  houses: number;
  /** How many the cadastre knows. */
  known: number;
  /** Buildings by what the cadastre says × what the app counts now, in a territory or not. */
  table: {
    use: Use;
    homeNow: boolean;
    inTerritory: number;
    outside: number;
  }[];
  /** The cadastre's words and how many buildings each. */
  words: { official: string; use: OfficialUse; n: number }[];
  /**
   * The rule (homes_rule in the database) against what is stored, homes inside a
   * territory: how many now and then, how many it adds and drops, and how
   * many houses are only further pieces of one building.
   */
  rule: {
    now: number;
    then: number;
    added: number;
    dropped: number;
    pieces: number;
    /** Cadastre buildings drawn in several pieces, inside a territory. */
    inPieces: number;
  };
  /** A few of each kind of disagreement, to look at on the map. */
  samples: Record<
    | 'homeNowNotByCadastre'
    | 'notNowHomeByCadastre'
    | 'unsure'
    | 'unknown'
    | 'added'
    | 'piece',
    SurveyHouse[]
  >;
}

const SAMPLES = 40;

/**
 * The homes survey (14 November 2026): before the cadastre decides what a
 * home is, how many buildings it would move, and which — for the keepers
 * to look at. Changes nothing.
 */
@Injectable()
export class HomesSurveyService {
  constructor(
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    private readonly dataSource: DataSource,
    private readonly access: TerritoryAccessService,
  ) {}

  async survey(user: AuthenticatedUser): Promise<HomesSurvey> {
    await this.access.mustKeep(user);
    const tenantId = user.congregationId;
    const rows = await this.territories.find({
      where: { congregationId: tenantId, archivedAt: IsNull() },
      select: { id: true, number: true, geometry: true, category: true },
    });
    const homes = rows.filter((t) => t.category === 'residential');
    const boxes = homes.map((t) => boxOf(t.geometry));
    const territoryOf = (p: [number, number]) => {
      for (let i = 0; i < homes.length; i++) {
        const b = boxes[i];
        if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
        if (pointInside(p, homes[i].geometry)) return homes[i].number;
      }
      return null;
    };
    const houses = await this.dataSource.query<
      {
        osm_id: string;
        lon: number;
        lat: number;
        official: string | null;
        official_id: string | null;
        floors: number | null;
        numbers: string | null;
        area_m2: number;
        home: boolean;
      }[]
    >(
      `SELECT osm_id::text AS osm_id, lon, lat, official, official_id, floors, numbers, area_m2, home
         FROM map_houses WHERE congregation_id = $1
        ORDER BY md5(osm_id::text)`,
      [tenantId],
    );
    const table = new Map<string, HomesSurvey['table'][number]>();
    const words = new Map<string, number>();
    const samples: HomesSurvey['samples'] = {
      homeNowNotByCadastre: [],
      notNowHomeByCadastre: [],
      unsure: [],
      unknown: [],
      added: [],
      piece: [],
    };
    // The rule as the map build applies it (homes_rule, one authority):
    // after a build «then» equals «now»; before, it shows what would move.
    const ruled = await this.dataSource.query<
      { osm_id: string; home: boolean }[]
    >(`SELECT osm_id::text AS osm_id, home FROM homes_rule($1)`, [tenantId]);
    const then = new Map(ruled.map((r) => [r.osm_id, r.home]));
    const rule = {
      now: 0,
      then: 0,
      added: 0,
      dropped: 0,
      pieces: 0,
      inPieces: 0,
    };
    const piecesOf = new Map<string, number>();
    // How many houses of the map share each cadastre building.
    const shared = new Map<string, number>();
    for (const h of houses)
      if (h.official_id)
        shared.set(h.official_id, (shared.get(h.official_id) ?? 0) + 1);
    let known = 0;
    for (const h of houses) {
      const use: Use = officialUse(h.official) ?? 'unknown';
      if (use !== 'unknown') {
        known += 1;
        words.set(h.official!, (words.get(h.official!) ?? 0) + 1);
      }
      const t = territoryOf([h.lon, h.lat]);
      const byRule = then.get(h.osm_id) ?? h.home;
      // A further piece of a building drawn in several: what the rule
      // leaves out for that reason alone.
      const piece =
        !byRule &&
        (use === 'home' || use === 'unsure') &&
        (shared.get(h.official_id ?? '') ?? 0) > 1;
      if (t) {
        if (h.home) rule.now += 1;
        if (byRule) rule.then += 1;
        if (byRule && !h.home) rule.added += 1;
        if (!byRule && h.home) rule.dropped += 1;
        if (piece) {
          rule.pieces += 1;
          piecesOf.set(h.official_id!, (piecesOf.get(h.official_id!) ?? 0) + 1);
        }
      }
      const key = `${use}:${h.home}`;
      const row = table.get(key) ?? {
        use,
        homeNow: h.home,
        inTerritory: 0,
        outside: 0,
      };
      if (t) row.inTerritory += 1;
      else row.outside += 1;
      table.set(key, row);
      const extra: (keyof HomesSurvey['samples'])[] = [];
      if (t && byRule && !h.home) extra.push('added');
      if (t && piece) extra.push('piece');
      const kind =
        use === 'not' && h.home
          ? 'homeNowNotByCadastre'
          : use === 'home' && !h.home
            ? 'notNowHomeByCadastre'
            : use === 'unsure' || use === 'unknown'
              ? use
              : null;
      // Random by the order above (md5 of the id): the same sample each time.
      for (const k of [kind, ...extra]) {
        if (!k || samples[k].length >= SAMPLES) continue;
        samples[k].push({
          lon: h.lon,
          lat: h.lat,
          official: h.official,
          floors: h.floors,
          numbers: h.numbers,
          areaM2: h.area_m2,
          home: h.home,
          territory: t,
        });
      }
    }
    rule.inPieces = piecesOf.size;
    return {
      houses: houses.length,
      known,
      table: [...table.values()].sort(
        (a, b) => b.inTerritory + b.outside - (a.inTerritory + a.outside),
      ),
      rule,
      words: [...words]
        .map(([official, n]) => ({ official, use: officialUse(official)!, n }))
        .sort((a, b) => b.n - a.n),
      samples,
    };
  }
}
