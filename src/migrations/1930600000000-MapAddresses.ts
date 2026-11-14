import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The official addresses of the congregation's map area (14 November 2026):
 * «Gebäudereferenzen NW» of Geobasis NRW (Datenlizenz Deutschland – Zero
 * 2.0) — street, number and point of every main building with a house
 * number. The map file has a building's number but not its street; with
 * these a house goes to its own street when a territory is divided, not to
 * the nearest one (in a trial town 12.6% of houses had another street
 * nearer than their own). Rebuilt whole with the map, like `map_houses`.
 * Public data only: no names, no owners.
 */
export class MapAddresses1930600000000 implements MigrationInterface {
  name = 'MapAddresses1930600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "map_addresses" (
        "congregation_id" uuid NOT NULL,
        "oid" varchar(16) NOT NULL,
        "lon" double precision NOT NULL,
        "lat" double precision NOT NULL,
        "number" varchar(16) NOT NULL,
        "street" varchar(200) NOT NULL,
        CONSTRAINT "PK_map_addresses" PRIMARY KEY ("congregation_id", "oid"),
        CONSTRAINT "FK_map_addresses_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_map_addresses_at" ON "map_addresses" ("congregation_id", "lat", "lon")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "map_addresses"`);
  }
}
