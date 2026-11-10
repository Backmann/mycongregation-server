#!/usr/bin/env bash
# Start this server on an empty database and fill it with the invented
# congregation of scripts/seed-screens.mjs.
#
# Used by two pipelines, so they walk one path:
#   • this repository's CI (job "seed"): a change to the API that breaks the
#     data set fails here, on the server, before it reaches the app;
#   • the app's CI (job "screens"), which photographs the screens against it.
#
# Expects a built server (npm ci && npm run build) and a Postgres reachable
# through the POSTGRES_* variables, with an empty database. Leaves the server
# running on $PORT (default 3000) and writes its log to server.log. Prints the
# seed summary (current week, logins) as the last line.
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_ENV="${NODE_ENV:-test}"
export PORT="${PORT:-3000}"
export TZ=UTC
# Validated at boot but never connected to here.
export REDIS_HOST="${REDIS_HOST:-localhost}" REDIS_PORT="${REDIS_PORT:-6379}" REDIS_PASSWORD="${REDIS_PASSWORD:-ci}"
export JWT_SECRET="${JWT_SECRET:-screens-only-secret-that-is-long-enough}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-screens-only-refresh-secret-long-enough}"
export KEK_BASE64="${KEK_BASE64:-$(openssl rand -base64 32)}"

# One transaction per migration: some add enum values that later ones use.
npx typeorm-ts-node-commonjs -d src/data-source.ts migration:run -t each > migrate.log 2>&1 || {
  echo "Migrations failed:"; tail -40 migrate.log; exit 1;
}

MAIN="$(find dist -name main.js -type f | head -1)"
[ -n "$MAIN" ] || { echo "No main.js under dist — build first."; exit 1; }
node "$MAIN" > server.log 2>&1 &
PID=$!
for i in $(seq 1 60); do
  kill -0 "$PID" 2>/dev/null || { echo "The server exited:"; tail -40 server.log; exit 1; }
  curl -fsS "http://localhost:${PORT}/api/health" > /dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "No answer within 60s:"; tail -40 server.log; exit 1; }
  sleep 1
done

node scripts/seed-screens.mjs "http://localhost:${PORT}/api"
