"use strict";
/**
 * Auth integration tests.
 *
 * These run against a real MySQL-compatible database and a real HTTP server.
 * Nothing is mocked, because the bugs worth catching here live in SQL
 * constraints and transaction behaviour, not in JavaScript.
 *
 *   node --test tests/auth.test.js
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

/* The functional tests share one account, so the per-account login limiter
   would starve them. Raise it here and prove the limiter separately below
   with its own app instance. This must run before config is required. */
process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.AUTH_RATE_TOKEN_MAX = "10000";
process.env.AUTH_RATE_REFRESH_MAX = "10000";

const { createApp } = require("../src/app");
const db = require("../src/db");
const svc = require("../src/services/auth.service");

const REDIRECT = process.env.TEST_REDIRECT || "http://localhost:5173/auth/callback";
const PASSWORD = "Kody!Dev2026";
let base, server, userId;

const api = async (method, path, body, token) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
};

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  const u = await db.one("SELECT id FROM users WHERE email = ?", ["shoban@dolluzcorp.com"]);
  assert.ok(u, "seed user must exist - run the migrations first");
  userId = u.id;
  await svc.setPassword(userId, PASSWORD);
  await db.query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [userId]);
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("health", () => {
  test("responds", async () => {
    const r = await api("GET", "/health");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });
});

describe("login", () => {
  test("rejects a wrong password", async () => {
    const r = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: "wrong-password" });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "invalid_credentials");
  });

  test("gives the same error for an unknown email, so accounts cannot be enumerated", async () => {
    const r = await api("POST", "/api/auth/login", { email: "nobody@dolluzcorp.com", password: "whatever12" });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "invalid_credentials");
  });

  test("accepts correct credentials and returns a token pair", async () => {
    const r = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
    assert.equal(r.status, 200);
    assert.ok(r.body.accessToken, "access token returned");
    assert.ok(r.body.refreshToken, "refresh token returned");
    assert.equal(r.body.user.email, "shoban@dolluzcorp.com");
    assert.ok(Array.isArray(r.body.roles) && r.body.roles.includes("super_admin"));
  });

  test("never returns the password hash", async () => {
    const r = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
    assert.equal(JSON.stringify(r.body).includes("scrypt$"), false);
  });

  test("stores only the hash of the refresh token", async () => {
    const r = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
    const row = await db.one("SELECT refresh_token_hash FROM sessions WHERE id = ?", [r.body.sessionId]);
    assert.ok(row);
    assert.notEqual(row.refresh_token_hash, r.body.refreshToken);
    assert.equal(row.refresh_token_hash.length, 64);
  });
});

describe("protected routes", () => {
  test("rejects a request with no token", async () => {
    const r = await api("GET", "/api/auth/me");
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "missing_token");
  });

  test("rejects a forged token", async () => {
    const r = await api("GET", "/api/auth/me", null, "not.a.real.token");
    assert.equal(r.status, 401);
  });

  test("accepts a valid token", async () => {
    const login = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
    const r = await api("GET", "/api/auth/me", null, login.body.accessToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, "shoban@dolluzcorp.com");
  });

  test("rejects an access token whose session was revoked, without waiting for expiry", async () => {
    const login = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
    const ok = await api("GET", "/api/auth/me", null, login.body.accessToken);
    assert.equal(ok.status, 200);

    await api("POST", "/api/auth/logout", { refresh_token: login.body.refreshToken });

    const after = await api("GET", "/api/auth/me", null, login.body.accessToken);
    assert.equal(after.status, 401);
    assert.equal(after.body.error, "session_revoked");
  });
});

