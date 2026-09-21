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
| server/src/services/conversations.service.js | get() now names a DM after the other member, as listMine() already did. |
| server/tests/users.test.js | Restores the member's seeded settings and skills first, so the suite passes on a second run (module rule 16). |
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
