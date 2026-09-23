"use strict";
/**
 * Service tokens from the dAdmin console (docs/PHASES.md 1.2).
 *
 * The tokens are real: signed here with the configured shared secret exactly as
 * dAdmin would sign them. dadmin.employee is read only for dAI, and CI has no
 * dadmin database, so the two reader functions are replaced by a fake employee
 * table; everything else runs for real.
 *
 * What these tests are really about is the whitelist. A service token is a key
 * to the admin surface, and it must open nothing else.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.KODY_RATE_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";
process.env.DADMIN_SHARED_JWT_SECRET = "test-dadmin-shared-secret-" + Date.now();

const { createApp } = require("../src/app");
const db = require("../src/db");
const config = require("../src/config");
const dadmin = require("../src/services/dadmin.service");
const { AUDIENCE } = require("../src/middleware/dadmin-service");

const SECRET = config.dadmin.sharedJwtSecret;
const stamp = Date.now().toString(36);
let counter = 0;
let server, base, adminEmp, memberEmp, userToken;

const employees = new Map();
const realFindByEmail = dadmin.findEmployeeByEmail;
const realFindByEmpId = dadmin.findEmployeeByEmpId;

const employee = (over = {}) => {
  counter += 1;
  const row = {
    empId: `S${stamp}${counter}`.slice(0, 20),
    email: `service-${stamp}-${counter}@example.com`,
    passwordHash: bcrypt.hashSync("Service!Test2026", 10),
    firstName: "Service",
    lastName: `Person ${counter}`,
    accessLevel: "User",
    active: 1,
    deletedTime: null,
    appDai: 1,
    ...over,
  };
  employees.set(row.email, row);
  return row;
};

/** A token shaped exactly as dAdmin's proxy route signs it. */
const serviceToken = (empId, over = {}) => jwt.sign(
  { emp_id: empId, aud: AUDIENCE, ...(over.claims || {}) },
  over.secret || SECRET,
  { expiresIn: over.expiresIn === undefined ? 60 : over.expiresIn }
);

const call = async (method, p, token, body) => {
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
  dadmin.findEmployeeByEmail = async (email) => employees.get(String(email || "").trim()) || null;
  dadmin.findEmployeeByEmpId = async (empId) =>
    [...employees.values()].find(e => e.empId === String(empId || "").trim()) || null;

  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  adminEmp = employee({ accessLevel: "Admin" });
  memberEmp = employee({ accessLevel: "User" });

  // A real Kody user token, to prove the whitelisted routes still work as before.
  const authSvc = require("../src/services/auth.service");
  const seed = await db.one("SELECT id FROM users WHERE email = ?", ["shoban@dolluzcorp.com"]);
  await authSvc.setPassword(seed.id, "Kody!Dev2026");
  await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [seed.id]);
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");
  const login = await call("POST", "/api/auth/login", null,
    { email: "shoban@dolluzcorp.com", password: "Kody!Dev2026" });
  userToken = login.body.accessToken;
  assert.ok(userToken, "the seed admin must be able to sign in");
});

after(async () => {
  dadmin.findEmployeeByEmail = realFindByEmail;
  dadmin.findEmployeeByEmpId = realFindByEmpId;
  server.close();
  await db.pool.end();
});

