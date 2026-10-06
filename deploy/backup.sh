#!/usr/bin/env bash
#
# Nightly database dump, verified and pruned.
#
#   ./backup.sh                 dump, verify, prune
#   ./backup.sh --verify-only FILE   check an existing dump
#
# Reads ../.env, the same file the application and deploy.sh read. Override with
# ENV_FILE=/some/other/.env
#
# deploy.sh calls this before every migration, so it is also the thing standing
# between a bad migration and a lost database.
#
# A backup nobody has restored is not a backup. This cannot restore for you, but
# it refuses to report success on a dump that is empty, truncated, unreadable or
# missing the tables that matter. Those are the four ways a backup job runs
# green for months and gives you nothing on the day.
#
# The dump contains message bodies, so it contains claim detail. It is written
# 0600 into a 0700 directory. Copying it anywhere else is a decision about PHI,
# not a convenience: encrypt it and keep it off any machine that does not need
# it.
set -euo pipefail

cd "$(dirname "$0")"
DEPLOY_DIR="$PWD"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
MIN_BYTES="${BACKUP_MIN_BYTES:-10240}"          # 10 KB: anything smaller is not a database
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8}"

# The tables whose absence means the dump is not usable. Not every table: these
# four are the ones that prove it ran against the right database and finished.
REQUIRED_TABLES=(users messages conversations schema_migrations)

say() { echo "==> $*"; }

# Does the gzipped dump contain this text?
#
# Deliberately not a quiet grep. A quiet grep exits the moment it matches, the
# upstream gzip takes SIGPIPE, and with `set -o pipefail` the whole pipeline
# reports failure. The test then reads backwards: a dump full of tables is
# reported as having none. That is exactly what happened on the first end to end
# run of this script, which called a complete 29 KB dump an unmigrated database.
#
# Counting reads to the end, so nothing upstream is ever signalled.
contains() {
  gzip -dc "$1" | grep -c -- "$2" >/dev/null 2>&1
}
die() { echo "backup failed: $*" >&2; exit 1; }

# ---------------------------------------------------------------- verify

