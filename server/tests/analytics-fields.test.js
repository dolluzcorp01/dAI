"use strict";
/**
 * What the analytics numbers mean.
 *
 * The dAdmin console read activeUsers as "people using Kody" and overstated it
 * eightfold: it counts accounts, and most accounts have never asked anything.
 * These tests pin each number to what it actually counts, and refuse a new
 * headline field that nobody has defined.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";
process.env.ANALYTICS_CACHE_MS = "1";

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");
const analytics = require("../src/services/analytics.service");

const PASSWORD = "Kody!Dev2026";
const stamp = Date.now().toString(36);
let server, base, adminToken, subToken;

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

  const email = `fields-sub-${stamp}@example.com`;
  const [res] = await db.query(
    "INSERT INTO users (email, full_name, initials, is_active) VALUES (?,?,?,1)",
    [email, `Fields Sub ${stamp}`, "FS"]
  );
  await db.query(
    "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'sub_admin'", [res.insertId]
  );
  await authSvc.setPassword(res.insertId, PASSWORD);
  subToken = (await api("POST", "/api/auth/login", { email, password: PASSWORD })).body.accessToken;
  assert.ok(adminToken && subToken);
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("accounts are not usage", () => {
  test("accountsTotal counts accounts, peopleWhoAsked7d counts people who used Kody", async () => {
    const r = await api("GET", "/api/admin/overview", null, adminToken);
    assert.equal(r.status, 200);

    const accounts = await db.one(
      "SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND deleted_at IS NULL");
    const askers = await db.one(
      `SELECT COUNT(DISTINCT user_id) AS n FROM kody_messages
        WHERE role = 'user' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`);

    assert.equal(r.body.accountsTotal, Number(accounts.n), "accountsTotal is every live account");
    assert.equal(r.body.peopleWhoAsked7d, Number(askers.n), "peopleWhoAsked7d is who actually asked");
    assert.ok(r.body.accountsTotal >= r.body.peopleWhoAsked7d,
      "an account that never asked still counts as an account");
  });

  test("the old names still work, and mean exactly what the new ones mean", async () => {
    const r = await api("GET", "/api/admin/overview", null, adminToken);
    assert.equal(r.body.activeUsers, r.body.accountsTotal, "activeUsers was never activity");
    assert.equal(r.body.activeUsers7d, r.body.peopleWhoAsked7d);
  });
});

describe("the field guide", () => {
  test("every headline field is defined, so a new one cannot arrive undocumented", async () => {
    const r = await api("GET", "/api/admin/overview", null, adminToken);
    const undocumented = Object.keys(r.body).filter(k => !(k in analytics.FIELD_GUIDE));
    assert.deepEqual(undocumented, [],
      `these fields have no line in FIELD_GUIDE: ${undocumented.join(", ")}`);
  });

  test("it is served by the API, so a dashboard can read the definitions", async () => {
    const r = await api("GET", "/api/admin/analytics/fields", null, adminToken);
    assert.equal(r.status, 200);
    assert.match(r.body.fields.accountsTotal, /NOT a measure of use/);
    assert.match(r.body.fields.peopleWhoAsked7d, /usage figure/);
    assert.match(r.body.fields.avgLatencyMs, /average, not a median/);
    assert.match(r.body.fields.tier0Share, /between 0 and 1/);
    assert.match(r.body.fields.inputTokens30d, /not money/);
  });

  test("a sub_admin can read it too, since it is only definitions", async () => {
    assert.equal((await api("GET", "/api/admin/analytics/fields", null, subToken)).status, 200);
  });
});

describe("the other numbers are what they say", () => {
  test("shares are fractions, not percentages", async () => {
    const r = await api("GET", "/api/admin/overview", null, adminToken);
    for (const key of ["tier0Share", "degradedRate"]) {
      assert.ok(r.body[key] >= 0 && r.body[key] <= 1, `${key} is ${r.body[key]}, which is not a fraction`);
    }
  });

  test("latency is the mean, which is what the guide says", async () => {
    const computed = await analytics.headline();
    const row = await db.one(
      `SELECT AVG(latency_ms) AS avgMs FROM kody_messages
        WHERE role = 'assistant' AND tier > 0 AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`);
    assert.equal(computed.avgLatencyMs, row.avgMs ? Math.round(Number(row.avgMs)) : 0);
  });

  test("questions are questions and messages are chat", async () => {
    const r = await api("GET", "/api/admin/overview", null, adminToken);
    const questions = await db.one(
      `SELECT COUNT(*) AS n FROM kody_messages WHERE role = 'user' AND created_at >= CURDATE()`);
    const chat = await db.one(
      `SELECT COUNT(*) AS n FROM messages WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`);
    assert.equal(r.body.questionsToday, Number(questions.n));
    assert.equal(r.body.messages7d, Number(chat.n), "messages7d is chat, not Kody answers");
  });
});
