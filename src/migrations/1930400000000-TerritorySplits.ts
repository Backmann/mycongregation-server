import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A territory divided between groups (13 November 2026).
 *
 * - `map_streets`: every named street of the congregation's map file, rebuilt
 *   with the map like `map_houses`. Public map data only.
 * - `territory_splits`: one territory's division for one day — the streets
 *   of each part. One per assignment and day; deleted with the assignment's
 *   marks when the territory comes back.
 * - `territory_street_marks`: «street walked» while the territory is out:
 *   the houses and the time, never who.
 */
export class TerritorySplits1930400000000 implements MigrationInterface {
  name = 'TerritorySplits1930400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "map_streets" (
        "congregation_id" uuid NOT NULL,
        "street_no" integer NOT NULL,
        "name" varchar(200) NOT NULL,
        "kind" varchar(40) NOT NULL,
        "west" double precision NOT NULL,
        "south" double precision NOT NULL,
        "east" double precision NOT NULL,
        "north" double precision NOT NULL,
        "lines" jsonb NOT NULL,
        CONSTRAINT "PK_map_streets" PRIMARY KEY ("congregation_id", "street_no"),
        CONSTRAINT "FK_map_streets_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_map_streets_box" ON "map_streets" ("congregation_id", "west", "east")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_splits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "territory_id" uuid NOT NULL,
        "assignment_id" uuid NOT NULL,
        "day" date NOT NULL,
        "parts" jsonb NOT NULL,
        "left_out" integer NOT NULL DEFAULT 0,
        "made_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_splits" PRIMARY KEY ("id"),
        CONSTRAINT "FK_territory_splits_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_splits_territory" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_splits_assignment" FOREIGN KEY ("assignment_id") REFERENCES "territory_assignments"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_territory_splits_day" ON "territory_splits" ("assignment_id", "day")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_street_marks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "assignment_id" uuid NOT NULL,
        "street_key" varchar(220) NOT NULL,
        "homes" jsonb NOT NULL,
        "marked_at" timestamptz NOT NULL,
        CONSTRAINT "PK_territory_street_marks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_territory_street_marks_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_street_marks_assignment" FOREIGN KEY ("assignment_id") REFERENCES "territory_assignments"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_territory_street_marks" ON "territory_street_marks" ("assignment_id", "street_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_street_marks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_splits"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "map_streets"`);
  }
}
