"use strict";
/**
 * Dismissing a question from the unanswered panel (migration 012).
 *
 * The panel is a GROUP BY with no row id, so a row carries a questionKey: the
 * SHA-256 of the normalised question and domain, computed in SQL so there is
 * one definition of "the same question" rather than two that drift.
 *
 * The store holds no question text. A question an associate typed can carry
 * claim detail, and a hash cannot be read back into one.
 *
 * This suite asks its own questions, with its own marker, so it passes twice
 * against the same database (module rule 16).
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.KODY_RATE_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";
process.env.ANALYTICS_CACHE_MS = "1";

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");
const analytics = require("../src/services/analytics.service");

const PASSWORD = "Kody!Dev2026";
const stamp = Date.now().toString(36);
const MARKER = `zqdismiss${stamp}`;
let server, base, adminToken, subToken, asked;

const api = async (method, p, body, token) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json || {} };
};

const panel = async (token = adminToken) =>
  (await api("GET", "/api/admin/analytics/unanswered?limit=50", null, token)).body.unanswered || [];

const mine = (rows) => rows.filter(r => String(r.question || "").includes(MARKER));

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  const admin = await db.one("SELECT id FROM users WHERE email = 'shoban@dolluzcorp.com'");
  await authSvc.setPassword(admin.id, PASSWORD);
  await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [admin.id]);
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");
  adminToken = (await api("POST", "/api/auth/login",
    { email: "shoban@dolluzcorp.com", password: PASSWORD })).body.accessToken;

  const email = `dismiss-sub-${stamp}@example.com`;
  const [res] = await db.query(
    "INSERT INTO users (email, full_name, initials, is_active) VALUES (?,?,?,1)",
    [email, `Dismiss Sub ${stamp}`, "DS"]
  );
  await db.query(
    "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'sub_admin'", [res.insertId]
  );
  await authSvc.setPassword(res.insertId, PASSWORD);
  subToken = (await api("POST", "/api/auth/login", { email, password: PASSWORD })).body.accessToken;

  // A question with no document behind it, which is what the panel collects.
  // The panel is capped at 50 rows ordered by how often a question was asked,
  // and a development database holds plenty of once-asked rows, so ask it often
  // enough to rank rather than hoping it lands inside the page.
  asked = `Which modifier applies to ${MARKER}`;
  for (let i = 0; i < 20; i++) {
    const r = await api("POST", "/api/kody/ask", { question: asked }, adminToken);
    assert.equal(r.status, 200, "the question must actually be asked");
  }
  analytics.clearCache();
});

after(async () => {
  await db.query("DELETE FROM unanswered_dismissals WHERE note LIKE ?", [`%${stamp}%`]);
  server.close();
  await db.pool.end();
});

describe("the panel hands out a key", () => {
  test("every row carries a 64 character questionKey", async () => {
    const rows = await panel();
    assert.ok(rows.length > 0, "the panel has rows to work with");
    for (const row of rows) {
      assert.match(String(row.questionKey), /^[0-9a-f]{64}$/, "a key, not a row id");
    }
    assert.equal(mine(rows).length, 1, "including the question this suite asked");
  });

  test("the same question asked again keeps the same key", async () => {
    const before_ = mine(await panel())[0];
    // Same words, different spacing, different case, with a question mark.
    await api("POST", "/api/kody/ask", { question: `  WHICH MODIFIER applies to ${MARKER}?  ` }, adminToken);
    analytics.clearCache();
    const rows = mine(await panel());
    assert.ok(rows.some(r => r.questionKey === before_.questionKey),
      "normalisation means one key for one question, however it was typed");
  });
});

describe("dismissing and undoing", () => {
  let key;

  test("an admin dismisses a row and it leaves the panel", async () => {
    key = mine(await panel())[0].questionKey;

    const out = await api("POST", "/api/admin/analytics/unanswered/dismiss",
      { questionKey: key, domain: "rcm", note: `handled offline ${stamp}` }, adminToken);
    assert.equal(out.status, 200);
    assert.equal(out.body.dismissed, true);

    const rows = await panel();
    assert.ok(!rows.some(r => r.questionKey === key), "gone from the panel");
  });

  test("the overview panel is refreshed too, not served stale from the cache", async () => {
    const overview = await api("GET", "/api/admin/overview", null, adminToken);
    assert.ok(!overview.body.unanswered.some(r => r.questionKey === key));
  });

  test("it appears in the dismissed list, with who and why but no question text", async () => {
    const r = await api("GET", "/api/admin/analytics/unanswered/dismissed", null, adminToken);
    assert.equal(r.status, 200);
    const row = r.body.dismissed.find(d => d.questionKey === key);
    assert.ok(row, "listed");
    assert.ok(row.dismissedBy, "who did it");
    assert.ok(row.dismissedAt, "when");
    assert.equal(row.note, `handled offline ${stamp}`);
    assert.ok(!JSON.stringify(row).includes(MARKER), "the question itself is not stored");
  });

  test("the store holds no question text at all", async () => {
    const [rows] = await db.query("SELECT * FROM unanswered_dismissals WHERE question_key = ?", [key]);
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows[0]).includes(MARKER),
      "a hash cannot be read back into a question, which is the point");
  });

  test("dismissing the same key twice is not an error", async () => {
    const again = await api("POST", "/api/admin/analytics/unanswered/dismiss",
      { questionKey: key, note: `second time ${stamp}` }, adminToken);
    assert.equal(again.status, 200);
    const [rows] = await db.query("SELECT COUNT(*) AS n FROM unanswered_dismissals WHERE question_key = ?", [key]);
    assert.equal(Number(rows[0].n), 1, "one row, updated");
  });

  test("undoing puts it back", async () => {
    const undo = await api("DELETE", `/api/admin/analytics/unanswered/dismiss/${key}`, null, adminToken);
    assert.equal(undo.status, 200);
    assert.equal(undo.body.restored, true);

    const rows = await panel();
    assert.ok(rows.some(r => r.questionKey === key), "back in the panel");
  });

  test("undoing something that was never dismissed is a 404", async () => {
    const r = await api("DELETE", `/api/admin/analytics/unanswered/dismiss/${"a".repeat(64)}`, null, adminToken);
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "not_dismissed");
  });

  test("a key that is not a key is refused", async () => {
    for (const bad of ["", "nonsense", "../../etc/passwd", "a".repeat(63), "A".repeat(64) + "b"]) {
      const r = await api("POST", "/api/admin/analytics/unanswered/dismiss", { questionKey: bad }, adminToken);
      assert.equal(r.status, 400, `${JSON.stringify(bad)} must be refused`);
    }
  });
});

describe("both directions are audited", () => {
  test("a dismissal and an undo each leave a row saying who", async () => {
    const key = mine(await panel())[0].questionKey;
    const before_ = await db.one(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('analytics.unanswered_dismissed','analytics.unanswered_restored')`);

    await api("POST", "/api/admin/analytics/unanswered/dismiss",
      { questionKey: key, note: `audit check ${stamp}` }, adminToken);
    await api("DELETE", `/api/admin/analytics/unanswered/dismiss/${key}`, null, adminToken);

    const after_ = await db.one(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('analytics.unanswered_dismissed','analytics.unanswered_restored')`);
    assert.equal(Number(after_.n), Number(before_.n) + 2, "one row each way");

    const last = await db.one(
      `SELECT a.action, a.meta, u.full_name AS actor FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.action = 'analytics.unanswered_restored' ORDER BY a.id DESC LIMIT 1`);
    assert.ok(last.actor, "who put it back");
    assert.ok(String(last.meta).includes(key), "which question");
  });
});

describe("who may dismiss", () => {
  test("a sub_admin may read the panel but not dismiss or undo", async () => {
    assert.equal((await api("GET", "/api/admin/analytics/unanswered", null, subToken)).status, 200);

    const key = mine(await panel())[0].questionKey;
    const dismissed = await api("POST", "/api/admin/analytics/unanswered/dismiss",
      { questionKey: key }, subToken);
    assert.equal(dismissed.status, 403, "dismissing decides what nobody will answer");

    const undo = await api("DELETE", `/api/admin/analytics/unanswered/dismiss/${key}`, null, subToken);
    assert.equal(undo.status, 403);

    const listed = await api("GET", "/api/admin/analytics/unanswered/dismissed", null, subToken);
    assert.equal(listed.status, 403);
  });

  test("a token is required", async () => {
    assert.equal((await api("POST", "/api/admin/analytics/unanswered/dismiss",
      { questionKey: "a".repeat(64) })).status, 401);
  });
});
