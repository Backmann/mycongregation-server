import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When the congregation's own map file was last put in place by the
 * «Territory map» job (11 November 2026). Until then the app draws the
 * territories without streets and does not ask for a file that is not
 * there.
 */
export class TerritoryMapFile1929500000000 implements MigrationInterface {
  name = 'TerritoryMapFile1929500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_settings" ADD COLUMN IF NOT EXISTS "map_built_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_settings" DROP COLUMN IF EXISTS "map_built_at"`,
    );
  }
}
