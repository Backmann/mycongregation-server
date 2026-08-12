import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let the database accept the area the app already offers.
 *
 * «Объявления» was added to the type, to the form and to the labels — and not
 * to the CHECK constraint written when the table was made, which still listed
 * the original six. So the form offered a choice the database refused, and
 * saving a task with it failed with a 500 that told the reader nothing.
 *
 * That constraint is not a mistake — it is the reason a wrong state is
 * impossible here rather than merely uncommon, and it did exactly its job. The
 * mistake was mine: a list kept in two places, and only one of them changed.
 *
 * The same guard is put back, with the seventh value in it, and the assignee
 * kind gets one of its own for the same reason.
 */
export class AnnouncementsAreaAllowed1865000000000 implements MigrationInterface {
  name = 'AnnouncementsAreaAllowed1865000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elder_tasks" DROP CONSTRAINT IF EXISTS "chk_elder_tasks_area"
    `);
    await queryRunner.query(`
      ALTER TABLE "elder_tasks" ADD CONSTRAINT "chk_elder_tasks_area"
        CHECK ("area" IN (
          'ministry','teaching','care','organisation',
          'announcements','accounts','other'
        ))
    `);
    await queryRunner.query(`
      ALTER TABLE "elder_tasks"
        DROP CONSTRAINT IF EXISTS "chk_elder_tasks_assignee_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "elder_tasks" ADD CONSTRAINT "chk_elder_tasks_assignee_kind"
        CHECK ("assignee_kind" IN ('people','service_committee','body_of_elders'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elder_tasks"
        DROP CONSTRAINT IF EXISTS "chk_elder_tasks_assignee_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "elder_tasks" DROP CONSTRAINT IF EXISTS "chk_elder_tasks_area"
    `);
    await queryRunner.query(`
      ALTER TABLE "elder_tasks" ADD CONSTRAINT "chk_elder_tasks_area"
        CHECK ("area" IN (
          'ministry','teaching','care','organisation','accounts','other'
        ))
    `);
  }
}
