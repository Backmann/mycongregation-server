import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A clearance whose meeting is held again (the event moved): its editors are
 * told once that it can be given back (8 November 2026).
 */
export class NotHeldHeldAgainTold1928700000000 implements MigrationInterface {
  name = 'NotHeldHeldAgainTold1928700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "not_held_clearances" ADD COLUMN IF NOT EXISTS "held_again_told_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "not_held_clearances" DROP COLUMN IF EXISTS "held_again_told_at"`,
    );
  }
}
