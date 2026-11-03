#!/usr/bin/env bash
# A copy of the live database taken right before a deploy touches it
# (3 November 2026).
#
# The nightly backup runs at 03:00. Without this, a migration that damaged
# data at 15:00 could only be undone back to 03:00 — twelve hours of the
# congregation's work lost. With it, the deploy can be undone to the minute
# before it started.
#
#   pre-deploy-backup.sh <commit>
#
# Called by the deploy AFTER the new image is built and BEFORE the running
# container is replaced or any migration runs — the last moment at which
# nothing has changed yet. If the copy cannot be made and verified, this
# exits non-zero and, under `set -e` in the deploy, the deploy stops there:
# the old server keeps running, untouched.
#
# The copy is encrypted to the same public key as the nightly backups
# ("mycongregation backups"); the private key is only on Lionel's PC. The
# plain dump never touches the disk: pg_dump → gzip → gpg in one pipe.
#
# Verified, not assumed:
#   - pg_dump wrote its own end marker, so the dump was not cut short;
#   - the file is non-empty and gpg lists it as encrypted to that key.
#     Judged by gpg's printed output, NOT its exit code: --list-packets also
#     tries to decrypt and always exits non-zero where no secret key exists
#     (the trap that made verify-backup.sh fail silently from June to July).
#
# Keeps the newest $KEEP copies (default 30) in $DIR.
#
# Test hooks: PG_CONTAINER, BACKUP_DIR, BACKUP_KEY, KEEP, and DUMP_CMD (a
# command that writes a dump to stdout, replacing the docker exec).
set -euo pipefail

COMMIT="${1:-unknown}"
CONTAINER="${PG_CONTAINER:-mycongregation-postgres}"
DIR="${BACKUP_DIR:-/root/backups/pre-deploy}"
KEY="${BACKUP_KEY:-5E3D1B4D88584B4A}"
KEEP="${KEEP:-30}"

mkdir -p "$DIR"
chmod 700 "$DIR"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$DIR/mycongregation-$stamp-${COMMIT:0:7}.sql.gz.gpg"
tmp="$file.partial"
tail_file=$(mktemp)
trap 'rm -f "$tmp" "$tail_file"' EXIT

dump() {
  if [ -n "${DUMP_CMD:-}" ]; then
    sh -c "$DUMP_CMD"
  else
    # No -i: nothing is sent in (see facts.sh — stdin is the deploy script).
    docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' </dev/null
  fi
}

# The end marker is the last lines of the dump: comments, no data.
dump \
  | tee >(tail -n 5 > "$tail_file") \
  | gzip \
  | gpg --batch --yes --quiet --trust-model always --recipient "$KEY" --encrypt --output "$tmp"
# Let the tee'd subshell finish writing before the marker is read.
wait

if ! grep -q 'PostgreSQL database dump complete' "$tail_file"; then
  echo "PRE-DEPLOY BACKUP FAILED: the dump has no end marker — it was cut short."
  exit 1
fi
if [ ! -s "$tmp" ]; then
  echo "PRE-DEPLOY BACKUP FAILED: the encrypted file is empty."
  exit 1
fi
# The packet names the ENCRYPTION key's id, which is often a subkey of $KEY,
# not $KEY itself — so accept any key id that belongs to $KEY.
key_ids=$(gpg --batch --with-colons --list-keys "$KEY" | awk -F: '/^(pub|sub):/ { print $5 }')
packet_id=$(gpg --batch --list-packets "$tmp" 2>&1 | sed -n 's/.*pubkey enc packet.*keyid \([0-9A-Fa-f]*\).*/\1/p' | head -n 1 || true)
if [ -z "$packet_id" ] || ! printf '%s\n' "$key_ids" | grep -qix "$packet_id"; then
  echo "PRE-DEPLOY BACKUP FAILED: the file is not encrypted to key $KEY."
  exit 1
fi

mv "$tmp" "$file"
chmod 600 "$file"

# Oldest first; drop all but the newest $KEEP.
ls -1 "$DIR"/mycongregation-*.sql.gz.gpg 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm -f

echo "PRE-DEPLOY BACKUP: OK $(basename "$file") ($(du -h "$file" | cut -f1))"
