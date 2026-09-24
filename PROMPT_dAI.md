# Prompt for Claude Code - dAI repo (paste everything below the line)

---

You are building dAI (Kody) for Dolluz Corp. This folder is the whole repo.

Before anything else, read in this order: CLAUDE.md, docs/PHASES.md, docs/DAI_CHANGES.md,
README.kody-modules.md (the "Rules" section), then the doc for the area you are about to touch.
CLAUDE.md is binding. Re-read it whenever your context is compacted.

Current state: Phase 0 is DONE. The server runs, migrations apply on MySQL 8, and the module test
suite passes except the extension's missing files (Phase 3). Do not refactor or rewrite module
code. When a change is unavoidable, keep it minimal, mark it `// dAI:` and log it in
docs/DAI_CHANGES.md.

Step 1 - prove the baseline on this machine, and change nothing:
- Check Node 22+, MySQL 8 and Redis are available. If one is missing, tell me the exact command
  for my OS and stop.
- cp .env.example .env, fill DB_* and generate both JWT secrets.
- cd server, npm install, npm run migrate, npm run seed:passwords, npm test.
- Start the API (npm run dev). Show me the output of GET /health/ready and of a login plus
  POST /api/kody/ask with { "question": "CO-45" }.
- Report: what passed, what failed and why, anything that differs from docs/DAI_CHANGES.md.
Then stop and wait for my "go".

After my "go", work through docs/PHASES.md Phase 1 items 1.1, 1.2, 1.3, 1.4, in order,
ONE item per session:
- Say in a few lines what you will change and which files.
- Build it. Add tests next to the existing ones in server/tests, in the same style.
- Verify: npm test on a migrated database, twice, AND real behaviour (curl output for API work,
  screenshots for UI work). A test count alone is not proof.
- Update docs/PHASES.md (status and anything learned) and docs/DAI_CHANGES.md.
- Commit with a clear message. Stop and report. Wait for "go" before the next item.

For 1.1, dadmin.employee columns you will use: emp_id (VARCHAR(20), e.g. DZIND148),
emp_mail_id, account_pass (bcryptjs hash), emp_first_name, emp_last_name, emp_access_level
('Admin' | 'Sub Admin' | 'Manager' | 'User'), active, deleted_time, and app_dAI (added by the
dAdmin branch; until then, create it in your local dadmin copy with DEFAULT 0).
Read-only: the dAI database user gets SELECT on dadmin.employee and nothing else in dadmin.

For 1.4, Kody is a browser extension and there is NO React app. Do not build one, and do not
add a bundler: the extension is plain ES modules Chrome loads directly. The work is the
extension itself (popup, side panel, bubble, icons) plus the small sign-in page on the dAI
host that hands the login back to it. Keep web/src/api, web/src/realtime and web/src/screens
and use them for every API call, so the SDK stays the one client contract and a web client
remains possible later. Copy the look of prototypes/kody_prototype_v10.jsx and
prototypes/kody_auth_flow_v11.jsx exactly; do not redesign anything.

Ask me before: adding a dependency not already used, changing a migration, touching auth token
logic, or anything that affects dAdmin. Never use an em dash or en dash anywhere.
