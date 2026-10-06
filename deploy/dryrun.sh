#!/usr/bin/env bash
#
# Run deploy.sh end to end on a developer machine, before pushing it.
#
# This exists because three separate faults reached the server in three days,
# and every one of them would have died on the first line of a single real run:
# the scripts shipped without the execute bit, backup.sh looked for a file that
# nothing creates, and backup.sh used a variable that only deploy.sh defines.
# Reading a shell script is not running it.
#
#   bash deploy/dryrun.sh
#
# What is real here: backup.sh against the real MySQL, the real npm ls check,
# the real migrate, the real readiness poll against a real server. The only
# stub is pm2, and it starts the actual application so the poll has something
# to answer it.
#
# It runs against a CLONE of the repository, with the working tree's deploy
# scripts copied in, so that the rollback path can never check out a commit in
# the tree you are working in.
#
# Needs: MySQL reachable with the .env credentials, Redis, and mysqldump. Set
# MYSQL_BIN if mysqldump is not on PATH.
set -uo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/dai-dryrun}"
mkdir -p "$SCRATCH"
APP="$SCRATCH/deploytest"
STUB="$SCRATCH/stubbin"
PORT=4017

say() { echo; echo "### $*"; }

cleanup() {
  [ -f "$SCRATCH/server.pid" ] && kill "$(cat "$SCRATCH/server.pid")" 2>/dev/null
  rm -f "$SCRATCH/server.pid"
}
trap cleanup EXIT

say "building a scratch deployment"
rm -rf "$APP" "$STUB"
mkdir -p "$STUB"
git clone --quiet "$REPO" "$APP" || { echo "clone failed"; exit 1; }
cp "$REPO/.env" "$APP/.env"
# The port and the env this run should use, overriding the developer's .env.
sed -i "s/^PORT=.*/PORT=$PORT/" "$APP/.env"
cp -r "$REPO/server/node_modules" "$APP/server/node_modules"

# The clone is at HEAD, which is the committed state. What needs testing is the
# WORKING TREE, because the whole point is to run the change before pushing it.
cp "$REPO/deploy/"*.sh "$APP/deploy/"
chmod +x "$APP/deploy/"*.sh
echo "  clone at $(git -C "$APP" rev-parse --short HEAD), with the working tree's deploy scripts"

say "stubbing pm2, so the readiness poll has a real server to answer it"
cat > "$STUB/pm2" <<STUBEOF
#!/usr/bin/env bash
# Enough pm2 for deploy.sh: describe, start, reload, logs, pid.
case "\$1" in
  describe) exit 1 ;;                       # not running yet, so deploy.sh uses start
  start|reload)
    cd "$APP/server" || exit 1
    node --env-file-if-exists="$APP/.env" src/server.js > "$SCRATCH/app.log" 2>&1 &
    echo \$! > "$SCRATCH/server.pid"
    echo "[pm2 stub] started pid \$(cat "$SCRATCH/server.pid")"
    sleep 3
    ;;
  save) echo "[pm2 stub] saved" ;;
  logs) tail -20 "$SCRATCH/app.log" 2>/dev/null ;;
  pid) cat "$SCRATCH/server.pid" 2>/dev/null ;;
  *) echo "[pm2 stub] ignoring \$*" ;;
esac
exit 0
STUBEOF
chmod +x "$STUB/pm2"

# mysqldump is not on PATH in this shell, but it is installed.
MYSQL_BIN="${MYSQL_BIN:-/c/Program Files/MySQL/MySQL Server 8.0/bin}"

say "running deploy.sh --skip-install, end to end"
PATH="$STUB:$MYSQL_BIN:$PATH" \
APP_DIR="$APP" \
APP_NAME="dai" \
PORT="$PORT" \
DAI_NODE_BIN="$(dirname "$(command -v node)")" \
bash "$APP/deploy/deploy.sh" --skip-install
RESULT=$?

say "deploy.sh exited $RESULT"
if [ -f "$SCRATCH/app.log" ]; then
  echo "--- last lines the app printed ---"
  tail -4 "$SCRATCH/app.log"
fi
if [ -d "$APP/deploy/backups" ]; then
  echo "--- what the backup produced ---"
  ls -l "$APP/deploy/backups" | tail -3
fi
exit $RESULT
