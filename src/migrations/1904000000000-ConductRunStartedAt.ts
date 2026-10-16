import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When a midweek meeting's first part began (16 October 2026), so the
 * detailed result can lay the meeting on the clock and place the pauses
 * between parts where they happened. Each part's own start lives in the
 * `segments` JSON as `startSec`. Results saved before stay null.
 */
export class ConductRunStartedAt1904000000000 implements MigrationInterface {
  name = 'ConductRunStartedAt1904000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conduct_runs" ADD COLUMN IF NOT EXISTS "started_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conduct_runs" DROP COLUMN IF EXISTS "started_at"`,
    );
  }
}
