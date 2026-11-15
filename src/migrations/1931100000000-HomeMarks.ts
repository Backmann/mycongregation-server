import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The keepers' own word on a building (15 November 2026): «a home» or «not
 * a home», over what the rule (homes_rule: addresses, size, the cadastre)
 * says. A correction of the map, like an edited boundary — about the
 * building only, never about people: no note, no name, nothing else.
 *
 * - `map_home_marks`: the marks. A mark is where the building's middle was
 *   when marked, with the cadastre's id of the building when known; each
 *   map build finds it again — the house of the map nearest within
 *   MARK_M, of the same cadastre building when the mark has one. A mark
 *   whose building is gone stays, found by none, for the keepers to drop.
 * - `map_houses.home_by_rule`: what the rule says, kept apart, so that a
 *   mark taken back gives the rule's word again without rerunning it.
 * - `apply_home_marks(cong)`: home = the mark, else the rule. Quick: run
 *   after each mark. `mark_homes(cong)` (the map build) now writes the rule
 *   to home_by_rule and then applies the marks.
 */
export class HomeMarks1931100000000 implements MigrationInterface {
  name = 'HomeMarks1931100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "map_home_marks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "official_id" varchar(64),
        "lon" double precision NOT NULL,
        "lat" double precision NOT NULL,
        "home" boolean NOT NULL,
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_map_home_marks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_map_home_marks_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_map_home_marks_user" FOREIGN KEY ("created_by")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_map_home_marks_congregation" ON "map_home_marks" ("congregation_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "map_houses" ADD COLUMN IF NOT EXISTS "home_by_rule" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(`UPDATE "map_houses" SET "home_by_rule" = "home"`);
    // The house a mark stands on: the nearest within 6 m (0.00009° of
    // longitude, 0.000055° of latitude here), of the mark's cadastre
    // building when it has one.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION home_marks_found(cong uuid)
      RETURNS TABLE (mark_id uuid, osm_id bigint, home boolean)
      LANGUAGE sql STABLE AS $fn$
        SELECT m.id, h.osm_id, m.home
          FROM map_home_marks m
          CROSS JOIN LATERAL (
            SELECT h.osm_id
              FROM map_houses h
             WHERE h.congregation_id = cong
               AND h.lat BETWEEN m.lat - 0.000055 AND m.lat + 0.000055
               AND h.lon BETWEEN m.lon - 0.00009 AND m.lon + 0.00009
               AND (m.official_id IS NULL OR h.official_id IS NULL
                    OR h.official_id = m.official_id)
             ORDER BY power((h.lon - m.lon) * 0.62, 2) + power(h.lat - m.lat, 2),
                      h.osm_id
             LIMIT 1
          ) h
         WHERE m.congregation_id = cong
      $fn$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION apply_home_marks(cong uuid) RETURNS integer
      LANGUAGE sql AS $fn$
        WITH found AS (
          SELECT DISTINCT ON (osm_id) osm_id, home FROM home_marks_found(cong)
           ORDER BY osm_id, mark_id
        ),
        changed AS (
          UPDATE map_houses h
             SET home = coalesce((SELECT f.home FROM found f WHERE f.osm_id = h.osm_id), h.home_by_rule)
           WHERE h.congregation_id = cong
             -- Only houses marked, or set apart from the rule before.
             AND (h.home IS DISTINCT FROM h.home_by_rule
                  OR h.osm_id IN (SELECT osm_id FROM found))
             AND h.home IS DISTINCT FROM
                 coalesce((SELECT f.home FROM found f WHERE f.osm_id = h.osm_id), h.home_by_rule)
          RETURNING 1
        )
        SELECT count(*)::integer FROM changed
      $fn$
    `);
    // Two statements: the marks are applied to the rule as just written.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION mark_homes(cong uuid) RETURNS integer
      LANGUAGE sql AS $fn$
        UPDATE map_houses h SET home_by_rule = v.home
          FROM homes_rule(cong) v
         WHERE h.congregation_id = cong AND h.osm_id = v.osm_id
           AND h.home_by_rule IS DISTINCT FROM v.home;
        SELECT apply_home_marks(cong);
      $fn$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(`DROP FUNCTION IF EXISTS apply_home_marks(uuid)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS home_marks_found(uuid)`);
    await queryRunner.query(
      `ALTER TABLE "map_houses" DROP COLUMN IF EXISTS "home_by_rule"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "map_home_marks"`);
  }
}
