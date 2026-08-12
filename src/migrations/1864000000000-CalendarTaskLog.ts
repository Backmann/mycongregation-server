import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A note that a calendar task has already been created for a period.
 *
 * Without it the rule «deleted on purpose does not come back» could not hold:
 * tasks are removed outright, not hidden, so the moment one is deleted the
 * unique key is free again and the next nightly pass would put it straight
 * back — which is the app arguing with a decision somebody made deliberately.
 *
 * One row per congregation per turn of a thing, written when it is created and
 * never removed. Small, and it answers exactly one question: «did we already
 * offer this one?»
 */
export class CalendarTaskLog1864000000000 implements MigrationInterface {
  name = 'CalendarTaskLog1864000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "elder_task_calendar_log" (
        "congregation_id" uuid NOT NULL REFERENCES "congregations"("id") ON DELETE CASCADE,
        "kind" varchar(30) NOT NULL,
        "period" varchar(20) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("congregation_id", "kind", "period")
      )
    `);
    // Anything already standing counts as offered, so switching this on does
    // not duplicate what is on the list today.
    await queryRunner.query(`
      INSERT INTO "elder_task_calendar_log" ("congregation_id", "kind", "period")
      SELECT DISTINCT "congregation_id", "kind", "kind_period"
      FROM "elder_tasks" WHERE "kind" IS NOT NULL AND "kind_period" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "elder_task_calendar_log"`);
  }
}
