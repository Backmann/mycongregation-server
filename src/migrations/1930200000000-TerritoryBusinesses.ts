import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Business territories get their list (13 November 2026).
 *
 * - `map_places`: every named place of the congregation's map file (shops,
 *   food, services, doctors…), rebuilt with the map like `map_houses`.
 *   Public map data only. The server picks the business kinds from it.
 * - `territory_businesses`: the list of a business territory as the
 *   territory servant keeps it — a name, a kind, a point; taken from the
 *   map (`osm_id`) or added by hand. No notes: nothing about people.
 * - `territory_business_visits`: «visited» / «closed, again later» while a
 *   territory is given out, tied to that one assignment and deleted when it
 *   is completed or returned. No person is recorded, only the day.
 */
export class TerritoryBusinesses1930200000000 implements MigrationInterface {
  name = 'TerritoryBusinesses1930200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "map_places" (
        "congregation_id" uuid NOT NULL,
        "osm_id" bigint NOT NULL,
        "kind" varchar(40) NOT NULL,
        "name" varchar(200) NOT NULL,
        "lon" double precision NOT NULL,
        "lat" double precision NOT NULL,
        CONSTRAINT "PK_map_places" PRIMARY KEY ("congregation_id", "osm_id"),
        CONSTRAINT "FK_map_places_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_map_places_place" ON "map_places" ("congregation_id", "lat", "lon")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_businesses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "territory_id" uuid NOT NULL,
        "osm_id" bigint,
        "name" varchar(160) NOT NULL,
        "kind" varchar(40) NOT NULL,
        "lon" double precision,
        "lat" double precision,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_businesses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_territory_businesses_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_businesses_territory" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_territory_businesses_territory" ON "territory_businesses" ("territory_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_territory_businesses_osm" ON "territory_businesses" ("territory_id", "osm_id") WHERE "osm_id" IS NOT NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_business_visits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "business_id" uuid NOT NULL,
        "assignment_id" uuid NOT NULL,
        "state" varchar(10) NOT NULL,
        "on_date" date NOT NULL,
        CONSTRAINT "PK_territory_business_visits" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_territory_business_visits_state" CHECK ("state" IN ('visited', 'later')),
        CONSTRAINT "FK_territory_business_visits_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_business_visits_business" FOREIGN KEY ("business_id") REFERENCES "territory_businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_business_visits_assignment" FOREIGN KEY ("assignment_id") REFERENCES "territory_assignments"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_territory_business_visits" ON "territory_business_visits" ("business_id", "assignment_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_business_visits"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_businesses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "map_places"`);
  }
}
