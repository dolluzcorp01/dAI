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
| extension/src/popup/index.html, popup.css, popup.js | Phase 1.4b. The manifest named the popup but it was never shipped, so the extension could not load. It starts the handoff and signs out; it holds no login form, no password and no token. |
| extension/src/sidepanel/index.html, sidepanel.css | Phase 1.4b. The panel sidepanel.js drives, in the v10 look. The tabs, recent codes and points arrive in 1.4c. |
| extension/src/content/bubble.css | Phase 1.4b. The only styles that reach the page: the properties that decide whether the bubble is visible, scoped to our own element id. |
| extension/icons/icon-16, 32, 48, 128.png | Phase 1.4b. The Dolluz K in gold on near black, drawn by extension/tools/make-icons.js. |
| extension/tools/make-icons.js | Phase 1.4b. Draws the icons, so the committed binaries are reproducible rather than pasted from somewhere. |
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
| server/src/services/analytics.service.js, src/routes/admin.routes.js, docs/12-admin-dashboard.md | dAdmin read activeUsers as usage and overstated it eightfold: it counts accounts (218 here against 28 people who ever asked). Added accountsTotal and peopleWhoAsked7d, kept the old names as aliases, wrote FIELD_GUIDE saying what each headline number counts, and served it at GET /api/admin/analytics/fields. A test fails if a headline field arrives with no definition. Also documented: avgLatencyMs is a mean not a median, tier0Share and degradedRate are fractions, and the token counts are not money. |
| server/migrations/012_unanswered_dismissals.sql, admin.service.js, analytics.service.js, admin.routes.js | The unanswered panel is a GROUP BY with no row id, so nothing could be acted on. Rows now carry a questionKey (sha256 of the normalised question and domain, computed in SQL so there is one definition), POST and DELETE dismiss and undo, the aggregate excludes dismissed keys in the query, and both directions are audited. The store holds the hash only: a question an associate typed can carry claim detail. Dismissing is admin only. |
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

## 1.4c - the side panel, and which server it talks to (2026-09-24)

| File | Change | Why |
|---|---|---|
| `extension/src/shared/config.js` | new | API_BASE and SITE_BASE were constants in the source. They are now production by default with an override in `chrome.storage.local`, so a local server can be used for development without an edit that someone forgets to undo. https anywhere, http only on this machine. |
| `extension/src/shared/api.js` | new | One place where the extension builds the SDK client. Only the service worker uses it, so tokens and the single refresh stay in one context. |
| `extension/src/shared/sdk/*.js` | new, vendored | Chrome can only load files inside the extension, so `web/src/api` is copied in rather than imported. |
| `extension/build.js` | `// dAI:` SDK drift check and `--sync` | A vendored copy that silently drifts would become a second client contract. The build now fails instead. |
| `extension/src/background/service-worker.js` | `// dAI:` uses the SDK; new cases `kody:ask`, `kody:threads`, `kody:thread`, `kody:feedback`, `kody:points`, `kody:endpoints`, `kody:set-endpoints`; the trusted external origin comes from config | The panel renders and the worker calls. Each new API case refuses when nobody is signed in. |
| `extension/src/sidepanel/{index.html,sidepanel.css,sidepanel.js}` | rewritten to prototype v10 | The panel was a stub from 1.4b. It is now Ask, Chats, Saved and History with the answer card, the recent codes strip, the points wallet and the feedback buttons. Built with textContent only. |
| `extension/src/popup/{index.html,popup.css,popup.js}` | `// dAI:` Server section | Where a developer points the extension at their own machine, including asking Chrome for the localhost host permission at the click. |
| `extension/manifest.json` | `optional_host_permissions` for localhost and 127.0.0.1 | Chrome refuses a host the manifest never asked for, and a packed build must not hold a local host permission it was granted. |
| `web/src/api/endpoints.js` | `// dAI:` added `notifications` | The badge and the bell had no endpoint wrapper. The list carries no message text unless the organisation opted in (rule 17). |

## 1.4d - the sign in page (2026-09-30)

| File | Change | Why |
|---|---|---|
| `server/public/extension/authorize/*` | new | The sign in page the extension has always opened, from prototype v11. Plain HTML, CSS and one ES module: no React app, no bundler. |
| `server/src/app.js` | `// dAI:` serves `/extension` with its own CSP | The only page this API serves, and the only place a Kody password is typed. `default-src 'none'`, script and style from this origin, `frame-ancestors 'none'`, `Cache-Control: no-store`. |
| `extension/src/shared/auth.js` | `// dAI:` `beginSignIn` takes `siteBase` | It built the sign in URL from a constant, so the handoff ignored a configured local server. Production stays the default, so nothing that omits it changes. |
| `extension/src/background/service-worker.js` | passes the resolved bases into `beginSignIn` and `completeSignIn` | The whole flow, sign in page included, now follows the configured server. |
| `extension/manifest.json` | `externally_connectable` for the Dolluz site | Without it `onMessageExternal` never fires, so the worker's tab fallback was dead code. One https host, never a wildcard. |
| `extension/build.js` | `// dAI:` rejects a wildcard in `externally_connectable` | That key decides which sites may talk to the worker at all. |
| `extension/src/popup/index.html` | placeholder now `http://localhost:4014` for both | The sign in page is served by the API host, so both bases are the same host in development too. |
| `server/tests/extension.test.js` | repaired `/\bfetch\s*\(/` | A 0x08 byte from a shell escape had replaced the `\b`, so the check had been passing without testing anything since 1.4c. |

