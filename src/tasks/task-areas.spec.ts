import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TASK_AREAS, TABLES_CONSTRAINED_BY_AREA } from './task-areas';

/**
 * The copy TypeScript cannot reach.
 *
 * Three of the four places areas lived in are now one: the list, the type
 * derived from it, and the validator that reads it. The fourth is a CHECK
 * constraint inside the database, written by a migration — and no compiler
 * will ever notice when it falls behind.
 *
 * It has fallen behind before. «Объявления» was added to the type and to the
 * form and not to the constraint, and a task in that area could not be saved:
 * the screen offered a choice the database refused. The failure surfaced as a
 * save that did nothing, which is the hardest kind to trace.
 *
 * So this reads the migrations the way Postgres will read them — last write
 * wins — and insists the constraint lists exactly what the code offers. Add an
 * area without a migration and this fails, naming what is missing.
 */
describe('the areas the database allows', () => {
  const dir = join(__dirname, '..', 'migrations');

  /**
   * Migrations in the order Postgres applies them: by their numeric prefix,
   * and only the `up` half of each.
   *
   * The `down` half is the trap, and it caught this test first time out: it
   * re-adds the PREVIOUS constraint, so reading the whole file makes the old
   * list look like the latest word. Postgres never runs it on the way forward.
   */
  const migrationsInOrder = () =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .map((f) => {
        const whole = readFileSync(join(dir, f), 'utf8');
        const downAt = whole.search(/public\s+async\s+down\s*\(/);
        return { name: f, text: downAt < 0 ? whole : whole.slice(0, downAt) };
      });

  /**
   * The areas the LAST constraint written for a table allows.
   *
   * Every migration that touches the table's area check is read in turn, so
   * what remains is what the running database actually enforces.
   */
  const allowedFor = (table: string): string[] | null => {
    let latest: string[] | null = null;
    for (const { text } of migrationsInOrder()) {
      // ALTER TABLE "<table>" ... CHECK ("area" IN ('a','b',...))
      const statements = text.split(/ALTER TABLE/i).slice(1);
      for (const statement of statements) {
        if (!new RegExp(`"${table}"`).test(statement)) continue;
        const check = /CHECK\s*\(\s*"area"\s+IN\s*\(([^)]*)\)/i.exec(statement);
        if (!check) continue;
        // A `down` that drops the constraint is not a new list; only an added
        // one counts, and ADD CONSTRAINT is what writes it.
        if (!/ADD\s+CONSTRAINT/i.test(statement)) continue;
        latest = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      }
      // A table can also be created with its check inline.
      const created =
        /CREATE TABLE[^;]*?"area"[^;]*?CHECK\s*\(\s*"area"\s+IN\s*\(([^)]*)\)/is;
      for (const { text: t } of [{ text }]) {
        const m = created.exec(t);
        if (m && new RegExp(`CREATE TABLE[^;]*"${table}"`, 'is').test(t)) {
          latest = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
        }
      }
    }
    return latest;
  };

  it.each([...TABLES_CONSTRAINED_BY_AREA])(
    'allows exactly the coded areas on %s',
    (table) => {
      const allowed = allowedFor(table);
      expect(allowed).not.toBeNull();

      const missingInDb = TASK_AREAS.filter((a) => !allowed!.includes(a));
      const missingInCode = allowed!.filter(
        (a) => !(TASK_AREAS as readonly string[]).includes(a),
      );

      // Named rather than merely compared, so a failure says what to do: write
      // a migration for the first list, delete or restore for the second.
      expect({ missingInDb, missingInCode }).toEqual({
        missingInDb: [],
        missingInCode: [],
      });
    },
  );

  it('finds a real constraint to read, not an empty result it mistook for agreement', () => {
    // Without this, a rename of the column or the table would make the check
    // above pass by finding nothing at all.
    for (const table of TABLES_CONSTRAINED_BY_AREA) {
      expect(allowedFor(table)!.length).toBeGreaterThan(3);
    }
  });
});
