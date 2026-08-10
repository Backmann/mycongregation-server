export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV,
    port: parseInt(process.env.PORT || '3000', 10),
    apiPrefix: process.env.API_PREFIX || 'api',
    corsOrigin: process.env.CORS_ORIGIN || '',
  },
  /**
   * Which build of the phone app the congregation should be on.
   *
   * Kept in the server's environment rather than in a congregation's settings
   * on purpose: which build exists is the platform owner's business, not
   * something each congregation decides for itself.
   *
   * `current` — the newest build handed out. Anyone below it sees a strip
   *   inviting them to update, which they can dismiss.
   * `minimum` — the oldest build still able to talk to this server. Below it
   *   the app must stop and say so; a wrong answer from an app too old to
   *   understand the server is worse than no answer.
   * Leave them unset and nothing is shown at all.
   */
  appVersion: {
    current: process.env.APP_CURRENT_BUILD || null,
    minimum: process.env.APP_MIN_BUILD || null,
    downloadUrl:
      process.env.APP_DOWNLOAD_URL || 'https://mycongregation.org/app/',
  },
  database: {
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  },
  expo: {
    accessToken: process.env.EXPO_ACCESS_TOKEN || '',
  },
});
