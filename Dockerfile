# syntax=docker/dockerfile:1
#
# Kody API. Multi stage, so build tooling does not ship.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY server/package*.json ./
# npm ci needs a lockfile; fall back for a first build without one.
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

FROM node:22-bookworm-slim AS runtime
# clamdscan talks to a separate clamav container, so only the client is needed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY server/ ./

# Never run as root. The uploads path is only used by the local driver, which
# production refuses anyway, but the directory has to exist for a dev image.
RUN addgroup --system --gid 10001 kody \
 && adduser --system --uid 10001 --ingroup kody kody \
 && mkdir -p /app/var/uploads \
 && chown -R kody:kody /app
USER kody

EXPOSE 4000

# A container that cannot reach its database is not healthy, even if it listens.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/health/ready || exit 1

# tini reaps zombies and forwards signals, so the graceful shutdown in
# server.js actually runs on docker stop.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
