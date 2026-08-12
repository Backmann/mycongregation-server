import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whom a task is for, when exactly it is due, and which recurring thing it is.
 *
 * WHOM used to be one optional publisher. In practice a task goes to one of
 * three quite different addressees: some named brothers, the service committee,
 * or the whole body of elders. The last two are not lists of names — they are
 * ASSIGNMENTS, and they change: replace the secretary and the task moves with
 * the office. So the kind is stored, and the names only for the first kind;
 * the other two are resolved from current responsibilities every time they are
 * read. A task set in May and still open in July belongs to whoever holds the
 * office in July, which is what everybody means by «the committee».
 *
 * WHEN gains a time. A day was enough while reminders did not exist; «two hours
 * before» has nothing to count from without one.
 *
 * WHICH marks the tasks the app creates itself on the calendar — the accounts
 * check, the annual reviews. It is not decoration: the rule «not the same
 * brother twice running» can only be applied if the previous check can be
 * found, and finding it by matching text would break the first time somebody
 * edited the title.
 *
 * The old single-assignee column is kept and carried over, so nothing written
 * before this is lost.
 */
export class TaskAssigneesAndKind1863000000000 implements MigrationInterface {
  name = 'TaskAssigneesAndKind1863000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elder_tasks"
        ADD COLUMN "assignee_kind" varchar(20) NOT NULL DEFAULT 'people',
        ADD COLUMN "due_time" varchar(5) NULL,
        ADD COLUMN "kind" varchar(30) NULL,
        ADD COLUMN "kind_period" varchar(20) NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "elder_task_assignees" (
        "task_id" uuid NOT NULL REFERENCES "elder_tasks"("id") ON DELETE CASCADE,
        "publisher_id" uuid NOT NULL REFERENCES "publishers"("id") ON DELETE CASCADE,
        PRIMARY KEY ("task_id", "publisher_id")
      )
    `);
    // Finding «my tasks» reads this the other way round.
    await queryRunner.query(`
      CREATE INDEX "IDX_elder_task_assignees_publisher"
        ON "elder_task_assignees" ("publisher_id")
    `);

    // Carry the single assignee over, so nothing already written is lost.
    await queryRunner.query(`
      INSERT INTO "elder_task_assignees" ("task_id", "publisher_id")
      SELECT "id", "assignee_publisher_id" FROM "elder_tasks"
      WHERE "assignee_publisher_id" IS NOT NULL
    `);

    // One recurring thing may exist once per congregation per period — the
    // guard against the scheduler creating a second copy of the same quarter.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_elder_tasks_kind_period"
        ON "elder_tasks" ("congregation_id", "kind", "kind_period")
        WHERE "kind" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_elder_tasks_kind_period"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "elder_task_assignees"`);
    await queryRunner.query(`
      ALTER TABLE "elder_tasks"
        DROP COLUMN "kind_period",
        DROP COLUMN "kind",
        DROP COLUMN "due_time",
        DROP COLUMN "assignee_kind"
    `);
  }
}
