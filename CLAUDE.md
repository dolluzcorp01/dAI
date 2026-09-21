# CLAUDE.md - dAI (Kody) standing rules

Read this file, docs/PHASES.md and the doc for the area you touch before writing code.
These rules survive context compaction. If a rule and a request conflict, stop and ask Shoban.

## What this repo is
dAI is Dolluz Corp's Kody assistant: a floating bubble for healthcare back-office associates,
with Ask Kody (codes, knowledge, AI), team chat, files, search and notifications.
- server/     Express API, MySQL 8, Socket.IO. Built from the 15 Kody modules.
- web/        Kody client SDK today; the dAI React app is created here in Phase 1.
- extension/  Chrome MV3 extension (Phase 3).
- prototypes/ v10 app, v11 sign-in, v12 admin. The visual source of truth.
- docs/       Per-area design docs (02-15), PHASES.md, DAI_CHANGES.md.
- The admin console does NOT live here. It lives in dAdmin (separate repo, dAI section).

## Non-negotiables
1. Use the module code as it is. Do not rewrite features, logic or file layout. When a change is
   unavoidable, make the smallest edit, mark it with a `// dAI:` comment, and add a line to
   docs/DAI_CHANGES.md saying what and why.
2. Never edit an applied migration. Add the next numbered file (next is 011).
3. The module rules in README.kody-modules.md "Rules" 1-24 all apply (seq ordering, no model-generated
   codes, scan gate, PHI stays out of notifications, private Spaces objects, and the rest).
4. Identity is not duplicated. Real users sign in with dadmin.employee credentials (Phase 1).
   emp_id is VARCHAR(20) holding codes like DZIND148. Never Number() an emp_id.
5. No em dash or en dash anywhere: code, comments, docs, UI text, emails. Use "-".
6. No secrets in the repo. .env is gitignored; .env.example lists keys with empty values.
7. A check that cannot run is inconclusive, never a pass.

## "Be Careful" standard (how every task is done)
- Before: read the relevant doc and the code you will change. State the plan in a few lines.
- After: run `cd server && npm test` on a migrated database AND show real behaviour
  (curl output, a screenshot, a rendered page). A test count is not evidence on its own.
- Recount before stating any number. Report what you verified and what you did not.
- One phase item per session. Commit with a clear message. Stop and report; wait for "go".

## Run it
    cp .env.example .env            # fill DB_* and the JWT secrets
    cd web && npm install           # the client SDK; integration.test.js imports it
    cd ../server && npm install
    npm run migrate                 # --status, --fresh (dev only) also exist
    npm run seed:passwords          # dev only: every seed user gets Kody!Dev2026
    npm test                        # needs MySQL 8 and Redis (TEST_REDIS_URL or 127.0.0.1:6379)
    npm run dev                     # API on :4014, /health and /health/ready

## Conventions borrowed from dAdmin (for the Phase 1 React app in web/)
- Create React App (react-scripts), react-router-dom, Bootstrap, Font Awesome, like dAdmin.
- Page files are PascalCase-with-underscores `Page_Name.js` + `Page_Name.css`, as in dAdmin.
- API calls go through the Kody SDK in web/src/api (bearer tokens, single-flight refresh,
  rule 12). Do not copy dAdmin's cookie auth into this app.
- Keep the look of prototypes/kody_prototype_v10.jsx and kody_auth_flow_v11.jsx exactly.
