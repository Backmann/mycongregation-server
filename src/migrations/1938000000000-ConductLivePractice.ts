import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A rehearsal of the meeting as it runs is a row of its own (R-73, 22
 * November 2026; entities/conduct-live.entity.ts). Rows so far are the
 * meetings themselves: practice = false.
 */
export class ConductLivePractice1938000000000 implements MigrationInterface {
  name = 'ConductLivePractice1938000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conduct_live" ADD COLUMN IF NOT EXISTS "practice" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "conduct_live" DROP CONSTRAINT IF EXISTS "UQ_conduct_live_week"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conduct_live" ADD CONSTRAINT "UQ_conduct_live_week" UNIQUE ("congregation_id", "week_start_date", "event_type", "room", "practice")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "conduct_live" WHERE "practice"`);
    await queryRunner.query(
      `ALTER TABLE "conduct_live" DROP CONSTRAINT IF EXISTS "UQ_conduct_live_week"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conduct_live" ADD CONSTRAINT "UQ_conduct_live_week" UNIQUE ("congregation_id", "week_start_date", "event_type", "room")`,
    );
    await queryRunner.query(
      `ALTER TABLE "conduct_live" DROP COLUMN IF EXISTS "practice"`,
    );
  }
}
