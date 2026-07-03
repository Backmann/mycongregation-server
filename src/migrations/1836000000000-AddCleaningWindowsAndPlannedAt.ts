import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Windows to wash during the weekly thorough cleaning (hall-plan numbers) and
 * the day/time the assigned group agreed to do it (optional; enables the
 * "2 hours before" push once the group picks a slot).
 */
export class AddCleaningWindowsAndPlannedAt1836000000000 implements MigrationInterface {
  name = 'AddCleaningWindowsAndPlannedAt1836000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments"
       ADD COLUMN IF NOT EXISTS "windows" integer[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments"
       ADD COLUMN IF NOT EXISTS "thorough_planned_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" DROP COLUMN IF EXISTS "thorough_planned_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" DROP COLUMN IF EXISTS "windows"`,
    );
  }
}
