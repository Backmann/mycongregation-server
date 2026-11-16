import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Territories held back for a join (16 November 2026, step 5 of the draft):
 * a decided join waits until all its territories are free together. One
 * that comes back while another is still out is held — not given out again
 * — unless the keeper chooses to give it out anyway. Empty for every
 * proposal already in the draft.
 */
export class RecutHolds1931700000000 implements MigrationInterface {
  name = 'RecutHolds1931700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_recut_proposals" ADD COLUMN IF NOT EXISTS "hold_ids" uuid[] NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_recut_proposals" DROP COLUMN IF EXISTS "hold_ids"`,
    );
  }
}
