# Deployment

Module 15. Redis for multi-instance realtime, the Spaces storage driver, CI,
and the production stack.

23 tests in this module, 456 across the project, passing on three consecutive
cold databases and on repeat runs.

---

## The Redis adapter, tested properly

Socket.IO keeps its rooms in the memory of one process. With two API instances
behind a load balancer, a message sent by someone on instance A never reaches
someone on instance B. The symptom is nasty: messages arrive for some people
and not others, depending on which box their socket landed on, and it looks
like an application bug.

The adapter publishes room events over Redis pub/sub so both instances deliver
to their own sockets.

**This is tested with two real instances.** Instance A runs in the test
process; instance B is a **separate child process**, because the realtime bus
is a module-level singleton and two gateways in one process would make the
test pass for the wrong reason. That was a genuine trap: the first version of
this test passed one direction with no adapter at all.

Verified crossing instances: a message A to B, a message B to A, typing, and a
read receipt. Also verified that the adapter spreads **rooms, not permissions**
- a non-member connected to instance B still receives nothing.

Removing `io.adapter(adapter)` fails all four crossing tests, which is exactly
what production would look like without it.

---

## The Spaces driver

S3-compatible, signed with our own SigV4 rather than the AWS SDK. The SDK is
tens of megabytes for four operations, and a hand-written signer can be
**checked against AWS's published test vectors**, which is a stronger guarantee
than assuming a dependency works.

`signRequest` matches the `get-vanilla` and `get-vanilla-query-order-key-case`
vectors byte for byte, including the canonical request string. Also verified:
the percent-encoding rules S3 needs and `encodeURIComponent` does not follow, a
different payload changing the signature, and a different date changing it so
an old signature cannot be replayed.

**The bucket is private and nothing here can make it public.** An uploaded
remittance is PHI and a public URL is a permanent leak, so every PUT sends
`x-amz-acl: private` and there is a test asserting the string `public-read`
appears nowhere in the driver. Downloads are streamed through the API, which
checks membership and scan status first.

Turn on versioning once, so a bad delete is recoverable:

```
s3cmd setversioning s3://kody-files enable
```

---

## Production refuses to start misconfigured

`config.js` now throws on boot rather than running in a state that looks fine
and fails quietly:

| Setting | Why it is refused |
|---|---|
| development JWT secrets | every token would be forgeable |
| no `REDIS_URL` | a second instance silently drops messages |
| any `STORAGE_DRIVER` but `spaces` or `none` | local disk is not shared and does not survive a redeploy. `none` turns file sharing off, which is what a pilot without it should run |
| any `FILE_SCANNER` but `clamav` or `none` | EICAR detection is not antivirus. A whitelist, because the old check refused the exact string `local`, so `off` passed it and fell through to the local stub |
| file sharing on with `FILE_SCANNER=none` | turning storage back on and forgetting the scanner is one line, and it would accept uploads with no antivirus at all |
| `MODEL_PRIMARY_PROVIDER=mock` | canned answers, no model |
| `MAIL_DRIVER` or `PUSH_DRIVER` of `memory` | mail and push would vanish |

Each has a test, and a properly configured environment starts.

---

## Health and readiness are different endpoints

`/health` says the process is running and checks nothing else. A liveness probe
that tests the database restarts every container during a database blip, which
turns a small outage into a large one.

`/health/ready` checks the database, Redis and that migrations have been
applied, and returns 503 when any fails. That is what the load balancer and the
container healthcheck use, so a box that cannot serve is taken out of rotation
rather than serving errors.

Unapplied migrations count as not ready, because code and schema disagreeing is
worse than being down.

---

## CI

Two jobs.

**test** runs against **MySQL 8 and Redis as real services**. Development here
runs MariaDB, so this job is the only place the SQL meets the production
engine. It migrates, asserts a second migrate is a no-op, seeds, runs the full
suite, then **runs it again** to catch suites that only pass once. That has
bitten this project three times, always through a shared seed row mutated by
another suite. It then checks and packages the extension and uploads the zip.

**standards** enforces the house rules: no em or en dashes anywhere, no
committed secrets, no committed `.env`, and on a pull request, **no
modification to a migration that has already been applied** - the checksum in
`schema_migrations` would no longer match.

