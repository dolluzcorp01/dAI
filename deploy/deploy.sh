#!/usr/bin/env bash
#
# Deploy Kody to a droplet.
#
#   ./deploy.sh v0.9.1
#
# Migrations run BEFORE the new image starts, in one container, so two
# replicas cannot race each other applying the same migration.
set -euo pipefail

VERSION="${1:-latest}"
COMPOSE="docker compose -f docker-compose.prod.yml"
cd "$(dirname "$0")"

if [ ! -f .env.production ]; then
  echo "No .env.production here. Copy .env.example and fill it in." >&2
  exit 1
fi

echo "==> Pulling ${VERSION}"
KODY_VERSION="$VERSION" $COMPOSE pull api

echo "==> Backing up the database first"
./backup.sh

echo "==> Running migrations in a single container"
KODY_VERSION="$VERSION" $COMPOSE run --rm --no-deps api node scripts/migrate.js

echo "==> Rolling the API"
KODY_VERSION="$VERSION" $COMPOSE up -d --no-deps --wait api

echo "==> Checking readiness"
for i in $(seq 1 30); do
  if $COMPOSE exec -T api curl -fsS http://127.0.0.1:4000/health/ready >/dev/null 2>&1; then
    echo "ready"
    $COMPOSE exec -T api curl -fsS http://127.0.0.1:4000/health/ready
    echo
    echo "==> Deployed ${VERSION}"
    exit 0
  fi
  sleep 2
done

echo "Readiness never came up. Rolling back." >&2
$COMPOSE logs --tail=80 api >&2
KODY_VERSION="$(cat .last-good-version 2>/dev/null || echo latest)" $COMPOSE up -d --no-deps --wait api
exit 1
