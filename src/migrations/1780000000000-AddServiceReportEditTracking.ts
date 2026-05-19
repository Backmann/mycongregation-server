import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceReportEditTracking1780000000000 implements MigrationInterface {
  name = 'AddServiceReportEditTracking1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_reports"
       ADD COLUMN "last_edited_at" timestamptz NULL,
       ADD COLUMN "last_edited_by_id" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_reports"
       ADD CONSTRAINT "fk_service_reports_last_edited_by"
       FOREIGN KEY ("last_edited_by_id")
       REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_reports"
       DROP CONSTRAINT "fk_service_reports_last_edited_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_reports"
       DROP COLUMN "last_edited_by_id",
       DROP COLUMN "last_edited_at"`,
    );
  }
}
