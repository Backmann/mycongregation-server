import { MigrationInterface, QueryRunner } from 'typeorm';
/**
 * Month-closure ledger for service reports. A row marks a reporting month as
 * confirmed/closed: edits are then frozen for everyone except admins and the
 * secretary. Re-opening deletes the row.
 */
export class AddReportMonthClosures1790000000000 implements MigrationInterface {
  name = 'AddReportMonthClosures1790000000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "report_month_closures" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "report_month" date NOT NULL,
        "closed_by_id" uuid,
        "closed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_report_month_closures" PRIMARY KEY ("id"),
        CONSTRAINT "uq_report_month_closures_cong_month" UNIQUE ("congregation_id", "report_month")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_report_month_closures_congregation" ON "report_month_closures" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_report_month_closures_report_month" ON "report_month_closures" ("report_month")`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_month_closures"
       ADD CONSTRAINT "fk_report_month_closures_congregation"
       FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_month_closures"
       ADD CONSTRAINT "fk_report_month_closures_closed_by"
       FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "report_month_closures" DROP CONSTRAINT "fk_report_month_closures_closed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_month_closures" DROP CONSTRAINT "fk_report_month_closures_congregation"`,
    );
    await queryRunner.query(`DROP TABLE "report_month_closures"`);
  }
}
