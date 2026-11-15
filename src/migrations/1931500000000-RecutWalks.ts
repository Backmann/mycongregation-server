import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The walk of each part of the draft (15 November 2026): worked out in the
 * background, as the figures are, and kept by the border of the part — a
 * line moved or a border changed makes a new key, and the old one is dropped
 * at the next pass. The screens show «41 → ≈14 км» and how many months a
 * part takes at the congregation's own pace.
 */
export class RecutWalks1931500000000 implements MigrationInterface {
  name = 'RecutWalks1931500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_recuts" ADD COLUMN IF NOT EXISTS "walks" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_recuts" DROP COLUMN IF EXISTS "walks"`,
    );
  }
}