describe("a valid service token", () => {
  test("reaches the admin console API and acts as that employee", async () => {
    const r = await call("GET", "/api/admin/overview", serviceToken(adminEmp.empId));
    assert.equal(r.status, 200);
    assert.ok("activeUsers" in r.body, "a real overview, not an empty shell");

    const user = await db.one("SELECT id FROM users WHERE emp_id = ?", [adminEmp.empId]);
    assert.ok(user, "an administrator who never opened dAI is created on first service call");
  });

  test("works on every whitelisted path", async () => {
    const token = () => serviceToken(adminEmp.empId);
    const checks = [
      ["GET", "/api/admin/settings"],
      ["GET", "/api/knowledge/docs"],
      ["GET", "/api/kody/sme?status=open"],
      ["GET", "/api/users/admin/list"],
    ];
    for (const [method, path] of checks) {
      const r = await call(method, path, token());
      assert.equal(r.status, 200, `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    }
    const announced = await call("POST", "/api/notifications/announce", token(),
      { kind: "feature", title: "Service", body: `announced by a service token ${stamp}` });
    assert.equal(announced.status, 200);
    assert.ok(announced.body.sent > 0);
  });

  test("still obeys the roles the person has in dAI", async () => {
    const r = await call("GET", "/api/admin/overview", serviceToken(memberEmp.empId));
    assert.equal(r.status, 403, "a member in dAI is still a member when dAdmin calls on their behalf");
    assert.equal(r.body.error, "forbidden");
  });
});

describe("the whitelist", () => {
  test("a service token opens nothing outside it", async () => {
    const token = () => serviceToken(adminEmp.empId);
    const refused = [
      ["GET", "/api/conversations"],
      ["GET", "/api/users/me"],
      ["GET", "/api/search?q=test"],
      ["POST", "/api/kody/ask"],
      ["GET", "/api/notifications"],
      ["PUT", "/api/notifications/read-all"],
      ["GET", "/api/auth/sessions"],
    ];
    for (const [method, path] of refused) {
      const r = await call(method, path, token(), method === "POST" ? { question: "CO-45" } : undefined);
      assert.equal(r.status, 401, `${method} ${path} must refuse a service token, got ${r.status}`);
    }
  });

  test("the announce whitelist is that one route, not the notifications router", async () => {
    const ok = await call("POST", "/api/notifications/announce", serviceToken(adminEmp.empId),
      { kind: "update", body: `second announcement ${stamp}` });
    assert.equal(ok.status, 200);

    const not = await call("GET", "/api/notifications/digest/preview", serviceToken(adminEmp.empId));
    assert.equal(not.status, 401);
  });

  test("ordinary user tokens still work on the whitelisted routes", async () => {
    const r = await call("GET", "/api/admin/overview", userToken);
    assert.equal(r.status, 200, "the console's own sign-in path is unaffected");
  });
});

describe("a service token that is not valid", () => {
  test("signed with the wrong secret is refused", async () => {
    const r = await call("GET", "/api/admin/overview",
      serviceToken(adminEmp.empId, { secret: "not-the-shared-secret" }));
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "service_token_invalid");
  });

  test("with the wrong audience is refused", async () => {
    const wrongAud = jwt.sign({ emp_id: adminEmp.empId, aud: "kody-api" }, SECRET, { expiresIn: 60 });
    const r = await call("GET", "/api/admin/overview", wrongAud);
    assert.equal(r.status, 401, "aud is what tells a service token from anything else");
  });

  test("that has expired is refused", async () => {
    const r = await call("GET", "/api/admin/overview",
      serviceToken(adminEmp.empId, { expiresIn: -30 }));
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "service_token_expired");
  });

  test("issued long ago is refused even if it says it lasts for hours", async () => {
    const old = jwt.sign(
      { emp_id: adminEmp.empId, aud: AUDIENCE, iat: Math.floor(Date.now() / 1000) - 3600 },
      SECRET, { expiresIn: "6h" }
    );
    const r = await call("GET", "/api/admin/overview", old);
    assert.equal(r.status, 401, "maxAge bounds it independently of exp");
    assert.equal(r.body.error, "service_token_expired");
  });

  test("with no emp_id, or an absurd one, is refused", async () => {
    const none = jwt.sign({ aud: AUDIENCE }, SECRET, { expiresIn: 60 });
    assert.equal((await call("GET", "/api/admin/overview", none)).status, 401);

    const huge = serviceToken("X".repeat(64));
    assert.equal((await call("GET", "/api/admin/overview", huge)).status, 401);
  });

  test("for an employee dAdmin does not have is refused", async () => {
    const r = await call("GET", "/api/admin/overview", serviceToken("NOSUCHEMP"));
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "unknown_employee");
  });

  test("for an employee whose dAI access was turned off is refused", async () => {
    const off = employee({ accessLevel: "Admin", appDai: 0 });
    const r = await call("GET", "/api/admin/overview", serviceToken(off.empId));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "dai_not_enabled");

    const created = await db.one("SELECT id FROM users WHERE emp_id = ?", [off.empId]);
    assert.equal(created, null, "and creates nobody");
  });

  test("a dAI user access token is not a service token", async () => {
    // Signed with the dAI access secret, so it must not be accepted as one,
    // and it must still work as the user token it is.
    const r = await call("GET", "/api/admin/overview", userToken);
    assert.equal(r.status, 200);
  });
});
