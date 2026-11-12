import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cutting and joining territories (12 November 2026).
 *
 * - `territories.worked_from`: when two are joined, the joined one counts as
 *   last worked on the older of their two dates; completions recorded on it
 *   before the join no longer make it look recently worked. Null: all count.
 * - `territory_shapes.detail`: what a cut, a join or a new territory did
 *   besides the outlines (the territory made, the one archived, the
 *   «не посещать» addresses moved), so «undo» can put it all back.
 */
export class TerritoryReshape1930100000000 implements MigrationInterface {
  name = 'TerritoryReshape1930100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territories" ADD COLUMN IF NOT EXISTS "worked_from" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_shapes" ADD COLUMN IF NOT EXISTS "detail" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_shapes" DROP COLUMN IF EXISTS "detail"`,
    );
    await queryRunner.query(
      `ALTER TABLE "territories" DROP COLUMN IF EXISTS "worked_from"`,
    );
  }
}
