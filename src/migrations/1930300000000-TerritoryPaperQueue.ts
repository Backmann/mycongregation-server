import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The queue of paper maps (13 November 2026): a territory given out on a
 * phone, whose holder walks with paper, waits here until the territory
 * servant prints it on a computer (the printed map is drawn by a browser).
 * Cleared once printed; meaningless once the territory is back.
 */
export class TerritoryPaperQueue1930300000000 implements MigrationInterface {
  name = 'TerritoryPaperQueue1930300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_assignments" ADD COLUMN IF NOT EXISTS "paper_wanted_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_assignments" DROP COLUMN IF EXISTS "paper_wanted_at"`,
    );
  }
}