describe("extension handoff", () => {
  test("refuses a redirect URI that is not on the allowlist", async () => {
    const r = await api("POST", "/api/auth/authorize", {
      email: "shoban@dolluzcorp.com", password: PASSWORD,
      state: "abcdefgh12345678", redirect_uri: "https://evil.example.com/steal",
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "bad_redirect_uri");
  });

  test("refuses a missing or short state value", async () => {
    const r = await api("POST", "/api/auth/authorize", {
      email: "shoban@dolluzcorp.com", password: PASSWORD, state: "x", redirect_uri: REDIRECT,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "bad_state");
  });

  test("issues a code, and the code is not a token", async () => {
    const r = await api("POST", "/api/auth/authorize", {
      email: "shoban@dolluzcorp.com", password: PASSWORD,
      state: "abcdefgh12345678", redirect_uri: REDIRECT,
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.code);
    assert.equal(r.body.accessToken, undefined, "no tokens travel through the redirect");
  });

  test("stores only the hash of the code", async () => {
    const r = await api("POST", "/api/auth/authorize", {
      email: "shoban@dolluzcorp.com", password: PASSWORD,
      state: "abcdefgh12345678", redirect_uri: REDIRECT,
    });
    const [rows] = await db.query("SELECT code_hash FROM auth_codes ORDER BY id DESC LIMIT 1");
    assert.notEqual(rows[0].code_hash, r.body.code);
    assert.equal(rows[0].code_hash.length, 64);
  });

  test("exchanges a code for tokens", async () => {
    const a = await api("POST", "/api/auth/authorize", {
      email: "shoban@dolluzcorp.com", password: PASSWORD,
      state: "state-aaaa-1111", redirect_uri: REDIRECT,
    });
    const t = await api("POST", "/api/auth/token", {
      code: a.body.code, state: "state-aaaa-1111", redirect_uri: REDIRECT,
    });
    assert.equal(t.status, 200);
    assert.ok(t.body.accessToken);
    assert.ok(t.body.refreshToken);
    assert.equal(t.body.user.email, "shoban@dolluzcorp.com");
  });

  test("a code works exactly once", async () => {
    const a = await api("POST", "/api/auth/authorize", {
      email: "shoban@dolluzcorp.com", password: PASSWORD,
      state: "state-bbbb-2222", redirect_uri: REDIRECT,
    });
    const first = await api("POST", "/api/auth/token", { code: a.body.code, state: "state-bbbb-2222" });
    assert.equal(first.status, 200);
    const second = await api("POST", "/api/auth/token", { code: a.body.code, state: "state-bbbb-2222" });
    assert.equal(second.status, 400);
    assert.equal(second.body.error, "code_used");
  });

  test("refuses a code redeemed with the wrong state", async () => {
    const a = await api("POST", "/api/auth/authorize", {
      email: "shoban@dolluzcorp.com", password: PASSWORD,
      state: "state-cccc-3333", redirect_uri: REDIRECT,
    });
    const r = await api("POST", "/api/auth/token", { code: a.body.code, state: "attacker-state" });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "state_mismatch");
  });

  test("refuses an invented code", async () => {
    const r = await api("POST", "/api/auth/token", { code: "totally-made-up", state: "whatever" });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid_code");
  });

  test("refuses an expired code", async () => {
    const a = await api("POST", "/api/auth/authorize", {
      email: "shoban@dolluzcorp.com", password: PASSWORD,
      state: "state-dddd-4444", redirect_uri: REDIRECT,
    });
    await db.query("UPDATE auth_codes SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE consumed_at IS NULL");
    const r = await api("POST", "/api/auth/token", { code: a.body.code, state: "state-dddd-4444" });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "code_expired");
  });
});

describe("refresh rotation", () => {
  test("rotates and returns a different refresh token", async () => {
    const login = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
    const r = await api("POST", "/api/auth/refresh", { refresh_token: login.body.refreshToken });
    assert.equal(r.status, 200);
    assert.ok(r.body.accessToken);
    assert.notEqual(r.body.refreshToken, login.body.refreshToken);
  });

  test("the rotated-away token stops working", async () => {
    const login = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
    await api("POST", "/api/auth/refresh", { refresh_token: login.body.refreshToken });
    const replay = await api("POST", "/api/auth/refresh", { refresh_token: login.body.refreshToken });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error, "refresh_reused");
  });

  test("replaying an old token kills every session for that user", async () => {
    const a = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
    const b = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });

    const rotated = await api("POST", "/api/auth/refresh", { refresh_token: a.body.refreshToken });
    assert.equal(rotated.status, 200);

    // the stolen original is replayed
    const replay = await api("POST", "/api/auth/refresh", { refresh_token: a.body.refreshToken });
    assert.equal(replay.status, 401);

    // the unrelated session must also be dead
    const other = await api("GET", "/api/auth/me", null, b.body.accessToken);
    assert.equal(other.status, 401, "all sessions revoked after reuse detection");

    // and so must the freshly rotated one
    const rotatedUse = await api("POST", "/api/auth/refresh", { refresh_token: rotated.body.refreshToken });
    assert.equal(rotatedUse.status, 401);
  });

  test("refuses an expired refresh token", async () => {
    const login = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
    await db.query(
      "UPDATE sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?",
      [login.body.sessionId]
    );
    const r = await api("POST", "/api/auth/refresh", { refresh_token: login.body.refreshToken });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "refresh_expired");
  });
});

