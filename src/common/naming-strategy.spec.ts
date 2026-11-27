import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';

/**
 * Every name the database knows, pinned (27 November 2026).
 *
 * Tables, columns, join columns, junction tables, primary keys, foreign keys,
 * indexes and unique constraints — as the entities and the naming strategy
 * make them. Written once from the old `typeorm-naming-strategies` package;
 * any library change (our own strategy, TypeORM 1.x and its new hashing of
 * constraint names) that moves one name fails here, before a migration or a
 * query meets a column that is not there.
 *
 * A deliberate schema change: rewrite the file with
 * `WRITE_NAMES=1 npx jest src/common/naming-strategy.spec.ts` and read the
 * diff.
 */
const FILE = join(__dirname, 'naming-strategy.names.txt');

async function names(): Promise<string[]> {
  const db = new DataSource({
    type: 'postgres',
    entities: [join(__dirname, '..', 'entities', '*.entity.{ts,js}')],
    namingStrategy: new SnakeNamingStrategy(),
  });
  // Reads the decorators; opens no connection.
  await (db as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
  const out: string[] = [];
  for (const m of db.entityMetadatas) {
    const t = m.tableName;
    out.push(`table ${t}`);
    for (const c of m.columns) out.push(`column ${t}.${c.databaseName}`);
    for (const r of m.relations)
      if (r.joinTableName)
        out.push(`junction ${t}.${r.propertyName} ${r.joinTableName}`);
    for (const f of m.foreignKeys)
      out.push(`fk ${t}.${f.name} (${f.columnNames.join(',')})`);
    for (const i of m.indices)
      out.push(
        `index ${t}.${i.name} (${i.columns.map((c) => c.databaseName).join(',')})`,
      );
    for (const u of m.uniques)
      out.push(
        `unique ${t}.${u.name} (${u.columns.map((c) => c.databaseName).join(',')})`,
      );
    for (const k of m.checks) out.push(`check ${t}.${k.name}`);
    if (m.primaryColumns.length)
      out.push(
        `pk ${t}.${db.namingStrategy.primaryKeyName(
          t,
          m.primaryColumns.map((c) => c.databaseName),
        )}`,
      );
  }
  return out.sort();
}

describe('every name in the database, pinned', () => {
  it('no table, column or constraint name moved', async () => {
    const now = await names();
    if (process.env.WRITE_NAMES === '1') {
      writeFileSync(FILE, now.join('\n') + '\n');
    }
    const pinned = readFileSync(FILE, 'utf8').trim().split('\n');
    expect(now.length).toBeGreaterThan(1000);
    expect(now).toEqual(pinned);
  });
});
