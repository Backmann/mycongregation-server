import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A part's whole text from the workbook (23 November 2026). The title kept
 * only the first 120 characters of it, cut mid-word: in the workbooks of
 * January and March 2027, as the app reads them, 16 of 216 parts were longer
 * (the longest 264 characters). Nothing to
 * fill here — the whole text exists only in the file; a new load of the
 * workbook writes it. Old rows stay as they are, with null.
 */
export class AssignmentPartText1941000000000 implements MigrationInterface {
  name = 'AssignmentPartText1941000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "part_text" text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP COLUMN IF EXISTS "part_text"`,
    );
  }
}