## 1.4 done-check preparation (2026-09-30)

| File | Change | Why |
|---|---|---|
| `extension/src/popup/popup.js`, `extension/src/sidepanel/sidepanel.js` | `// dAI:` ask for the `identity` permission on the sign in click | `identity` is optional, so `chrome.identity` does not exist until it is granted, and Chrome only grants it from a user gesture. Asking in the worker is too late: the click has already ended. Found while preparing the Chrome done-check, before a browser had run any of it. |
| `extension/src/background/service-worker.js` | `// dAI:` the tab fallback refuses against a local server | That path can only complete on the production site, which is the one `externally_connectable` names. Opening a tab that cannot finish is worse than saying so. |
| `extension/src/popup/popup.js` | `// dAI:` the requested host pattern drops the port | A Chrome match pattern may not carry a port, so `http://localhost:4014/*` is rejected as invalid and the request throws. `http://localhost/*` covers every port on the host. |
| `extension/src/background/service-worker.js` | `// dAI:` changing server clears the tokens | A token belongs to the server that issued it. Keeping one across a change looks signed in and fails on the first call. |

## The extension handoff never asked dAdmin (2026-09-30)

| File | Change | Why |
|---|---|---|
| `server/src/services/auth.service.js` | `// dAI:` `resolveUser` extracted from `login`, and `authorize` now calls it | 1.1 put dAdmin in front of `login` and missed `authorize`, which the sign in page uses. `authorize` checked local Kody credentials only, and a real employee has none, so the extension could not sign anyone in. Found on the first done-check attempt with a real dAdmin account. |
| `server/tests/dadmin.test.js` | four tests for the handoff | An employee with no local password gets a code and swaps it for a session, the Kody user is created and linked by emp_id, a wrong password mints nothing, and `app_dAI = 0` is refused here as well as on the site. |

## Sign in says when Chrome has not granted the host (2026-09-30)

| File | Change | Why |
|---|---|---|
| `extension/src/shared/config.js` | `matchPattern()` | One place that knows a Chrome match pattern carries no port. The popup and the worker both use it. |
| `extension/src/background/service-worker.js` | `// dAI:` checks the host permission before starting sign in, and reports it over `kody:endpoints` | Without it the person signs in, the server mints a code, and the exchange fails with a bare network error. The evidence is an unconsumed row in `auth_codes` and a message that explains nothing. |
| `extension/src/popup/popup.js` | the Server line says when access has not been granted | The state that decides whether sign in can work was invisible. |

## A syntax error shipped past a green suite (2026-10-01)

| File | Change | Why |
|---|---|---|
| `extension/src/background/service-worker.js` | removed a duplicate `const { isProduction }` | The previous change destructured it at the top of `signIn`, where the tab fallback already declared it further down. Chrome disabled the extension: a worker that will not parse does not run at all. |
| `extension/build.js` | `// dAI:` every shipped `.js` is parsed, not just grepped | 581 tests passed on a file Chrome refused to load, because every check was a regular expression over the text and nothing ever asked a parser. Each file is parsed as a module, which is what Chrome does. |
| `server/tests/extension.test.js` | the same check as a test | So `npm test` catches it too, not only the build. Putting the duplicate back fails both, with the message Chrome printed. |

## After the done-check (2026-10-01)

| File | Change | Why |
|---|---|---|
| `server/public/extension/authorize/*` | the eye toggle and a Caps Lock hint | dAdmin's sign in page has both. The one thing people do on both pages now behaves the same way: the eye swaps the field, stays out of the tab order, carries `aria-pressed`, and says which it will do rather than what it is. Caps Lock is why a correct password gets typed wrong. |
| `server/public/extension/authorize/authorize.js` | the request and the reading of the reply are separate steps | A failed request and a refused credential were one branch, so a server that never answered could be reported as a bad password. No answer, an answer that refuses, and an answer that breaks are now three different messages, and the broken one carries the status. |

## Two findings from the dAdmin audit (2026-10-01)

| File | Change | Why |
|---|---|---|
| `server/src/services/kody.service.js` | `// dAI:` `smeQueue` takes `order` and a `from`/`to` window, sorted on `created_at` plus `id` | It was oldest first with no dates, which is fine with five open items and useless with fifty: the thing an expert wants is what came in today, and that was the one thing the list could not show. The direction is a whitelist, not a parameter, because a direction cannot be bound. `id` breaks the tie so two items raised in the same second cannot swap between reads. A bare `to` covers the whole of that day. |
| `server/src/routes/kody.routes.js` | passes `order`, `from`, `to` through, newest by default | |
| `web/src/api/endpoints.js` | `smeQueue(status, { order, from, to, limit })`, re-vendored into the extension | |
| `server/src/lib/safe-error.js` | new | A mysql2 error carries `sql`, the statement with the values filled in. Proven, not assumed: a failing insert of a question naming a patient put the whole sentence in `err.sql`. This is the only thing allowed into a log: kind, driver code, errno, sqlState, a capped message and one frame from our own source. |
| nine route handlers, `app.js`, `middleware/dadmin-service.js`, `server.js` | `// dAI:` `logError(...)` instead of `console.error(..., err)` | The audit named three. There were twelve. |

## Three more from the dAdmin audit (2026-10-01)

