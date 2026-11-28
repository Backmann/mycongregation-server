import { Harness, startHarness } from './harness';
import { planProblems, type SchemaColumn } from '../../src/anon-copy/plan';

/**
 * The anonymised copy refuses to run while any table or column of the live
 * database has no decision in its plan (src/anon-copy/plan.ts). The unit
 * test builds its schema from the entities; a table made by a migration
 * alone slipped past it and would have stopped the copy on the server
 * (independent review, 28 November 2026). Here: the database itself, after
 * every migration.
 */
describe('every table the migrations make has a decision in the copy plan', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it('no table or column without a decision', async () => {
    const schema = await h.sql<SchemaColumn>(
      `SELECT table_name AS "table", column_name AS "column",
              is_nullable = 'YES' AS nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
    );
    expect(schema.length).toBeGreaterThan(500);
    expect(planProblems(schema)).toEqual([]);
  });
});
