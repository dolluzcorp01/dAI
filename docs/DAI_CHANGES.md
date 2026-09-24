# DAI_CHANGES - every change made to the Kody module code, and why

The 15 module zips were assembled into the layout in README.kody-modules.md "Layout".
Where a file existed in two modules, the later module's version was kept
(storage.js 15, messages.service.js 6, migrate.js 4, endpoints.js 13, 12-admin-dashboard.md 12b).
The bundle could not start as shipped. The changes below are the minimum that made it run.
Every one is marked `// dAI:` in the code where it touches a module file.

## Files the bundle referenced but never shipped (written for dAI)
| File | Why it was needed |
|---|---|
| server/package.json | No package file existed. Dependencies taken from every require() in the code. |
| server/src/db.js | Required in 31 places. Contract: query, one, transaction, pool, end. |
| server/src/routes/kody.routes.js | docs/08-kody-ai.md lists 10 endpoints; no router existed. Thin wrapper over kody.service. |
| server/src/routes/notifications.routes.js | docs/11-notifications.md lists 6 endpoints; no router existed. |
| server/src/realtime/fanout.js | notifications.service.notifyMessage existed but nothing called it, so no message ever notified anyone. |
| server/tests/helpers/instance.js | deploy.test.js spawns it as the second API instance. |
| server/scripts/seed-passwords.js | CI calls it. Dev only, refuses production. |
| web/package.json | The web SDK imports socket.io-client. |
| server/migrations/011_dadmin_link.sql | Phase 1.1. users.emp_id VARCHAR(20) NULL UNIQUE, so a Kody user points back at the employee it was created from. |
| server/src/services/dadmin.service.js | Phase 1.1. Reads dadmin.employee (the nine granted columns only), bcrypt-compares account_pass, maps the access level to a role on first creation, and creates, adopts or refreshes the Kody user. |
| server/src/middleware/dadmin-service.js | Phase 1.2. Verifies a short lived JWT signed with DADMIN_SHARED_JWT_SECRET, audience dai-admin, maps emp_id to the Kody user and their roles, and leaves the routers' own requireRole checks to do the rest. |
| server/scripts/verify-1.1.js | Phase 1.1 done-check, run by hand against a live API. Reads the granted columns only, never writes to dadmin, prints no password or token. |
| server/tests/sub-admin.test.js | Phase 1.1 follow-up. 31 tests naming every route a sub_admin may and may not reach. |
| server/tests/dadmin-service.test.js | Phase 1.2. 14 tests, including that a service token opens nothing outside the whitelist. |
| server/tests/dadmin.test.js | Phase 1.1. 20 tests. dadmin is read only and CI has no dadmin database, so the two reader functions are replaced by a fake employee table; everything else runs for real. |

