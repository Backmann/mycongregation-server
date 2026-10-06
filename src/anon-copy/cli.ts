/**
 * Make an anonymised copy of the database for testing.
 *
 *   docker compose exec -T server node dist/src/anon-copy/cli.js > copy.json
 *
 * Reads only: one read-only transaction, no write of any kind. The copy goes
 * to standard output, the account of what was done — to standard error, so
 * the two never mix. Needs no encryption key: encrypted fields are removed
 * without being read.
 *
 * Refuses, and writes nothing, when
 *  - a field of the database has no decision in plan.ts, or
 *  - a real name, an encrypted value or an e-mail address is found in the
 *    finished copy (anonymise.ts → findLeaks).
 */
import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';
import { anonymise, type Row, type Tables } from './anonymise';
import { PLAN, planProblems, type SchemaColumn } from './plan';

// Quiet: its greeting goes to standard output, which is the file.
loadEnv({ quiet: true });

const say = (line = '') => process.stderr.write(line + '\n');

/** Tables whose first rows are shown, so that a person can see the names. */
const SHOWN: Record<string, string[]> = {
  publishers: ['first_name', 'last_name', 'display_name', 'mobile_phone'],
  users: ['email', 'login_name', 'role'],
  visiting_speakers: ['first_name', 'last_name', 'phone'],
  circuit_overseers: ['first_name', 'last_name', 'wife_name'],
  external_congregations: ['name', 'city', 'contact_name'],
  service_groups: ['name', 'meeting_location'],
};

function shown(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function main(): Promise<number> {
  const db = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl:
      process.env.POSTGRES_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
  });
  await db.initialize();
  const runner = db.createQueryRunner();
  try {
    await runner.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );

    const schema = (await runner.query(
      `SELECT table_name AS "table", column_name AS "column",
              is_nullable = 'YES' AS nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
    )) as SchemaColumn[];
    const problems = planProblems(schema);
    if (problems.length > 0) {
      say('НЕ СДЕЛАНО: в базе есть поля, о которых в описи нет решения.');
      for (const p of problems) say('  ' + p);
      return 2;
    }

    const last = (await runner.query(
      'SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 1',
    )) as { name: string }[];

    const first = new Map<string, string>();
    for (const c of schema)
      if (!first.has(c.table)) first.set(c.table, c.column);

    const source: Tables = {};
    for (const [table, plan] of Object.entries(PLAN)) {
      if (plan === 'skip') continue;
      const rows = (await runner.query(
        `SELECT row_to_json(t) AS r FROM "${table}" t ORDER BY t."${first.get(table)}"`,
      )) as { r: Row }[];
      source[table] = rows.map((x) => x.r);
    }

    const { tables, leaks } = anonymise(source);
    if (leaks.length > 0) {
      say('НЕ СДЕЛАНО: в готовой копии нашлось то, чего в ней быть не должно.');
      say('Копия не записана. Пришлите эти строки — в них нет самих значений:');
      for (const l of leaks) {
        say(`  ${l.table}.${l.column}: ${l.what} × ${l.count}`);
      }
      return 3;
    }

    const counts: Record<string, number> = {};
    for (const [table, rows] of Object.entries(tables)) {
      counts[table] = rows.length;
    }
    const file =
      JSON.stringify({
        meta: {
          made: new Date().toISOString(),
          schema: last[0]?.name ?? null,
          rows: counts,
        },
        tables,
      }) + '\n';
    // Wait for the last byte: leaving while a pipe is still being written
    // would cut the file short.
    await new Promise<void>((done, fail) =>
      process.stdout.write(file, (err) => (err ? fail(err) : done())),
    );

    say('──── копия сделана ────');
    say(`структура базы: ${last[0]?.name ?? '?'}`);
    say('строк по таблицам:');
    for (const [table, n] of Object.entries(counts)) {
      if (n > 0) say(`  ${table}: ${n}`);
    }
    say('');
    say('Посмотрите первые строки. Все имена здесь должны быть выдуманными,');
    say(
      'телефоны и контакты — пустыми. Увидите настоящее — файл не отправляйте.',
    );
    for (const [table, columns] of Object.entries(SHOWN)) {
      say('');
      say(`${table}:`);
      for (const row of (tables[table] ?? []).slice(0, 5)) {
        say('  ' + columns.map((c) => shown(row[c])).join(' | '));
      }
    }
    say('──── конец ────');
    return 0;
  } finally {
    await runner.query('ROLLBACK').catch(() => undefined);
    await runner.release();
    await db.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // The message of a database error can quote a row; the kind of error is
    // enough to act on.
    say(`НЕ СДЕЛАНО: ${err instanceof Error ? err.name : 'ошибка'}`);
    if (process.env.ANON_COPY_DEBUG === '1') console.error(err);
    process.exit(1);
  },
);
