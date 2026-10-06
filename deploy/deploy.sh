#!/usr/bin/env bash
#
# Deploy dAI on the Dolluz server.
#
#   ./deploy.sh                 deploy whatever is checked out
#   ./deploy.sh --no-backup     skip the backup (only when you have just taken one)
#   ./deploy.sh --skip-install  do not run npm ci: node_modules was built elsewhere
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
APP_NAME="${APP_NAME:-dai-backend}"   # every app on this box is <name>-backend
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

SKIP_INSTALL=""
NO_BACKUP=""
for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL="yes" ;;
    --no-backup)    NO_BACKUP="yes" ;;
    *) die "unknown option $arg" ;;
  esac
done
[ "${DAI_SKIP_INSTALL:-}" = "1" ] && SKIP_INSTALL="yes"

NODE_VERSION="$(node -v 2>/dev/null || echo none)"
case "$NODE_VERSION" in
  v2[2-9].*|v[3-9][0-9].*) : ;;
  *) die "node is ${NODE_VERSION}, and dAI needs 22 or newer. Set DAI_NODE_BIN to the
         directory holding the Node 22 binary (nvm which 22 prints the binary itself)." ;;
esac
say "Using node ${NODE_VERSION} from $(command -v node)"

[ -d "$APP_DIR" ] || die "no app directory at $APP_DIR"
[ -f "$APP_DIR/.env" ] || die "no $APP_DIR/.env. Copy .env.example and fill it in."

# The branch and the commit we are on now, so a rollback has somewhere to go
# back to AND something to go back on.
#
# A detached HEAD is refused outright. It is not an inconvenience, it is the
# state in which `git pull` prints "You are not currently on a branch" and does
# nothing, so the next deploy runs the OLD code while every step of this script
# reports success. That is how you ship yesterday's build believing it is
# today's, and it happened on the box on 2026-10-06 because this script's own
# rollback left the repository detached.
BRANCH="$(git -C "$APP_DIR" symbolic-ref --short -q HEAD || echo "")"
PREVIOUS="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo "")"

if [ -z "$BRANCH" ]; then
  echo "This checkout is on a detached HEAD at ${PREVIOUS:0:12}." >&2
  echo "git pull does nothing in that state, so a deploy from here would run" >&2
  echo "whatever is checked out while reporting success. Get back on the branch" >&2
  echo "first, deciding deliberately which code you want:" >&2
  echo "" >&2
  echo "  git -C $APP_DIR checkout main      # then git pull for the latest" >&2
  echo "" >&2
  die "refusing to deploy from a detached HEAD"
fi

say "Deploying ${PREVIOUS:0:12} on ${BRANCH}"

# ---------------------------------------------------------------- backup

if [ -z "$NO_BACKUP" ]; then
  say "Backing up the database first"
  "$DEPLOY_DIR/backup.sh" || die "backup failed, so nothing was changed"
fi

# ---------------------------------------------------------------- install

cd "$APP_DIR/server"
if [ -n "$SKIP_INSTALL" ]; then
  # node_modules was built on another machine and copied here, because npm ci
  # peaks around 228 MB and this box has 1 GB shared with twelve other apps.
  # Nothing in the tree is compiled, so a tree built anywhere works here.
  [ -d node_modules ] || die "--skip-install, but there is no node_modules to use."
  say "Skipping install. Checking the tree matches the lockfile instead"
  npm ls --omit=dev --depth=0 >/dev/null 2>&1     || die "node_modules does not satisfy package-lock.json. Rebuild it and copy it again."
  say "The tree satisfies the lockfile"
else
  say "Installing dependencies"
  npm ci --omit=dev 2>/dev/null || npm install --omit=dev
fi

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
  say "Deployed ${PREVIOUS:0:12} on ${BRANCH}. pm2 id $(pm2 pid "$APP_NAME" 2>/dev/null || echo '?')"
  exit 0
fi

# ---------------------------------------------------------------- roll back

echo "Readiness never came up. Last 80 lines:" >&2
pm2 logs "$APP_NAME" --lines 80 --nostream >&2 || true

if [ -n "$PREVIOUS" ]; then
  echo "Rolling the code back to ${PREVIOUS} on ${BRANCH}." >&2
  # On the branch, not detached. `git checkout <sha>` leaves the repository in a
  # state where the next git pull silently does nothing.
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet "$PREVIOUS"
  if [ -n "$SKIP_INSTALL" ]; then
    # The rollback used to run npm ci regardless, which is the 228 MB spike this
    # whole arrangement exists to avoid, at the worst possible moment: a box
    # already in trouble, with a deploy failing. node_modules is left as it is.
    echo "Not reinstalling: --skip-install. If the previous commit needs different" >&2
    echo "dependencies, rebuild node_modules elsewhere and copy it over." >&2
  else
    (cd "$APP_DIR/server" && (npm ci --omit=dev 2>/dev/null || npm install --omit=dev))
  fi
  pm2 reload "$APP_NAME" --update-env || pm2 start "$APP_DIR/ecosystem.config.js"
  echo "" >&2
  echo "${BRANCH} now points at ${PREVIOUS:0:12}, so you are on a branch and git pull" >&2
  echo "still works. The next pull will bring the failing commit back: fix it first." >&2
  echo "" >&2
  echo "Code rolled back. THE MIGRATIONS DID NOT ROLL BACK: this project has no down" >&2
  echo "migrations, by design. If the new migration is what broke it, restore the dump" >&2
  echo "taken at the start of this run before doing anything else." >&2
else
  echo "No previous commit recorded, so nothing was rolled back. Fix forward." >&2
fi
exit 1
