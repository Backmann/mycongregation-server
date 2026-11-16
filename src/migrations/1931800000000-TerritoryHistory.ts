import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The S-13 kept by hand (17 November 2026):
 *
 *  - `transferred`: a line that ended because the keeper handed the
 *    territory on to someone else — the S-13 reads «передан …» instead of an
 *    empty «worked» column;
 *  - two lines of one territory never lie over each other by days. The
 *    screens already refuse it; the database now does too, so neither an
 *    import nor a slip in the code can write a history in which two people
 *    held a territory at once. A line may start the day the one before it
 *    ended (half-open ranges). An open line runs on without end.
 *
 * Old rows in old shapes: if some congregation's records already overlap,
 * the constraint is NOT added and the server log says so — the rest of this
 * migration must still land, or the new code would read a column that is
 * not there. Live data checked on 16 November 2026: 0 overlaps in the kept
 * service years.
 */
export class TerritoryHistory1931800000000 implements MigrationInterface {
  name = 'TerritoryHistory1931800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_assignments" ADD COLUMN IF NOT EXISTS "transferred" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    const [backwards] = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM territory_assignments
        WHERE COALESCE(completed_on, returned_on) < assigned_on`,
    )) as { n: number }[];
    const [bad] =
      backwards.n > 0
        ? [{ n: 0 }]
        : ((await queryRunner.query(
            `SELECT count(*)::int AS n FROM territory_assignments a
         JOIN territory_assignments b
           ON a.territory_id = b.territory_id AND a.id < b.id
        WHERE daterange(a.assigned_on, COALESCE(a.completed_on, a.returned_on), '[)')
           && daterange(b.assigned_on, COALESCE(b.completed_on, b.returned_on), '[)')`,
          )) as { n: number }[]);
    if (bad.n > 0 || backwards.n > 0) {
      console.warn(
        `TerritoryHistory: overlap constraint NOT added — ${bad.n} overlapping pairs, ${backwards.n} lines ending before they start`,
      );
      return;
    }
    await queryRunner.query(
      `ALTER TABLE "territory_assignments"
         ADD CONSTRAINT "territory_assignments_no_overlap"
         EXCLUDE USING gist (
           territory_id WITH =,
           daterange(assigned_on, COALESCE(completed_on, returned_on), '[)') WITH &&
         )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_assignments" DROP CONSTRAINT IF EXISTS "territory_assignments_no_overlap"`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_assignments" DROP COLUMN IF EXISTS "transferred"`,
    );
  }
}
