import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The month the hours log begins in a congregation (Lionel, 29 October 2026).
 * The congregations already here begin with November 2026; a new one has it
 * off until it is switched on.
 */
export class HoursLogFrom1926100000000 implements MigrationInterface {
  name = 'HoursLogFrom1926100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "congregations" ADD COLUMN IF NOT EXISTS "hours_log_from" varchar(7)`,
    );
    await queryRunner.query(
      `UPDATE "congregations" SET "hours_log_from" = '2026-11' WHERE "hours_log_from" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "congregations" DROP COLUMN IF EXISTS "hours_log_from"`,
    );
  }
}
