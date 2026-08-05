import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A deleted item of the circuit overseer's visit stops disappearing.
 *
 * Until now the row was erased outright and nothing was written down about it:
 * one mis-tap and the only way back was decrypting last night's backup and
 * reading the values out by hand. Everything else people type into this app
 * either hides instead of vanishing or leaves its contents in the change
 * journal; this was the hole.
 *
 * The column alone is what makes an undo possible at all — there is nothing to
 * restore from a row that is gone.
 */
export class CoVisitItemSoftDelete1859000000000 implements MigrationInterface {
  name = 'CoVisitItemSoftDelete1859000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "co_visit_items" ADD COLUMN "deleted_at" timestamptz NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_co_visit_items_deleted_at"
        ON "co_visit_items" ("deleted_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_co_visit_items_deleted_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "co_visit_items" DROP COLUMN "deleted_at"
    `);
  }
}
