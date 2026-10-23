import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The journal «К нам» owns who speaks at a weekend (Lionel, 23 October 2026).
 *
 * - `assignments.talk_exchange_id`: the programme line knows its entry
 *   instead of finding it again by week and by name each time. Linked now
 *   only where the two already say the same — on live data, every week.
 * - `talk_exchange.origin`: who made the entry. `journal` — the coordinator
 *   (every such entry has a CREATE line in the audit log); `programme` — the
 *   application, from a name typed into the weekend programme. Clearing the
 *   programme line removes only the second kind: the first is somebody's
 *   arrangement and is kept, and those who answer for it are told.
 * - `talk_exchange.meeting_cancelled`: a cancelled weekend keeps its guest's
 *   entry, marked, instead of deleting it with its note and host family.
 * - One live entry «К нам» a week, held by the database. Live data has none
 *   twice (checked read-only the same day).
 */
export class JournalOwnsWeekendSpeaker1913000000000 implements MigrationInterface {
  name = 'JournalOwnsWeekendSpeaker1913000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" ADD COLUMN IF NOT EXISTS "meeting_cancelled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" ADD COLUMN IF NOT EXISTS "origin" varchar(16) NOT NULL DEFAULT 'journal'`,
    );
    await queryRunner.query(`
      UPDATE talk_exchange t SET origin = 'programme'
       WHERE t.direction = 'incoming'
         AND NOT EXISTS (
           SELECT 1 FROM audit_logs l
            WHERE l.entity_type = 'talk_exchange'
              AND l.entity_id = t.id
              AND l.action = 'CREATE')
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_talk_exchange_incoming_week"
          ON "talk_exchange" ("congregation_id", ("date" - (extract(isodow from "date")::int - 1)))
       WHERE "direction" = 'incoming' AND "deleted_at" IS NULL AND "status" <> 'did_not_happen'
    `);

    await queryRunner.query(
      `ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "talk_exchange_id" uuid`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "assignments" ADD CONSTRAINT "FK_assignments_talk_exchange"
          FOREIGN KEY ("talk_exchange_id") REFERENCES "talk_exchange"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_assignments_talk_exchange" ON "assignments" ("talk_exchange_id")`,
    );
    // The week's entry, where the programme line already shows its speaker.
    await queryRunner.query(`
      UPDATE assignments a SET talk_exchange_id = te.id
        FROM talk_exchange te
       WHERE a.part_key = 'public_talk_speaker'
         AND a.deleted_at IS NULL
         AND a.talk_exchange_id IS NULL
         AND te.congregation_id = a.congregation_id
         AND te.direction = 'incoming'
         AND te.deleted_at IS NULL
         AND te.status <> 'did_not_happen'
         AND te.date - (extract(isodow from te.date)::int - 1) = a.week_start_date
         AND (a.publisher_id IS NOT NULL OR coalesce(a.speaker_name, '') <> '')
         AND a.publisher_id IS NOT DISTINCT FROM te.publisher_id
         AND (a.publisher_id IS NOT NULL
              OR (a.visiting_speaker_id IS NOT NULL
                  AND a.visiting_speaker_id = te.visiting_speaker_id)
              OR lower(trim(a.speaker_name)) = lower(trim(te.speaker_name)))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP COLUMN IF EXISTS "talk_exchange_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_talk_exchange_incoming_week"`,
    );
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" DROP COLUMN IF EXISTS "origin"`,
    );
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" DROP COLUMN IF EXISTS "meeting_cancelled"`,
    );
  }
}
