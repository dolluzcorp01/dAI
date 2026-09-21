# Kody

A work companion for Dolluz Corp. A floating bubble that answers questions in
healthcare RCM, Agile, cybersecurity and software development, and carries
lightweight team chat alongside.

Built by Dolluz Corporation Pvt. Ltd.

---

## Status

| Module | State |
|---|---|
| 1. Repo, environment, docker | done |
| 2. MySQL schema and migrations | done, 40 domain tables, verified against a live server |
| 3. Auth service (JWT, rotation, extension handoff) | done, 31 tests passing |
| 4. Core API: users, profile, presence | done, 74 tests passing |
| 5. Realtime server (replaces the prototype SEAM) | done, 96 tests passing |
| 6. Chat API and persistence | done, 143 tests passing |
| 7. Files service | done, 177 tests passing |
| 8. Kody AI service and model gateway | done, 213 tests passing |
| 9. Knowledge layer and code import | done, 272 tests passing |
| 10. Search | done, 316 tests passing |
| 11. Notifications | pending |
| 12a. Admin dashboard UI | done, 49 checks passing |
| 12b. Admin dashboard API | done, 404 tests passing |
| 13. Frontend integration (client SDK, adapters, login) | done, 233 tests passing |
| 14. Browser extension packaging (MV3) | pending |
| 15. Deployment, CI, Redis, Spaces | done, 456 tests passing |

## The UI contracts

Two prototypes define what gets built. They are **specifications, not
production code**. Mock data, no server, no auth.

- `kody_auth_flow_v11.jsx` - install and sign-in. Store listing, extension
  popup, website handoff, token exchange, bubble going live, sign out.
- `kody_prototype_v10.jsx` - the application. Bubble, panel, Ask, Chats,
  Saved, History, settings, channels, presence, notifications, search.
- `kody_admin_v12.jsx` - the admin console. Overview, people and roles, spaces,
  knowledge, code sets, Kody AI routing, points, messaging, reports, security
  and audit, settings.

`v11` ends exactly where `v10` begins: the moment the bubble goes live.
The admin dashboard has no UI yet.

Inside `v10` there is a comment block marked **SEAM** around
`createKodySocket`. That one function is the entire realtime mock. Module 5
replaces it with a Socket.IO client emitting the same events. Nothing above
it changes.

## Getting started

```bash
cp .env.example .env         # then fill it in
docker compose up -d         # mysql, redis, pgvector
cd server && npm install
npm run migrate              # applies everything pending
npm run migrate:status       # what is applied, what is pending
```

`npm run migrate:fresh` drops and rebuilds. It refuses to run when
`NODE_ENV=production`.

## Secrets

Real API keys never enter this repo. `.env` is gitignored; `.env.example`
lists every variable with empty values. Generate JWT secrets with:

```bash
openssl rand -base64 48
```

The model gateway reads provider keys from the environment. No module calls a
vendor SDK directly, so switching model providers is a config change.

## Rules

1. **Never edit an applied migration.** The runner checksums each file and
   refuses to continue if one changed after being applied. Add a new file.
2. **Never trust a client-side check.** The prototype hides the composer in an
   announcement channel; the API must also reject the post.
3. **Never serve an attachment whose `scan_status` is not `clean`.** Enforced in
   `files.service.js`, verified by deliberately breaking it.
4. **Never let a model generate a medical code.** Codes come from
   `code_entries` or Kody says it does not have one.
5. **Order messages by `seq`, never by timestamp.** See `docs/02-data-model.md`.
6. **Never trust the JWT without the session lookup.** See `docs/03-auth.md`.
7. **Never spread a request body into an UPDATE.** Whitelist the fields.
   See `pick()` in `src/lib/validate.js`.
8. **Never remove `FOR UPDATE` from the seq allocation.** Doing so makes the
   concurrency test fail immediately. See `docs/05-realtime.md`.
