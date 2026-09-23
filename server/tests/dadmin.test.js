"use strict";
/**
 * The dAdmin link (docs/PHASES.md 1.1).
 *
 * dadmin is read only for dAI, and CI has no dadmin database at all, so these
 * tests replace the two reader functions with a fake employee table and let
 * everything else run for real: bcrypt, the Kody user creation, the roles, the
 * session, and the refresh re-check.
 *
 * Every employee here is created by the test with a unique emp_id and email,
 * so the suite passes twice against the same database (module rule 16).
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcryptjs");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.AUTH_RATE_REFRESH_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";

const { createApp } = require("../src/app");
const db = require("../src/db");
const config = require("../src/config");
const authSvc = require("../src/services/auth.service");
const dadmin = require("../src/services/dadmin.service");

const LOCAL_PASSWORD = "Kody!Dev2026";
const DADMIN_PASSWORD = "Dadmin!Test2026";
let server, base, hash;

const stamp = Date.now().toString(36);
let counter = 0;

/* The fake dadmin.employee table. Keyed by email, as the real query is. */
const employees = new Map();
const realFindByEmail = dadmin.findEmployeeByEmail;
const realFindByEmpId = dadmin.findEmployeeByEmpId;

const employee = (over = {}) => {
  counter += 1;
  const row = {
    empId: `T${stamp}${counter}`.slice(0, 20),
    email: `dadmin-${stamp}-${counter}@example.com`,
    passwordHash: hash,
    firstName: "Test",
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

const api = async (method, p, body, token) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
};

const rolesOf = async (userId) => {
  const [rows] = await db.query(
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`, [userId]
  );
  return rows.map(r => r.code).sort();
};

before(async () => {
  // One bcrypt hash for the whole suite: at cost 10 each one costs real time.
  hash = bcrypt.hashSync(DADMIN_PASSWORD, 10);

  dadmin.findEmployeeByEmail = async (email) => employees.get(String(email || "").trim()) || null;
  dadmin.findEmployeeByEmpId = async (empId) =>
    [...employees.values()].find(e => e.empId === String(empId || "").trim()) || null;

  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  const local = await db.one("SELECT id FROM users WHERE email = ?", ["gopi@dolluzcorp.com"]);
  await authSvc.setPassword(local.id, LOCAL_PASSWORD);
  await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [local.id]);
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");
});

after(async () => {
  dadmin.findEmployeeByEmail = realFindByEmail;
  dadmin.findEmployeeByEmpId = realFindByEmpId;
  config.env = "development";
  server.close();
  await db.pool.end();
});

describe("access level to role", () => {
  test("Admin, Sub Admin and everyone else map to a Kody role", () => {
    assert.equal(dadmin.roleForAccessLevel("Admin"), "admin");
    assert.equal(dadmin.roleForAccessLevel("Sub Admin"), "sub_admin");
    assert.equal(dadmin.roleForAccessLevel("sub-admin"), "sub_admin");
    assert.equal(dadmin.roleForAccessLevel("Manager"), "member");
    assert.equal(dadmin.roleForAccessLevel("User"), "member");
    assert.equal(dadmin.roleForAccessLevel(null), "member");
  });
});

describe("signing in with dAdmin credentials", () => {
  test("creates the Kody user on first sign-in, with emp_id and the mapped role", async () => {
    const emp = employee({ accessLevel: "Admin", firstName: "Ada", lastName: "Admin" });

    const before_ = await db.one("SELECT id FROM users WHERE emp_id = ?", [emp.empId]);
    assert.equal(before_, null, "nobody created this user by hand");

    const r = await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });
    assert.equal(r.status, 200);
    assert.ok(r.body.accessToken && r.body.refreshToken);
    assert.equal(r.body.user.email, emp.email);
    assert.equal(r.body.user.fullName, "Ada Admin");
    assert.deepEqual(r.body.roles, ["admin"], "dAdmin Admin starts as a Kody admin");

    const row = await db.one(
      "SELECT id, emp_id AS empId, full_name AS fullName, initials, is_active AS isActive FROM users WHERE emp_id = ?",
      [emp.empId]
    );
    assert.ok(row, "the Kody user was created by signing in");
    assert.equal(row.empId, emp.empId);
    assert.equal(row.initials, "AA");
    assert.equal(row.isActive, 1);
    assert.deepEqual(await rolesOf(row.id), ["admin"]);

    const me = await api("GET", "/api/auth/me", null, r.body.accessToken);
    assert.equal(me.status, 200, "the issued token works like any other");
  });

  test("a Sub Admin starts as sub_admin, everyone else as member", async () => {
    const sub = employee({ accessLevel: "Sub Admin" });
    const plain = employee({ accessLevel: "Manager" });

    const a = await api("POST", "/api/auth/login", { email: sub.email, password: DADMIN_PASSWORD });
    const b = await api("POST", "/api/auth/login", { email: plain.email, password: DADMIN_PASSWORD });
    assert.deepEqual(a.body.roles, ["sub_admin"]);
    assert.deepEqual(b.body.roles, ["member"]);
  });

  test("signing in twice reuses the same Kody user", async () => {
    const emp = employee();
    await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });
    await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });

    const rows = await db.one("SELECT COUNT(*) AS n FROM users WHERE emp_id = ?", [emp.empId]);
    assert.equal(Number(rows.n), 1, "one employee, one Kody user");
  });

  test("a role edited in dAI is never overwritten by a later sign-in", async () => {
    const emp = employee({ accessLevel: "Admin" });
    const first = await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });
    assert.deepEqual(first.body.roles, ["admin"]);

    const user = await db.one("SELECT id FROM users WHERE emp_id = ?", [emp.empId]);
    await db.query("DELETE FROM user_roles WHERE user_id = ?", [user.id]);
    await db.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'coordinator'", [user.id]
    );

    const again = await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });
    assert.deepEqual(again.body.roles, ["coordinator"], "dAI owns the role after the first sign-in");
    assert.deepEqual(await rolesOf(user.id), ["coordinator"]);
  });

  test("adopts an existing Kody user with the same email rather than failing", async () => {
    const emp = employee({ firstName: "Older", lastName: "Account" });
    const [res] = await db.query(
      "INSERT INTO users (email, full_name, initials, is_active) VALUES (?,?,?,1)",
      [emp.email, "Older Account", "OA"]
    );
    const existingId = res.insertId;
    await db.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'coordinator'", [existingId]
    );

    const r = await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.id, existingId, "the same row, now linked");
    assert.deepEqual(r.body.roles, ["coordinator"], "adoption does not touch roles");

    const row = await db.one("SELECT emp_id AS empId FROM users WHERE id = ?", [existingId]);
    assert.equal(row.empId, emp.empId);
  });

  test("refuses a wrong password, with the same answer as an unknown account", async () => {
    const emp = employee();
    const wrong = await api("POST", "/api/auth/login", { email: emp.email, password: "not-the-password" });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, "invalid_credentials");

    const unknown = await api("POST", "/api/auth/login",
      { email: `nobody-${stamp}@example.com`, password: "not-the-password" });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, "invalid_credentials");
    assert.equal(wrong.body.message, unknown.body.message, "the two are indistinguishable");

    const created = await db.one("SELECT id FROM users WHERE emp_id = ?", [emp.empId]);
    assert.equal(created, null, "a failed sign-in creates nobody");
  });

  test("app_dAI = 0 is refused even with the right password", async () => {
    const emp = employee({ appDai: 0 });
    const r = await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "dai_not_enabled");

    const created = await db.one("SELECT id FROM users WHERE emp_id = ?", [emp.empId]);
    assert.equal(created, null, "no Kody user is created for someone who may not use dAI");
  });

  test("an inactive or deleted employee is refused", async () => {
    const inactive = employee({ active: 0 });
    const deleted = employee({ deletedTime: new Date() });

    assert.equal((await api("POST", "/api/auth/login",
      { email: inactive.email, password: DADMIN_PASSWORD })).status, 403);
    assert.equal((await api("POST", "/api/auth/login",
      { email: deleted.email, password: DADMIN_PASSWORD })).status, 403);
  });

  test("two employees cannot take over each other's work email", async () => {
    const first = employee();
    await api("POST", "/api/auth/login", { email: first.email, password: DADMIN_PASSWORD });

    const impostor = employee({ email: first.email });
    employees.set(first.email, impostor);          // dadmin now answers with a different emp_id
    const r = await api("POST", "/api/auth/login", { email: first.email, password: DADMIN_PASSWORD });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "email_belongs_to_another_employee");
    employees.set(first.email, first);
  });
});

describe("local Kody passwords", () => {
  test("still work in development for a user dAdmin does not have", async () => {
    const r = await api("POST", "/api/auth/login",
      { email: "gopi@dolluzcorp.com", password: LOCAL_PASSWORD });
    assert.equal(r.status, 200, "the seed users can still sign in while developing");
  });

  test("are refused in production, where dAdmin is the only way in", async () => {
    config.env = "production";
    try {
      const r = await api("POST", "/api/auth/login",
        { email: "gopi@dolluzcorp.com", password: LOCAL_PASSWORD });
      assert.equal(r.status, 401);
      assert.equal(r.body.error, "invalid_credentials");
    } finally {
      config.env = "development";
    }

    const back = await api("POST", "/api/auth/login",
      { email: "gopi@dolluzcorp.com", password: LOCAL_PASSWORD });
    assert.equal(back.status, 200, "and works again outside production");
  });
});

describe("refresh re-checks dAdmin", () => {
  test("rotates as usual while the employee still has access", async () => {
    const emp = employee();
    const login = await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });
    const r = await api("POST", "/api/auth/refresh", { refresh_token: login.body.refreshToken });
    assert.equal(r.status, 200);
    assert.ok(r.body.accessToken);
  });

  test("turning app_dAI off in dAdmin ends the session on the next refresh", async () => {
    const emp = employee();
    const login = await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });
    assert.equal(login.status, 200);

    const ok = await api("GET", "/api/auth/me", null, login.body.accessToken);
    assert.equal(ok.status, 200);

    emp.appDai = 0;                                 // the toggle in dAdmin App Configuration

    const refused = await api("POST", "/api/auth/refresh", { refresh_token: login.body.refreshToken });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "dai_not_enabled");

    const after = await api("GET", "/api/auth/me", null, login.body.accessToken);
    assert.equal(after.status, 401, "every live session for that person is revoked, not just this one");

    const rows = await db.one(
      `SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE u.emp_id = ? AND s.revoked_at IS NULL`, [emp.empId]
    );
    assert.equal(Number(rows.n), 0);

    const audit = await db.one(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.dadmin_access_revoked'`
    );
    assert.ok(Number(audit.n) > 0, "the revocation is audited");
  });

  test("deactivating the employee ends it the same way", async () => {
    const emp = employee();
    const login = await api("POST", "/api/auth/login", { email: emp.email, password: DADMIN_PASSWORD });
    emp.active = 0;
    const refused = await api("POST", "/api/auth/refresh", { refresh_token: login.body.refreshToken });
    assert.equal(refused.status, 403);
  });

  test("a seed user with no emp_id refreshes without asking dAdmin anything", async () => {
    const login = await api("POST", "/api/auth/login",
      { email: "gopi@dolluzcorp.com", password: LOCAL_PASSWORD });
    let asked = false;
    const patched = dadmin.findEmployeeByEmpId;
    dadmin.findEmployeeByEmpId = async (id) => { asked = true; return patched(id); };
    try {
      const r = await api("POST", "/api/auth/refresh", { refresh_token: login.body.refreshToken });
      assert.equal(r.status, 200);
      assert.equal(asked, false, "no emp_id means no dadmin lookup");
    } finally {
      dadmin.findEmployeeByEmpId = patched;
    }
  });
});

