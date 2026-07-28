import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tasks of the body of elders, and the meetings they are going to.
 *
 * Two tables rather than one flag: a meeting is a real occasion with a date,
 * so a task can be put on a PARTICULAR one, and afterwards it is still visible
 * what was discussed that evening.
 *
 * Text columns are `text` because their contents arrive already encrypted —
 * the same transformer the journal uses. Nothing readable about a brother's
 * circumstances is written to disk.
 */
export class EldersTasksAndMeetings1855000000000 implements MigrationInterface {
  name = 'EldersTasksAndMeetings1855000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "elders_meetings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "date" date NOT NULL,
        "start_time" varchar(5) NULL,
        "note" text NULL,
        "created_by_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_elders_meetings" PRIMARY KEY ("id"),
        CONSTRAINT "fk_elders_meetings_congregation"
          FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_elders_meetings_date"
        ON "elders_meetings" ("congregation_id", "date")
    `);

    await queryRunner.query(`
      CREATE TABLE "elder_tasks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "title" text NOT NULL,
        "details" text NULL,
        "area" varchar(20) NOT NULL DEFAULT 'other',
        "assignee_publisher_id" uuid NULL,
        "due_date" date NULL,
        "status" varchar(10) NOT NULL DEFAULT 'open',
        "done_at" timestamptz NULL,
        "done_by_id" uuid NULL,
        "elders_meeting_id" uuid NULL,
        "created_by_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_elder_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "fk_elder_tasks_congregation"
          FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
          ON DELETE RESTRICT,
        -- Cancelling a meeting must not delete the work that was going to be
        -- discussed at it.
        CONSTRAINT "fk_elder_tasks_meeting"
          FOREIGN KEY ("elders_meeting_id") REFERENCES "elders_meetings"("id")
          ON DELETE SET NULL,
        -- Only two states, and the database says so: «in progress» and the
        -- like invite people to record a process the congregation does not have.
        CONSTRAINT "chk_elder_tasks_status"
          CHECK ("status" IN ('open', 'done')),
        CONSTRAINT "chk_elder_tasks_area"
          CHECK ("area" IN ('ministry','teaching','care','organisation','accounts','other'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_elder_tasks_status"
        ON "elder_tasks" ("congregation_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_elder_tasks_meeting"
        ON "elder_tasks" ("congregation_id", "elders_meeting_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "elder_tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "elders_meetings"`);
  }
}