One correction worth recording: the idempotency step originally grepped for
"Applied 0 migrations", which the runner never prints. It prints "Nothing to
apply, schema is current." The step would have failed every green build. Found
by running it rather than reading it.

---

## The stack

**Production is pm2 behind nginx, not Docker.** The Dolluz server runs every
dApp as a pm2 process behind one nginx, with certbot for TLS and MySQL on the
same box. Caddy would collide with nginx on 80 and 443, so the Caddyfile that
used to be here was deleted rather than kept: a config that cannot run is a
thing someone will one day try to use. docs/16-pilot-runbook.md is how dAI
actually goes out.

```
deploy/
  nginx/dai.dolluzcorp.com.conf   the site: /api/, /extension/, /socket.io/
  deploy.sh                       backup, install, migrate, pm2 reload, verify, roll back
  backup.sh                       nightly dump, verified, pruned
  docker/                         parked. Not how this runs. See its README
ecosystem.config.js               pm2: one process, fork mode, capped heap
Dockerfile                        still current, builds and runs, used by CI
```

The rest of this document describes the containerised stack, which is still the
right shape for a box that is not shared with twelve other apps. The reasoning
below about replicas, readiness and migrations carries over; only the mechanism
changed.

**Two API replicas on purpose.** It is the smallest configuration that proves
the Redis adapter is working. One replica would hide the failure until the day
you scale.

**The pilot runs one.** The box is 1 vCPU and 1 GB, already in swap, with twelve
other dApps on it, and a second process to prove a point is not worth taking
those twelve down. So on that box the adapter is configured and unproven, which
is written into the runbook rather than left to be discovered.

**Migrations run in a single container before the new image starts**, so two
replicas cannot race applying the same migration.

**Redis has persistence turned off.** It is a message bus here, not a store.
Everything in it is reconstructible and losing it costs one reconnect.

**The deploy script rolls back** if readiness never comes up, and dumps the
last eighty log lines first.

**The backup script verifies the dump.** A backup nobody has restored is not a
backup, so it checks the gzip is readable and that the schema for `users`,
`messages`, `conversations` and `schema_migrations` is actually present.
A dump under 10 KB is treated as a failure.

**Caddy rather than nginx**, for automatic certificates and one less thing to
misconfigure. Access logs deliberately do not record query strings, because a
search query can contain claim detail.

---

## Not verified

- ~~No image has been built.~~ **Built and run, 2026-10-01.** 638 MB, runs as
  uid 10001 under tini, `/health` answers 200 and `/health/ready` answers 503
  naming the reason when the database is unreachable, the production guard
  fires inside the container, and the sign in page is served from the image.
  Still not run against a real database or behind Caddy.
- **The CI workflow has never executed.** It parses and the commands were run
  by hand, but GitHub has not run it.
- **No Spaces bucket has been written to.** The signer is checked against AWS
  vectors and the driver constructs correctly, but no real object has been
  stored. This is the highest remaining risk in the module.
- **ClamAV has still never run.** Same as module 7.
- **No load testing.** Two instances are proven correct, not fast.
- **The deploy and backup scripts parse but have never run against a droplet.**
  `backup.sh` exists now and has never produced a dump. Its verification refuses
  a dump that is too small, unreadable, truncated or missing any of `users`,
  `messages`, `conversations` or `schema_migrations`, and it prunes only when a
  readable dump remains.
- **Caddy has never served anything.** The Caddyfile is written, not run. The
  access log filter that strips query strings is reviewed, not observed.

---

## First deploy, in order

1. Create the droplet, the managed MySQL 8 database and the Spaces bucket.
2. Enable versioning on the bucket.
3. Copy `.env.example` to `deploy/.env.production` and fill it in, including
   `EXTENSION_IDS` once the extension is packed.
4. `docker compose -f docker-compose.prod.yml up -d redis clamav caddy`
   and wait for ClamAV's first signature download, which takes minutes.
5. `./deploy.sh v0.9.0`
6. Check `/health/ready` reports `redis.configured: true`. If it does not, you
   are running single instance and will lose messages when you scale.
