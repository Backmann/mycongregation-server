import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The «Templates» screen of the announcements (R-09 step 4, 26 November 2026):
 * one row per congregation and template it has changed. New and empty: every
 * congregation keeps the app's own until it changes something.
 */
export class AnnouncementTemplates1945000000000 implements MigrationInterface {
  name = 'AnnouncementTemplates1945000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "announcement_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "key" character varying(40) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "words" text,
        "weeks_ahead" smallint,
        "updated_by_user_id" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcement_templates" PRIMARY KEY ("id"),
        CONSTRAINT "FK_announcement_templates_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_announcement_templates_weeks" CHECK ("weeks_ahead" IS NULL OR "weeks_ahead" BETWEEN 2 AND 16)
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_announcement_templates_key" ON "announcement_templates" ("congregation_id", "key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "announcement_templates"`);
  }
}
