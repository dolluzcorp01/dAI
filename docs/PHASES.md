# PHASES - dAI build plan and status

Status key: DONE = verified by running it. BUILT = code exists and module tests pass, not yet used
by a real person. PENDING = not started. Update this table at the end of every session.

| Phase | Scope | Status |
|---|---|---|
| 0 | Assemble the 15 modules, fill what they never shipped, pass the suite on real MySQL 8 + Redis | DONE |
| 1 | Sign-in through dAdmin, the extension client (Ask Kody), SME loop with notifications, dAI admin pages in dAdmin | 1.1 to 1.4 DONE, Chrome done-check PASSED 2026-10-01. 1.5 is dAdmin |
| 2 | Team chat, files with virus scan, search, notifications UI, daily digest by SendGrid | BUILT on the server, UI PENDING |
| 3 | Chrome extension: packaging and the Web Store listing. The missing files and the real browser test moved into 1.4 | PENDING |
| 4 | Pilot on the shared Dolluz server: pm2 on 4011 behind nginx, Redis on the box, kody on the same MySQL as dadmin, first real Claude call, CARC/RARC/ICD-10 import. Spaces, ClamAV and Caddy are NOT in the pilot | IN PROGRESS, see docs/16-pilot-runbook.md |
| 5 | Mobile apps, Edge/Firefox/Safari, pgvector if MySQL full-text is not enough | LATER |

## Phase 1 - items (one per session, in this order)
1.1 dAdmin link in dAI
    - Migration 011: users.emp_id VARCHAR(20) NULL UNIQUE.
    - config.js: DADMIN_DB_NAME, DADMIN_SHARED_JWT_SECRET.
    - Login: look up dadmin.employee by emp_mail_id (deleted_time IS NULL, active = 1, app_dAI = 1),
      bcrypt-compare account_pass (bcryptjs), then create or update the Kody user by emp_id and issue
      Kody tokens exactly as today. Role on first creation: Admin -> admin, Sub Admin -> sub_admin,
      everyone else -> member. Never overwrite a role later edited in dAI.
    - Refresh also re-checks active and app_dAI, so revoking in dAdmin ends access.
    - Local Kody passwords remain for development and tests only; production refuses them.
    - sub_admin gate (added 2026-09-24): a Sub Admin was mapped but named in no role list, so
      they were refused across the console. They now get the read-only console panels, knowledge
      authoring, the SME queue and the people list. Publishing, code imports, licences, settings,
      points rules, sessions, versions, quick links, reports, role changes, activation,
      announcements and the digest stay with admin.
    - Forgot password points to the dAdmin reset flow (the password belongs to dAdmin).
    Done-check: a dadmin employee with app_dAI = 1 signs in with no one creating anything by hand;
    app_dAI = 0 is refused; turning it off ends their session on next refresh.
    DONE 2026-09-23. Migration 011, src/services/dadmin.service.js, login and refresh in
    auth.service.js, forgot-password in auth.routes.js, 20 tests in tests/dadmin.test.js.
    Done-check: Shoban ran server/scripts/verify-1.1.js against the live API as DZIND148
    on 2026-09-23 and reported 15 passed, 0 failed. It signs in with dAdmin credentials,
    confirms the Kody user was created by signing in, turns app_dAI off in dAdmin and
    requires refresh, a second live session and a fresh sign-in all to be refused, then
    turns it back on and signs in again. Full suite 459/461 twice (the 2 are Phase 3).
    An earlier run was void: the App Configuration toggle only saves after Edit access is
    clicked, so app_dAI never changed, and one check passed for the wrong reason because it
    read a token from a session that refresh had already rotated away. Both are fixed in
    the script: it re-reads app_dAI at every pause, and it proves a second, independent
    session is alive before requiring it to die.
    Learned along the way:
    - dadmin is read only for dAI and the SQL is run by Shoban, so the DB user holds column
      level SELECT on nine columns of dadmin.employee. account_pass_text, the bank columns,
      aadhar_number and pan_number are refused by MySQL, not by remembering to avoid them.
    - The password is checked before active and app_dAI, so someone without the password
      cannot learn whether an account exists or is enabled.
    - Kody users created before Phase 1, including the seed users, have no emp_id. A first
      dadmin sign-in with a matching email adopts that row rather than colliding on the
      unique email, and adoption never touches roles.
    - bcryptjs was added to read dAdmin's $2b hashes. Node has no built-in bcrypt.
    - A local Kody password still works in development and tests; production refuses it.
