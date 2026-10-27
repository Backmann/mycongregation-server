import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The congregation's places at its meetings (27 October 2026): the template a
 * new duty sheet is cut from. Empty for everybody on the day it ships — and
 * an empty template means the code's list, exactly as before.
 */
export class DutyPlaces1921000000000 implements MigrationInterface {
  name = 'DutyPlaces1921000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "duty_places" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "meeting_kind" varchar(16) NOT NULL,
        "duty_type" varchar(32) NOT NULL,
        "custom_label" varchar(60),
        "count" smallint NOT NULL DEFAULT 1,
        "sort_order" integer NOT NULL DEFAULT 0,
        "notes" text,
        "capability" varchar(40),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_duty_places" PRIMARY KEY ("id"),
        CONSTRAINT "FK_duty_places_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_duty_places_kind" CHECK ("meeting_kind" IN ('midweek', 'weekend')),
        CONSTRAINT "CHK_duty_places_count" CHECK ("count" BETWEEN 1 AND 10)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_duty_places_cong_kind" ON "duty_places" ("congregation_id", "meeting_kind")`,
    );
    // One place per type, and one per own name, in each kind of meeting.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_duty_places_place" ON "duty_places"
         ("congregation_id", "meeting_kind", "duty_type", lower(coalesce("custom_label", '')))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "duty_places"`);
  }
}
