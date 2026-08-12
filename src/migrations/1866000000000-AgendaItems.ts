import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The agenda proper: numbered items, and the things a meeting needs to be one.
 *
 * Until now a meeting was a date and a note, and its agenda was assembled from
 * tasks — what was put on it, what was overdue, what fell due before the next.
 * That stays; it is how the list keeps itself honest. What it could not hold is
 * the OTHER half of a meeting: the questions brought to it, who presents each,
 * how long each is expected to take, and what was decided.
 *
 * WHY ITEMS AND NOT A TEXT FIELD. A free-form body would have been a second
 * place for the same material, and within a month half the questions would
 * live in one and half in the other, with the printed sheet showing only one
 * half. An item has a shape — title, source, who presents, minutes — and a
 * shape can be numbered, ordered, timed, carried over and printed.
 *
 * WHAT BECOMES OF AN ITEM is the point of the whole thing. «Рассмотрен»,
 * «перенесён», or «стал задачей» — and the last is the one that matters: what
 * was decided leaves the meeting as work with a name and a date on it, instead
 * of as words nobody can act on.
 *
 * THE DRAFT IS THE COORDINATOR'S. Questions reach him by letter, not through
 * the app, and he decides what goes on. Until he approves it nobody else sees
 * the items — an unfinished agenda read by five people is five conversations
 * about something not yet decided.
 */
export class AgendaItems1866000000000 implements MigrationInterface {
  name = 'AgendaItems1866000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elders_meetings"
        ADD COLUMN "hall_id" uuid NULL REFERENCES "halls"("id") ON DELETE SET NULL,
        ADD COLUMN "place_text" text NULL,
        ADD COLUMN "minute_taker_publisher_id" uuid NULL
          REFERENCES "publishers"("id") ON DELETE SET NULL,
        ADD COLUMN "approved_at" timestamptz NULL,
        ADD COLUMN "approved_by_id" uuid NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "elders_meeting_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        -- Null while an item waits for a meeting: one carried over with no
        -- next meeting yet is picked up by the first that is created.
        "meeting_id" uuid NULL
          REFERENCES "elders_meetings"("id") ON DELETE SET NULL,
        "position" integer NOT NULL DEFAULT 0,
        "title" text NOT NULL,
        -- «km 3/24, стр. 5», a link, or both — whichever the coordinator has.
        "source_text" text NULL,
        "source_url" text NULL,
        "presenter_publisher_id" uuid NULL
          REFERENCES "publishers"("id") ON DELETE SET NULL,
        "minutes" integer NOT NULL DEFAULT 10,
        "outcome" varchar(20) NULL,
        "outcome_note" text NULL,
        -- What it became, when it became work. Kept as SET NULL: deleting the
        -- task must not erase the record that something was decided.
        "task_id" uuid NULL REFERENCES "elder_tasks"("id") ON DELETE SET NULL,
        "created_by_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_meeting_items_outcome"
          CHECK ("outcome" IS NULL OR "outcome" IN ('reviewed','carried','task'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_meeting_items_meeting"
        ON "elders_meeting_items" ("congregation_id", "meeting_id", "position")
    `);
    // Items waiting for a meeting are looked up on their own.
    await queryRunner.query(`
      CREATE INDEX "idx_meeting_items_waiting"
        ON "elders_meeting_items" ("congregation_id")
        WHERE "meeting_id" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "elders_meeting_items"`);
    await queryRunner.query(`
      ALTER TABLE "elders_meetings"
        DROP COLUMN "approved_by_id",
        DROP COLUMN "approved_at",
        DROP COLUMN "minute_taker_publisher_id",
        DROP COLUMN "place_text",
        DROP COLUMN "hall_id"
    `);
  }
}
