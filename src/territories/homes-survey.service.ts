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
  /** A few of each kind of disagreement, to look at on the map. */
  samples: Record<
    'homeNowNotByCadastre' | 'notNowHomeByCadastre' | 'unsure' | 'unknown',
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
        lon: number;
        lat: number;
        official: string | null;
        floors: number | null;
        numbers: string | null;
        area_m2: number;
        home: boolean;
      }[]
    >(
      `SELECT lon, lat, official, floors, numbers, area_m2, home
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
    };
    let known = 0;
    for (const h of houses) {
      const use: Use = officialUse(h.official) ?? 'unknown';
      if (use !== 'unknown') {
        known += 1;
        words.set(h.official!, (words.get(h.official!) ?? 0) + 1);
      }
      const t = territoryOf([h.lon, h.lat]);
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
      const kind =
        use === 'not' && h.home
          ? 'homeNowNotByCadastre'
          : use === 'home' && !h.home
            ? 'notNowHomeByCadastre'
            : use === 'unsure' || use === 'unknown'
              ? use
              : null;
      // Random by the order above (md5 of the id): the same sample each time.
      if (kind && samples[kind].length < SAMPLES) {
        samples[kind].push({
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
    return {
      houses: houses.length,
      known,
      table: [...table.values()].sort(
        (a, b) => b.inTerritory + b.outside - (a.inTerritory + a.outside),
      ),
      words: [...words]
        .map(([official, n]) => ({ official, use: officialUse(official)!, n }))
        .sort((a, b) => b.n - a.n),
      samples,
    };
  }
}
