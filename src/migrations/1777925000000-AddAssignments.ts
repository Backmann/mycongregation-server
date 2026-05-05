import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssignments1777925000000 implements MigrationInterface {
  name = 'AddAssignments1777925000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- Enums ----
    await queryRunner.query(
      `CREATE TYPE "assignments_event_type_enum" AS ENUM ('midweek', 'weekend', 'cleaning', 'av_duty', 'public_witnessing')`,
    );
    await queryRunner.query(
      `CREATE TYPE "assignments_status_enum" AS ENUM ('draft', 'published', 'cancelled')`,
    );

    // ---- Table ----
    await queryRunner.query(`
      CREATE TABLE "assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "event_type" "assignments_event_type_enum" NOT NULL,
        "part_key" varchar(64) NOT NULL,
        "part_order" integer NOT NULL DEFAULT 0,
        "part_title" varchar(255),
        "part_duration_min" integer,
        "publisher_id" uuid,
        "assistant_publisher_id" uuid,
        "status" "assignments_status_enum" NOT NULL DEFAULT 'draft',
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "pk_assignments" PRIMARY KEY ("id")
      )
    `);

    // Comments for documentation
    await queryRunner.query(
      `COMMENT ON COLUMN "assignments"."week_start_date" IS 'Monday of the ISO week (frontend normalizes to Monday)'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "assignments"."part_key" IS 'Programmatic key, e.g. bible_reading, treasures_talk, apply_yourself_1'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "assignments"."part_order" IS 'Sort order within the event (1, 2, 3...)'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "assignments"."part_title" IS 'Override label, e.g. "1 Тимофею 2:1-15" or "Why we should pray"'`,
    );

    // ---- Indexes ----
    await queryRunner.query(
      `CREATE INDEX "idx_assignments_week_event" ON "assignments" ("congregation_id", "week_start_date", "event_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_assignments_publisher" ON "assignments" ("congregation_id", "publisher_id")`,
    );

    // ---- Foreign keys ----
    await queryRunner.query(`
      ALTER TABLE "assignments"
      ADD CONSTRAINT "fk_assignments_congregation"
      FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "assignments"
      ADD CONSTRAINT "fk_assignments_publisher"
      FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "assignments"
      ADD CONSTRAINT "fk_assignments_assistant_publisher"
      FOREIGN KEY ("assistant_publisher_id") REFERENCES "publishers"("id")
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP CONSTRAINT "fk_assignments_assistant_publisher"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP CONSTRAINT "fk_assignments_publisher"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP CONSTRAINT "fk_assignments_congregation"`,
    );
    await queryRunner.query(`DROP INDEX "idx_assignments_publisher"`);
    await queryRunner.query(`DROP INDEX "idx_assignments_week_event"`);
    await queryRunner.query(`DROP TABLE "assignments"`);
    await queryRunner.query(`DROP TYPE "assignments_status_enum"`);
    await queryRunner.query(`DROP TYPE "assignments_event_type_enum"`);
  }
}
