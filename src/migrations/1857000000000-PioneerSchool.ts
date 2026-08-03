import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Pioneer Service School: the school, its days, the brothers who may serve
 * and who holds which role on which day.
 *
 * Four tables rather than one because the four things have different lifetimes.
 * The school and its days belong to one event and go together (CASCADE). The
 * list of brothers outlives every school — a school comes round in a few years
 * and the same names help — so it stands on its own and a duty merely points
 * at it (SET NULL: removing a name from the list must not silently empty a day
 * nobody was looking at).
 */
export class PioneerSchool1857000000000 implements MigrationInterface {
  name = 'PioneerSchool1857000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "pioneer_schools" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "title" varchar(160) NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "hall_name" varchar(160),
        "hall_address" varchar(255),
        "start_time" varchar(5),
        "end_time" varchar(5),
        "microphone_slots" integer NOT NULL DEFAULT 2,
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "pk_pioneer_schools" PRIMARY KEY ("id"),
        CONSTRAINT "fk_pioneer_schools_congregation"
          FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "ck_pioneer_schools_dates" CHECK ("end_date" >= "start_date")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pioneer_schools_congregation"
        ON "pioneer_schools" ("congregation_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pioneer_schools_start"
        ON "pioneer_schools" ("congregation_id", "start_date")
    `);

    await queryRunner.query(`
      CREATE TABLE "pioneer_school_helpers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "first_name" varchar(80) NOT NULL,
        "last_name" varchar(80) NOT NULL,
        "congregation_name" varchar(160),
        "publisher_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "pk_pioneer_school_helpers" PRIMARY KEY ("id"),
        CONSTRAINT "fk_pioneer_school_helpers_congregation"
          FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_pioneer_school_helpers_publisher"
          FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pioneer_school_helpers_congregation"
        ON "pioneer_school_helpers" ("congregation_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pioneer_school_helpers_name"
        ON "pioneer_school_helpers" ("congregation_id", "last_name")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pioneer_school_helpers_publisher"
        ON "pioneer_school_helpers" ("publisher_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "pioneer_school_days" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "school_id" uuid NOT NULL,
        "date" date NOT NULL,
        "start_time" varchar(5),
        "end_time" varchar(5),
        CONSTRAINT "pk_pioneer_school_days" PRIMARY KEY ("id"),
        CONSTRAINT "fk_pioneer_school_days_school"
          FOREIGN KEY ("school_id") REFERENCES "pioneer_schools"("id")
          ON DELETE CASCADE,
        CONSTRAINT "uq_pioneer_school_day" UNIQUE ("school_id", "date")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pioneer_school_days_date"
        ON "pioneer_school_days" ("congregation_id", "date")
    `);

    await queryRunner.query(`
      CREATE TABLE "pioneer_school_duties" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "day_id" uuid NOT NULL,
        "duty_type" varchar(32) NOT NULL,
        "slot_index" integer NOT NULL DEFAULT 0,
        "custom_label" varchar(120),
        "helper_id" uuid,
        CONSTRAINT "pk_pioneer_school_duties" PRIMARY KEY ("id"),
        CONSTRAINT "fk_pioneer_school_duties_day"
          FOREIGN KEY ("day_id") REFERENCES "pioneer_school_days"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_pioneer_school_duties_helper"
          FOREIGN KEY ("helper_id") REFERENCES "pioneer_school_helpers"("id")
          ON DELETE SET NULL,
        CONSTRAINT "uq_pioneer_school_duty"
          UNIQUE ("day_id", "duty_type", "slot_index")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pioneer_school_duties_helper"
        ON "pioneer_school_duties" ("congregation_id", "helper_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pioneer_school_duties"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pioneer_school_days"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pioneer_school_helpers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pioneer_schools"`);
  }
}
