#!/usr/bin/env bash
# The invented congregation of scripts/seed-screens.mjs on a running server.
#
#   scripts/screens-server.sh          migrate an empty database, start, seed,
#                                      keep a copy of the seeded database
#   scripts/screens-server.sh restore  stop the server, put the seeded copy
#                                      back, start again
#
# Used by two pipelines, so they walk one path:
#   • this repository's CI (job "seed"): a change to the API that breaks the
#     data set fails here, on the server, before it reaches the app;
#   • the app's CI (job "screens"), which photographs main and the pull request
#     one after the other — and restores the seeded copy before each, because
#     a screen can write (a «Later» on a card is kept on the server), and the
#     second side must not see what the first one did.
#
# Expects a built server (npm ci && npm run build) and Postgres reachable
# through the POSTGRES_* variables, with an empty database for the first form.
# The server runs on $PORT (default 3000), logs to server.log, and its process
# id is kept in .screens-server.pid. The first form prints the seed summary
# (current week, logins) as its last line.
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_ENV="${NODE_ENV:-test}"
export PORT="${PORT:-3000}"
export TZ=UTC
# The two static copies of the app (main and the pull request) in the app's CI.
export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:8091,http://localhost:8092}"
# Validated at boot but never connected to here.
export REDIS_HOST="${REDIS_HOST:-localhost}" REDIS_PORT="${REDIS_PORT:-6379}" REDIS_PASSWORD="${REDIS_PASSWORD:-ci}"
export JWT_SECRET="${JWT_SECRET:-screens-only-secret-that-is-long-enough}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-screens-only-refresh-secret-long-enough}"
# The same key on every start: the seeded rows are encrypted with it.
KEY_FILE=.screens-kek
[ -f "$KEY_FILE" ] || openssl rand -base64 32 > "$KEY_FILE"
export KEK_BASE64="${KEK_BASE64:-$(cat "$KEY_FILE")}"
SNAPSHOT="${POSTGRES_DB}_seeded"

# SQL on the maintenance database, through the server's own driver.
admin_sql() {
  node -e '
    const { Client } = require("pg");
    const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT,
      user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_ADMIN_DB || "postgres" });
    c.connect().then(async () => { for (const q of process.argv.slice(1)) await c.query(q); await c.end(); })
      .catch((e) => { console.error(e.message); process.exit(1); });
  ' "$@"
}

# SQL on one database (the seeded one), through the server's own driver.
admin_sql_on() {
  POSTGRES_ADMIN_DB="$1" admin_sql "${@:2}"
}

start() {
  MAIN="$(find dist -name main.js -type f | head -1)"
  [ -n "$MAIN" ] || { echo "No main.js under dist — build first."; exit 1; }
  node "$MAIN" >> server.log 2>&1 &
  echo $! > .screens-server.pid
  for i in $(seq 1 60); do
    kill -0 "$(cat .screens-server.pid)" 2>/dev/null || { echo "The server exited:"; tail -40 server.log; exit 1; }
    curl -fsS "http://localhost:${PORT}/api/health" > /dev/null 2>&1 && return 0
    sleep 1
  done
  echo "No answer within 60s:"; tail -40 server.log; exit 1
}

stop() {
  if [ -f .screens-server.pid ]; then
    kill "$(cat .screens-server.pid)" 2>/dev/null || true
    for i in $(seq 1 30); do kill -0 "$(cat .screens-server.pid)" 2>/dev/null || break; sleep 0.5; done
    rm -f .screens-server.pid
  fi
}

if [ "${1:-}" = restore ]; then
  stop
  admin_sql "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" \
            "CREATE DATABASE \"$POSTGRES_DB\" TEMPLATE \"$SNAPSHOT\""
  start
  echo "Seeded database restored."
  exit 0
fi

# One transaction per migration: some add enum values that later ones use.
npx typeorm-ts-node-commonjs -d src/data-source.ts migration:run -t each > migrate.log 2>&1 || {
  echo "Migrations failed:"; tail -40 migrate.log; exit 1;
}
start
SUMMARY="$(node scripts/seed-screens.mjs "http://localhost:${PORT}/api")"
stop
# The map's register has no API (it is built from the map file): invented
# streets and houses in T03 (16 November 2026), so the editor of a cut's
# lines counts homes and walks (the walks seeded before them are dropped).
# One house stands beside the drawn line.
admin_sql_on "$POSTGRES_DB" \
  "INSERT INTO map_streets (congregation_id, street_no, name, kind, west, south, east, north, lines)
     SELECT c.id, 900 + k, 'Улица ' || (k + 1), 'residential', 10.023, 51.0007 + k * 0.0013, 10.036, 51.0007 + k * 0.0013,
            jsonb_build_array(jsonb_build_array(jsonb_build_array(10.023, 51.0007 + k * 0.0013), jsonb_build_array(10.036, 51.0007 + k * 0.0013)))
       FROM congregations c, generate_series(0, 4) k" \
  "INSERT INTO map_houses (congregation_id, osm_id, lon, lat, area_m2, home)
     SELECT c.id, 900000 + g, 10.0245 + (g % 8) * 0.0013, 51.001 + (g / 8) * 0.0013, 120, true
       FROM congregations c, generate_series(0, 39) g" \
  "UPDATE territory_settings SET houses_built_at = now()" \
  "UPDATE territory_recuts SET walks = '{}'::jsonb"
admin_sql "DROP DATABASE IF EXISTS \"$SNAPSHOT\" WITH (FORCE)" \
          "CREATE DATABASE \"$SNAPSHOT\" TEMPLATE \"$POSTGRES_DB\""
start
echo "$SUMMARY"
