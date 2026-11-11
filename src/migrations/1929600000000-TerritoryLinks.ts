import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A link without login to one assignment's map (11 November 2026): only the
 * hash of the link is kept, so the database never holds a working link.
 * A new link replaces the old one; the link stops with the assignment.
 */
export class TerritoryLinks1929600000000 implements MigrationInterface {
  name = 'TerritoryLinks1929600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_assignments" ADD COLUMN IF NOT EXISTS "link_hash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_assignments" ADD COLUMN IF NOT EXISTS "link_created_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_territory_assignments_link_hash" ON "territory_assignments" ("link_hash") WHERE "link_hash" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_territory_assignments_link_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_assignments" DROP COLUMN IF EXISTS "link_created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_assignments" DROP COLUMN IF EXISTS "link_hash"`,
    );
  }
}
