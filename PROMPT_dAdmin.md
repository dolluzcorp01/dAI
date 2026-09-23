# Prompt for Claude Code - dAdmin repo, branch feature/dai-admin (paste everything below the line)

---

We are adding the dAI (Kody) admin console to dAdmin as a new "dAI" section, the same way dSpr
and dNews live in dAdmin today. Work on a new branch: git checkout -b feature/dai-admin.

Two sources:
1. This dAdmin repo. It is the pattern for everything: server.js, config/db.js,
   src/backend_routes/*_server.js, verifyJWT from Login_server.js, requirePageAccess from
   src/backend_routes/AccessGate.js, src/utils/api.js (apiFetch), src/utils/AccessContext.js,
   ProtectedRoute in App.js, left_navbar.js sections, and Page_Name.js + Page_Name.css pages.
2. The dAI repo (dai_project.zip). Read CLAUDE.md, docs/PHASES.md, docs/12-admin-dashboard.md
   (the endpoint table), and prototypes/kody_admin_v12.jsx (the screens). The dAI API is the only
   source of dAI data. dAdmin never reads the kody database directly.

Rules:
- Follow dAdmin's existing patterns exactly: file naming, route style, callback-style db.query,
  CSS approach, SweetAlert usage, navbar structure. Structural fidelity over interpretation.
- Match the v12 screens' content and layout, built with dAdmin's own look and components.
- Do not change any existing page or route except the few listed in step 1.
- Never commit .env. Never use an em dash or en dash anywhere.
- "Be Careful": before each step read the files you will touch; after it, show real behaviour
  (screenshots of the page, curl output of the route), not only that it compiles.
- One step per session. Commit. Stop and report. Wait for my "go".

Step 1 - access plumbing (dAdmin only)
- SQL file (do not run it; give it to me): ALTER TABLE employee ADD COLUMN app_dAI TINYINT(1)
  NOT NULL DEFAULT 0; plus access_levels rows for category 'dAI' with pages: Overview,
  People and Roles, Knowledge, SME Queue, Code Sets, Kody AI, Security and Audit, Settings,
  Spaces, Cheer Points, Messaging, Reports. Admin = 1, others = 0 by default. Include
  display_order, created_by and updated_by, as the existing rows do.
- AccessGate.js and AccessContext.js: add "dAI": "app_dAI" to CATEGORY_TO_APP_FLAG.
- Emp_App_Access.js: add the dAI toggle next to dSpr/dNews (topTierOnly: false).
- .env keys (names only, in the README or a .env.example): DAI_API_URL, DAI_SHARED_JWT_SECRET
  (a dedicated random secret, NOT dAdmin's own JWT_SECRET. It must equal dAI's
  DADMIN_SHARED_JWT_SECRET, which is what dAI verifies these tokens with. Keeping it separate
  means a dAdmin user session token can never be replayed against dAI, and either side can
  rotate it without signing anyone out.)

Step 2 - the proxy route: src/backend_routes/dAI_Admin_server.js, mounted at /api/dai
- Every route: verifyJWT, then requirePageAccess('dAI', '<Page>'), then forward to
  `${DAI_API_URL}<dAI path>` with header Authorization: Bearer <token>, where the token is
  jwt.sign({ emp_id: req.emp_id, aud: "dai-admin" }, DAI_SHARED_JWT_SECRET, { expiresIn: 60 }).
- Explicit whitelist only, one Express route per dAI endpoint. Never a wildcard pass-through.
  Map them from docs/12-admin-dashboard.md: /api/admin/*, /api/knowledge/*, /api/kody/sme*,
  /api/users/admin/*, POST /api/notifications/announce.
- Pass status codes and JSON through unchanged. Stream binary responses (reports as xlsx or pdf)
  with Content-Type and Content-Disposition. Code-set CSV import is multipart: accept it with
  multer memory storage and forward it as multipart.
- Timeout of 20 s. If dAI is unreachable, return 502 with a clear message; never 200.
- The dAI side of this (the service-token middleware) is dAI PHASES item 1.2. Until it is merged,
  test against it on a local dAI checkout.

Step 3 onward - the pages, one per session, in this order:
  Overview, People and Roles, Knowledge + SME Queue, Code Sets, Kody AI, Security and Audit,
  Settings. Phase 2 later: Spaces, Cheer Points, Messaging, Reports.
- Files: src/dAI_<Page>.js + src/dAI_<Page>.css; route /dAI_<Page> wrapped in
  <ProtectedRoute category="dAI" page="<Page>">; a "dAI" section in left_navbar.js like dSpr.
- Data only from /api/dai/... via apiFetch. Loading, empty and error states on every page.
- Code Sets: CPT and CDT imports stay disabled until a licence is recorded (the dAI API enforces
  it too).

Before step 1, read the files named above and tell me in a short list anything in dAdmin that
conflicts with this plan. Then wait for my "go".
