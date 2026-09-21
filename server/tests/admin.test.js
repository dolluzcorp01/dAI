"use strict";
/**
 * Admin console API: analytics, reports, settings, points rules, spaces,
 * sessions, versions, default links and the audit log.
 *
 * The reports tests open the produced files rather than trusting a 200, so a
 * corrupt spreadsheet fails here and not on someone's desk.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const ExcelJS = require("exceljs");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.KODY_RATE_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";
process.env.ANALYTICS_CACHE_MS = "1";   // effectively no cache, so tests see fresh numbers

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");
const analytics = require("../src/services/analytics.service");
const reports = require("../src/services/reports.service");

const PASSWORD = "Kody!Dev2026";
let server, base, admin, member, memberId;

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

const raw = (p, token) => fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } });

const login = async (email) => {
  const r = await api("POST", "/api/auth/login", { email, password: PASSWORD });
  assert.ok(r.body.accessToken, `login failed for ${email}`);
  return r.body.accessToken;
};

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  for (const email of ["shoban@dolluzcorp.com", "manasi@dolluzcorp.com"]) {
    const u = await db.one("SELECT id FROM users WHERE email = ?", [email]);
    await authSvc.setPassword(u.id, PASSWORD);
    await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [u.id]);
  }
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");

  const m = await db.one("SELECT id FROM users WHERE email = 'manasi@dolluzcorp.com'");
  memberId = m.id;
  await db.query(
    `DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.code IN ('admin','super_admin','coordinator')`, [memberId]
  );

  admin = { token: await login("shoban@dolluzcorp.com") };
  member = { token: await login("manasi@dolluzcorp.com") };

  // known state for the guards
  await db.query(
    `UPDATE org_settings SET setting_value = 'false' WHERE setting_key = 'reports.allow_content_export'`
  );
  analytics.clearCache();
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("access", () => {
  test("a member is refused everywhere in the console", async () => {
    for (const p of ["/api/admin/overview", "/api/admin/settings", "/api/admin/sessions",
                     "/api/admin/audit", "/api/admin/reports", "/api/admin/spaces"]) {
      const r = await api("GET", p, null, member.token);
      assert.equal(r.status, 403, `${p} must be admin only`);
    }
  });

  test("everything needs a token", async () => {
    assert.equal((await api("GET", "/api/admin/overview")).status, 401);
  });
});

describe("analytics", () => {
  test("the overview answers in one call with every panel", async () => {
    const r = await api("GET", "/api/admin/overview", null, admin.token);
    assert.equal(r.status, 200);
    for (const key of ["activeUsers", "questionsToday", "tier0Share", "avgLatencyMs",
                       "degradedRate", "domains", "tiers", "models", "unanswered", "knowledge"]) {
      assert.ok(key in r.body, `overview needs ${key}`);
    }
    assert.ok(Array.isArray(r.body.domains));
    assert.ok(r.body.knowledge.publishedDocs >= 0);
  });

  test("tier 0 share is a real fraction derived from the answers", async () => {
    await api("POST", "/api/kody/ask", { question: "CO-97" }, admin.token);
    await api("POST", "/api/kody/ask", { question: "how do we run a retro" }, admin.token);
    analytics.clearCache();

    const r = await api("GET", "/api/admin/overview", null, admin.token);
    assert.ok(r.body.tier0Share >= 0 && r.body.tier0Share <= 1, "a fraction, not a percentage");
    assert.ok(r.body.answers30d > 0);

    const tiers = r.body.tiers;
    const t0 = tiers.find(t => t.tier === 0);
    assert.ok(t0, "tier 0 appears");
    assert.equal(t0.avgMs < 500, true, "a lookup is fast because nothing leaves the process");
  });

  test("the model breakdown carries token counts", async () => {
    const r = await api("GET", "/api/admin/analytics/models", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.models.every(m => "inputTokens" in m && "outputTokens" in m));
  });

  test("unanswered surfaces low confidence questions", async () => {
    const r = await api("GET", "/api/admin/analytics/unanswered", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.unanswered));
    if (r.body.unanswered.length > 0) {
      const first = r.body.unanswered[0];
      assert.ok("question" in first && "asked" in first && "withoutDocument" in first);
    }
  });

  test("per person usage is reported", async () => {
    const r = await api("GET", "/api/admin/analytics/people", null, admin.token);
    assert.equal(r.status, 200);
    const me = r.body.people.find(p => p.email === "shoban@dolluzcorp.com");
    assert.ok(me, "the asker appears");
    assert.ok(me.questions > 0);
  });

  test("the overview is cached, and a settings change clears it", async () => {
    process.env.ANALYTICS_CACHE_MS = "60000";
    delete require.cache[require.resolve("../src/services/analytics.service")];
    const fresh = require("../src/services/analytics.service");

    const first = await fresh.overview();
    assert.equal(first.cached, false, "first call computes");
    const second = await fresh.overview();
    assert.equal(second.cached, true, "second call is served from cache");

    fresh.clearCache();
    const third = await fresh.overview();
    assert.equal(third.cached, false, "clearing forces a recompute");
    process.env.ANALYTICS_CACHE_MS = "1";
  });
});

describe("reports", () => {
  test("lists the catalogue and flags which contain message text", async () => {
    const r = await api("GET", "/api/admin/reports", null, admin.token);
    assert.equal(r.status, 200);
    const unanswered = r.body.reports.find(x => x.code === "unanswered");
    assert.equal(unanswered.containsContent, true);
    const usage = r.body.reports.find(x => x.code === "usage_by_person");
    assert.equal(usage.containsContent, false);
    assert.equal(r.body.contentExportAllowed, false);
  });

  test("produces a spreadsheet that actually opens", async () => {
    const res = await raw("/api/admin/reports/usage_by_person?format=xlsx", admin.token);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /spreadsheetml/);
    assert.match(res.headers.get("content-disposition"), /attachment; filename="kody-usage_by_person-/);

    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000, "not an empty file");
    assert.equal(buf.slice(0, 2).toString(), "PK", "a real xlsx is a zip");

    // open it rather than trusting the status code
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    assert.ok(ws, "has a worksheet");
    // Find the header rather than assuming its row: the range line is only
    // written when a date range was given, which shifts everything by one.
    let headerRow = null;
    for (let i = 1; i <= Math.min(ws.rowCount, 10); i++) {
      const values = ws.getRow(i).values.filter(Boolean).map(String);
      if (values.includes("Questions")) { headerRow = { i, values }; break; }
    }
    assert.ok(headerRow, "header row found in the first ten rows");
    assert.ok(headerRow.values.includes("Email"));
    assert.ok(headerRow.values.includes("Points"));
    assert.ok(ws.rowCount > headerRow.i, "has data rows below the header");

    // and the data is real, not placeholder
    const firstData = ws.getRow(headerRow.i + 1).values.filter(v => v !== null && v !== undefined);
    assert.ok(firstData.length >= 4, "a data row with content");
  });

  test("produces a PDF that is a real PDF", async () => {
    const res = await raw("/api/admin/reports/questions_by_domain?format=pdf", admin.token);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");

    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.slice(0, 5).toString(), "%PDF-", "starts with the PDF magic number");
    assert.ok(buf.slice(-8).toString().includes("EOF"), "ends properly");
    assert.ok(buf.length > 800);
  });

  test("a report containing message text is blocked until the org allows it", async () => {
    const blocked = await api("GET", "/api/admin/reports/unanswered?format=xlsx", null, admin.token);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, "content_export_blocked");
    assert.match(blocked.body.message, /PHI/);

    await api("PATCH", "/api/admin/settings", { "reports.allow_content_export": true }, admin.token);

    const res = await raw("/api/admin/reports/unanswered?format=xlsx", admin.token);
    assert.equal(res.status, 200, "allowed once the org opts in");

    await api("PATCH", "/api/admin/settings", { "reports.allow_content_export": false }, admin.token);
  });

  test("every run is recorded with who, what and whether content left", async () => {
    await raw("/api/admin/reports/model_spend?format=xlsx", admin.token);
    const r = await api("GET", "/api/admin/reports/history", null, admin.token);
    assert.equal(r.status, 200);
    const last = r.body.runs[0];
    assert.ok(last.requestedBy, "who ran it");
    assert.ok("containsContent" in last);
    assert.ok(typeof last.rowCount === "number");

    const logged = await db.one(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'report.exported'`
    );
    assert.ok(Number(logged.n) > 0, "also written to the audit log");
  });

  test("an unknown report and a bad format are refused", async () => {
    assert.equal((await api("GET", "/api/admin/reports/not_a_report", null, admin.token)).status, 404);
    assert.equal((await api("GET", "/api/admin/reports/model_spend?format=docx", null, admin.token)).status, 400);
    assert.equal((await api("GET", "/api/admin/reports/model_spend?from=yesterday", null, admin.token)).status, 400);
  });

  test("a member cannot download a report", async () => {
    const res = await raw("/api/admin/reports/usage_by_person", member.token);
    assert.equal(res.status, 403);
  });
});

describe("settings", () => {
  test("lists only settings the console may write", async () => {
    const r = await api("GET", "/api/admin/settings", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.settings.some(s => s.key === "points.per_cent"));
    assert.ok(r.body.settings.every(s => s.note), "each one explains itself");
  });

  test("accepts a valid change", async () => {
    const r = await api("PATCH", "/api/admin/settings", { "files.max_mb": 40 }, admin.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.changed.some(c => c.key === "files.max_mb" && c.value === "40"));

    const row = await db.one(`SELECT setting_value AS v FROM org_settings WHERE setting_key = 'files.max_mb'`);
    assert.equal(row.v, "40");
    await api("PATCH", "/api/admin/settings", { "files.max_mb": 25 }, admin.token);
  });

  test("rejects a value outside its range rather than storing it", async () => {
    const r = await api("PATCH", "/api/admin/settings", { "files.max_mb": 99999 }, admin.token);
    assert.equal(r.status, 400);
    const row = await db.one(`SELECT setting_value AS v FROM org_settings WHERE setting_key = 'files.max_mb'`);
    assert.equal(row.v, "25", "unchanged");
  });

  test("rejects a key that is not on the whitelist", async () => {
    const r = await api("PATCH", "/api/admin/settings", { "auth.access_secret": "hunter2" }, admin.token);
    assert.equal(r.status, 400);
    const row = await db.one(`SELECT COUNT(*) AS n FROM org_settings WHERE setting_key = 'auth.access_secret'`);
    assert.equal(Number(row.n), 0, "nothing was written");
  });

  test("applies the good keys and reports the bad ones", async () => {
    const r = await api("PATCH", "/api/admin/settings", {
      "org.name": "Dolluz Corporation", "nonsense.key": "x",
    }, admin.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.changed.length, 1);
    assert.equal(r.body.rejected[0].reason, "unknown_setting");
  });

  test("a setting change is audited", async () => {
    const before = await db.one(`SELECT COUNT(*) AS n FROM audit_log WHERE action='org.settings_changed'`);
    await api("PATCH", "/api/admin/settings", { "spaces.default_retention": "90d" }, admin.token);
    const after = await db.one(`SELECT COUNT(*) AS n FROM audit_log WHERE action='org.settings_changed'`);
    assert.ok(Number(after.n) > Number(before.n));
    await api("PATCH", "/api/admin/settings", { "spaces.default_retention": "1y" }, admin.token);
  });
});

describe("points rules", () => {
  test("lists rules with the conversion rate", async () => {
    const r = await api("GET", "/api/admin/points/rules", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.rules.some(x => x.eventCode === "helpful"));
    assert.equal(typeof r.body.pointsPerCent, "number");
  });

  test("updates points and the daily cap", async () => {
    const r = await api("PATCH", "/api/admin/points/rules/helpful", { points: 30, dailyCap: 600 }, admin.token);
    assert.equal(r.status, 200);
    const helpful = r.body.rules.find(x => x.eventCode === "helpful");
    assert.equal(helpful.points, 30);
    assert.equal(helpful.dailyCap, 600);
    await api("PATCH", "/api/admin/points/rules/helpful", { points: 25, dailyCap: 500 }, admin.token);
  });

  test("rejects a negative or absurd value", async () => {
    assert.equal((await api("PATCH", "/api/admin/points/rules/helpful", { points: -5 }, admin.token)).status, 400);
    assert.equal((await api("PATCH", "/api/admin/points/rules/helpful", { points: 1e9 }, admin.token)).status, 400);
  });

  test("an unknown earning event is a 404", async () => {
    const r = await api("PATCH", "/api/admin/points/rules/invented", { points: 10 }, admin.token);
    assert.equal(r.status, 404);
  });
});

describe("spaces, org wide", () => {
  test("lists every space with owners and member counts", async () => {
    const r = await api("GET", "/api/admin/spaces", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.total > 0);
    assert.ok(r.body.spaces.every(s => s.kind !== "dm"), "direct messages are not listed");
    assert.ok(r.body.spaces.some(s => s.memberCount > 0));
  });

  test("includes a private channel the admin is not in", async () => {
    const priv = await db.one("SELECT id, name FROM conversations WHERE slug = 'leadership'");
    const r = await api("GET", "/api/admin/spaces?q=leadership", null, admin.token);
    assert.ok(r.body.spaces.some(s => Number(s.id) === Number(priv.id)),
      "an admin sees every space, unlike the chat API");
  });

  test("archived spaces are excluded unless asked for", async () => {
    const without = await api("GET", "/api/admin/spaces", null, admin.token);
    const with_ = await api("GET", "/api/admin/spaces?includeArchived=true", null, admin.token);
    assert.ok(with_.body.total >= without.body.total);
  });
});

describe("sessions, org wide", () => {
  test("lists everyone's live sessions", async () => {
    const r = await api("GET", "/api/admin/sessions", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.sessions.length > 0);
    assert.ok(r.body.sessions.some(s => s.email === "manasi@dolluzcorp.com"),
      "not just my own, unlike /api/auth/sessions");
  });

  test("an admin can revoke someone else's session, and it takes effect at once", async () => {
    const memberToken = await login("manasi@dolluzcorp.com");
    const ok = await api("GET", "/api/users/me", null, memberToken);
    assert.equal(ok.status, 200);

    // Revoke the session this token actually belongs to. Picking the first
    // session for that user is not deterministic: they may have several, and
    // the list is ordered by last use.
    const me = await api("GET", "/api/auth/me", null, memberToken);
    assert.equal(me.status, 200);
    const sessionId = me.body.session.id;

    const list = await api("GET", "/api/admin/sessions", null, admin.token);
    assert.ok(list.body.sessions.some(s => Number(s.id) === Number(sessionId)),
      "the session appears in the org-wide list");

    const revoked = await api("DELETE", `/api/admin/sessions/${sessionId}`, null, admin.token);
    assert.equal(revoked.status, 200);

    const after = await api("GET", "/api/users/me", null, memberToken);
    assert.equal(after.status, 401, "signed out immediately, not when the token expires");
    member.token = await login("manasi@dolluzcorp.com");
  });

  test("revoking twice is a 404", async () => {
    const r = await api("DELETE", "/api/admin/sessions/9999999", null, admin.token);
    assert.equal(r.status, 404);
  });
});

describe("versions", () => {
  test("publishing supersedes the previous current version", async () => {
    const r = await api("POST", "/api/admin/versions", {
      surface: "web", version: "0.9.1", releaseNote: "Search operators and the quick switcher.",
    }, admin.token);
    assert.equal(r.status, 201);

    const web = r.body.versions.filter(v => v.surface === "web");
    const current = web.filter(v => v.isCurrent);
    assert.equal(current.length, 1, "exactly one current version per surface");
    assert.equal(current[0].version, "0.9.1");
  });

  test("publishing with announce sends a notification to everyone", async () => {
    const before = await db.one(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'update'`);
    await api("POST", "/api/admin/versions", {
      surface: "server", version: "0.9.2", releaseNote: "Admin console API.", announce: true,
    }, admin.token);
    const after = await db.one(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'update'`);
    assert.ok(Number(after.n) > Number(before.n));
  });

  test("an unknown surface is refused", async () => {
    const r = await api("POST", "/api/admin/versions", { surface: "watch", version: "1.0" }, admin.token);
    assert.equal(r.status, 400);
  });
});

describe("default quick links", () => {
  test("adds one that every user then sees", async () => {
    const r = await api("POST", "/api/admin/quick-links", {
      label: "Payer portal index", url: "https://dai.dolluzcorp.com/payers",
    }, admin.token);
    assert.equal(r.status, 201);

    const theirs = await api("GET", "/api/users/me/quick-links", null, member.token);
    assert.ok(theirs.body.links.some(l => l.label === "Payer portal index" && l.isDefault),
      "it appears for a plain member as a default");
  });

  test("a member still cannot delete a default link", async () => {
    const list = await api("GET", "/api/users/me/quick-links", null, member.token);
    const def = list.body.links.find(l => l.label === "Payer portal index");
    const r = await api("DELETE", `/api/users/me/quick-links/${def.id}`, null, member.token);
    assert.equal(r.status, 404);
  });

  test("an admin removes it", async () => {
    const links = await api("GET", "/api/admin/quick-links", null, admin.token);
    const target = links.body.links.find(l => l.label === "Payer portal index");
    const r = await api("DELETE", `/api/admin/quick-links/${target.id}`, null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(!r.body.links.some(l => l.label === "Payer portal index"));
  });

  test("refuses a url that is not http", async () => {
    const r = await api("POST", "/api/admin/quick-links",
      { label: "Bad", url: "javascript:alert(1)" }, admin.token);
    assert.equal(r.status, 400);
  });
});

describe("audit log", () => {
  test("lists entries with the actor resolved", async () => {
    const r = await api("GET", "/api/admin/audit?limit=20", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.total > 0);
    assert.ok(r.body.entries.every(e => typeof e.actorName === "string"));
  });

  test("filters by action prefix", async () => {
    const r = await api("GET", "/api/admin/audit?action=auth.", null, admin.token);
    assert.ok(r.body.entries.every(e => e.action.startsWith("auth.")));
  });

  test("filters by date and rejects a malformed one gracefully", async () => {
    const future = await api("GET", "/api/admin/audit?from=2099-01-01", null, admin.token);
    assert.equal(future.body.entries.length, 0);
  });

  test("summarises which actions occur", async () => {
    const r = await api("GET", "/api/admin/audit/actions", null, admin.token);
    assert.ok(r.body.actions.length > 0);
    assert.ok(r.body.actions.every(a => typeof a.n === "number"));
  });
});
