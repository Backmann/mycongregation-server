import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suggested announcements (announcements R-09, 26 November 2026).
 *
 * - `announcement_dismissals`: a suggestion a writer marked «not needed».
 *   No person is named; it leaves with its week.
 * - `meeting_announcements.source_facts`: the fingerprint of the dates and
 *   hours a suggestion's words were made from, so an announcement taken from
 *   it can tell its writer when the event has changed since.
 *
 * Both are new and empty; old rows keep `source_facts` NULL and are simply
 * never «stale».
 */
export class AnnouncementSuggestions1944000000000 implements MigrationInterface {
  name = 'AnnouncementSuggestions1944000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "announcement_dismissals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "source_key" character varying(120) NOT NULL,
        "week_start_date" date NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcement_dismissals" PRIMARY KEY ("id"),
        CONSTRAINT "FK_announcement_dismissals_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_announcement_dismissals_source" ON "announcement_dismissals" ("congregation_id", "source_key")`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_announcements" ADD COLUMN IF NOT EXISTS "source_facts" character varying(16)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meeting_announcements" DROP COLUMN IF EXISTS "source_facts"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "announcement_dismissals"`);
  }
}
