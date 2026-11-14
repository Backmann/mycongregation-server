import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Only homes are counted (14 November 2026). The register of buildings
 * holds garages, sheds and barns besides the homes; every home in NRW has
 * its own official address («Gebäudereferenzen NW», `map_addresses`).
 *
 * - `map_houses.home`: false for a building under 150 m² with no number of
 *   its own and no address of its own within 20 m — no address at all, or
 *   only addresses a numbered house nearby already stands at (a garage or a
 *   shed behind a house). Bigger buildings stay homes until a keeper marks
 *   them on the spot. Where no address stands round about (200 to 500 m:
 *   squares of 200 m and their neighbours) the register has none there
 *   (another Land, an older map build): nothing is left out.
 * - `mark_homes(congregation)`: THE rule, in one place. Run here once, and
 *   by the map build after each rebuild (.github/workflows/map.yml). Until it
 *   runs every building counts, as before.
 *
 * Distances as the app measures them (src/territories/split.ts `dist`):
 * 111 320 m a degree of longitude times the cosine (at the middle of the
 * area), 110 540 a degree of latitude. Neighbours are found by squares of
 * 40 m, not by scanning: a whole area of 250 000 buildings in seconds.
 */
export class MapHomes1930700000000 implements MigrationInterface {
  name = 'MapHomes1930700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "map_houses" ADD COLUMN IF NOT EXISTS "home" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION mark_homes(cong uuid) RETURNS integer
      LANGUAGE sql AS $fn$
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
        changed AS (
          UPDATE map_houses h SET home = v.home
            FROM verdict v
           WHERE h.congregation_id = cong AND h.osm_id = v.osm_id
             AND h.home IS DISTINCT FROM v.home
          RETURNING 1
        )
        SELECT count(*)::integer FROM changed
      $fn$
    `);
    await queryRunner.query(
      `SELECT mark_homes(id) FROM congregations WHERE id IN (SELECT DISTINCT congregation_id FROM map_houses)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS mark_homes(uuid)`);
    await queryRunner.query(
      `ALTER TABLE "map_houses" DROP COLUMN IF EXISTS "home"`,
    );
  }
}
