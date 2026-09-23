"use strict";
/**
 * Users, profile, presence, settings, directory and admin.
 * Real database, real HTTP server, no mocks.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.AUTH_RATE_TOKEN_MAX = "10000";
process.env.AUTH_RATE_REFRESH_MAX = "10000";

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");

const PASSWORD = "Kody!Dev2026";
let base, server, adminToken, memberToken, adminId, memberId;

const api = async (method, path, body, token) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

  const admin = await db.one("SELECT id FROM users WHERE email = ?", ["shoban@dolluzcorp.com"]);
  const member = await db.one("SELECT id FROM users WHERE email = ?", ["vignesh@dolluzcorp.com"]);
  adminId = admin.id; memberId = member.id;

  await authSvc.setPassword(adminId, PASSWORD);
  await authSvc.setPassword(memberId, PASSWORD);
  await db.query("UPDATE users SET is_active = 1 WHERE id IN (?,?)", [adminId, memberId]);
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");

  // dAI: this suite edits the member's settings and skills, so restore the
  // seeded state first. Without this the suite only passes once (rule 16).
  await db.query("UPDATE user_settings SET accent = 'gold', wallpaper = 'none', predictive = 1 WHERE user_id = ?", [memberId]);
  await db.query("DELETE FROM user_skills WHERE user_id = ?", [memberId]);
  await db.query(
    `INSERT INTO user_skills (user_id, skill_id)
     SELECT ?, id FROM skills WHERE name IN ('SOC','SIEM','Incident response')`, [memberId]
  );

  const a = await api("POST", "/api/auth/login", { email: "shoban@dolluzcorp.com", password: PASSWORD });
  const m = await api("POST", "/api/auth/login", { email: "vignesh@dolluzcorp.com", password: PASSWORD });
  adminToken = a.body.accessToken;
  memberToken = m.body.accessToken;
  assert.ok(adminToken && memberToken, "both logins must succeed");
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("auth guard", () => {
  test("every user route needs a token", async () => {
    for (const p of ["/api/users/me", "/api/users", "/api/users/me/settings", "/api/users/teams"]) {
      const r = await api("GET", p);
      assert.equal(r.status, 401, `${p} must require auth`);
    }
  });
});

describe("profile", () => {
  test("returns the current user with derived fields", async () => {
    const r = await api("GET", "/api/users/me", null, adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, "shoban@dolluzcorp.com");
    assert.ok(r.body.user.localTime, "local time derived from the timezone");
    assert.ok(Array.isArray(r.body.user.skills));
  });

  test("updates allowed fields", async () => {
    const r = await api("PATCH", "/api/users/me", {
      jobTitle: "Founder and CEO", team: "Delivery",
      workStart: "09:00", workEnd: "18:00", timezone: "Asia/Kolkata",
    }, adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.jobTitle, "Founder and CEO");
    assert.equal(r.body.user.workStart, "09:00:00");
  });

  test("ignores fields that are not on the whitelist", async () => {
    const r = await api("PATCH", "/api/users/me", {
      jobTitle: "Still CEO", isActive: false, email: "attacker@evil.com", id: 999,
    }, adminToken);
    assert.equal(r.status, 200);
    const row = await db.one("SELECT email, is_active FROM users WHERE id = ?", [adminId]);
    assert.equal(row.email, "shoban@dolluzcorp.com", "email cannot be changed here");
    assert.equal(row.is_active, 1, "is_active cannot be changed here");
  });

  test("rejects a bad timezone", async () => {
    const r = await api("PATCH", "/api/users/me", { timezone: "Mars/Olympus" }, adminToken);
    assert.equal(r.status, 400);
    assert.equal(r.body.field, "timezone");
  });

  test("rejects a bad time format", async () => {
    const r = await api("PATCH", "/api/users/me", { workStart: "half past nine" }, adminToken);
    assert.equal(r.status, 400);
    assert.equal(r.body.field, "workStart");
  });

  test("rejects a patch with nothing recognised in it", async () => {
    const r = await api("PATCH", "/api/users/me", { nonsense: 1 }, adminToken);
    assert.equal(r.status, 400);
  });

  test("out of office with a message round-trips", async () => {
    const r = await api("PATCH", "/api/users/me", {
      ooo: true, oooMessage: "Out until Monday. For AR escalations contact Manasi.",
    }, adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.ooo, true);
    const back = await api("PATCH", "/api/users/me", { ooo: false }, adminToken);
    assert.equal(back.body.user.ooo, false);
  });
});

describe("presence and custom status", () => {
  test("sets presence", async () => {
    const r = await api("PUT", "/api/users/me/presence", { presence: "busy" }, adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.presence, "busy");
  });

  test("rejects an unknown presence", async () => {
    const r = await api("PUT", "/api/users/me/presence", { presence: "vibing" }, adminToken);
    assert.equal(r.status, 400);
  });

  test("sets a custom status with an expiry", async () => {
    const r = await api("PUT", "/api/users/me/status", {
      emoji: "\u{1F4DE}", text: "On a payer call", expiresInMinutes: 60,
    }, adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.statusText, "On a payer call");
    assert.ok(r.body.user.statusExpiresAt);
  });

  test("an expired status reads as cleared", async () => {
    await api("PUT", "/api/users/me/status", { emoji: "\u{1F374}", text: "Lunch", expiresInMinutes: 30 }, adminToken);
    await db.query("UPDATE users SET status_expires_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE id = ?", [adminId]);
    const r = await api("GET", "/api/users/me", null, adminToken);
    assert.equal(r.body.user.statusText, null, "expired status is not shown");
    assert.equal(r.body.user.statusEmoji, null);
  });

  test("empty text clears the status", async () => {
    await api("PUT", "/api/users/me/status", { emoji: "\u{1F525}", text: "Heads down", expiresInMinutes: 0 }, adminToken);
    const r = await api("PUT", "/api/users/me/status", { emoji: null, text: null }, adminToken);
    assert.equal(r.body.user.statusText, null);
  });
});

describe("settings", () => {
  test("returns defaults", async () => {
    const r = await api("GET", "/api/users/me/settings", null, memberToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.settings.accent, "gold");
    assert.equal(r.body.settings.predictive, true);
  });

  test("updates accent and wallpaper", async () => {
    const r = await api("PATCH", "/api/users/me/settings", { accent: "teal", wallpaper: "sand" }, memberToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.settings.accent, "teal");
    assert.equal(r.body.settings.wallpaper, "sand");
  });

  test("rejects an accent that does not exist in the client", async () => {
    const r = await api("PATCH", "/api/users/me/settings", { accent: "neon" }, memberToken);
    assert.equal(r.status, 400);
    assert.equal(r.body.field, "accent");
  });

  test("bounds the font scale", async () => {
    assert.equal((await api("PATCH", "/api/users/me/settings", { fontScale: 5 }, memberToken)).status, 400);
    assert.equal((await api("PATCH", "/api/users/me/settings", { fontScale: 1.25 }, memberToken)).status, 200);
  });
});

describe("directory", () => {
  test("lists active users with totals", async () => {
    const r = await api("GET", "/api/users", null, memberToken);
    assert.equal(r.status, 200);
    assert.ok(r.body.total >= 6);
    assert.ok(r.body.users.every(u => u.localTime !== undefined));
  });

  test("searches by name", async () => {
    const r = await api("GET", "/api/users?q=pavithran", null, memberToken);
    // dAI: since Phase 1.1 a real dadmin employee signs in and gets a Kody user,
    // and two people can share part of a name. Assert the seeded user is found,
    // not that nobody else matches.
    assert.ok(r.body.users.length >= 1, "the search finds somebody");
    assert.ok(r.body.users.some(u => u.fullName === "Pavithran R"), "including the seeded user");
  });

  test("searches by skill, which is the v10 behaviour", async () => {
    const r = await api("GET", "/api/users?q=SIEM", null, memberToken);
    assert.equal(r.body.users.length, 1);
    assert.equal(r.body.users[0].fullName, "Vignesh Naidu");
    assert.ok(r.body.users[0].skills.includes("SIEM"));
  });

  test("filters by team", async () => {
    const r = await api("GET", "/api/users?team=RCM%20Operations", null, memberToken);
    assert.ok(r.body.users.length >= 2);
    assert.ok(r.body.users.every(u => u.team === "RCM Operations"));
  });

  test("filters by exact skill", async () => {
    const r = await api("GET", "/api/users?skill=Denials", null, memberToken);
    assert.ok(r.body.users.some(u => u.fullName === "Manasi Rao"));
  });

  test("paginates", async () => {
    const page = await api("GET", "/api/users?limit=2&offset=0", null, memberToken);
    assert.equal(page.body.users.length, 2);
    const next = await api("GET", "/api/users?limit=2&offset=2", null, memberToken);
    assert.notEqual(page.body.users[0].id, next.body.users[0].id);
  });

  test("caps an absurd limit rather than trusting it", async () => {
    const r = await api("GET", "/api/users?limit=99999", null, memberToken);
    assert.equal(r.body.limit, 100);
  });

  test("returns nothing for a nonsense query rather than erroring", async () => {
    const r = await api("GET", "/api/users?q=zzzznotarealperson", null, memberToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.users.length, 0);
  });

  test("lists teams and skills", async () => {
    const t = await api("GET", "/api/users/teams", null, memberToken);
    assert.ok(t.body.teams.some(x => x.team === "Cybersecurity"));
    const s = await api("GET", "/api/users/skills", null, memberToken);
    assert.ok(s.body.skills.some(x => x.name === "Denials"));
  });

  test("fetches one profile by id", async () => {
    const r = await api("GET", `/api/users/${memberId}`, null, adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.fullName, "Vignesh Naidu");
  });

  test("404s for a user that does not exist", async () => {
    const r = await api("GET", "/api/users/999999", null, adminToken);
    assert.equal(r.status, 404);
  });
});

describe("skills", () => {
  test("replaces a user's own skills and creates new ones", async () => {
    const r = await api("PUT", "/api/users/me/skills", { skills: ["SOC", "Threat hunting"] }, memberToken);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.skills.sort(), ["SOC", "Threat hunting"]);
    const found = await api("GET", "/api/users?q=Threat%20hunting", null, memberToken);
    assert.equal(found.body.users.length, 1);
  });

  test("refuses more than twenty", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `skill-${i}`);
    const r = await api("PUT", "/api/users/me/skills", { skills: many }, memberToken);
    assert.equal(r.status, 400);
  });
});

describe("quick links", () => {
  test("lists the Kody team defaults", async () => {
    const r = await api("GET", "/api/users/me/quick-links", null, memberToken);
    assert.equal(r.status, 200);
    assert.ok(r.body.links.some(l => l.isDefault && l.label === "X12 denial codes"));
  });

  test("adds a personal link", async () => {
    const r = await api("POST", "/api/users/me/quick-links",
      { label: "My payer matrix", url: "https://dai.dolluzcorp.com/matrix" }, memberToken);
    assert.equal(r.status, 201);
    assert.equal(r.body.link.label, "My payer matrix");
  });

  test("rejects a url that is not http", async () => {
    const r = await api("POST", "/api/users/me/quick-links",
      { label: "Bad", url: "javascript:alert(1)" }, memberToken);
    assert.equal(r.status, 400);
  });

  test("one user cannot delete another user's link", async () => {
    const mine = await api("POST", "/api/users/me/quick-links",
      { label: "Private note", url: "https://example.com/mine" }, memberToken);
    const attempt = await api("DELETE", `/api/users/me/quick-links/${mine.body.link.id}`, null, adminToken);
    assert.equal(attempt.status, 404, "not found, because it is not theirs");

    const still = await api("GET", "/api/users/me/quick-links", null, memberToken);
    assert.ok(still.body.links.some(l => l.id === mine.body.link.id), "link survives");

    const own = await api("DELETE", `/api/users/me/quick-links/${mine.body.link.id}`, null, memberToken);
    assert.equal(own.status, 200);
  });

  test("cannot delete a Kody team default", async () => {
    const list = await api("GET", "/api/users/me/quick-links", null, memberToken);
    const def = list.body.links.find(l => l.isDefault);
    const r = await api("DELETE", `/api/users/me/quick-links/${def.id}`, null, memberToken);
    assert.equal(r.status, 404);
  });
});

describe("admin", () => {
  test("a member cannot reach admin routes", async () => {
    const r = await api("GET", "/api/users/admin/list", null, memberToken);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "forbidden");
  });

  test("an admin can list users with their roles", async () => {
    const r = await api("GET", "/api/users/admin/list", null, adminToken);
    assert.equal(r.status, 200);
    const me = r.body.users.find(u => u.id === adminId);
    assert.ok(me.roles.includes("super_admin"));
  });

  test("a member cannot change roles", async () => {
    const r = await api("PUT", `/api/users/admin/${memberId}/roles`, { roles: ["admin"] }, memberToken);
    assert.equal(r.status, 403);
  });

  test("an admin can change roles, and it is audited", async () => {
    const before = await db.one("SELECT COUNT(*) AS n FROM audit_log WHERE action='user.roles_changed'");
    const r = await api("PUT", `/api/users/admin/${memberId}/roles`, { roles: ["coordinator"] }, adminToken);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.roles, ["coordinator"]);
    const after = await db.one("SELECT COUNT(*) AS n FROM audit_log WHERE action='user.roles_changed'");
    assert.ok(after.n > before.n);
  });

  test("rejects a role that does not exist", async () => {
    const r = await api("PUT", `/api/users/admin/${memberId}/roles`, { roles: ["overlord"] }, adminToken);
    assert.equal(r.status, 400);
  });

  test("deactivating a user kills their sessions immediately", async () => {
    const login = await api("POST", "/api/auth/login", { email: "vignesh@dolluzcorp.com", password: PASSWORD });
    const ok = await api("GET", "/api/users/me", null, login.body.accessToken);
    assert.equal(ok.status, 200);

    const off = await api("PUT", `/api/users/admin/${memberId}/active`, { isActive: false }, adminToken);
    assert.equal(off.status, 200);

    const after = await api("GET", "/api/users/me", null, login.body.accessToken);
    assert.equal(after.status, 401, "access stops at once, not when the token expires");

    const cannotLogin = await api("POST", "/api/auth/login", { email: "vignesh@dolluzcorp.com", password: PASSWORD });
    assert.equal(cannotLogin.status, 403);

    await api("PUT", `/api/users/admin/${memberId}/active`, { isActive: true }, adminToken);
    const back = await api("POST", "/api/auth/login", { email: "vignesh@dolluzcorp.com", password: PASSWORD });
    assert.equal(back.status, 200);
    memberToken = back.body.accessToken;
  });

  test("an admin cannot deactivate themselves and lock everyone out", async () => {
    const r = await api("PUT", `/api/users/admin/${adminId}/active`, { isActive: false }, adminToken);
    assert.equal(r.status, 400);
    const still = await api("GET", "/api/users/me", null, adminToken);
    assert.equal(still.status, 200);
  });

  test("a deactivated user disappears from the directory", async () => {
    await api("PUT", `/api/users/admin/${memberId}/active`, { isActive: false }, adminToken);
    const dir = await api("GET", "/api/users?q=vignesh", null, adminToken);
    assert.equal(dir.body.users.length, 0);
    await api("PUT", `/api/users/admin/${memberId}/active`, { isActive: true }, adminToken);
  });
});