| File | Change | Why |
|---|---|---|
| `server/src/config.js`, `.env.example` | `BUSINESS_DAY_OFFSET`, default `+05:30` | A bare date was read as midnight in whatever zone the server process ran in: IST on a laptop, UTC on a droplet, so the same request covered different hours in different places. It is now an explicit, configured zone. Everything is still stored in UTC, which the pool enforces on every connection. |
| `server/src/services/kody.service.js` | `queueBoundary` converts a business day to the UTC instant, and validates the date before rolling it | `Date.UTC` rolls the 45th of the 13th month into next year rather than failing, and the old check skipped the `to` side entirely. |
| `server/src/lib/safe-error.js` | a driver error keeps code, errno and sqlState, and no message | `ER_DUP_ENTRY` reports the offending value. A small door is still a door. Ordinary errors keep their message, which is the point of having one. |
| `server/src/services/kody.service.js`, `routes/kody.routes.js` | all four statuses, plus `all`, and an unknown one is refused | The column is `ENUM('open','in_review','resolved','rejected')` but the route mapped anything but open or resolved to open, so an item being worked on or rejected could not be listed, and asking for one returned the open list as though that were the answer. Quietly correcting bad input is what hid it. |

## Phase 4 step 2: the pieces that need no provisioning (2026-10-01)

| File | Change | Why |
|---|---|---|
| `deploy/Caddyfile` | new | Referenced by docker-compose.prod.yml and missing. Uses `dynamic a` upstreams so both replicas get traffic rather than whichever answered first, health checks `/health` rather than `/health/ready` so Caddy does not query the database every ten seconds, keeps `/health/ready` to private ranges because it names unapplied migrations, and cuts the query string out of the access log entirely rather than filtering known parameter names. |
| `deploy/backup.sh` | new | Called by deploy.sh before every migration and missing. Refuses a dump that is under 10 KB, that gzip cannot read, that has no completion marker, or that is missing `users`, `messages`, `conversations` or `schema_migrations`. Prunes only when a readable dump remains. The dump holds message bodies, so it is written 0600 into a 0700 directory. |
| `extension/manifest.json` | `key` | Pins the extension id to `ikamkodfpkklimdldhfpnhmmlapdjpmn` on every machine, so a pilot needs one EXTENSION_IDS entry rather than one per tester. |
| `extension/build.js` | derives and prints the id, excludes `*.pem` from the zip | The id is otherwise only discoverable by loading it in Chrome. |
| `.gitignore` | `extension/*.pem` | The signing key must never be committed. |
| `server/tests/search.test.js` | the switcher test makes its own channel | It searched for a seeded channel, and the switcher reads only the 200 most recently active conversations before filtering. Once the seed user passed 345 conversations the test passed or failed depending on which channels had been posted to last. |

## Phase 4 re-planned for pm2 and nginx (2026-10-01)

Production is the shared Dolluz server, not Docker: pm2 behind one nginx, with
twelve other dApps on 1 vCPU and 1 GB.

| File | Change | Why |
|---|---|---|
| `server/src/lib/storage.js` | `// dAI:` a `none` driver | The pilot has no file sharing, and the only drivers were `local` (refused in production) and `spaces` (would mean provisioning object storage for a feature nobody uses). It refuses rather than pretending: an upload that silently went nowhere would be found by whoever needed the file back. |
| `server/src/config.js` | `// dAI:` whitelists for both, and the pair rule | The old guard refused the exact string `local`, so `FILE_SCANNER=off` passed it and fell through to the local EICAR stub, which is the failure the guard existed to prevent. File sharing on with no scanner is now refused outright. |
| `server/src/services/files.service.js` | `// dAI:` refuse an upload before validating or scanning it | A file that was scanned and written to a row before being dropped looks like a bug rather than a policy. |
| `ecosystem.config.js` | new | pm2, one process, fork mode, heap capped at 256 MB, restart above 250 MB. One process because the box is already in swap, which makes the Redis adapter configured and unproven in production. |
| `deploy/nginx/dai.dolluzcorp.com.conf` | new | Port 4011. Express serves the sign-in page rather than nginx, so the CSP the tests assert is the CSP that ships. Logs the path without the query string, because a search term can carry claim detail. |
| `deploy/deploy.sh` | rewritten for pm2 | Backup, install, migrate once, reload, verify, roll the code back. Says plainly that migrations do not roll back with it. |
| `deploy/Caddyfile` | deleted | Caddy would collide with nginx on 80 and 443. |
| `deploy/docker/` | parked, with a README | Keeps the two-replica reasoning for a box where it can be proven. |
| `docs/16-pilot-runbook.md` | new | Provisioning, first deploy on mock, the first real model call, the imports, backups against a 92% full disk, and rollback. |
| `server/tests/unanswered-dismiss.test.js` | reads where the panel cut is, and deletes its own threads afterwards | It asked 20 times to rank in a 50 row panel. Every run left a 20 behind, the fiftieth row climbed to 20, and the suite began tying with its own history and losing an arbitrary tie-break. A suite that cannot be run twice is not a test. |

## Node 22 pinned where dAI starts (2026-10-01)

Found during real provisioning: the nvm installer appends itself to root's
`.bashrc`, so every new root shell defaulted to Node 22 for every app on the
box, and a pm2 restart from such a shell would have relaunched another dApp on
22. Shoban caught it and set `nvm alias default system`.

That fix has a second half, which was missing here: with the default back to
Node 18, nothing would have started dAI on 22.

