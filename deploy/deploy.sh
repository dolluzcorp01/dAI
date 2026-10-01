#!/usr/bin/env bash
#
# Deploy dAI on the Dolluz server.
#
#   ./deploy.sh              deploy whatever is checked out
#   ./deploy.sh --no-backup  skip the backup (only when you have just taken one)
#
# Production here is pm2 behind nginx, not Docker. One process, fork mode,
# port 4011. See ecosystem.config.js for why one.
#
# Order matters and is the whole point of this script:
#   back up, install, migrate, reload, verify, and roll back if it does not come
#   up. Migrations run BEFORE the new code starts, once, so the running process
#   is never newer than the schema it is talking to.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/dolluzcorp.com/dai}"
APP_NAME="${APP_NAME:-dai}"
PORT="${PORT:-4011}"
HEALTH="http://127.0.0.1:${PORT}/health/ready"

# This box runs Node 18 for twelve other dApps and Node 22 only for dAI, and
# nvm's default is deliberately the system Node so that no other app is moved
# onto 22 by a shell that happened to source nvm. So this script cannot rely on
# whatever `node` means in the shell that ran it: it pins the one it needs.
#
# Getting this wrong is quiet rather than loud. Node 18 does not have
# --env-file-if-exists, so migrations would run with no environment at all and
# fail in a way that reads like a database problem.
DAI_NODE_BIN="${DAI_NODE_BIN:-/root/.nvm/versions/node/v22.23.3/bin}"
if [ -x "$DAI_NODE_BIN/node" ]; then
  PATH="$DAI_NODE_BIN:$PATH"
  export PATH
fi

cd "$(dirname "$0")"
DEPLOY_DIR="$PWD"

say() { echo "==> $*"; }
die() { echo "deploy failed: $*" >&2; exit 1; }

NODE_VERSION="$(node -v 2>/dev/null || echo none)"
case "$NODE_VERSION" in
  v2[2-9].*|v[3-9][0-9].*) : ;;
  *) die "node is ${NODE_VERSION}, and dAI needs 22 or newer. Set DAI_NODE_BIN to the
         directory holding the Node 22 binary (nvm which 22 prints the binary itself)." ;;
esac
say "Using node ${NODE_VERSION} from $(command -v node)"

[ -d "$APP_DIR" ] || die "no app directory at $APP_DIR"
[ -f "$APP_DIR/.env" ] || die "no $APP_DIR/.env. Copy .env.example and fill it in."

# The commit we are on now, so a rollback has somewhere to go back to.
PREVIOUS="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo "")"

# ---------------------------------------------------------------- backup

if [ "${1:-}" != "--no-backup" ]; then
  say "Backing up the database first"
  "$DEPLOY_DIR/backup.sh" || die "backup failed, so nothing was changed"
fi

# ---------------------------------------------------------------- install

say "Installing dependencies"
cd "$APP_DIR/server"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ---------------------------------------------------------------- migrate

# Once, before the new code runs. With one process there is no race today, but
# this is also what makes adding a second process later safe rather than a
# thing someone has to remember.
say "Running migrations"
node --env-file-if-exists="$APP_DIR/.env" scripts/migrate.js \
  || die "migrations failed. The old code is still running and the schema is unchanged."

# ---------------------------------------------------------------- reload

say "Reloading ${APP_NAME}"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env
else
  pm2 start "$APP_DIR/ecosystem.config.js"
  pm2 save
fi

# ---------------------------------------------------------------- verify

say "Waiting for readiness"
ready=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "$HEALTH" >/dev/null 2>&1; then ready="yes"; break; fi
  sleep 2
done

if [ -n "$ready" ]; then
  curl -fsS "$HEALTH"
  echo
  say "Deployed. pm2 id $(pm2 pid "$APP_NAME" 2>/dev/null || echo '?')"
  exit 0
fi

# ---------------------------------------------------------------- roll back

echo "Readiness never came up. Last 80 lines:" >&2
pm2 logs "$APP_NAME" --lines 80 --nostream >&2 || true

if [ -n "$PREVIOUS" ]; then
  echo "Rolling the code back to ${PREVIOUS}." >&2
  git -C "$APP_DIR" checkout --quiet "$PREVIOUS"
  (cd "$APP_DIR/server" && (npm ci --omit=dev 2>/dev/null || npm install --omit=dev))
  pm2 reload "$APP_NAME" --update-env || pm2 start "$APP_DIR/ecosystem.config.js"
  echo "Code rolled back. THE MIGRATIONS DID NOT ROLL BACK: this project has no down" >&2
  echo "migrations, by design. If the new migration is what broke it, restore the dump" >&2
  echo "taken at the start of this run before doing anything else." >&2
else
  echo "No previous commit recorded, so nothing was rolled back. Fix forward." >&2
fi
exit 1
