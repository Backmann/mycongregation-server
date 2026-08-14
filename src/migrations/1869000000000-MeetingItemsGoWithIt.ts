import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deleting a meeting takes its questions with it.
 *
 * They were detached instead — the link cleared, the rows left waiting — and
 * the next meeting created adopted them. Lionel found it the way anybody would:
 * he deleted an agenda, made a new one for the same evening, and the questions
 * he had just thrown away came back.
 *
 * That was my reasoning applied in the wrong place. TASKS must survive a
 * cancelled evening, because a task is work somebody owes whatever happens to
 * the meeting — and they still do. A QUESTION is not work; it exists only as
 * part of an agenda, and deleting the agenda is a decision about the question
 * too. Waiting items still exist, but only where they were meant to: an item
 * CARRIED OVER from a meeting that was held and closed.
 */
export class MeetingItemsGoWithIt1869000000000 implements MigrationInterface {
  name = 'MeetingItemsGoWithIt1869000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elders_meeting_items"
        DROP CONSTRAINT IF EXISTS "elders_meeting_items_meeting_id_fkey"
    `);
    await queryRunner.query(`
      ALTER TABLE "elders_meeting_items"
        ADD CONSTRAINT "elders_meeting_items_meeting_id_fkey"
        FOREIGN KEY ("meeting_id") REFERENCES "elders_meetings"("id")
        ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elders_meeting_items"
        DROP CONSTRAINT IF EXISTS "elders_meeting_items_meeting_id_fkey"
    `);
    await queryRunner.query(`
      ALTER TABLE "elders_meeting_items"
        ADD CONSTRAINT "elders_meeting_items_meeting_id_fkey"
        FOREIGN KEY ("meeting_id") REFERENCES "elders_meetings"("id")
        ON DELETE SET NULL
    `);
  }
}