9. **Never put a user-supplied filename into a storage path**, and never serve
   an upload with a renderable content type. See `docs/07-files.md`.
10. **Never let a model generate a code.** Tier 0 looks it up or Kody says which
    code set to check. See `docs/08-kody-ai.md`.
11. **Bump `PROMPT_VERSION` whenever the system prompt changes**, or answers stop
    being reproducible.
12. **Never let two token refreshes run at once.** The server treats a reused
    refresh token as theft and kills every session. See `docs/13-frontend-integration.md`.
13. **Never edit a published knowledge document in place.** Past answers cited it.
    Supersede instead. See `docs/09-knowledge.md`.
14. **Never import a licensed code set without recording the licence.** CPT is AMA,
    CDT is ADA, both royalty bearing.
15. **Scope search in the SQL, never by filtering results.** See `docs/10-search.md`.
16. **A test suite must create the data it asserts on.** Files run in parallel
    against one database, and seeded rows are shared.
17. **Message text must not leave the system in a notification** unless the
    organisation opts in. It can be PHI. See `docs/11-notifications.md`.
18. **Mark a digest delivered only after the transport succeeds**, never before.
19. **Gate an admin router once, at the top.** A route added later is then gated
    by default rather than by remembering.
20. **A report containing message text is a PHI export.** It needs the
    organisation to opt in, and every run is recorded.
21. **Never widen the redirect allowlist to a wildcard.** An extension callback
    is accepted only for an id in `EXTENSION_IDS`. See `docs/14-extension.md`.
22. **A token never reaches a content script.** It runs in the page's world.
23. **Never run more than one instance without `REDIS_URL`.** Socket.IO rooms
    live in one process. See `docs/15-deployment.md`.
24. **Never make a Spaces object public.** An uploaded remittance is PHI.

## Layout

```
kody/
  .env.example
  docker-compose.yml
  docs/
    02-data-model.md        schema decisions and verified behaviour
    03-auth.md              auth flow, token model, what not to change
    04-users.md             profile, presence, directory, admin
    05-realtime.md          socket contract, seq rules, what replaces the SEAM
    06-chat-api.md          conversations, membership, message mutations
    07-files.md             upload, scan gate, download safety, browser
    08-kody-ai.md           gateway, tiers, code lookup, citations, SME loop
    09-knowledge.md         document versioning, code import, licence guard
    10-search.md            permission scoping, operators, short terms
    11-notifications.md     decision rules, quiet hours, digest, PHI guard
    12-admin-dashboard.md   screens, BRD coverage, what the API still owes
    14-extension.md         MV3 structure, auth handoff, what is not verified
    15-deployment.md        Redis adapter, Spaces driver, CI, the production stack
    13-frontend-integration.md  shape mismatches, the SEAM replacement, refresh
  deploy/                   production stack, reverse proxy, deploy and backup
  .github/workflows/ci.yml  MySQL 8 and Redis as real services
  Dockerfile                multi stage, non root
  extension/                Manifest V3 browser extension
    src/shared/auth.js      handoff and refresh
    src/background/         service worker
    src/content/            the floating bubble
    src/sidepanel/          where answers render
    build.js                check and package
  web/                      client SDK, drop src/ into a Vite React app
    src/api/                client, adapters, endpoints
    src/realtime/socket.js  replaces the prototype SEAM
    src/screens/            login
  server/
    migrations/             numbered SQL, applied in order
    scripts/
      migrate.js            runner with checksum tracking
      seed-passwords.js     dev only
      import-codes.js       CSV code set import, dry run by default
      send-digests.js       daily email digest, for cron
    src/
      config.js             the only file that reads process.env
      db.js                 pool and transaction helper
      app.js  server.js     express app and entry point
      lib/                  password hashing, tokens
      middleware/auth.js    authenticate, requireRole, rateLimit
      routes/               auth routes
      services/             auth service
    tests/                  456 integration tests, including client against server
```
