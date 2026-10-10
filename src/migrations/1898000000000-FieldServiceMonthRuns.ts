import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the automatic preparation has already done for a month (October
 * 2026, stage 5): prepared it, reminded about its draft, published it on
 * its own. One row per congregation and month, so a nightly pass that runs
 * twice — or after a restart — does each of the three exactly once.
 */
export class FieldServiceMonthRuns1898000000000 implements MigrationInterface {
  name = 'FieldServiceMonthRuns1898000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "field_service_month_runs" (
        "congregation_id" uuid NOT NULL REFERENCES "congregations"("id") ON DELETE CASCADE,
        "year" smallint NOT NULL,
        "month" smallint NOT NULL,
        "prepared_at" timestamptz NULL,
        "reminded_at" timestamptz NULL,
        "auto_published_at" timestamptz NULL,
        PRIMARY KEY ("congregation_id", "year", "month")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "field_service_month_runs"`);
  }
}
