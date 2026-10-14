import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How a midweek meeting actually ran, kept SEVEN DAYS (14 October 2026).
 *
 * See entities/conduct-run.entity.ts. A table of its own rather than a column
 * on anything lasting: the rows are deleted every night once a week old, and
 * nothing else should go with them.
 */
export class ConductRuns1902000000000 implements MigrationInterface {
  name = 'ConductRuns1902000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conduct_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "event_type" varchar(16) NOT NULL DEFAULT 'midweek',
        "segments" jsonb NOT NULL,
        "total_sec" integer NOT NULL,
        "planned_sec" integer NOT NULL,
        "saved_by" uuid,
        "saved_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conduct_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conduct_runs_week" UNIQUE ("congregation_id", "week_start_date", "event_type"),
        CONSTRAINT "FK_conduct_runs_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_conduct_runs_saved_at" ON "conduct_runs" ("saved_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "conduct_runs"`);
  }
}
