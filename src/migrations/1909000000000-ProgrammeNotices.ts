import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Changes to a published meeting are said by themselves (21 October 2026):
 * one row per meeting for the editor's «вечером» and what was last sent
 * (entities/programme-notice.entity.ts).
 */
export class ProgrammeNotices1909000000000 implements MigrationInterface {
  name = 'ProgrammeNotices1909000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "programme_notices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "event_type" varchar(16) NOT NULL,
        "hold_until" timestamptz,
        "sent_at" timestamptz,
        "sent_names" text,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_programme_notices" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_programme_notices_meeting" ON "programme_notices" ("congregation_id", "week_start_date", "event_type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "programme_notices"`);
  }
}
