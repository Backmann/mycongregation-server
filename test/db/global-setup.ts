import { join } from 'path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { dbEnv } from './env';

/**
 * A database of its own for every run (23 October 2026).
 *
 * Dropped and made again, then brought to today by the very migrations the
 * production server runs. The tests then talk to the real application over
 * HTTP, as the app does — the stand checks of 23 October, kept as tests.
 */
export default async function globalSetup(): Promise<void> {
  const env = dbEnv();
  Object.assign(process.env, env);
  const admin = new Client({
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT),
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_ADMIN_DB,
  });
  await admin.connect();
  // The template every test file copies; its own copies are left by earlier
  // runs only if a run died, and are swept here.
  const left = await admin.query(
    `SELECT datname FROM pg_database WHERE datname LIKE 'congmap_dbtest%'`,
  );
  for (const row of left.rows as { datname: string }[]) {
    await admin.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
  }
  await admin.query(`CREATE DATABASE "${env.POSTGRES_DB}"`);
  await admin.end();

  const ds = new DataSource({
    type: 'postgres',
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT),
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    entities: [join(__dirname, '..', '..', 'src', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, '..', '..', 'src', 'migrations', '*.{ts,js}')],
    namingStrategy: new SnakeNamingStrategy(),
  });
  await ds.initialize();
  await ds.runMigrations({ transaction: 'each' });
  await ds.destroy();
  // A template may not have connections while it is copied.
}
