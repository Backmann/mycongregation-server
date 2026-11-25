import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Announcements read aloud at a meeting (R-01, 24 November 2026):
 * entities/meeting-announcement.entity.ts. A new table, nothing to fill.
 *
 * The text column holds ciphertext («enc:v1:…»), so it is plain `text` with
 * no length limit; the unique index on source_key keeps one suggestion from
 * being taken twice.
 */
export class MeetingAnnouncements1942000000000 implements MigrationInterface {
  name = 'MeetingAnnouncements1942000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "meeting_announcements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "event_type" varchar(16) NOT NULL,
        "position" integer NOT NULL DEFAULT 1,
        "text" text NOT NULL,
        "is_letter" boolean NOT NULL DEFAULT false,
        "source" varchar(40),
        "source_key" varchar(120),
        "by_rule" boolean NOT NULL DEFAULT false,
        "read_at" timestamptz,
        "read_by_user_id" uuid,
        "dismissed_at" timestamptz,
        "carried_from" date,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meeting_announcements" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_meeting_announcements_kind" CHECK ("event_type" IN ('midweek', 'weekend')),
        CONSTRAINT "FK_meeting_announcements_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_meeting_announcements_meeting" ON "meeting_announcements" ("congregation_id", "week_start_date", "event_type")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_meeting_announcements_source" ON "meeting_announcements" ("congregation_id", "source_key") WHERE "source_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meeting_announcements"`);
  }
}