| File | Change | Why |
|---|---|---|
| `ecosystem.config.js` | `// dAI:` `interpreter`, overridable with `DAI_NODE` | Without it pm2 launches dAI on whatever `node` means in its shell, which is now 18, where `--env-file-if-exists` does not exist. |
| `deploy/deploy.sh` | pins `PATH` and refuses anything below Node 22 | Migrations on Node 18 would run with no environment at all and fail in a way that reads like a database fault. |
| `docs/16-pilot-runbook.md` | `nvm alias default system` immediately after `nvm install`, with the reason and a verification in a fresh shell | The window between installing nvm and fixing the default is the dangerous part. |

## A retention sweep, and seven settings that do nothing (2026-10-03)

| File | Change | Why |
|---|---|---|
| `server/scripts/retention.js` | new | The first thing in dAI that deletes anything on a schedule. Dry run unless `--apply`, so a crontab typo cannot delete. Read notifications and old digest runs only. Deletes in chunks of 1000, because one statement removing a hundred thousand rows holds a lock long enough to be noticed on one CPU, and the first run after months of accumulation is when that happens. Refuses `--audit-log` with a reason rather than ignoring it. |
| `server/tests/retention.test.js` | new | Creates its own user and scopes every call to it, so a failure here can never be somebody else's data disappearing. |

Measured while building it: **97.6% of notifications are unread** (179,081 of
183,559). The policy as specified, read-only by age, therefore trims the tail
and does not control growth. Said rather than shipped quietly: the decision
about unread notifications belongs to Shoban.

Also found, and not acted on pending a decision: seven of the eleven settings
the admin API exposes are read by no code at all, `auth.require_mfa` among them,
and there is no MFA anywhere in the product.

## The unread window, and seven settings gone (2026-10-03)

| File | Change | Why |
|---|---|---|
| `server/scripts/retention.js` | `--unread`, default 365 days | Keeping unread for ever was measured and does not work: 97.6% of notifications are never read, so a read-only policy reclaims one row in forty. Unread is held to a higher bar than read: below 180 days it refuses without `--force`, and it refuses outright if the unread window is shorter than the read one, because that would bin unseen notifications sooner than seen ones. |
| `server/src/services/admin.service.js` | `auth.require_mfa` removed, then six more | A setting belongs in that list only when some code reads it. Four remain and all four are enforced. A test asserts the exact list, so adding a key means adding its reader in the same commit. |
| `server/tests/admin.test.js` | three tests moved off removed keys | They used `files.max_mb`, `org.name` and `spaces.default_retention` to exercise unrelated behaviour. |
| `server/tests/sme-loop.test.js` | the ordering tests scope to their own date window, and the suite deletes its queue items | Every run left its open items behind, the queue page is the newest 200, and rows backdated to February fell off that page once enough newer ones existed. It failed on the second run, not the first. The fourth suite to fail this way. |

## Cleanup by default, and the model routing table (2026-10-03)

| File | Change | Why |
|---|---|---|
| `server/tests/helpers/cleanup.mjs` | new | Four suites had failed on a second run for the same reason, and the fifth was always going to arrive. Notes the highest id in every table before a suite starts, deletes anything above those marks when it finishes. Loaded into every test process, so a new suite cannot forget it. |
| `server/tests/run.js` | new | `npm test` goes through this. It has to be NODE_OPTIONS rather than `--import`: `node --test` runs each file in a child process and `--import` on the parent never reaches them. It also lists the files itself and fails when none match, because `node --test` on a pattern that matches nothing prints `# tests 0` and exits 0. |
| `server/package.json` | `test` runs the runner; `test:dirty` skips cleanup | For inspecting what a failure left behind. |
| `server/tests/cleanup-hook.test.js` | new | Guards the three traps that were actually hit while writing it. |
| `server/tests/knowledge.test.js` | the citation test creates its own message | It cited whatever the newest assistant message in the database happened to be, which only ever worked because other suites had left some behind. On a database rebuilt from the migrations there were none. |
| `server/src/services/admin.service.js`, `routes/admin.routes.js` | `// dAI:` `GET /api/admin/model-routing` | Read only, for dAdmin's Kody AI page. No key material and no keysPresent flag: whether a key is configured is a readiness question. Tier 0 reports `model: null`, which is the no-generated-codes rule made visible. |
| `server/src/services/conversations.service.js` | `// dAI:` a note on RETENTIONS | It is accepted, stored and enforced by nothing, and that is waiting on a legal answer. A reader should not have to find PHASES to learn it. |

Two traps the cleanup hook fell into first, both of which made the application
look broken rather than the hook:

1. `process.on("beforeExit")` fires whenever the event loop happens to be empty,
   which during an async test run is not the same as the process finishing. It
   deleted sessions and refresh tokens while auth.test.js was still using them:
   ten failures that read like the API was broken. A root `after()` hook from
   node:test is the right thing.
2. The hook imported `src/config`, which built and cached it before the test
   file ran. Several suites set an environment variable at the top of the file
   and expect config to pick it up; auth.test.js sets AUTH_RATE_LOGIN_MAX, lost
   it, and ran into the real login rate limit. The hook now reads the database
   settings from the environment and touches none of the application's modules.

## Correction: npm test was never running zero tests (2026-10-03)

The commit that added the runner said `npm test` had been "running nothing at
all" on Windows outside a bash shell. That was inferred from cmd.exe not
expanding globs, and it is wrong. It was checked afterwards, properly:

