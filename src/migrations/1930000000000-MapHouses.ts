import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The register of houses (12 November 2026): the middle of every building on
 * the congregation's map file, taken from OpenStreetMap when the map is cut.
 * Public map data only — no people, no addresses. It lets the server count
 * houses in a territory: how many change hands when a boundary moves (the
 * 10 % rule for a held territory is about buildings), splitting by houses.
 * Rebuilt whole with the map; nothing else writes it.
 */
export class MapHouses1930000000000 implements MigrationInterface {
  name = 'MapHouses1930000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "map_houses" (
        "congregation_id" uuid NOT NULL,
        "osm_id" bigint NOT NULL,
        "lon" double precision NOT NULL,
        "lat" double precision NOT NULL,
        "area_m2" integer NOT NULL,
        CONSTRAINT "PK_map_houses" PRIMARY KEY ("congregation_id", "osm_id"),
        CONSTRAINT "FK_map_houses_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_map_houses_place" ON "map_houses" ("congregation_id", "lat", "lon")`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_settings" ADD COLUMN IF NOT EXISTS "houses_built_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_settings" DROP COLUMN IF EXISTS "houses_built_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "map_houses"`);
  }
}
