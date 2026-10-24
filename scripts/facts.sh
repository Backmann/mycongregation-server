#!/usr/bin/env bash
# The live database's checks, as numbers (24 October 2026).
#
#   facts         every check with its number — for reading
#   facts --ci    only OK, or the names of the checks that broke a rule;
#                 exits 1 when one did. For the deploy log, which is public:
#                 no numbers in it.
#
# Runs on the server, as root: it asks the database container under the
# role mycongregation_facts, which may call the functions of the schema
# `facts` and read nothing else (migration 1916000000000-ProductionFacts).
set -euo pipefail

CONTAINER="${FACTS_CONTAINER:-mycongregation-postgres}"
MODE="${1:-}"

QUERY='SELECT check_name, value, expect_zero FROM facts.after_deploy()'
if [ -n "${FACTS_LOCAL_DB:-}" ]; then
  # The stand and the tests: a database on this machine, no container.
  rows=$(psql -X -q -v ON_ERROR_STOP=1 -U mycongregation_facts -d "$FACTS_LOCAL_DB" -At -F '|' -c "$QUERY")
else
  # No -i: nothing is sent in, and with it the call would read whatever
  # stands on standard input — the rest of the deploy script.
  rows=$(docker exec "$CONTAINER" sh -c \
    "psql -X -q -v ON_ERROR_STOP=1 -U mycongregation_facts -d \"\$POSTGRES_DB\" -At -F '|' -c '$QUERY'")
fi

if [ "$MODE" = "--ci" ]; then
  broken=$(printf '%s\n' "$rows" | awk -F'|' '$3 == "t" && $2 != "0" { print $1 }')
  if [ -n "$broken" ]; then
    echo "FACTS: NOT AS EXPECTED:"
    printf '  %s\n' $broken
    exit 1
  fi
  echo "FACTS: OK ($(printf '%s\n' "$rows" | awk -F'|' '$3 == "t"' | wc -l | tr -d ' ') rules)"
  exit 0
fi

printf '%s\n' "$rows" | awk -F'|' '{
  mark = ($3 == "t") ? (($2 == "0") ? "ok " : "!! ") : "   ";
  printf "%s %-40s %s\n", mark, $1, $2
}'
