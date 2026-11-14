import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the cadastre says a building is (14 November 2026): the
 * «Gebäudefunktion» of ALKIS NW («Wohngebäude», «Gebäude für Wirtschaft
 * oder Gewerbe», «Gebäude für Land- und Forstwirtschaft» …) and its floors,
 * filled by the map build (scripts/map-official.mjs). Null: the cadastre
 * was not read, or does not know the building.
 *
 * Read by nothing that counts homes yet: first measured (the homes survey),
 * then, once agreed, by `mark_homes()`.
 */
export class MapOfficialUse1930800000000 implements MigrationInterface {
  name = 'MapOfficialUse1930800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "map_houses" ADD COLUMN IF NOT EXISTS "official" varchar(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "map_houses" ADD COLUMN IF NOT EXISTS "floors" smallint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "map_houses" DROP COLUMN IF EXISTS "floors"`,
    );
    await queryRunner.query(
      `ALTER TABLE "map_houses" DROP COLUMN IF EXISTS "official"`,
    );
  }
}
