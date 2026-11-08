import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assignments on meetings that are not held (8 November 2026): what was taken
 * off, so it can be put back, and the one notice sent about it.
 */
export class NotHeldClearances1928600000000 implements MigrationInterface {
  name = 'NotHeldClearances1928600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "not_held_clearances" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "event_type" character varying(16) NOT NULL,
        "reason" character varying(16) NOT NULL,
        "reason_event_id" uuid,
        "parts" jsonb NOT NULL DEFAULT '[]',
        "duties" jsonb NOT NULL DEFAULT '[]',
        "cleared_by_id" uuid,
        "cleared_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "restored_at" TIMESTAMP WITH TIME ZONE,
        "restored_by_id" uuid,
        CONSTRAINT "PK_not_held_clearances" PRIMARY KEY ("id"),
        CONSTRAINT "FK_not_held_clearances_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_not_held_clearances_week" ON "not_held_clearances" ("congregation_id", "week_start_date")`,
    );
    await queryRunner.query(`
      CREATE TABLE "not_held_alerts" (
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "event_type" character varying(16) NOT NULL,
        "count" integer NOT NULL,
        "alerted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_not_held_alerts" PRIMARY KEY ("congregation_id", "week_start_date", "event_type"),
        CONSTRAINT "FK_not_held_alerts_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "not_held_alerts"`);
    await queryRunner.query(`DROP TABLE "not_held_clearances"`);
  }
}