1.2 Service auth for the dAdmin console
    - Middleware accepting a 60-second JWT signed with DADMIN_SHARED_JWT_SECRET,
      payload { emp_id, aud: "dai-admin" }. Maps emp_id to the Kody user and their roles.
    - DADMIN_SHARED_JWT_SECRET is a dedicated random secret, shared only with dAdmin's
      DAI_SHARED_JWT_SECRET. It is NOT dAdmin's JWT_SECRET, so a dAdmin user session token
      can never be replayed against dAI, and either side can rotate it without logging anyone out.
    - Accepted only on /api/admin, /api/knowledge, /api/kody/sme, /api/users/admin and
      POST /api/notifications/announce. Every other route keeps user tokens only.
    Done-check: a signed call from curl works; expired, wrong audience or wrong secret get 401.
    DONE 2026-09-23. src/middleware/dadmin-service.js, mounted in app.js on the five paths
    above and nowhere else, plus a one line skip in middleware/auth.js for a request that
    already carries a verified service identity. 14 tests in tests/dadmin-service.test.js.
    Live against the running API, signing tokens as dAdmin would: GET /api/admin/overview
    with a valid token 200; wrong secret 401 service_token_invalid; wrong audience 401;
    expired 401 service_token_expired; the same valid token on /api/conversations and
    /api/kody/ask 401; no token 401. Full suite 473/475 twice (the 2 are Phase 3).
    Learned along the way:
    - maxAge bounds the token from iat as well as exp, so a dAdmin bug that issued a long
      lived token still cannot produce a key to dAI that works for hours.
    - The whitelist is mounted in app.js before the routers, so a route added to an admin
      router later is NOT reachable by a service token until someone adds it here.
    - A service token holds no session, so there is nothing to revoke. It is bounded by
      being short lived and by the employee still passing the app_dAI and active checks.
    - An administrator who has never opened dAI is created on first service call by the
      same create-or-link path a sign-in uses, so they act as themselves, with their own
      roles, rather than as nobody.
1.3 SME loop notifications (the gap from the walkthrough)
    - Thumbs down notifies every coordinator/admin (kind "sme", no answer text in the body).
    - Resolution notifies the person who raised it.
    Done-check: both bells light up in a live run.
    DONE 2026-09-24. notifySmeRaised and notifySmeResolved in kody.service.js, called from
    feedback() and resolveSme(). 9 tests in tests/sme-loop.test.js.
    Live run against the API: gopi (member) asked a question carrying fake patient detail and
    voted the answer down; shoban (super_admin) got "SME review", refType sme_queue, refId 39,
    with none of the question or answer text in it. shoban resolved it into document 119 and
    gopi got "Your report was answered", refType knowledge_doc, refId 119, again with no
    question and no resolution text. Full suite 513/515 twice (the 2 are Phase 3).
    Learned along the way:
    - The notification carries no question text either, not just no answer text. A question an
      associate typed can hold claim detail exactly as an answer can (module rule 17).
    - Who is told matches the roles that can open GET /api/kody/sme, including sub_admin since
      the gate above. A test asserts the two lists stay together, because drifting apart means
      someone is told about a queue they cannot open.
    - Notifying is best effort. A notification failure must not fail the vote or the resolution.
    - Two module tests had to change, both from data that grows rather than from this work:
      chat.test.js read the first 500 messages of a DM that now holds 609, and the digest pair
      in notifications.test.js unread a history larger than the 200 a digest covers per run.
