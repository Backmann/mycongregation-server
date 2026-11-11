import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The territory section (11 November 2026): territories, their earlier
 * outlines, the congregation's boundary, assignments (the S-13 lines),
 * do-not-call addresses and the section's state. See the entities.
 */
export class Territories1929400000000 implements MigrationInterface {
  name = 'Territories1929400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "number" character varying(40) NOT NULL,
        "locality" character varying(120),
        "kind" character varying(8),
        "geometry" jsonb NOT NULL,
        "note" text,
        "last_completed_on" date,
        "archived_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territories" PRIMARY KEY ("id"),
        CONSTRAINT "FK_territories_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_territories_congregation" ON "territories" ("congregation_id")`,
    );
    // A number names one territory in use; an archived one frees it.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_territories_number" ON "territories" ("congregation_id", lower("number")) WHERE "archived_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_shapes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "territory_id" uuid NOT NULL,
        "geometry" jsonb NOT NULL,
        "reason" character varying(12) NOT NULL,
        "from_territory_ids" uuid array NOT NULL DEFAULT '{}',
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_shapes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_territory_shapes_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_shapes_territory" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_territory_shapes_territory" ON "territory_shapes" ("territory_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_boundaries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "geometry" jsonb NOT NULL,
        "description" jsonb,
        "valid_from" date,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_boundaries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_territory_boundaries_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_territory_boundaries_congregation" ON "territory_boundaries" ("congregation_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "territory_id" uuid NOT NULL,
        "publisher_id" uuid,
        "holder_name" character varying(160) NOT NULL,
        "for_group_id" uuid,
        "for_group_name" character varying(80),
        "assigned_on" date NOT NULL,
        "due_on" date,
        "completed_on" date,
        "returned_on" date,
        "method" character varying(14),
        "extended" boolean NOT NULL DEFAULT false,
        "imported" boolean NOT NULL DEFAULT false,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_territory_assignments_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_assignments_territory" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_assignments_publisher" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_territory_assignments_group" FOREIGN KEY ("for_group_id") REFERENCES "service_groups"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_territory_assignments_one_end" CHECK ("completed_on" IS NULL OR "returned_on" IS NULL)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_territory_assignments_congregation" ON "territory_assignments" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_territory_assignments_territory" ON "territory_assignments" ("territory_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_territory_assignments_open" ON "territory_assignments" ("territory_id") WHERE "completed_on" IS NULL AND "returned_on" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_no_calls" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "territory_id" uuid NOT NULL,
        "address" text NOT NULL,
        "surname" text,
        "noted_on" date NOT NULL,
        "review_on" date NOT NULL,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_no_calls" PRIMARY KEY ("id"),
        CONSTRAINT "FK_territory_no_calls_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_no_calls_territory" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_territory_no_calls_territory" ON "territory_no_calls" ("territory_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_settings" (
        "congregation_id" uuid NOT NULL,
        "verified_at" TIMESTAMP WITH TIME ZONE,
        "verified_by_user_id" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_settings" PRIMARY KEY ("congregation_id"),
        CONSTRAINT "FK_territory_settings_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_no_calls"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_boundaries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_shapes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "territories"`);
  }
}
