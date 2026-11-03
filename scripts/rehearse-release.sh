#!/usr/bin/env bash
# A dress rehearsal of a release on the production server, before anyone uses
# it (3 November 2026, written for the move to Node 24).
#
#   bash rehearse-release.sh <branch>
#
# Builds the branch's image here, on the server, and runs it against a fresh
# copy of the live database — next to production, never in its place:
#
#   - The copy lives in a throwaway Postgres whose data is in RAM (tmpfs), on
#     a Docker network created with --internal: nothing on it can reach the
#     internet or the live containers. The rehearsal app runs its schedulers
#     against the copy, and any reminder, e-mail or push it tries to send has
#     nowhere to go. SMTP is also pointed at an address that does not exist.
#   - The copy never touches the disk and never leaves the server: pg_dump of
#     the live database is piped straight into the throwaway one.
#   - The live database is only read: one pg_dump (as the nightly backup does)
#     and one `SELECT 1` over TLS with the app's own credentials, to prove the
#     new image's OpenSSL still talks to it.
#   - Nothing printed here carries personal data: counts, names of checks,
#     versions, error class names. No rows, no e-mails, no hashes.
#   - Everything it creates is removed at the end, pass or fail.
#
# Exits non-zero if any check fails. A rehearsal that fails has changed
# nothing: production keeps running as it was.
set -euo pipefail

REF="${1:?usage: rehearse-release.sh <branch>}"
REPO="Backmann/mycongregation-server"
LIVE_APP="mycongregation-server"
LIVE_DB="mycongregation-postgres"
LIVE_NET="mycongregation_default"
NET="mcg-rehearsal-net"
DB="mcg-rehearsal-db"
APP="mcg-rehearsal-app"
IMG="mycongregation-server:rehearsal"

SRC=$(mktemp -d)
ENVF=$(mktemp -p /dev/shm 2>/dev/null || mktemp)
chmod 600 "$ENVF"
FAILED=0

cleanup() {
  docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker image rm "$IMG" >/dev/null 2>&1 || true
  rm -rf "$SRC" "$ENVF"
}
trap cleanup EXIT

ok()   { echo "  ok    $*"; }
bad()  { echo "  FAIL  $*"; FAILED=1; }
step() { echo ""; echo "== $*"; }

# Leftovers of an interrupted earlier run would make this one lie.
docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
docker network rm "$NET" >/dev/null 2>&1 || true

step "Source of $REF"
SHA=$(curl -fsS "https://api.github.com/repos/$REPO/commits/$REF" | sed -n 's/^  "sha": "\([0-9a-f]\{40\}\)".*/\1/p' | head -n 1)
[ -n "$SHA" ] || { echo "Cannot resolve $REF on GitHub."; exit 1; }
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$SHA" | tar -xz -C "$SRC" --strip-components=1
ok "commit ${SHA:0:7}"

step "Build the image (as the deploy does, on this server)"
if docker build -t "$IMG" "$SRC" > "$SRC/build.log" 2>&1; then
  ok "image built"
else
  tail -n 30 "$SRC/build.log"; echo "BUILD FAILED"; exit 1
fi

step "The image itself"
docker run --rm --entrypoint sh "$IMG" -c '
  echo "  node  $(node -v)"
  test -f dist/src/main.js && echo "  ok    entry point dist/src/main.js"
  echo "  user  $(id -un)"
  node -e "const b=require(\"bcrypt\");const h=b.hashSync(\"check\",4);if(!b.compareSync(\"check\",h)||b.compareSync(\"wrong\",h))process.exit(1)" && echo "  ok    bcrypt loads, hashes and verifies"
' || bad "the image cannot run its own basics"

# The live container's environment, for the same configuration and secrets.
# Kept in RAM where possible, mode 600, removed at the end, never printed.
# The base image's own variables (PATH, NODE_VERSION…) are left out: they
# describe the OLD image and must not override the new one's.
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$LIVE_APP" \
  | grep -v '^$' | grep -vE '^(PATH|NODE_VERSION|YARN_VERSION|HOME|HOSTNAME)=' > "$ENVF"
for v in POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD; do
  grep -q "^$v=." "$ENVF" || { echo "The live container has no $v — cannot rehearse."; exit 1; }
done

step "TLS from the new image to the LIVE database (read-only: SELECT 1)"
docker run --rm --network "$LIVE_NET" --env-file "$ENVF" --entrypoint node "$IMG" -e '
  const { Client } = require("pg");
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : false });
  c.connect().then(() => c.query("SELECT 1"))
   .then(() => { const s = c.connection.stream; console.log("  ok    connected" + (s.getProtocol ? ", " + s.getProtocol() + " " + s.getCipher().name : " (no TLS)")); return c.end(); })
   .catch(e => { console.log("  FAIL  " + e.message); process.exit(1); });
' || bad "the new image cannot reach the live database"

step "Throwaway copy of the live database (RAM only, isolated network)"
docker network create --internal "$NET" >/dev/null
PG_IMAGE=$(docker inspect -f '{{.Config.Image}}' "$LIVE_DB")
PG_USER=$(sed -n 's/^POSTGRES_USER=//p' "$ENVF")
PG_DB=$(sed -n 's/^POSTGRES_DB=//p' "$ENVF")
PG_PASS=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$ENVF")
docker run -d --name "$DB" --network "$NET" --tmpfs /var/lib/postgresql/data:rw,size=1g \
  -e POSTGRES_USER="$PG_USER" -e POSTGRES_DB="$PG_DB" -e POSTGRES_PASSWORD="$PG_PASS" \
  "$PG_IMAGE" >/dev/null