```
cmd.exe: node -e "...print argv..." tests/*.test.js   ->  1 arg: tests/*.test.js
cmd.exe: node --test tests/cleanup*.test.js           ->  # tests 7, # pass 7
```

cmd.exe does not expand the pattern, but `node --test` expands it itself. The
old script ran the full suite on cmd.exe exactly as it did under bash, so **no
result recorded in PHASES is affected and no done-check needs re-running.**

The related hazard is real and is what the runner now guards: a pattern matching
NOTHING makes `node --test` print `# tests 0` and exit 0, which is a green run
that proves nothing. `run.js` lists the files and exits 1 when none match.

## The certificate chicken and egg (2026-10-05)

Found by Shoban running step 1d on the real box, not by anything here.

| File | Change | Why |
|---|---|---|
| `deploy/nginx/dai.dolluzcorp.com.http-only.conf` | new | The full site file cannot be installed before a certificate exists: nginx refuses an `ssl` listener with none, so `nginx -t` fails, the file cannot be enabled, and `certbot --nginx` cannot run against a config that will not load. This is stage one: port 80, the acme challenge, and a 404 for everything else. Not a redirect to https, because at that stage there is nothing listening there. |
| `deploy/nginx/dai.dolluzcorp.com.conf` | `.well-known/acme-challenge` served ahead of the redirect | A second fault in the same area, and the worse of the two because it is silent. Certbot renews with the authenticator it first used, so every renewal fetches the challenge over port 80. With the redirect first, Let's Encrypt follows it to https, hits `location / { return 404; }` and the renewal fails. Nobody finds out for sixty days, and then the site stops. |
| `deploy/nginx/dai.dolluzcorp.com.conf` | the `ssl_certificate` lines are live, not commented | Commenting them out does not make the file installable: nginx refuses the listener either way. All it changes is that the error says "no ssl_certificate is defined" rather than naming the file that is missing, and the second is more useful. |
| `server/tests/deploy.test.js` | four tests over both files | The challenge must come before the redirect, stage one must not listen on 443 or redirect to https, both certificate lines must be live, and http2 must be on the listen directive for the 1.24 that Ubuntu 24.04 ships. |

## A check instead of a list (2026-10-05)

Shoban pointed out that the runbook's config check was written as
`node -e "..."` with no `--env-file`, so it did not read `.env` at all: it fell
over on the first secret and proved nothing. Rule 7 says a check that cannot run
is inconclusive, and that one was written into a runbook anyway.

| File | Change | Why |
|---|---|---|
| `server/scripts/check-env.js` | new | `config.js` refuses to START on a dangerous configuration. This covers the other kind: the one that starts perfectly well and is wrong. `PORT` left at 4014 while nginx proxies 4011 boots happily and returns 502 for ever. A fallback provider with no key behind it works until the primary fails, which is the day it was supposed to help. Two JWT secrets the same string means an access token verifies as a refresh token. It reads `.env.example` to find what the template ships, so a value still at its template default is reported without a list here that somebody has to remember to update. |
| `server/tests/check-env.test.js` | new | Fourteen cases, each a mistake that is easy to make and expensive to diagnose. |
| `docs/16-pilot-runbook.md` | the check, with `--env-file`, and why it matters | Replaces "read this list carefully", which is a weak control for the exact failures that are hardest to spot. |

A note for anyone writing a test around `--env-file`: it does NOT override a
variable that is already set. The first version of the suite wrote a temporary
`.env` and ran the checker against it, and every case silently tested the
developer's own configuration instead, because the test runner was itself
started with the repository's `.env`. The suite passes the values as the child's
environment instead.

| `deploy/deploy.sh` | `--skip-install`, and `DAI_SKIP_INSTALL=1` | `npm ci` peaks at 228 MB against 84 MB for the running app, on a box with 1 GB shared between thirteen apps, so `node_modules` is built elsewhere and copied. Skipping the install does not skip checking it: `npm ls --omit=dev` must still say the tree satisfies the lockfile. An unknown flag is now refused before anything happens, rather than ignored. |

## A 13 MB tarball got committed (2026-10-05)

Found by Shoban, when `git pull` on the server tried to overwrite the
`node_modules` he had just copied there.

| File | Change | Why |
|---|---|---|
| `server/node_modules.tgz`, `server/node_modules.sha256` | untracked | Build artefacts from the install-elsewhere route. 13.2 MB and 653 KB, committed in 7d1fef1. |
| `.gitignore` | both, plus `*.tgz` and `*.sha256` | So the next sweep cannot take them. |
| `server/tests/repo-hygiene.test.js` | new | No tracked file over 1 MB, no archives or keys or `.env` files, `node_modules` not tracked in any form, and `.gitignore` actually covering the three that would hurt most. |

**How it happened, which is the part worth fixing:** every commit in this
project has been made with `git add -A`, which stages the whole working tree. It
was fine while the only things in the tree were source files. The moment the
runbook told someone to build a 13 MB archive inside `server/`, the next commit
took it. Staging explicit paths is the fix; the test above is what catches it
when the habit slips.

Nothing secret was ever tracked. `.env`, `deploy/.env.production` and
`extension/key.pem` were checked and are absent from the index, which is what
the `.gitignore` entries added for them were for.

## backup.sh would have stopped the first deploy (2026-10-06)