describe("session management", () => {
  test("lists live sessions and revokes one remotely", async () => {
    await db.query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [userId]);
    const web = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD, surface: "web" });
    const ext = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD, surface: "extension" });

    const list = await api("GET", "/api/auth/sessions", null, web.body.accessToken);
    assert.equal(list.status, 200);
    assert.ok(list.body.sessions.length >= 2);
    assert.ok(list.body.sessions.some(s => s.surface === "extension"));

    const del = await api("DELETE", `/api/auth/sessions/${ext.body.sessionId}`, null, web.body.accessToken);
    assert.equal(del.status, 200);

    const extNow = await api("GET", "/api/auth/me", null, ext.body.accessToken);
    assert.equal(extNow.status, 401, "revoked surface is signed out immediately");

    const webStill = await api("GET", "/api/auth/me", null, web.body.accessToken);
    assert.equal(webStill.status, 200, "the other surface keeps working");
  });
});

describe("lockout and audit", () => {
  test("locks the account after repeated failures, then reports 429", async () => {
    const email = "gopi@dolluzcorp.com";
    const u = await db.one("SELECT id FROM users WHERE email = ?", [email]);
    await svc.setPassword(u.id, PASSWORD);

    let sawLock = false;
    for (let i = 0; i < 7; i++) {
      const r = await api("POST", "/api/auth/login", { email, password: `bad-password-${i}` });
      if (r.status === 429 && r.body.error === "account_locked") { sawLock = true; break; }
    }
    assert.ok(sawLock, "account locks after repeated failures");

    const good = await api("POST", "/api/auth/login", { email, password: PASSWORD });
    assert.equal(good.status, 429, "correct password is still refused while locked");

    await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?", [u.id]);
    const after = await api("POST", "/api/auth/login", { email, password: PASSWORD });
    assert.equal(after.status, 200, "works again once the lock lifts");
  });

  test("writes an audit row for failures and for sessions", async () => {
    const before = await db.one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.login_failed'");
    await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: "definitely-wrong" });
    const after = await db.one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.login_failed'");
    assert.ok(after.n > before.n, "failed login is audited");

    const reuse = await db.one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.refresh_reuse_detected'");
    assert.ok(reuse.n > 0, "refresh reuse is audited");
  });
});

describe("password hashing", () => {
  test("the same password hashes differently every time", async () => {
    const { hashPassword, verifyPassword } = require("../src/lib/password");
    const a = await hashPassword("SamePassword1");
    const b = await hashPassword("SamePassword1");
    assert.notEqual(a, b, "salted");
    assert.equal(await verifyPassword("SamePassword1", a), true);
    assert.equal(await verifyPassword("SamePassword1", b), true);
    assert.equal(await verifyPassword("WrongPassword1", a), false);
  });

  test("refuses a password under 8 characters", async () => {
    const { hashPassword } = require("../src/lib/password");
    await assert.rejects(() => hashPassword("short"));
  });

  test("verification of a malformed stored hash returns false rather than throwing", async () => {
    const { verifyPassword } = require("../src/lib/password");
    assert.equal(await verifyPassword("anything", "not-a-hash"), false);
    assert.equal(await verifyPassword("anything", null), false);
  });
});

describe("rate limiting", () => {
  test("blocks a burst once the limit is reached", async () => {
    const express = require("express");
    const { rateLimit } = require("../src/middleware/auth");
    const app = express();
    app.use(express.json());
    app.post("/try", rateLimit({ windowMs: 60000, max: 3 }), (req, res) => res.json({ ok: true }));
    const srv = app.listen(0);
    await new Promise(r => srv.once("listening", r));
    const url = `http://127.0.0.1:${srv.address().port}/try`;

    const codes = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      codes.push(res.status);
    }
    srv.close();
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  });

  test("sets the remaining-requests header", async () => {
    const express = require("express");
    const { rateLimit } = require("../src/middleware/auth");
    const app = express();
    app.post("/try", rateLimit({ windowMs: 60000, max: 5 }), (req, res) => res.json({ ok: true }));
    const srv = app.listen(0);
    await new Promise(r => srv.once("listening", r));
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/try`, { method: "POST" });
    srv.close();
    assert.equal(res.headers.get("x-ratelimit-limit"), "5");
    assert.equal(res.headers.get("x-ratelimit-remaining"), "4");
  });
});
