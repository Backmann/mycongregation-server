import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-congregation opt-in for assignment automation rules (e.g. chairman ->
 * concluding/opening prayer auto-fill). Off by default so the shared template
 * stays neutral; congregations enable it on the Schedule "Rules" page.
 */
export class AddAssignmentAutomation1827000000000 implements MigrationInterface {
  name = 'AddAssignmentAutomation1827000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "congregations" ADD COLUMN "assignment_automation_enabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "congregations" DROP COLUMN "assignment_automation_enabled"`,
    );
  }
}
