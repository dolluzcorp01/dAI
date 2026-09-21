# PHASES - dAI build plan and status

Status key: DONE = verified by running it. BUILT = code exists and module tests pass, not yet used
by a real person. PENDING = not started. Update this table at the end of every session.

| Phase | Scope | Status |
|---|---|---|
| 0 | Assemble the 15 modules, fill what they never shipped, pass the suite on real MySQL 8 + Redis | DONE |
| 1 | Sign-in through dAdmin, the dAI React app (Ask Kody), SME loop with notifications, dAI admin pages in dAdmin | PENDING |
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
    - Forgot password points to the dAdmin reset flow (the password belongs to dAdmin).
    Done-check: a dadmin employee with app_dAI = 1 signs in with no one creating anything by hand;
    app_dAI = 0 is refused; turning it off ends their session on next refresh.
1.2 Service auth for the dAdmin console
    - Middleware accepting a 60-second JWT signed with DADMIN_SHARED_JWT_SECRET,
      payload { emp_id, aud: "dai-admin" }. Maps emp_id to the Kody user and their roles.
    - Accepted only on /api/admin, /api/knowledge, /api/kody/sme, /api/users/admin and
      POST /api/notifications/announce. Every other route keeps user tokens only.
    Done-check: a signed call from curl works; expired, wrong audience or wrong secret get 401.
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