for i in $(seq 1 30); do
  docker exec "$DB" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1 && break
  sleep 1
done
# Ownership and grants are left out: the copy's only user owns everything.
docker exec "$LIVE_DB" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' </dev/null \
  | docker exec -i "$DB" psql -q -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" >/dev/null
COUNT_SQL="SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')"
LIVE_TABLES=$(docker exec "$LIVE_DB" sh -c "psql -At -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"$COUNT_SQL\"" </dev/null)
COPY_TABLES=$(docker exec "$DB" psql -At -U "$PG_USER" -d "$PG_DB" -c "$COUNT_SQL")
[ "$LIVE_TABLES" = "$COPY_TABLES" ] && ok "copy restored: $COPY_TABLES tables, same as live" \
  || bad "copy has $COPY_TABLES tables, live has $LIVE_TABLES"

step "The new release, running on the copy"
docker run -d --name "$APP" --network "$NET" --env-file "$ENVF" --memory 512m \
  -e POSTGRES_HOST="$DB" -e POSTGRES_PORT=5432 -e POSTGRES_SSL=false \
  -e SMTP_HOST=smtp.rehearsal.invalid \
  "$IMG" >/dev/null
UP=0
for i in $(seq 1 90); do
  if docker exec "$APP" node -e 'require("http").get("http://127.0.0.1:3000/api/health",r=>process.exit(r.statusCode===200?0:1)).on("error",()=>process.exit(1))' 2>/dev/null; then
    UP=1; break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$APP")" != true ]; then break; fi
  sleep 1
done
if [ "$UP" = 1 ]; then ok "started and answers /api/health after ${i}s"; else
  bad "did not start"; docker logs --tail 40 "$APP" 2>&1 | sed 's/^/        /'; exit 1
fi

# A command that failed would also print no "[ ]" — so the applied ones
# ("[X]") must be there before "none pending" is believed.
MIGS=$(docker exec "$APP" npm run --silent migration:show:prod 2>&1 || true)
APPLIED=$(printf '%s\n' "$MIGS" | grep -c '\[X\]' || true)
PENDING=$(printf '%s\n' "$MIGS" | grep -c '\[ \]' || true)
if [ "$APPLIED" -gt 0 ] && [ "$PENDING" = 0 ]; then ok "migrations: $APPLIED applied, none pending"
else bad "migrations: $APPLIED applied, $PENDING pending (or the check could not run)"; fi

FACTS_SQL='SELECT check_name, value, expect_zero FROM facts.after_deploy()'
BROKEN=$(docker exec "$DB" psql -At -F '|' -U "$PG_USER" -d "$PG_DB" -c "$FACTS_SQL" | awk -F'|' '$3=="t" && $2!="0" {print $1}')
[ -z "$BROKEN" ] && ok "facts on the copy: all rules hold" || bad "facts broken on the copy: $BROKEN"

COL=$(docker exec "$DB" psql -At -U "$PG_USER" -d "$PG_DB" -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('password_hash','passwordHash') LIMIT 1")
if [ -n "$COL" ]; then
  N=$(docker exec "$DB" psql -At -U "$PG_USER" -d "$PG_DB" -c "SELECT count(*) FROM users WHERE \"$COL\" IS NOT NULL")
  # Real hashes, checked inside the rehearsal container against a password
  # nobody has; only true/false counts come out.
  RES=$(docker exec "$DB" psql -At -U "$PG_USER" -d "$PG_DB" -c "SELECT \"$COL\" FROM users WHERE \"$COL\" IS NOT NULL" \
    | docker exec -i "$APP" node -e '
        const b = require("bcrypt"); let n = 0, wrongOk = 0, bad = 0;
        require("readline").createInterface({ input: process.stdin }).on("line", h => {
          n++; try { if (b.compareSync("rehearsal-not-a-password", h)) wrongOk++; } catch { bad++; }
        }).on("close", () => console.log(n + " " + wrongOk + " " + bad));')
  read -r CHECKED ACCEPTED BROKENH <<< "$RES"
  if [ "$CHECKED" = "$N" ] && [ "$ACCEPTED" = 0 ] && [ "$BROKENH" = 0 ]; then
    ok "bcrypt read all $N real password hashes and rejected a wrong password for each"
  else
    bad "bcrypt on real hashes: $CHECKED of $N read, $ACCEPTED accepted a wrong password, $BROKENH unreadable"
  fi
else
  bad "no password column found on users"
fi

MEM=$(docker stats --no-stream --format '{{.MemUsage}}' "$APP")
ok "memory now: $MEM (limit as in production)"

# Error lines, by kind only — the messages themselves may name people.
ERRS=$(docker logs "$APP" 2>&1 | grep -E '\bERROR\b' || true)
if [ -z "$ERRS" ]; then
  ok "no ERROR lines in the log"
else
  echo "  note  $(printf '%s\n' "$ERRS" | wc -l) ERROR line(s); by source:"
  printf '%s\n' "$ERRS" | sed -n 's/.*ERROR[^[]*\[\([^]]*\)\].*/\1/p' | sort | uniq -c | sed 's/^/        /'
fi

echo ""
if [ "$FAILED" = 0 ]; then
  echo "REHEARSAL PASSED for ${SHA:0:7}. Production was not touched."
else
  echo "REHEARSAL FAILED for ${SHA:0:7}. Production was not touched."
  exit 1
fi
