# PHASES - dAI build plan and status

Status key: DONE = verified by running it. BUILT = code exists and module tests pass, not yet used
by a real person. PENDING = not started. Update this table at the end of every session.

| Phase | Scope | Status |
|---|---|---|
| 0 | Assemble the 15 modules, fill what they never shipped, pass the suite on real MySQL 8 + Redis | DONE |
| 1 | Sign-in through dAdmin, the dAI client (Ask Kody), SME loop with notifications, dAI admin pages in dAdmin | 1.1 and 1.2 DONE, 1.3 and 1.4 PENDING |
| 2 | Team chat, files with virus scan, search, notifications UI, daily digest by SendGrid | BUILT on the server, UI PENDING |
| 3 | Chrome extension: missing files, real browser test, Web Store listing | PENDING |
| 4 | Production on DigitalOcean: droplet, managed MySQL, Spaces, Redis, ClamAV, Caddy, first real Claude call, CMS code import | PENDING |
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
1.4 dAI React app in web/ (CRA, like dAdmin), from prototypes/kody_prototype_v10.jsx
    - Login screen from v11 + web/src/screens/LoginScreen.jsx, wired to the SDK.
    - Ask tab, History, Saved, recent codes strip, points, feedback buttons.
    - Chats tab shows "coming in Phase 2" but the layout is in place.
    Done-check: sign in with a dadmin account, ask CO-45 and a general question, thumbs down,
    see it appear in the dAdmin SME queue. Screenshots in the PR.
1.5 dAdmin dAI pages (separate repo, see PROMPT_dAdmin.md)

## Known gaps carried forward (do not lose these)
- Extension: popup HTML/JS, side panel HTML, bubble.css, icons (Phase 3).
- deploy/: Caddyfile and backup.sh are referenced but missing (Phase 4).
- Real model, SendGrid, Spaces and ClamAV never exercised (Phase 4).
- CPT (AMA) and CDT (ADA) licences before importing those code sets (Phase 4).
