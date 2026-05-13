import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceReports1777935000000 implements MigrationInterface {
  name = 'AddServiceReports1777935000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Phase A of service-reports.md. Two form variants distinguished by
    // which column is non-null:
    //   - served_this_month: regular publishers (PioneerType.NONE)
    //   - hours_reported:    pioneers (PioneerType !== NONE)
    // CHECK constraints enforce data integrity at the DB level.
    await queryRunner.query(`
      CREATE TABLE "service_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "publisher_id" uuid NOT NULL,
        "report_month" date NOT NULL,
        "served_this_month" boolean,
        "hours_reported" integer,
        "bible_studies" integer NOT NULL DEFAULT 0,
        "notes" text,
        "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "submitted_by_id" uuid,
        "submitted_on_behalf_of" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_service_reports" PRIMARY KEY ("id"),
        CONSTRAINT "uq_service_reports_publisher_month" UNIQUE ("publisher_id", "report_month"),
        CONSTRAINT "ck_service_reports_form_variant" CHECK (
          "served_this_month" IS NOT NULL OR "hours_reported" IS NOT NULL
        ),
        CONSTRAINT "ck_service_reports_hours_nonneg" CHECK (
          "hours_reported" IS NULL OR "hours_reported" >= 0
        ),
        CONSTRAINT "ck_service_reports_studies_nonneg" CHECK (
          "bible_studies" >= 0
        ),
        CONSTRAINT "ck_service_reports_month_first_day" CHECK (
          EXTRACT(DAY FROM "report_month") = 1
        )
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_service_reports_congregation" ON "service_reports" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_service_reports_publisher" ON "service_reports" ("publisher_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_service_reports_month" ON "service_reports" ("report_month")`,
    );

    await queryRunner.query(`
      ALTER TABLE "service_reports"
        ADD CONSTRAINT "fk_service_reports_congregation"
        FOREIGN KEY ("congregation_id")
        REFERENCES "congregations"("id")
        ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "service_reports"
        ADD CONSTRAINT "fk_service_reports_publisher"
        FOREIGN KEY ("publisher_id")
        REFERENCES "publishers"("id")
        ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "service_reports"
        ADD CONSTRAINT "fk_service_reports_submitted_by"
        FOREIGN KEY ("submitted_by_id")
        REFERENCES "users"("id")
        ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "service_reports" DROP CONSTRAINT "fk_service_reports_submitted_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_reports" DROP CONSTRAINT "fk_service_reports_publisher"`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_reports" DROP CONSTRAINT "fk_service_reports_congregation"`,
    );
    await queryRunner.query(`DROP INDEX "idx_service_reports_month"`);
    await queryRunner.query(`DROP INDEX "idx_service_reports_publisher"`);
    await queryRunner.query(`DROP INDEX "idx_service_reports_congregation"`);
    await queryRunner.query(`DROP TABLE "service_reports"`);
  }
}