verify() {
  local file="$1"

  [ -f "$file" ] || die "no such dump: $file"

  local size
  size=$(wc -c < "$file" | tr -d ' ')

  # An empty database dumps to well under the floor, so the floor only bites
  # once there is something to measure. The CREATE TABLE check below is what
  # separates "nothing in it yet" from "the dump went wrong".
  if [ "$size" -lt "$MIN_BYTES" ] && contains "$file" "CREATE TABLE"; then
    die "dump is ${size} bytes, under the ${MIN_BYTES} minimum, yet it contains tables. Something truncated it."
  fi

  gzip -t "$file" 2>/dev/null \
    || die "gzip cannot read $file. It is truncated or was never finished."

  # mysqldump writes this as its last line. Without it the dump stopped early,
  # which is exactly the case that still gunzips and still looks plausible.
  gzip -dc "$file" | tail -5 | grep -c "Dump completed" >/dev/null 2>&1 \
    || die "the dump has no completion marker. It stopped partway."

  # A database with no tables at all is the first deploy, before migrations
  # have run. There is genuinely nothing to lose, and failing here would stop
  # the very deploy that creates the schema. The completion marker above has
  # already proved the dump ran, so this is "empty", not "broken".
  if ! contains "$file" "CREATE TABLE"; then
    say "$(basename "$file") holds no tables: this database has not been migrated yet."
    say "Nothing to back up. That is correct for a first deploy, not a failure."
    return 0
  fi

  local missing=()
  for table in "${REQUIRED_TABLES[@]}"; do
    contains "$file" "CREATE TABLE \`${table}\`" || missing+=("$table")
  done
  [ ${#missing[@]} -eq 0 ] \
    || die "these tables are not in the dump: ${missing[*]}. Wrong database, or the dump was filtered."

  say "verified $(basename "$file") (${size} bytes, all ${#REQUIRED_TABLES[@]} required tables present)"
}

if [ "${1:-}" = "--verify-only" ]; then
  [ -n "${2:-}" ] || die "--verify-only needs a file"
  verify "$2"
  exit 0
fi

# ---------------------------------------------------------------- settings

# ONE env file, the same one the application and deploy.sh read: .env at the
# repository root. This used to look for .env.production in the deploy directory,
# left over from the Docker design where that was the compose env_file, and the
# first real deploy stopped here because 1e had only ever created .env.
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/../.env}"

[ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE. Copy .env.example to .env and fill it in."

# Read only the keys needed, rather than sourcing the whole file: .env holds API
# keys and secrets, and this script has no business with any of them.
env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -1 | sed 's/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//'
}

DB_HOST="$(env_value DB_HOST)"
DB_PORT="$(env_value DB_PORT)"
DB_NAME="$(env_value DB_NAME)"
DB_USER="$(env_value DB_USER)"
DB_PASSWORD="$(env_value DB_PASSWORD)"

[ -n "$DB_HOST" ] || die "DB_HOST is not set in $ENV_FILE"
[ -n "$DB_NAME" ] || die "DB_NAME is not set in $ENV_FILE"
[ -n "$DB_USER" ] || die "DB_USER is not set in $ENV_FILE"
[ -n "$DB_PASSWORD" ] || die "DB_PASSWORD is not set in $ENV_FILE"
DB_PORT="${DB_PORT:-3306}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/${DB_NAME}-${STAMP}.sql.gz"
TMP="${OUT}.part"

# A failed dump must not be left looking like a backup.
trap 'rm -f "$TMP"' EXIT

# ---------------------------------------------------------------- dump

# mysqldump runs in a throwaway container when there is no client on the host,
# so the droplet does not need one installed and the version always matches.
#
# --lock-tables         NOT --single-transaction, and this is deliberate. Since
#                       mysqldump 8.0.32, --single-transaction issues FLUSH
#                       TABLES, which needs the GLOBAL privilege RELOAD or
#                       FLUSH_TABLES. The kody user has ALL PRIVILEGES on its own
#                       database and nothing global, which is correct and is why
#                       the first real backup failed with error 1227.
#
#                       --lock-tables locks every table in the database at once
#                       for the length of the dump, so the dump is still
#                       consistent. It blocks writers while it runs, which for a
#                       database this size is well under a second and happens
#                       immediately before a deploy restarts the app anyway.
#
#                       If this database ever grows to where that pause matters,
#                       the fix is a privilege, not a flag:
#                         GRANT RELOAD ON *.* TO 'kody'@'localhost';
#                       then set BACKUP_SINGLE_TRANSACTION=1.
# --no-tablespaces      dumping tablespace info needs PROCESS, also global
# --set-gtid-purged=OFF the dump is for restoring here, not for seeding a replica
# --password via MYSQL_PWD  so it never appears in `ps` or in shell history
CONSISTENCY="--lock-tables"
[ "${BACKUP_SINGLE_TRANSACTION:-}" = "1" ] && CONSISTENCY="--single-transaction"
say "dumping ${DB_NAME} from ${DB_HOST}:${DB_PORT}"

if command -v mysqldump >/dev/null 2>&1; then
  MYSQL_PWD="$DB_PASSWORD" mysqldump \
    --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
    $CONSISTENCY --quick --routines --triggers --events \
    --no-tablespaces --set-gtid-purged=OFF \
    "$DB_NAME" | gzip -9 > "$TMP"
else
  docker run --rm -i -e MYSQL_PWD="$DB_PASSWORD" "$MYSQL_IMAGE" \
    mysqldump \
    --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
    $CONSISTENCY --quick --routines --triggers --events \
    --no-tablespaces --set-gtid-purged=OFF \
    "$DB_NAME" | gzip -9 > "$TMP"
fi

mv "$TMP" "$OUT"
chmod 600 "$OUT"
trap - EXIT

verify "$OUT"

# ---------------------------------------------------------------- prune

# Only ever deletes files this script named, in this directory, that verify
# clean. A pruner that deletes on age alone will one day delete the only good
# backup because the newer ones were broken.
newest_good=""
while IFS= read -r candidate; do
  if gzip -t "$candidate" 2>/dev/null; then newest_good="$candidate"; break; fi
done < <(ls -1t "${BACKUP_DIR}/${DB_NAME}-"*.sql.gz 2>/dev/null || true)

if [ -z "$newest_good" ]; then
  say "nothing readable to prune against. Keeping everything."
  exit 0
fi

pruned=0
while IFS= read -r old; do
  [ "$old" = "$newest_good" ] && continue
  rm -f "$old"
  pruned=$((pruned + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.sql.gz" -type f -mtime "+${KEEP_DAYS}" 2>/dev/null || true)

say "kept $(find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.sql.gz" -type f | wc -l | tr -d ' ') dumps, pruned ${pruned} older than ${KEEP_DAYS} days"
say "latest: ${OUT}"
