import { MigrationInterface, QueryRunner } from 'typeorm';
import { MapHomes1930700000000 } from './1930700000000-MapHomes';

/**
 * Homes by the cadastre (15 November 2026). The rule of MapHomes (addresses
 * and size) stays the first word; the cadastre (map_houses.official, filled
 * by the map build) may only take away:
 *
 *  - not a home by the cadastre (a barn, a workshop, a garage, a school …):
 *    not a home;
 *  - a building the map draws in several pieces is not several homes: a
 *    piece with a house number of its own stays one (a semi-detached house
 *    is often one building in the cadastre, two front doors on the map),
 *    pieces without a number are one with the rest — only when no piece has
 *    a number, the biggest of them is the home;
 *  - a home or unsure by the cadastre, or a building it does not know: as
 *    the rule of MapHomes says. The cadastre never adds a home: the small
 *    «Wohngebäude» without an address of its own were annexes, looked at.
 *
 * ONE authority: homes_rule() says it; mark_homes() writes it (the map
 * build), the homes survey reads it. official_use() mirrors officialUse()
 * in src/territories/official-use.ts (a test holds the two together).
 */
export class HomesByCadastre1931000000000 implements MigrationInterface {
  name = 'HomesByCadastre1931000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION official_use(w text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $fn$
        SELECT CASE
          WHEN w IS NULL OR btrim(w) = '' THEN NULL
          WHEN w ~* 'wohn|bauernhaus|forsthaus' THEN 'home'
          WHEN w ~* 'sonstig|nicht zu spezifizieren|soziale zwecke|heim|pflege|heilanstalt|kloster|erholungszwecke|ferienhaus|wochenend|hotel|pension|gasthaus|beherbergung' THEN 'unsure'
          ELSE 'not'
        END
      $fn$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION homes_rule(cong uuid)
      RETURNS TABLE (osm_id bigint, home boolean)
      LANGUAGE sql STABLE AS $fn$
        WITH k AS (
          -- Metres a degree of longitude, at the middle of the area.
          SELECT 111320 * cos(radians(avg(lat))) AS kx
            FROM map_houses WHERE congregation_id = cong
        ),
        hs AS (
          SELECT h.osm_id, h.lon, h.lat, h.area_m2, h.numbers,
                 (h.numbers IS NOT NULL AND h.numbers <> '') AS numbered,
                 floor(h.lon * k.kx / 40)::bigint AS cx,
                 floor(h.lat * 110540 / 40)::bigint AS cy,
                 floor(h.lon * k.kx / 200)::bigint AS gx,
                 floor(h.lat * 110540 / 200)::bigint AS gy
            FROM map_houses h, k
           WHERE h.congregation_id = cong
        ),
        ad AS (
          SELECT a.oid, a.lon, a.lat, lower(a.number) AS num,
                 floor(a.lon * k.kx / 40)::bigint AS cx,
                 floor(a.lat * 110540 / 40)::bigint AS cy,
                 floor(a.lon * k.kx / 200)::bigint AS gx,
                 floor(a.lat * 110540 / 200)::bigint AS gy
            FROM map_addresses a, k
           WHERE a.congregation_id = cong
        ),
        off AS (
          SELECT dx, dy FROM generate_series(-1, 1) dx, generate_series(-1, 1) dy
        ),
        -- Each address with the houses in its square of 40 m and round it.
        pairs AS (
          SELECT h.osm_id, h.numbered, h.numbers, a.oid, a.num,
                 sqrt(power((h.lon - a.lon) * k.kx, 2)
                    + power((h.lat - a.lat) * 110540, 2)) AS d
            FROM ad a
           CROSS JOIN off o
            JOIN hs h ON h.cx = a.cx + o.dx AND h.cy = a.cy + o.dy
           CROSS JOIN k
        ),
        -- Addresses a house of the map with that number stands at: each
        -- number of a house takes its nearest address within 40 m — not the
        -- same number of the next street round the corner.
        claimed AS (
          SELECT DISTINCT ON (osm_id, num) oid FROM pairs
           WHERE numbered AND d <= 40
             AND num = ANY (string_to_array(lower(numbers), ';'))
           ORDER BY osm_id, num, d
        ),
        -- Houses without a number on an address of their own (20 m).
        own AS (
          SELECT DISTINCT osm_id FROM pairs
           WHERE NOT numbered AND d <= 20
             AND oid NOT IN (SELECT oid FROM claimed)
        ),
        -- Squares of 200 m the register has addresses in or next to.
        covered AS (
          SELECT DISTINCT a.gx + o.dx AS gx, a.gy + o.dy AS gy
            FROM ad a CROSS JOIN off o
        ),
        verdict AS (
          SELECT h.osm_id,
                 h.numbered
              OR h.area_m2 >= 150
              -- No addresses round here: the register cannot tell.
              OR NOT EXISTS (SELECT 1 FROM covered c WHERE c.gx = h.gx AND c.gy = h.gy)
              OR h.osm_id IN (SELECT osm_id FROM own) AS home
            FROM hs h
        ),
        r AS (
          SELECT h.osm_id, h.official_id, h.area_m2, v.home AS by_address,
                 official_use(h.official) AS use,
                 lower(regexp_replace(coalesce(h.numbers, ''), '\\s', '', 'g')) AS nums
            FROM map_houses h
            JOIN verdict v ON v.osm_id = h.osm_id
           WHERE h.congregation_id = cong
        ),
        pieces AS (
          SELECT r.osm_id,
                 CASE WHEN r.nums <> '' THEN
                   -- A number of its own in this building: one per number.
                   row_number() OVER (PARTITION BY r.official_id, r.nums
                                      ORDER BY r.area_m2 DESC, r.osm_id) = 1
                 ELSE
                   -- No number: only when no piece has one, the biggest.
                   NOT bool_or(r.nums <> '') OVER (PARTITION BY r.official_id)
                   AND row_number() OVER (PARTITION BY r.official_id, (r.nums = '')
                                          ORDER BY r.area_m2 DESC, r.osm_id) = 1
                 END AS keep
            FROM r
           WHERE r.official_id IS NOT NULL AND r.use IN ('home', 'unsure')
        )
        SELECT r.osm_id,
               r.by_address
               AND r.use IS DISTINCT FROM 'not'
               AND coalesce(p.keep, true)
          FROM r LEFT JOIN pieces p ON p.osm_id = r.osm_id
      $fn$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION mark_homes(cong uuid) RETURNS integer
      LANGUAGE sql AS $fn$
        WITH changed AS (
          UPDATE map_houses h SET home = v.home
            FROM homes_rule(cong) v
           WHERE h.congregation_id = cong AND h.osm_id = v.osm_id
             AND h.home IS DISTINCT FROM v.home
          RETURNING 1
        )
        SELECT count(*)::integer FROM changed
      $fn$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // MapHomes' mark_homes() comes back with its own migration's body.
    await new MapHomes1930700000000().up(queryRunner);
    await queryRunner.query(`DROP FUNCTION IF EXISTS homes_rule(uuid)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS official_use(text)`);
  }
}