describe("forgot password", () => {
  test("points at dAdmin and says the same thing for any address", async () => {
    const known = employee();
    const a = await api("POST", "/api/auth/forgot-password", { email: known.email });
    const b = await api("POST", "/api/auth/forgot-password", { email: `nobody-${stamp}@example.com` });

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(a.body, b.body, "no way to tell whether an account exists");
    assert.match(a.body.message, /dAdmin/, "it names where the password lives");
    assert.equal("resetUrl" in a.body, true);
  });
});

describe("the dadmin reader itself", () => {
  test("refuses a database name that is not a plain identifier", async () => {
    const patched = dadmin.findEmployeeByEmail;
    dadmin.findEmployeeByEmail = realFindByEmail;
    const original = config.dadmin.dbName;
    config.dadmin.dbName = "dadmin`; DROP TABLE users; --";
    try {
      await assert.rejects(
        () => dadmin.findEmployeeByEmail("someone@example.com"),
        (err) => err.code === "bad_dadmin_db"
      );
    } finally {
      config.dadmin.dbName = original;
      dadmin.findEmployeeByEmail = patched;
    }
  });

  test("reads only $2 bcrypt hashes, and never treats a blank one as a match", async () => {
    assert.equal(await dadmin.verifyEmployeePassword("anything", null), false);
    assert.equal(await dadmin.verifyEmployeePassword("anything", ""), false);
    assert.equal(await dadmin.verifyEmployeePassword("anything", "not-a-hash"), false);
    assert.equal(await dadmin.verifyEmployeePassword("", hash), false);
    assert.equal(await dadmin.verifyEmployeePassword(DADMIN_PASSWORD, hash), true);
  });

  test("asks dadmin for the nine granted columns only", () => {
    const allowed = ["emp_id", "emp_mail_id", "account_pass", "emp_first_name", "emp_last_name",
                     "emp_access_level", "active", "deleted_time", "app_dAI"];
    // Read the source column out of each "column AS alias" pair.
    const columns = dadmin.EMPLOYEE_COLUMNS.split(",")
      .map(part => part.trim()).filter(Boolean)
      .map(part => part.split(/\s+AS\s+/i)[0].trim());
    assert.equal(columns.length, 9, "nine columns, matching the grant");
    for (const c of columns) {
      assert.ok(allowed.some(a => a.toLowerCase() === c.toLowerCase()),
        `${c} is not one of the granted columns`);
    }
    for (const forbidden of ["account_pass_text", "bank_account_number", "aadhar_number", "pan_number"]) {
      assert.ok(!dadmin.EMPLOYEE_COLUMNS.includes(forbidden), `${forbidden} must never be selected`);
    }
  });
});
