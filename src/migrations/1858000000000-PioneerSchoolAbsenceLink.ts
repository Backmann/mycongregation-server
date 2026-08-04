import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An absence the app created because a brother is serving at the Pioneer
 * Service School on the evening of our own midweek meeting.
 *
 * The column exists so the app can take it back. An absence entered by hand is
 * somebody's decision and must never be touched; one that follows from a duty
 * has to disappear when that duty does, or the brother stays marked away for a
 * meeting he is free to attend — and nobody would ever guess why.
 *
 * ON DELETE CASCADE for the same reason: removing a day from the school takes
 * its duties, and the absences that hung on them go with it.
 */
export class PioneerSchoolAbsenceLink1858000000000 implements MigrationInterface {
  name = 'PioneerSchoolAbsenceLink1858000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "absences"
        ADD COLUMN "pioneer_school_duty_id" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "absences"
        ADD CONSTRAINT "fk_absences_pioneer_school_duty"
        FOREIGN KEY ("pioneer_school_duty_id")
        REFERENCES "pioneer_school_duties"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_absences_pioneer_school_duty"
        ON "absences" ("pioneer_school_duty_id")
        WHERE "pioneer_school_duty_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_absences_pioneer_school_duty"
    `);
    await queryRunner.query(`
      ALTER TABLE "absences"
        DROP CONSTRAINT IF EXISTS "fk_absences_pioneer_school_duty"
    `);
    await queryRunner.query(`
      ALTER TABLE "absences" DROP COLUMN "pioneer_school_duty_id"
    `);
  }
}