## Module files changed
| File | Change |
|---|---|
| server/src/app.js | Was the Module 3 version mounting only /api/auth. Now mounts all 10 routers and adds /health/ready (DB, Redis, migrations). |
| server/src/server.js | Was the Module 5 version. Now creates the Redis adapter when REDIS_URL is set. |
| server/src/config.js | Was the Module 3 version. Added ai, files, mail, push, redis, socketPath, extensionIds and the production guards docs/15 describes. |
| server/src/realtime/gateway.js | Was the Module 5 version. Accepts { adapter }, registers with the bus so REST sends reach sockets, calls the fan-out after a socket send. |
| server/src/routes/chat.routes.js | One line: call the fan-out after a REST send. |
| server/src/lib/tokens.js | Accept https://<id>.chromiumapp.org/ callbacks only for ids in EXTENSION_IDS (docs/14). |
| server/src/services/kody.service.js | Store and read lookup_description (migration 007 added the column; the service never used it). |
| server/src/services/auth.service.js | Phase 1.1. login() tries dadmin.employee first and falls back to a local Kody password only outside production; refresh() re-checks active and app_dAI for a user that carries an emp_id, and revokes every session for that person when access is gone. |
| server/src/routes/auth.routes.js | Phase 1.1. POST /api/auth/forgot-password, which points at the dAdmin reset flow. The password belongs to dAdmin, so dAI never resets one. dAdmin has no separate reset page, so DADMIN_RESET_URL is its sign-in page and the message names the Forgot password button. |
| server/src/routes/admin.routes.js | Phase 1.1 follow-up. sub_admin was mapped from dAdmin but named in no requireRole list, so a Sub Admin signed in and was then refused across the whole console. The single gate at the top now also admits sub_admin to an explicit allowlist of read-only panels (overview, the five analytics routes, spaces, audit). Everything else stays admin only, so a route added later is still out of reach until it is named. |
| server/src/routes/knowledge.routes.js | Phase 1.1 follow-up. sub_admin authors documents. Publishing, importing and recording a licence stay with admin. |
| server/src/routes/kody.routes.js | Phase 1.1 follow-up. sub_admin works the SME queue. |
| server/src/routes/users.routes.js | Phase 1.1 follow-up. sub_admin reads the people list. Changing roles and activation stay with admin: someone who can grant roles can promote themselves. |
| server/src/app.js | Phase 1.2. Mounts the dAdmin service token middleware on /api/admin, /api/knowledge, /api/kody/sme, /api/users/admin and POST /api/notifications/announce, before the routers and nowhere else. |
| server/src/middleware/auth.js | Phase 1.2. authenticate() passes a request straight through when a dAdmin service token has already been verified and mapped to a user. A service call holds no session, so there is nothing to look up. |
| server/src/config.js | Phase 1.1. Added the dadmin block: DADMIN_DB_NAME, DADMIN_SHARED_JWT_SECRET, DADMIN_RESET_URL. |
| server/package.json | Phase 1.1. Added bcryptjs, to read the $2b hashes dAdmin writes. Node has no built-in bcrypt. Approved before adding. |
| server/src/services/kody.service.js | Phase 1.3. A thumbs down notifies everyone who works the SME queue (kind sme, refType sme_queue), and resolving it notifies the person who reported it (refType knowledge_doc when published). Neither carries question, answer or resolution text. Best effort: a notification failure never fails the vote or the resolution. |
| server/tests/chat.test.js | Phase 1.3. "delete for me" read the first 500 messages of the seeded DM, which now holds more than that after repeated runs, so the message it had just posted fell outside the window. It reads the tail instead. |
| server/tests/notifications.test.js | Phase 1.3. The digest pair unread the whole history of a user, which is larger than the 200 notifications a digest covers per run, so the second run found a second batch and reported "sent". The test now parks the history and unreads five, which is what the pair is about. |
| server/src/services/codes.service.js | answerFromCode formatted effective_from with String(), and mysql2 returns a Date, so every tier 0 answer read "Thu Jan 01" instead of "2026-01-01". Now formats a Date as YYYY-MM-DD. Test in kody.test.js. Found in the Step 1 live run. |
| server/src/services/conversations.service.js | get() now names a DM after the other member, as listMine() already did. |
| server/tests/users.test.js | Restores the member's seeded settings and skills first, so the suite passes on a second run (module rule 16). Phase 1.1: "searches by name" asserted that a directory search for pavithran returns exactly one row. Once a real dadmin employee signs in, two people can share part of a name, so it now asserts the seeded user is among the results. |
| .env.example | Rewritten: the old one used key names config.js never read (DO_SPACES_*, PGVECTOR_URL). |
| .env.example, CLAUDE.md | Local API port 4000 -> 4014 (PORT, PUBLIC_URL), requested 2026-09-21. Module code unchanged: config.js reads PORT. The container port in Dockerfile and deploy/ stays 4000. |
| .env.example, CLAUDE.md | TEST_REDIRECT added (auth.test.js defaults to :5173, which the example allowlist does not contain), and "cd web && npm install" added to Run it (integration.test.js imports the SDK, which needs socket.io-client). Found by the Step 1 baseline run. |

## Verified in the assembly environment (MySQL 8.0.46, Redis, Node 22)
- All 10 migrations apply cleanly; a second migrate is a no-op.
- Full suite run three times on one database: 438 of 440 pass each time. The 2 failures, plus the
  "static safety" group that cannot load, are all the extension's missing files (Phase 3).
- Live server walkthrough: login, Kody CO-45 answered by code lookup with no model call,
  a general question answered (mock model), thumbs down opened an SME item, an admin resolved it
  into a published document, an @mention produced a notification with no message text in it,
  /health/ready returned 200.
- NOT verified: any real Claude or OpenAI call, SendGrid, Spaces, ClamAV, the extension in a browser.
