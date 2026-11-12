import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Outlines changed by hand (12 November 2026). A border moved between two
 * neighbours changes both at once; their earlier outlines share one
 * `edit_id`, so «undo» puts both back together. Imported outlines have none.
 */
export class TerritoryShapeEdit1929900000000 implements MigrationInterface {
  name = 'TerritoryShapeEdit1929900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_shapes" ADD COLUMN IF NOT EXISTS "edit_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_territory_shapes_edit" ON "territory_shapes" ("edit_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_territory_shapes_edit"`);
    await queryRunner.query(
      `ALTER TABLE "territory_shapes" DROP COLUMN IF EXISTS "edit_id"`,
    );
  }
}