| File | Change | Why |
|---|---|---|
| `deploy/backup.sh` | a dump with no tables is "empty", not "broken" | On the first deploy the schema does not exist yet, so the dump contains no `CREATE TABLE` and the verification failed for missing `users`, `messages`, `conversations` and `schema_migrations`. `deploy.sh` runs the backup first, so it would have aborted the very deploy that creates the schema. The completion marker already proves the dump ran, which is what separates "nothing in it yet" from "the dump went wrong". |
| `deploy/backup.sh` | the size floor only applies when the dump contains tables | Same reason. An empty database dumps to a few hundred bytes legitimately. A dump that is small AND claims to contain tables is still a failure, and says so. |
| `server/tests/backup-verify.test.js` | new | Eight cases through `--verify-only` against dumps crafted in the test, so it needs no database and no server. That matters, because the case that caused this is a database with no tables, which is awkward to produce on a machine whose only database is the one the tests use. |

Worth knowing for anyone writing more of these: the size floor measures the
GZIPPED file. The first version of the suite padded its fake dumps with twenty
thousand identical characters, which gzip reduces to under 300 bytes, so every
"big enough" dump tripped the size floor and three tests failed for a reason
that had nothing to do with what they were testing. The padding is random hex
now.

## Two more the first deploy found (2026-10-06)

| File | Change | Why |
|---|---|---|
| `deploy/deploy.sh`, `deploy/backup.sh` | mode 100755 in the index | They shipped as 100644, so a fresh clone could not run them and `deploy.sh` failed with "Permission denied" on `backup.sh`. Setting the bit on one machine does nothing: git records the mode, and the clone is what matters. |
| `deploy/backup.sh` | reads `../.env`, with an `ENV_FILE` override | It wanted `.env.production` in the deploy directory, left over from the Docker design where that was the compose `env_file`. `deploy.sh`, pm2 and the application all read `.env` at the root, and step 1e creates only that, so the first deploy could not work as written. One filename. |
| `server/tests/repo-hygiene.test.js` | both, as tests | The mode is checked through `git ls-files -s`, so it fails on what a clone would get rather than on what this working tree happens to have. The env file check reads all three scripts and fails if they disagree. |

Both failures stopped cleanly with "nothing was changed", which is the only
good thing to say about them.

## Running the deploy before pushing it (2026-10-06)

Three faults reached the server in three days, all in the same two files, and
every one of them would have died on the first line of a single real run:

1. the scripts shipped without the execute bit
2. `backup.sh` read `.env.production`, which nothing creates
3. `backup.sh` used `DEPLOY_DIR`, which only `deploy.sh` defines

Shoban found all three by running them. The honest reading is that reading a
shell script is not running it, and I had been reading.

| File | Change | Why |
|---|---|---|
| `deploy/backup.sh` | `DEPLOY_DIR="$PWD"` after the `cd` | The third fault. `set -u` caught it, which is right, and it means the change was never executed before it was pushed. |
| `deploy/backup.sh` | `--lock-tables` rather than `--single-transaction` | The fourth fault, found by the first real run. Since mysqldump 8.0.32, `--single-transaction` issues `FLUSH TABLES`, which needs the GLOBAL privilege `RELOAD` or `FLUSH_TABLES`. The `kody` user has `ALL PRIVILEGES` on its own database and nothing global, which is correct, so every backup would have failed on the box with error 1227. `--lock-tables` locks the whole database at once, so the dump is still consistent, and it needs no privilege the user does not already have. `BACKUP_SINGLE_TRANSACTION=1` opts back in where the privilege exists. |
| `deploy/backup.sh` | a `contains()` helper, replacing four quiet greps | The fifth, found in the same run. A quiet grep exits on first match, the upstream `gzip` takes SIGPIPE, and with `set -o pipefail` the pipeline reports failure. Every one of those tests read backwards: a complete 29 KB dump of a fully migrated database was reported as having no tables. The same trap sat in the required-tables check, where it would have reported tables missing when they were present, and failed a good backup. |
| `deploy/dryrun.sh` | new | Runs `deploy.sh` end to end against a clone, with the working tree's scripts copied in. Real backup, real `npm ls`, real migrate, real readiness poll against a real server; the only stub is pm2, and it starts the actual application. |

Proven, not asserted: the full path exits 0 with `verified ... all 4 required
tables present`, and a genuinely empty database, in a throwaway MySQL
container, reports `nothing to back up` and exits 0.

## /root/.my.cnf was answering for us (2026-10-06)

| File | Change | Why |
|---|---|---|
| `deploy/backup.sh` | `--no-defaults` as the FIRST argument of both mysqldump invocations | Shoban diagnosed this on the box. MySQL client tools read option files before anything you pass them, and a `password=` in one wins over `MYSQL_PWD`. `/root/.my.cnf` on that server belongs to another application, so `mysqldump --user=kody` authenticated with somebody else's password and reported access denied, while the same credentials worked by hand. mysqldump refuses `--no-defaults` anywhere but first, so the position is part of the requirement. |
| `server/tests/backup-verify.test.js` | two tests over the command itself | That every invocation starts with `--no-defaults`, and that the consistency flag is one the database user's privileges actually allow. |

Reproduced on Linux before the fix was pushed, in a container with a real 0600
`/root/.my.cnf` holding the wrong password:

```
with    --no-defaults:  verified kody-....sql.gz (841 bytes, all 4 required tables present)
without --no-defaults:  Access denied for user 'kody'@'172.22.0.3' (using password: YES)
```

