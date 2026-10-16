import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where an announced field-service meeting was before it moved (16 October
 * 2026). A cancelled meeting stays in sight crossed out; a moved one used to
 * leave its old day simply empty, and whoever missed the message saw a
 * Saturday with nothing on it. `moved_from_date` lets both days say so.
 */
export class FieldServiceMeetingMovedFrom1905000000000 implements MigrationInterface {
  name = 'FieldServiceMeetingMovedFrom1905000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" ADD COLUMN IF NOT EXISTS "moved_from_date" date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP COLUMN IF EXISTS "moved_from_date"`,
    );
  }
}
