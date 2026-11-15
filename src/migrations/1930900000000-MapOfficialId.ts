import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which building of the cadastre a house of the map is (14 November 2026):
 * the map often draws one building as several pieces — each a «house»
 * here, one home in truth. Filled by the map build with `official`.
 */
export class MapOfficialId1930900000000 implements MigrationInterface {
  name = 'MapOfficialId1930900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "map_houses" ADD COLUMN IF NOT EXISTS "official_id" varchar(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "map_houses" DROP COLUMN IF EXISTS "official_id"`,
    );
  }
}