The first attempt at that reproduction proved nothing and said so: the
bind-mounted option file came out world-writable, MySQL ignored it, and both
runs behaved identically. A check that cannot run is inconclusive, never a pass.

## Three from the first real deploy attempt (2026-10-06)

| File | Change | Why |
|---|---|---|
| `server/src/config.js` | `ALLOW_MOCK_MODEL=1` permits the mock provider in production, with a warning at every boot | The plan contradicted itself: step 1e said the first deploy would run `NODE_ENV=development` so the mock was allowed, and step 3 never said to change it, so the app refused to boot. Decided properly rather than patched: `NODE_ENV` stays `production`. Development mode would also switch off the Redis requirement, the storage and scanner checks, the mail and push transports, and the rule that a local Kody password cannot stand in for a dAdmin one. Working around one guard by disabling six is a bad trade. |
| `deploy/deploy.sh` | the rollback honours `--skip-install` | It ran `npm ci` regardless, which is the 228 MB spike this whole arrangement exists to avoid, at the worst possible moment: a box already in trouble with a deploy failing. It happened on the box with 234 MB free. |
| `ecosystem.config.js`, `deploy/deploy.sh` | the pm2 app is `dai-backend` | Every other app on that server is `<name>-backend`, and `pm2 list` is read by people who know that pattern. |
| `deploy/dryrun.sh` | copies the whole working tree, not just `deploy/*.sh` | Found while testing the above: the config change was not in the run at all, so the deploy failed against the committed code while the new code sat untested a directory away. A half-faithful dry run is worth less than it appears. |

Run end to end before pushing: `Reloading dai-backend`, the mock warning,
`Kody API listening (production)`, readiness green, exit 0. And the rollback
path was exercised by accident on the way, printing `Not reinstalling:
--skip-install`.

## The rollback left the repository detached (2026-10-06)

| File | Change | Why |
|---|---|---|
| `deploy/deploy.sh` | refuses to deploy from a detached HEAD, and the rollback returns to the branch | The worst fault of the set, because it was silent. `git checkout <sha>` detaches, `git pull` then prints "You are not currently on a branch" and does nothing, and the NEXT deploy runs the old code while every step reports success. Shoban hit exactly that on the box. The rollback now does `checkout $BRANCH` then `reset --hard $PREVIOUS`, so the tree is the old code and the repository is still on a branch. |
| `deploy/deploy.sh` | says which commit it is deploying, at the start and the end | So "it ran yesterday's build and said it worked" is visible in the output rather than worked out two deploys later. |

Proven against a genuinely detached checkout before pushing: the guard refuses,
names the commit, and prints the command to get back on the branch.

One mutation did not fail at first: turning the guard off left the words
"detached HEAD" in the echo lines, which a test searching for that text still
matched. The test asserts on the condition now.

## Two from the first production sign in (2026-10-06)

Both found by Shoban with the extension running against production.

| File | Change | Why |
|---|---|---|
| `.secrets/kody-extension.pem` | the signing key moved out of `extension/` | Chrome warns "This extension includes the key file ... You probably don't want to do that" about a key inside a loaded extension, and a Web Store package built from that folder would have carried it. Whoever holds it can publish an update as us. |
| `extension/build.js` | refuses to build when any `.pem`, `.key`, `.p12` or `.pfx` is anywhere under `extension/` | A warning would not have stopped it. Proven by planting a key at the top level and under `src/`: the build fails both times. |
| `.gitignore` | `*.pem` and `.secrets/` | One path was ignored before, so a key anywhere else was not. |
| `server/public/extension/authorize/*` | the spinner becomes a tick, and the heading changes to "Signed in" | The tab said "Kody is signed in. You can close this tab" underneath a spinner that was still turning. The one thing on the page that moves said wait while the text said done. |

A mutation worth recording. The first version of the build test asserted that
`build.js` contained the sentence about private keys, which passes just as
happily when the check has been downgraded from a failure to a warning, as a
mutation of exactly that shape proved. The test now runs the build with a key
planted and asserts a non-zero exit.

## Two panels, and a tab nobody should have to close (2026-10-06)

| File | Change | Why |
|---|---|---|
| `extension/src/background/service-worker.js` | `openPanel` focuses an existing panel before it opens anything | The bubble and the popup each created their own window, so two panels sat side by side sharing one session and one points balance. The check runs first, ahead of `sidePanel.open`, or a side panel opens alongside a fallback window that is already up. |
| same | the window id lives in `chrome.storage.session`, and `windows.onRemoved` forgets it | MV3 stops the worker after about thirty seconds, so a variable would be gone by the second click. Forgetting a closed window matters too, or the next open tries to focus something that is not there and the person gets nothing. |
| same | the sign in tab closes itself about a second after the code is handed over | Telling someone to close a tab is a step we can do for them. The delay lets the tick be seen; if the worker is stopped first, the page still says what happened. |

Not a code change, but worth recording: the spinner fix in bcc45a5 looked
broken in production and was not. The served file was the old one, checked
rather than assumed:

```
production: 8585 bytes, "function signedIn" x0, old inline note x1, last-modified 05 Oct
this repo:  "function signedIn" x1
```

`cache-control: no-store` was already set, so it was not a cache. The checkout
on the box had not been updated. Static files are read per request, so a pull is
enough; no restart, no deploy.

## The auto-close raced Chrome's own sign in window (2026-10-06)

