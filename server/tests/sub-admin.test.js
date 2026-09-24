"use strict";
/**
 * What a sub_admin can reach (docs/PHASES.md 1.1).
 *
 * A dAdmin Sub Admin maps to Kody sub_admin on first sign-in. They get the
 * read-only panels of the console, knowledge authoring and the SME queue, and
 * nothing that changes who people are, what Kody tells them, or what leaves the
 * building.
 *
 * The refusals matter more than the permissions here, so they are listed one by
 * one rather than summarised. This suite creates its own user and its own role
 * grant, so it passes twice against the same database (module rule 16).
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.KODY_RATE_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");

const PASSWORD = "Kody!Dev2026";
const stamp = Date.now().toString(36);
let server, base, subToken, adminToken, subUserId;

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

  const email = `sub-admin-${stamp}@example.com`;
  const [res] = await db.query(
    "INSERT INTO users (email, full_name, initials, is_active) VALUES (?,?,?,1)",
    [email, `Sub Admin ${stamp}`, "SA"]
  );
  subUserId = res.insertId;
  await db.query(
    "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'sub_admin'", [subUserId]
  );
  await authSvc.setPassword(subUserId, PASSWORD);

  const admin = await db.one("SELECT id FROM users WHERE email = 'shoban@dolluzcorp.com'");
  await authSvc.setPassword(admin.id, PASSWORD);
  await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [admin.id]);
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");

  subToken = (await api("POST", "/api/auth/login", { email, password: PASSWORD })).body.accessToken;
  adminToken = (await api("POST", "/api/auth/login",
    { email: "shoban@dolluzcorp.com", password: PASSWORD })).body.accessToken;
  assert.ok(subToken && adminToken, "both sign-ins must work");
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("a sub_admin signs in and is not locked out", () => {
  test("has the sub_admin role and can use Kody like anyone else", async () => {
    const me = await api("GET", "/api/auth/me", null, subToken);
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.roles, ["sub_admin"]);

    const asked = await api("POST", "/api/kody/ask", { question: "CO-45" }, subToken);
    assert.equal(asked.status, 200, "the console is not the only thing they can do");
  });
});

describe("the read-only console panels", () => {
  const allowed = [
    ["GET", "/api/admin/overview"],
    ["GET", "/api/admin/analytics/domains"],
    ["GET", "/api/admin/analytics/tiers"],
    ["GET", "/api/admin/analytics/models"],
    ["GET", "/api/admin/analytics/unanswered"],
    ["GET", "/api/admin/analytics/people"],
    ["GET", "/api/admin/spaces"],
    ["GET", "/api/admin/audit"],
    ["GET", "/api/admin/audit/actions"],
  ];
  for (const [method, path] of allowed) {
    test(`${method} ${path} is allowed`, async () => {
      const r = await api(method, path, null, subToken);
      assert.equal(r.status, 200, `${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    });
  }
});

describe("everything else in the console is still admin only", () => {
  const refused = [
    ["GET", "/api/admin/settings", null],
    ["PATCH", "/api/admin/settings", { "files.max_mb": 30 }],
    ["GET", "/api/admin/points/rules", null],
    ["PATCH", "/api/admin/points/rules/helpful", { points: 30 }],
    ["GET", "/api/admin/sessions", null],
    ["DELETE", "/api/admin/sessions/1", null],
    ["GET", "/api/admin/versions", null],
    ["POST", "/api/admin/versions", { surface: "web", version: "9.9.9" }],
    ["GET", "/api/admin/quick-links", null],
    ["POST", "/api/admin/quick-links", { label: "x", url: "https://example.com" }],
    ["GET", "/api/admin/reports", null],
    ["GET", "/api/admin/reports/history", null],
    ["GET", "/api/admin/reports/usage_by_person", null],
  ];
  for (const [method, path, body] of refused) {
    test(`${method} ${path} is refused`, async () => {
      const r = await api(method, path, body, subToken);
      assert.equal(r.status, 403, `${path} -> ${r.status}`);
      assert.equal(r.body.error, "forbidden");
    });
  }

  test("a route that nobody listed is refused, so new routes are admin only by default", async () => {
    // /api/admin/analytics/unanswered is listed; a sibling that is not must fail
    // for a sub_admin even though it sits in the same router.
    const r = await api("GET", "/api/admin/analytics/nothing-like-this", null, subToken);
    assert.notEqual(r.status, 200);
  });
});

describe("knowledge and the SME queue", () => {
  test("can read and author documents", async () => {
    const list = await api("GET", "/api/knowledge/docs", null, subToken);
    assert.equal(list.status, 200);

    const draft = await api("POST", "/api/knowledge/docs", {
      title: `Sub admin draft ${stamp}`,
      body: "A draft written by a sub admin, long enough to pass validation.",
      domain: "rcm", sourceKind: "sop",
    }, subToken);
    assert.equal(draft.status, 201);
    assert.equal(draft.body.doc.status, "draft");
  });

  test("cannot publish, import a code set or record a licence", async () => {
    const draft = await api("POST", "/api/knowledge/docs", {
      title: `Sub admin second draft ${stamp}`,
      body: "Another draft, which this person must not be able to publish.",
      domain: "rcm", sourceKind: "sop",
    }, subToken);

    const publish = await api("PUT", `/api/knowledge/docs/${draft.body.doc.id}/status`,
      { status: "published" }, subToken);
    assert.equal(publish.status, 403, "publishing decides what Kody tells people");

    const imported = await api("POST", "/api/knowledge/codesets/CARC/import",
      { csv: "code,description\nCO-999,Invented by a sub admin", dryRun: true }, subToken);
    assert.equal(imported.status, 403);

    const licence = await api("PUT", "/api/knowledge/codesets/CPT/licence",
      { licenceRecorded: true }, subToken);
    assert.equal(licence.status, 403, "a licence record is a contractual claim");
  });

  test("can work the SME queue", async () => {
    const queue = await api("GET", "/api/kody/sme?status=open", null, subToken);
    assert.equal(queue.status, 200);
    assert.ok(Array.isArray(queue.body.items));
  });
});

describe("people, announcements and the digest", () => {
  test("can read the people list", async () => {
    const r = await api("GET", "/api/users/admin/list", null, subToken);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.users));
  });

  test("cannot change roles or deactivate anyone", async () => {
    const roles = await api("PUT", `/api/users/admin/${subUserId}/roles`, { roles: ["admin"] }, subToken);
    assert.equal(roles.status, 403, "otherwise a sub admin could promote themselves");

    const active = await api("PUT", `/api/users/admin/${subUserId}/active`, { isActive: false }, subToken);
    assert.equal(active.status, 403);

    const stillSub = await db.one(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`, [subUserId]);
    assert.equal(stillSub.code, "sub_admin", "and the role did not change");
  });

  test("cannot announce to everyone or trigger the digest", async () => {
    const announce = await api("POST", "/api/notifications/announce",
      { kind: "feature", body: `sub admin announcement ${stamp}` }, subToken);
    assert.equal(announce.status, 403);

    const digest = await api("POST", "/api/notifications/digest/run", null, subToken);
    assert.equal(digest.status, 403);
  });
});

describe("an admin is unaffected", () => {
  test("still reaches the routes a sub_admin cannot", async () => {
    for (const path of ["/api/admin/settings", "/api/admin/points/rules", "/api/admin/sessions",
                        "/api/admin/versions", "/api/admin/quick-links", "/api/admin/reports"]) {
      const r = await api("GET", path, null, adminToken);
      assert.equal(r.status, 200, `${path} -> ${r.status}`);
    }
  });
});