1.4 The extension is the client. Re-scoped 2026-09-24: Kody is a browser extension, NOT a
    React web app, and none is to be built. web/ stays as the client SDK the extension
    imports, so a web client remains possible later and the API keeps one client contract.
    1.4a Say so in CLAUDE.md, PHASES.md and PROMPT_dAI.md.
    1.4b Pull forward from Phase 3 the files the extension names but never shipped:
         src/popup/index.html, src/popup/popup.js, src/sidepanel/index.html,
         src/content/bubble.css, and icons at 16, 32, 48 and 128.
         Done-check: the 2 failing extension tests pass and the "static safety" group,
         which could not even load, loads and passes. node extension/build.js passes.
         DONE 2026-09-24. src/popup/index.html, popup.css, popup.js; src/sidepanel/index.html
         and sidepanel.css; src/content/bubble.css; icons 16, 32, 48, 128 drawn by
         extension/tools/make-icons.js, which is committed so they can be redrawn.
         extension.test.js 30/30 including the static safety group, build.js passes, and the
         FULL SUITE IS 525/525 TWICE, green for the first time in this project.
         Learned along the way:
         - bubble.css is the only styling that reaches the page, so it pins the handful of
           properties that decide whether the bubble is visible at all, scoped to our own
           element id, and sets nothing else. The look lives in the closed shadow root.
         - The icons are generated rather than pasted so they are reproducible: running the
           script again writes the same bytes.
         - NOT verified: no browser has rendered any of this. The HTML, the CSS and the
           panel in a real Chrome are the 1.4 done-check, with screenshots.
    1.4c The side panel, from prototypes/kody_prototype_v10.jsx: Ask, History, Saved, the
         recent codes strip, points and the feedback buttons, same look, no redesign.
         The Chats tab shows "coming in Phase 2" with the layout in place. Every call goes
         through web/src/api. No token in the content script (rule 22).
         DONE 2026-09-24. Four tabs, the answer card with its lookup block, chips,
         disclaimer and citations, Save, Copy, Helpful and Not helpful, the recent codes
         strip and the cheer points wallet. Chats is the prototype's layout with a
         "Coming in Phase 2" note. API_BASE and SITE_BASE are configurable:
         src/shared/config.js, production by default, overridable from the popup's Server
         section, https anywhere or http only on this machine.
         Evidence: extension.test.js 43/43 with 13 new tests, node extension/build.js
         passes, FULL SUITE 559/559 TWICE. Three mutations caught and restored byte for
         byte: a drifted vendored SDK, http allowed to point anywhere, and the session
         check dropped from kody:points.
         Learned along the way:
         - The panel holds no token and makes no fetch. Every call is a message to the
           worker, which owns the one refresh. That is not only rule 22: the API treats a
           reused refresh token as theft and kills every session, so a second refresher in
           a second context would sign people out for no reason.
         - web/src/api cannot be imported across the repo, because Chrome only loads files
           inside the extension. It is vendored into src/shared/sdk/ and build.js fails on
           drift, so there is still one client contract. --sync re-copies it.
         - An answer is model output, so the whole panel is built with createElement and
           textContent, and a link is followed only if it is http or https. A model can
           return javascript: as easily as https:.
         - Chrome will not call a host the manifest never asked for. localhost is an
           optional host permission, requested from the popup click, so a packed build
           never carries it.
         - NOT verified: no browser has rendered the panel. That is the 1.4 done-check.
    1.4d The sign-in page on the dAI host that hands the login back to the extension, from
         prototypes/kody_auth_flow_v11.jsx. It signs in with dAdmin credentials, as 1.1 does.
         DONE 2026-09-30. server/public/extension/authorize/, plain static files served by the
         API host at /extension/authorize, which is the URL beginSignIn already opened. The
         v11 card: dark logo tile, the gold authorising strip, Work email and Password, the
         gold button, the or divider with the two SSO buttons disabled and the prototype's own
         note about them, Forgot password pointing at dAdmin, and the handoff screen.
         Evidence: a new suite, signin-page.test.js, runs the page's OWN authorize.js in a
         DOM written for the test against the real server: 11/11. extension.test.js 45/45.
         FULL SUITE 572/572 TWICE. Five mutations caught, every file restored byte for byte:
         the page returning to any https address, the password left in the page, a loosened
         page CSP, a widened externally_connectable, and a fetch added to the side panel.
         Learned along the way:
         - 1.4c left the handoff hardcoded to production: shared/auth.js still had API_BASE
           and SITE_BASE constants, so sign in ignored the configured server and 1.4d could
           not have been tested locally at all. beginSignIn and completeSignIn now take the
           bases, and the worker passes what config.js resolved. Production stays the default.
         - externally_connectable was missing, so the worker's onMessageExternal branch, and
           the whole tab fallback with it, was dead code. It names one https host, build.js
           now fails on a wildcard there, and the worker still checks the origin itself.
         - The page tests the callback against the RAW string, not the parsed host, because
           new URL() lowercases a host and the server's allowlist does not. A page laxer than
           the server it depends on is how an open redirect starts. A test asserts the two
           agree, case for case.
         - A stray 0x08 byte from a shell escape had been sitting in extension.test.js since
           1.4c, inside /\bfetch\s*\(/. The regex was looking for a backspace character, so
           "the panel never calls fetch" had been passing without checking anything. Repaired,
           then proved by adding a fetch to the panel and watching it fail. All 140 tracked
           text files are now scanned for control bytes and are clean.
         - NOT verified: no browser has rendered this page either.
         The done-check also found the gap in how this area was tested: a duplicate
         declaration in the service worker passed 581 green tests and then stopped the
         extension loading at all, because every check was a regular expression over the
         text. build.js and the suite now parse every shipped script as a module, which is
         what Chrome does. Full suite 581/581 twice.
         The first done-check attempt found the one that mattered: 1.1 put dAdmin in front of
         login and missed authorize, which is what the sign in page calls. authorize checked
         local Kody credentials only, and a real employee has none, so the extension could
         not sign anyone in. Both now go through one resolveUser. Four tests cover the
         handoff, and putting the bug back fails three of them. Full suite 579/579 twice.
         Preparing the done-check found one more, again before any browser ran: identity is
         an optional permission, so chrome.identity does not exist until it is granted and
         Chrome only grants it from a user gesture. Both sign in buttons now ask on the
         click, and the worker's tab fallback refuses against a local server instead of
         opening a tab that cannot finish. Two more found the same way: a Chrome match
         pattern may not carry a port, so the popup asked for http://localhost:4014/* and
         Chrome rejected it; and changing server kept the old server's tokens, which looks
         signed in and fails on the first call. Full suite 575/575 twice.
    Done-check for 1.4 as a whole, in a real Chrome: load the unpacked extension, sign in
    with a dAdmin password, click the bubble, ask CO-45 and a general question, thumbs down
    one, and see it reach the dAdmin SME queue. Screenshots of each step.
    PASSED 2026-10-01, run by Shoban in Chrome against a local server, extension id
    llfpaneificjjjedekfkimpakmkjdmie loaded unpacked, API and site both http://localhost:4014.
    Steps 2 to 9 all passed: signed in with the dAdmin password (DZIND148), CO-45 came back
    as a verified CARC lookup in 28ms, thumbs up credited 25 cheer points, Saved, History,
    Chats and the recent codes strip behaved, and the bubble appeared on
    dadmin.dolluzcorp.com. Screenshots held by Shoban.
    The thumbs down reached the queue: sme_queue id 141, status open, raised by
    tigerboogipinky@gmail.com (DZIND148) at 2026-10-01T05:12:48Z, kody_messages 3112, domain
    rcm, tier 0, confidence high. It notified 2 real reviewers, vignesh (coordinator) and
    shoban (super_admin), with title "SME review" and a body naming only the domain: no
    question text and no answer text, which is rule 17 holding in production use. The other
    278 recipients are test accounts this development database has accumulated from the
    suite, not a product behaviour.
    What the done-check found that no test had: five faults, four of them in paths no test
    covered and one a hole in the testing itself.
      1. authorize never asked dAdmin, so no real employee could sign in through the
         extension at all. The decisive one.
      2. identity is an optional permission, so chrome.identity did not exist until granted.
      3. A Chrome match pattern may not carry a port, so the host permission request was
         rejected outright.
      4. Changing server kept the previous server's tokens.
      5. A duplicate declaration stopped the worker loading, and 581 green tests could not
         see it because every check was a regular expression over the text. build.js and the
         suite now parse every shipped script as a module, which is what Chrome does.
    The lesson for the remaining phases: a browser check finds what a test suite built from
    the same assumptions cannot, so it belongs before an item is called done, not after.
1.5 dAdmin dAI pages (separate repo, see PROMPT_dAdmin.md)

## Known gaps carried forward (do not lose these)
- Test cleanup is automatic as of 2026-10-03. tests/run.js loads tests/helpers/cleanup.mjs
  into every test process through NODE_OPTIONS, which notes the highest id in every table
  before a suite runs and deletes anything above those marks when it finishes. Two full runs
  now leave every row count unchanged. What it does NOT undo is changes to rows that already
  existed: a suite that rewrites a seed password or flips a setting still has to put it back.
  It also needs --test-concurrency=1, which tests/run.js sets: with files running in
  parallel, one file's cleanup would delete another file's rows.
- Retention: scripts/retention.js (2026-10-03) deletes read notifications after 90 days,
  unread after 365, and digest runs after 90. Never audit_log. Dry run unless --apply.
  It has never run on the server.
- THE FAN-OUT ITSELF NEEDS RETHINKING IN PHASE 2. 97.6% of notifications in development
  are unread: 179,081 of 183,559. That is not a storage problem that a sweeper fixes, it
  is the product telling people things they do not want to know. One thumbs down notifies
  every SME reviewer, and the done-check produced 280 rows from a single click. Phase 2
  should decide who actually needs to be told, whether a digest replaces the per-event
  notification for most people, and whether a reviewer can opt out of a domain. A sweeper
  that deletes a year later is a bucket under a leak.
- auth.require_mfa REMOVED 2026-10-03, on its own and first, because ticking it told a
  security officer they had multi-factor authentication when the product has none: no
  implementation, no schema, nothing. To build it properly: a second factor on the dAdmin
  side, since that is where credentials live and dAI never holds a password, plus a claim
  in the dAI session saying the factor was satisfied. That is a dAdmin feature with a dAI
  follow-on, not a dAI feature, and it is a Phase 5 conversation at the earliest.
- SIX more settings REMOVED 2026-10-03, all read by no code: org.name, files.max_mb,
  auth.access_token_minutes, auth.refresh_token_days, auth.code_ttl_seconds,
  spaces.default_retention. Four remain and all four are enforced: points.per_cent,
  points.show_cash, notifications.include_message_text, reports.allow_content_export.
  What each removed one would cost to build properly:
    org.name                   trivial. One read where the console title and the mail
                               templates are rendered. Not worth a setting until something
                               renders an organisation name that is not hardcoded.
    files.max_mb               small, but it belongs to Phase 2 with the rest of files, and
                               MAX_FILE_MB in the environment already does the job. Two
                               places to set one thing is the bug, not the missing read.
    auth.access_token_minutes  small each, same objection: ACCESS_TOKEN_MINUTES,
    auth.refresh_token_days    REFRESH_TOKEN_DAYS and AUTH_CODE_TTL_SECONDS already apply,
    auth.code_ttl_seconds      and a database value that silently loses to the environment
                               is worse than no value. If these should be editable at run
                               time, config.js has to read them per request rather than at
                               boot, which is a real change to how config works.
    spaces.default_retention   see the legal note below. Spaces are Phase 2 anyway.
- conversations.retention is still accepted and still enforces nothing. It is a LEGAL
  question before it is an engineering one: enforcing it means permanently deleting message
  history in a healthcare back-office, and what Dolluz is obliged to keep, and for how long,
  has not been established. Until somebody answers that, building the deletion would be
  building a thing nobody can say is correct. Left in place and documented rather than
  removed, because removing it would also need the dAdmin side to stop sending it.
- The quick switcher reads the 200 most recently active conversations and filters those in
  JavaScript (search.service.js). Someone in more than 200 conversations cannot find an
  older one by typing its name, and it fails silently: the list simply does not contain it.
  Found on 2026-10-01 because a test went intermittent once the seed user passed 345
  conversations. The test now owns its data; the product behaviour is unchanged and
  unreported to anyone using it.
- The SME queue date filter reads a bare date in BUSINESS_DAY_OFFSET, default +05:30, and
  everything is stored in UTC. A fixed offset is exact for India. If dAI is ever used from a
  zone with daylight saving, this needs a real time zone database rather than an offset.
- exchangeCode issues a session from the one-time code without re-checking dAdmin. Found in
  the 1.4 audit on 2026-10-01. The window is the code's sixty second life, and every refresh
  after that re-checks dAdmin and revokes on access_revoked (1.1), so an employee whose
  app_dAI is turned off between signing in on the page and the extension redeeming the code
  gets a session that dies at the first refresh. Narrow, but it is the only gap left in the
  sign-in path. Phase 4: re-check in exchangeCode, or bind the check into the code row.
- Single sign-on from Inside D is BUILT on dAI's side and INERT: with the five PORTAL_*
  values unset, the sign in page never leaves dai.dolluzcorp.com and the password form is
  the only way in. The Inside D half is a separate repository and has not been built. The
  contract it has to implement is docs/17-portal-sso.md section 5. Two things in that
  document are open questions rather than work: whether a portal logout should end a Kody
  session within 15 minutes (which puts Inside D in the path of every refresh) or whether
  the 8 hour session is close enough, and whether Inside D ever shows its own login for
  Kody rather than always answering prompt=none.
- Extension: popup HTML/JS, side panel HTML, bubble.css, icons. Moved from Phase 3 into 1.4b.
- deploy/: backup.sh and the pm2 deploy.sh written. Neither has run on the server. The
  Caddyfile was deleted: Caddy would collide with nginx on 80 and 443.
- Real model never exercised. SendGrid, Spaces and ClamAV are OUT of the pilot: mail and
  push run with the none transport, and file sharing runs with STORAGE_DRIVER=none.
- CPT (AMA) and CDT (ADA) licences before importing those code sets (Phase 4).