Caused by the previous commit. Shoban watched the popup through the first five
seconds rather than only the end state: tick, tab closes, popup says "The user
did not approve access", then a few seconds later shows him signed in.

| File | Change | Why |
|---|---|---|
| `extension/src/shared/auth.js` | `beginSignIn` puts `flow=webauth` or `flow=tab` in the URL | The page cannot tell Chrome's auth window from an ordinary tab. Inside the auth window it is still on the Dolluz site, so `externally_connectable` matches and `sendMessage` works there too, and taking that route leaves Chrome waiting for a navigation that never comes. |
| `server/public/extension/authorize/authorize.js` | messages the extension only when `flow=tab`, redirects otherwise | Removes the race rather than papering over it. An absent `flow` means an older extension and redirects, which is the path Chrome drives. |
| `extension/src/background/service-worker.js` | a cancellation is checked against whether a session exists | Chrome cannot tell a window that closed itself from one the person dismissed, so a cancellation arriving after the tokens are stored is not a failure. Showing an error beside a working session is worse than either on its own. |

Three mutations caught, including the exact regression: messaging the extension
inside Chrome's own flow again fails two tests.

**Not verified here:** no browser has run this. The routing and the recovery are
proven by tests; that Chrome stops reporting the cancellation is Shoban's to
confirm, by watching the popup through the first five seconds as before.

## Forgot password pointed at a door most people cannot open (2026-10-07)

| File | Change | Why |
|---|---|---|
| `server/src/config.js` | `PASSWORD_RESET_URL`, falling back to `DADMIN_RESET_URL` | The link went to the dAdmin console, where only Admin and Sub Admin can sign in. Kody is for everyone, so a User-level AR caller who forgot their password landed on a page that refuses them. It points at Inside D now, the portal every employee can use. The old variable is still read, because renaming a setting that is already on a server is a way to break it quietly. |
| `server/src/routes/auth.routes.js`, the sign in page | the wording says the Dolluz portal, not dAdmin | |

Checked before pointing at it, rather than assumed: Inside D's login is at
`/login` (lowercase), and its Forgot password runs a five minute email OTP
against the same `dadmin.employee` row, with no access-level condition. So the
people this link exists for can actually use it.

On the box, update `.env`:

```
PASSWORD_RESET_URL=https://inside.dolluzcorp.com/login
```

## Single sign-on from Inside D, 2026-10-07 (docs/17-portal-sso.md)

Designed first, answered five questions, then built dAI's half only. Inside D is a separate
repository and its half is specified in docs/17-portal-sso.md section 5, not written here.

The shape is a short-lived handoff code, NOT introspection of the portal cookie. The
proposal was that dAI's sign in page send Inside D the raw dolluzcorp_token and ask who it
belongs to. That was rejected because it would put a live portal credential, the key to
every dApp in the suite, through dAI's page and process: an XSS there or one stray error
object carrying a request body would turn a dAI incident into a suite-wide one, which is the
same risk that keeps dAI out of dAdmin's shared JWT_SECRET scheme.

| File | Change | Why |
|---|---|---|
| server/migrations/013_portal_sso.sql | NEW | origin on auth_codes and sessions. On the SESSION row, not just the code, because refresh rotation INSERTs a new row every fifteen minutes: without carrying the word forward a portal session is issued for 8 hours and promoted to 30 days by its own first refresh. |
| server/src/services/portal.service.js | NEW | The exchange with Inside D and nothing else. Reads emp_id from the response and drops every other field, so a later Inside D cannot start deciding who somebody is in Kody. 5 second timeout, then the password form. |
| server/src/services/dadmin.service.js | `// dAI:` signInWithEmpId | Sign in on an emp_id somebody else vouched for. Goes through the SAME accessProblem() as signIn, so app_dAI is enforced on both paths. Does not fall through to a local Kody password in any environment. |
| server/src/services/auth.service.js | resolveUser takes an object | Two ways to prove who you are, one place that decides whether you may use Kody. issueSession and refresh carry origin; refresh distinguishes portal_session_ended from refresh_expired. |
| server/src/lib/tokens.js | sessionExpiry(origin) | 8 hours for portal, REFRESH_TOKEN_DAYS for password, and the shorter of the two for anything unrecognised so a typo cannot lengthen a session. |
| server/src/routes/auth.routes.js | two routes | GET /portal/config (nothing secret) and POST /portal/callback. The authorize route still never reads an emp_id from a request body. |
| server/public/extension/authorize/ | both legs | prompt=none so Inside D answers without showing its own login and there is no loop. sessionStorage holds what the extension asked for, because Inside D gets one fixed redirect_uri with no query. Every failure lands on the password form with a line saying why. |
| server/src/config.js | portal block, portalEnabled(), four guards | Inert unless all five PORTAL_* are set. Refuses to boot on four of five, on a client secret that is a signing secret, on one under 32 characters, and on a non-https portal URL in production. |
| server/scripts/check-env.js | portal checks, and a fix | Also fixes a fault introduced in c241629: it still required DADMIN_RESET_URL, so a box configured with the new PASSWORD_RESET_URL would have been told it was missing. |

Not built, on purpose: nothing propagates a portal logout to a Kody session. The honest
answer was to make a portal sign-in last a working day instead of 30 days and SAY so, on the
handoff screen and again when it ends, rather than let somebody find out by being signed out
in the evening and assume Kody is broken.
