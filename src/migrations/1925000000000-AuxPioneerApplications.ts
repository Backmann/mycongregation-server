import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The S-205b application online, and the service committee's three places on
 * it (Lionel, 29 October 2026). See entities/aux-pioneer-application.entity.ts.
 */
export class AuxPioneerApplications1925000000000 implements MigrationInterface {
  name = 'AuxPioneerApplications1925000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aux_pioneer_applications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "publisher_id" uuid NOT NULL,
        "months" text[] NOT NULL,
        "until_cancelled" boolean NOT NULL DEFAULT false,
        "reduced_months" text[] NOT NULL DEFAULT '{}',
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "source" varchar(8) NOT NULL DEFAULT 'app',
        "created_by" uuid,
        "paper_date" date,
        "approved_at" timestamptz,
        "period_ids" uuid[] NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_aux_pioneer_applications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_aux_app_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_aux_app_publisher" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_aux_app_status" CHECK ("status" IN ('pending', 'approved')),
        CONSTRAINT "CHK_aux_app_source" CHECK ("source" IN ('app', 'paper'))
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_aux_app_cong_status" ON "aux_pioneer_applications" ("congregation_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_aux_app_publisher" ON "aux_pioneer_applications" ("publisher_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aux_pioneer_application_seats" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "application_id" uuid NOT NULL,
        "seat" varchar(32) NOT NULL,
        "open_reason" varchar(16),
        "opened_at" timestamptz,
        "opened_by" uuid,
        "approved_by" uuid,
        "approved_at" timestamptz,
        "approver_name" varchar(200),
        "reminded_at" timestamptz,
        CONSTRAINT "PK_aux_pioneer_application_seats" PRIMARY KEY ("id"),
        CONSTRAINT "FK_aux_seat_application" FOREIGN KEY ("application_id") REFERENCES "aux_pioneer_applications"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_aux_seat_seat" CHECK ("seat" IN ('body_coordinator', 'secretary', 'service_overseer'))
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_aux_seat_app_seat" ON "aux_pioneer_application_seats" ("application_id", "seat")`,
    );
    // No brother answers in two places of one application.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_aux_seat_app_voter" ON "aux_pioneer_application_seats" ("application_id", "approved_by") WHERE "approved_by" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "aux_pioneer_application_seats"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "aux_pioneer_applications"`);
  }
}
