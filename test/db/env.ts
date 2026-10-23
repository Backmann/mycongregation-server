/**
 * Where the throwaway database lives. CI gives a postgres service; locally the
 * stand's cluster is used, under a database name nothing else touches.
 */
export function dbEnv(): Record<string, string> {
  const e = process.env;
  return {
    NODE_ENV: 'test',
    POSTGRES_HOST: e.TEST_PG_HOST ?? e.POSTGRES_HOST ?? 'localhost',
    POSTGRES_PORT: e.TEST_PG_PORT ?? e.POSTGRES_PORT ?? '5432',
    POSTGRES_USER: e.TEST_PG_USER ?? e.POSTGRES_USER ?? 'postgres',
    POSTGRES_PASSWORD: e.TEST_PG_PASSWORD ?? e.POSTGRES_PASSWORD ?? 'postgres',
    POSTGRES_ADMIN_DB: e.TEST_PG_ADMIN_DB ?? 'postgres',
    POSTGRES_DB: 'congmap_dbtest',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: 'dbtest',
    JWT_SECRET: 'db-test-only-secret-that-is-long-enough-x',
    JWT_REFRESH_SECRET: 'db-test-only-refresh-secret-long-enough-x',
    KEK_BASE64: 'ZGItdGVzdC1vbmx5LWtlay0zMi1ieXRlcy1sb25nISE=',
    BCRYPT_ROUNDS: '10',
    CORS_ORIGIN: '*',
  };
}
