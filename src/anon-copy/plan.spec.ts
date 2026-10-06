import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { PLAN, planProblems, type SchemaColumn } from './plan';

/**
 * Every field the code knows has a decision in the plan.
 *
 * This is the guard that makes the plan an allow-list in fact and not only in
 * intent: add a field to an entity without deciding what a copy does with it,
 * and this fails. The same comparison runs against the real database every
 * time a copy is made (cli.ts) — this one runs earlier, before the commit.
 */
describe('anon-copy plan', () => {
  let schema: SchemaColumn[];

  beforeAll(async () => {
    const db = new DataSource({
      type: 'postgres',
      entities: [join(__dirname, '..', 'entities', '*.entity.{ts,js}')],
      namingStrategy: new SnakeNamingStrategy(),
    });
    // Reads the decorators; opens no connection.
    await (
      db as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    schema = [];
    for (const meta of db.entityMetadatas) {
      for (const column of meta.columns) {
        schema.push({
          table: meta.tableName,
          column: column.databaseName,
          nullable: column.isNullable,
        });
      }
    }
    // Not an entity: TypeORM's own table.
    for (const column of ['id', 'timestamp', 'name']) {
      schema.push({ table: 'migrations', column, nullable: false });
    }
  });

  it('sees the entities at all', () => {
    const tables = new Set(schema.map((c) => c.table));
    expect(tables.size).toBeGreaterThan(50);
    expect(tables.has('publishers')).toBe(true);
    expect(tables.has('elder_task_assignees')).toBe(true);
  });

  it('has a decision for every field, and a field for every decision', () => {
    expect(planProblems(schema)).toEqual([]);
  });

  it('notices a field nobody decided about', () => {
    const more = [
      ...schema,
      { table: 'publishers', column: 'nickname', nullable: true },
      { table: 'diaries', column: 'id', nullable: false },
    ];
    expect(planProblems(more)).toEqual([
      'publishers.nickname: no decision in the plan',
      'table diaries: no decision in the plan',
    ]);
  });

  it('notices a decision left behind by a removed field', () => {
    const less = schema.filter(
      (c) => !(c.table === 'halls' && c.column === 'address'),
    );
    expect(planProblems(less)).toEqual([
      'halls.address: in the plan, not in the database',
    ]);
  });

  it('will not empty a field that is required', () => {
    const strict = schema.map((c) =>
      c.table === 'absences' && c.column === 'note'
        ? { ...c, nullable: false }
        : c,
    );
    expect(planProblems(strict)).toEqual([
      'absences.note: cannot be emptied, it is required',
    ]);
  });

  it('copies no secret and no contact', () => {
    const rule = (t: string, c: string) =>
      (PLAN[t] as Record<string, string>)[c];
    for (const c of ['password_hash', 'reset_token_hash', 'invite_code_hash']) {
      expect(rule('users', c)).toBe('null');
    }
    for (const c of ['mobile_phone', 'email', 'address', 'notes']) {
      expect(rule('publishers', c)).toBe('null');
    }
    for (const t of [
      'audit_logs',
      'refresh_sessions',
      'push_tokens',
      'push_receipts',
      'web_push_subscriptions',
      'notification_outbox',
    ]) {
      expect(PLAN[t]).toBe('skip');
    }
  });
});
