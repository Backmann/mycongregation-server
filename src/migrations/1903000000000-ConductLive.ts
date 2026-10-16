import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A midweek meeting while it runs, for the chairman and the appointed brothers
 * to watch (15 October 2026). See entities/conduct-live.entity.ts. Rows live a
 * day and are deleted every night; nothing else depends on them.
 */
export class ConductLive1903000000000 implements MigrationInterface {
  name = 'ConductLive1903000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conduct_live" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "event_type" varchar(16) NOT NULL DEFAULT 'midweek',
        "state" jsonb NOT NULL,
        "epoch" integer NOT NULL DEFAULT 1,
        "controller_user_id" uuid NOT NULL,
        "controller_seen_at" timestamptz NOT NULL,
        "chairman_seen_at" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conduct_live" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conduct_live_week" UNIQUE ("congregation_id", "week_start_date", "event_type"),
        CONSTRAINT "FK_conduct_live_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_conduct_live_updated_at" ON "conduct_live" ("updated_at")`,
    );
    // The new place «Ведущий времени» on the midweek sheets ALREADY made:
    // the app generates a sheet only while it is empty, so without this the
    // place would appear only on weeks generated from now on. Current and
    // future weeks only — the past is history. Last on the sheet, empty.
    await queryRunner.query(`
      INSERT INTO "duties" ("congregation_id", "week_start_date", "event_type",
        "duty_type", "slot_index", "sort_order")
      SELECT "congregation_id", "week_start_date", 'midweek', 'timekeeper', 0,
        MAX("sort_order") + 1
      FROM "duties"
      WHERE "event_type" = 'midweek'
        AND "week_start_date" >= CURRENT_DATE - 6
      GROUP BY "congregation_id", "week_start_date"
      ON CONFLICT ON CONSTRAINT "uq_duty_slot" DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "duties" WHERE "duty_type" = 'timekeeper' AND "publisher_id" IS NULL`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "conduct_live"`);
  }
}
