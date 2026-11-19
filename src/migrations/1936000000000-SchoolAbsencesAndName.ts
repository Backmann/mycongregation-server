import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Kingdom Ministry School: its new Russian name, and its absences
 * (19 November 2026, Lionel).
 *
 * 1. THE NAME. «Школа царственного служения» is now «Школа Священного
 *    Служения». An event keeps the title it was saved with, and the form
 *    fills the title with the kind's name; so a title that is still the old
 *    name of its own kind is the form's, not somebody's words, and follows
 *    the kind. Any other title is left as it was typed. English and German
 *    names do not change.
 *
 * 2. THE ABSENCE. The school takes the whole day, so each invited brother is
 *    away on its days — written by the event, as the pioneer school and a
 *    trip «От нас» write theirs (`absences.special_event_id`). The rows
 *    themselves are written by the app (SchoolAbsencesService), not here.
 *
 * The link deletes with the event (CASCADE): were the event ever removed
 * for good, its absences must not stay behind as if a person had entered
 * them — that is what SET NULL would make of them.
 *
 * Down puts the old name back on the same rows and removes the column with
 * every absence it carries: those are the event's own bookkeeping, and the
 * old code has nothing that reads them.
 */
const NAMES: [type: string, before: string, after: string][] = [
  [
    'kingdom_ministry_school_elders',
    'Школа царственного служения для старейшин',
    'Школа Священного Служения для старейшин',
  ],
  [
    'kingdom_ministry_school_servants',
    'Школа царственного служения для служебных помощников',
    'Школа Священного Служения для служебных помощников',
  ],
];

export class SchoolAbsencesAndName1936000000000 implements MigrationInterface {
  name = 'SchoolAbsencesAndName1936000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "absences"
      ADD COLUMN IF NOT EXISTS "special_event_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "absences"
      ADD CONSTRAINT "FK_absences_special_event"
      FOREIGN KEY ("special_event_id")
      REFERENCES "special_events"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_absences_special_event"
      ON "absences" ("special_event_id")
    `);
    for (const [type, before, after] of NAMES) {
      const [{ count }] = (await queryRunner.query(
        `WITH renamed AS (
           UPDATE "special_events" SET "title" = $3
            WHERE "type" = $1 AND btrim("title") = $2
           RETURNING "id"
         )
         SELECT COUNT(*)::int AS count FROM renamed`,
        [type, before, after],
      )) as { count: number }[];
      console.log(`      [SchoolAbsencesAndName] ${type} renamed: ${count}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [type, before, after] of NAMES) {
      await queryRunner.query(
        `UPDATE "special_events" SET "title" = $2
          WHERE "type" = $1 AND btrim("title") = $3`,
        [type, before, after],
      );
    }
    await queryRunner.query(
      `DELETE FROM "absences" WHERE "special_event_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_absences_special_event"`,
    );
    await queryRunner.query(`
      ALTER TABLE "absences" DROP CONSTRAINT IF EXISTS "FK_absences_special_event"
    `);
    await queryRunner.query(`
      ALTER TABLE "absences" DROP COLUMN IF EXISTS "special_event_id"
    `);
  }
}
