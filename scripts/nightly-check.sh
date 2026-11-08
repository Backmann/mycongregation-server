#!/usr/bin/env bash
# The nightly look at the production machine (8 November 2026).
#
# Runs on the server as the forced command of one SSH key that can do nothing
# else (authorized_keys: command="bash .../nightly-check.sh",restrict). Called
# by .github/workflows/nightly.yml every night and after every server deploy.
#
# READS ONLY. It changes nothing, and it prints nothing personal: the Actions
# log of a public repository is public. Each line is OK, WARN or FAIL; the
# last line is the verdict, and the exit code is 1 when anything FAILed.
#
# Every outside command can be replaced through the environment, so the spec
# (src/common/nightly-check.spec.ts) runs it against a fake machine.
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
DOCKER="${DOCKER:-docker}"
CONTAINERS="${CONTAINERS:-mycongregation-server mycongregation-postgres 30sec-nginx}"
DISK_WARN="${DISK_WARN:-75}"
DISK_FAIL="${DISK_FAIL:-85}"
OFFSITE_LOG_CMD="${OFFSITE_LOG_CMD:-journalctl -t backup-db --since -${MAX_AGE_HOURS}h --no-pager -o cat}"
FACTS_CMD="${FACTS_CMD:-bash /root/mycongregation/server/scripts/facts.sh --ci}"
CRONTAB_CMD="${CRONTAB_CMD:-crontab -l}"
DF_CMD="${DF_CMD:-df -P /}"
NOW="${NOW:-$(date +%s)}"

fails=0
warns=0
ok() { echo "OK   $1"; }
warn() { echo "WARN $1"; warns=$((warns + 1)); }
fail() { echo "FAIL $1"; fails=$((fails + 1)); }

# 1. The daily copy of the database: there, fresh, and not suddenly smaller.
#    The copies before a deploy live in pre-deploy/ and are not counted.
mapfile -t copies < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*mycongregation*' ! -name '*.partial' -printf '%T@ %s %f\n' 2>/dev/null | sort -rn)
if [ "${#copies[@]}" -eq 0 ]; then
  fail "daily copy: no file matching *mycongregation* in $BACKUP_DIR"
else
  read -r mtime size name <<< "${copies[0]}"
  age_h=$(( (NOW - ${mtime%.*}) / 3600 ))
  if [ "$age_h" -gt "$MAX_AGE_HOURS" ]; then
    fail "daily copy: newest is ${age_h}h old (limit ${MAX_AGE_HOURS}h)"
  elif [ "$size" -eq 0 ]; then
    fail "daily copy: newest is empty"
  else
    ok "daily copy: ${age_h}h old, $size bytes"
  fi
  if [ "${#copies[@]}" -ge 2 ]; then
    read -r _ prev_size _ <<< "${copies[1]}"
    if [ "$prev_size" -gt 0 ] && [ $((size * 2)) -lt "$prev_size" ]; then
      fail "daily copy: newest is less than half the one before ($size < $prev_size bytes)"
    fi
  fi
fi

# 2. The copy reached the Storage Box: backup-db.sh logs «offsite verified».
offsite=$(sh -c "$OFFSITE_LOG_CMD" </dev/null 2>/dev/null | grep -c 'offsite verified' || true)
if [ "${offsite:-0}" -gt 0 ]; then
  ok "offsite copy: verified $offsite time(s) in ${MAX_AGE_HOURS}h"
else
  fail "offsite copy: no «offsite verified» in the log for ${MAX_AGE_HOURS}h"
fi

# 3. Disk. The build cache filled it once (11 August) and nearly again (5 November).
used=$(sh -c "$DF_CMD" </dev/null 2>/dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
if ! [[ "$used" =~ ^[0-9]+$ ]]; then
  fail "disk: could not read the usage"
elif [ "$used" -ge "$DISK_FAIL" ]; then
  fail "disk: ${used}% used (limit ${DISK_FAIL}%)"
elif [ "$used" -ge "$DISK_WARN" ]; then
  warn "disk: ${used}% used (warning at ${DISK_WARN}%)"
else
  ok "disk: ${used}% used"
fi

# 4. Containers: running, and healthy where a healthcheck is declared.
for c in $CONTAINERS; do
  state=$($DOCKER inspect -f '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" </dev/null 2>/dev/null)
  case "$state" in
    "true healthy" | "true none") ok "container $c: ${state#true }" ;;
    "true starting") warn "container $c: starting" ;;
    "") fail "container $c: not found" ;;
    *) fail "container $c: $state" ;;
  esac
done

# 5. The live database's own rules — the same verdict the deploy prints,
#    names of broken rules only, no numbers.
facts_out=$(sh -c "$FACTS_CMD" </dev/null 2>&1)
if [ $? -eq 0 ]; then
  ok "database rules: ${facts_out:-no output}"
else
  fail "database rules: $(printf '%s' "$facts_out" | tr '\n' ' ')"
fi

# 6. The job that makes the daily copy is still scheduled.
if sh -c "$CRONTAB_CMD" </dev/null 2>/dev/null | grep -v '^\s*#' | grep -q 'backup-db.sh'; then
  ok "cron: backup-db.sh scheduled"
else
  fail "cron: backup-db.sh is not in the crontab"
fi

if [ "$fails" -gt 0 ]; then
  echo "NIGHTLY: FAIL ($fails failed, $warns warning(s))"
  exit 1
fi
echo "NIGHTLY: OK ($warns warning(s))"
