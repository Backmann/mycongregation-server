import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pairs on a territory (13 November 2026; mockup «Пары на участке»).
 *
 * - `map_houses.numbers`: the house numbers of the address points inside
 *   each building, «12;12a;14» — one per entrance of a block of flats.
 *   Filled by the next map build; until then empty, and a division names
 *   its pieces by crossing streets as before.
 * - `territory_splits.mode`: «near» (pairs start together and stay
 *   neighbours) or «own» (each pair its own ground). Divisions made before
 *   are «own».
 * - `territory_splits.start`: the common start, [lon, lat]: the meeting
 *   place found on the map, or the middle of the territory.
 */
export class TerritoryPairs1930500000000 implements MigrationInterface {
  name = 'TerritoryPairs1930500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "map_houses" ADD COLUMN IF NOT EXISTS "numbers" varchar(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_splits" ADD COLUMN IF NOT EXISTS "mode" varchar(8) NOT NULL DEFAULT 'own'`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_splits" ADD COLUMN IF NOT EXISTS "start" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_splits" DROP COLUMN IF EXISTS "start"`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_splits" DROP COLUMN IF EXISTS "mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "map_houses" DROP COLUMN IF EXISTS "numbers"`,
    );
  }
}
