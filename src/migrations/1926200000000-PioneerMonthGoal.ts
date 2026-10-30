import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A special pioneer's or missionary's monthly hours when not the usual 100 —
 * 90 is the other (Lionel, 30 October 2026). Null means 100.
 */
export class PioneerMonthGoal1926200000000 implements MigrationInterface {
  name = 'PioneerMonthGoal1926200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD COLUMN IF NOT EXISTS "pioneer_month_goal" smallint`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP CONSTRAINT IF EXISTS "ck_publishers_pioneer_month_goal"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD CONSTRAINT "ck_publishers_pioneer_month_goal" CHECK ("pioneer_month_goal" IS NULL OR "pioneer_month_goal" = 90)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP CONSTRAINT IF EXISTS "ck_publishers_pioneer_month_goal"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN IF EXISTS "pioneer_month_goal"`,
    );
  }
}
