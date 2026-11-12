import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Residential and business territories (12 November 2026): two separate
 * lists, maps and S-13 sheets that never mix. Every territory there is so
 * far is residential.
 */
export class TerritoryCategory1929800000000 implements MigrationInterface {
  name = 'TerritoryCategory1929800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territories" ADD COLUMN IF NOT EXISTS "category" character varying(12) NOT NULL DEFAULT 'residential'`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "territories"
          ADD CONSTRAINT "CHK_territories_category"
          CHECK ("category" IN ('residential', 'business'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territories" DROP CONSTRAINT IF EXISTS "CHK_territories_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "territories" DROP COLUMN IF EXISTS "category"`,
    );
  }
}
