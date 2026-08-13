import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An area on the agenda item itself.
 *
 * A question that becomes work has to land somewhere, and a task without an
 * area cannot be saved — the database refuses it, as it should. Three ways out
 * were on the table: ask again in the window that creates the task, default
 * everything to «Прочее», or give the question its own area from the start.
 *
 * The third was chosen, and it pays twice: the area travels with the question
 * into the task by itself, and until then the agenda shows what each question
 * is ABOUT — «Счета», «Забота» — which a bare list of titles never did.
 *
 * The same seven the tasks use, and the same CHECK guarding them: a list kept
 * in two places drifts apart, and this one is now kept in three. That is worth
 * saying out loud, because it has already caught us once.
 */
export class AgendaItemArea1867000000000 implements MigrationInterface {
  name = 'AgendaItemArea1867000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elders_meeting_items"
        ADD COLUMN "area" varchar(20) NOT NULL DEFAULT 'other'
    `);
    await queryRunner.query(`
      ALTER TABLE "elders_meeting_items" ADD CONSTRAINT "chk_meeting_items_area"
        CHECK ("area" IN (
          'ministry','teaching','care','organisation',
          'announcements','accounts','other'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elders_meeting_items"
        DROP CONSTRAINT IF EXISTS "chk_meeting_items_area"
    `);
    await queryRunner.query(`
      ALTER TABLE "elders_meeting_items" DROP COLUMN "area"
    `);
  }
}
