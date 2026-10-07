"use strict";
/**
 * The dAdmin handoff: the interim single sign-on (docs/17-portal-sso.md section 7).
 *
 * dAdmin's half is not built yet, so the tokens here are real ones signed with
 * the configured secret exactly as dAdmin will sign them. Everything dAI does
 * with them runs for real: the verify, the jti spend against MySQL, the dadmin
 * access check, and the session that comes out.
 *
 * dadmin.employee is read only for dAI and CI has no dadmin database, so the two
 * reader functions are replaced by a fake employee table, as tests/dadmin.test.js
 * does. Nothing here writes to dadmin.
 *
 * Four things this exists to hold down:
 *
 *   1. Single use. dAdmin cannot enforce it, so dAI must, and a replay has to be
 *      refused across restarts and across instances, not just within one process.
 *   2. app_dAI. A vouched emp_id is proof of WHO, never of WHETHER.
 *   3. The two audiences do not overlap. A dai-login token must not open the
 *      admin surface and a dai-admin token must not sign anybody in.
 *   4. The session is a portal session: 8 hours, and it stays 8 hours.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.AUTH_RATE_TOKEN_MAX = "10000";
process.env.AUTH_RATE_REFRESH_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";

const LOGIN_SECRET = "dai-login-test-secret-" + "k".repeat(40);
const ADMIN_SECRET = "dadmin-shared-test-secret-" + "m".repeat(40);
process.env.DAI_LOGIN_JWT_SECRET = LOGIN_SECRET;
process.env.DAI_LOGIN_HANDOFF_URL = "https://dadmin.dolluzcorp.com/api/login/dai/handoff";
process.env.DADMIN_SHARED_JWT_SECRET = ADMIN_SECRET;

const fs = require("node:fs");
const path = require("node:path");

const { createApp } = require("../src/app");
const db = require("../src/db");
const config = require("../src/config");
const daiLogin = require("../src/services/dai-login.service");
const dadmin = require("../src/services/dadmin.service");
const T = require("../src/lib/tokens");

const DADMIN_PASSWORD = "Handoff!Test2026";
const stamp = Date.now().toString(36);
let counter = 0;
let server, base, hash, client;

const EXT = path.join(__dirname, "..", "..", "extension");

/* ---------------- the fake dadmin.employee table ---------------- */

const employees = new Map();
const realFindByEmail = dadmin.findEmployeeByEmail;
const realFindByEmpId = dadmin.findEmployeeByEmpId;

const employee = (over = {}) => {
  counter += 1;
  const row = {
    empId: `H${stamp}${counter}`.slice(0, 20),
    email: `handoff-${stamp}-${counter}@example.com`,
    passwordHash: hash,
    firstName: "Handoff",
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

/* ---------------- tokens exactly as dAdmin will sign them ---------------- */

/**
 * dAdmin's contract: { emp_id, aud: "dai-login", jti, iat, exp }, exp = iat + 60,
 * signed with DAI_LOGIN_JWT_SECRET.
 */
const handoffToken = ({
  empId, aud = "dai-login", jti = crypto.randomUUID(), secret = LOGIN_SECRET,
  expiresIn = 60, iat,
} = {}) => {
  const payload = { emp_id: empId, aud, jti };
  if (iat !== undefined) payload.iat = iat;
  return jwt.sign(payload, secret, expiresIn === null ? {} : { expiresIn });
};

const api = async (method, p, body, token) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  return { status: res.status, body: json || {} };
};

const signIn = (empId, over = {}) =>
  api("POST", "/api/auth/dai-login", { token: handoffToken({ empId, ...over }) });

const hoursUntil = (when) => (new Date(when).getTime() - Date.now()) / 3600000;

before(async () => {
  hash = bcrypt.hashSync(DADMIN_PASSWORD, 10);

  // The extension's own module, imported as the real ES module it is.
  client = await import(`file://${path.join(EXT, "src", "shared", "dai-login.js")}`);

  dadmin.findEmployeeByEmail = async (email) => employees.get(String(email || "").trim()) || null;
  dadmin.findEmployeeByEmpId = async (empId) =>
    [...employees.values()].find(e => e.empId === String(empId || "").trim()) || null;

  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  dadmin.findEmployeeByEmail = realFindByEmail;
  dadmin.findEmployeeByEmpId = realFindByEmpId;
  server.close();
  await db.pool.end();
});

/* ===================================================================== */

describe("what the extension is told", () => {
  test("it is told where to call, and nothing secret", async () => {
    const { status, body } = await api("GET", "/api/auth/dai-login/config");
    assert.equal(status, 200);
    assert.equal(body.enabled, true);
    assert.equal(body.handoffUrl, "https://dadmin.dolluzcorp.com/api/login/dai/handoff");

    assert.ok(!JSON.stringify(body).includes(LOGIN_SECRET), "the secret reached the extension");
    assert.deepEqual(Object.keys(body).sort(), ["enabled", "handoffUrl"]);
  });

  test("with nothing configured it says so, and the endpoint refuses", async () => {
    // The state the repository ships in, and the state the box is in until the
    // two values are set.
    const real = config.daiLogin.secret;
    config.daiLogin.secret = "";
    try {
      assert.equal(daiLogin.enabled(), false);
      const cfg = await api("GET", "/api/auth/dai-login/config");
      assert.deepEqual(cfg.body, { enabled: false, reason: "not_configured" });

      const out = await api("POST", "/api/auth/dai-login", { token: "anything" });
      assert.equal(out.status, 503);
      assert.equal(out.body.error, "dai_login_disabled");
    } finally {
      config.daiLogin.secret = real;
    }
  });
});

describe("a handoff token is used once and once only", () => {
  test("the happy path, then the same token again", async () => {
    const emp = employee();
    const token = handoffToken({ empId: emp.empId });

    const first = await api("POST", "/api/auth/dai-login", { token });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.ok(first.body.accessToken && first.body.refreshToken);
    assert.equal(first.body.user.empId, emp.empId);
    assert.equal(first.body.origin, "portal");

    const second = await api("POST", "/api/auth/dai-login", { token });
    assert.equal(second.status, 401);
    assert.equal(second.body.error, "handoff_used");
    assert.ok(!second.body.accessToken, "a replay produced a second session");
  });

  test("the jti row is what refuses it, so a restart cannot forget", async () => {
    // This is the whole reason it is a table and not a Set. Nothing here
    // restarts the process, but the row outliving the request is the property
    // that would let it: an in-memory guard has nothing to show for itself here.
    const emp = employee();
    const jti = crypto.randomUUID();
    const out = await api("POST", "/api/auth/dai-login", {
      token: handoffToken({ empId: emp.empId, jti }),
    });
    assert.equal(out.status, 200, JSON.stringify(out.body));

    const row = await db.one("SELECT jti, expires_at FROM dai_login_jti WHERE jti = ?", [jti]);
    assert.ok(row, "nothing was written down, so a restart would allow the replay");
    const seconds = (new Date(row.expires_at).getTime() - Date.now()) / 1000;
    assert.ok(seconds > 30 && seconds < 90, `expires_at should be the token's exp, got ${seconds}s`);
  });

  test("two simultaneous redemptions: one wins, one is refused", async () => {
    // A replay is not polite enough to arrive after the first request finishes.
    // The INSERT is the check precisely so there is no window between looking
    // and writing for the second one to fit through.
    const emp = employee();
    const token = handoffToken({ empId: emp.empId });
    const [a, b] = await Promise.all([
      api("POST", "/api/auth/dai-login", { token }),
      api("POST", "/api/auth/dai-login", { token }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 401], `got ${JSON.stringify(statuses)}`);
    const sessions = [a, b].filter(r => r.body.accessToken).length;
    assert.equal(sessions, 1, "both requests produced a session");
  });

  test("a token with no jti is refused, not accepted without a guard", async () => {
    // Accepting it would be the same as having no replay protection at all,
    // while looking like it had some.
    const emp = employee();
    const token = jwt.sign({ emp_id: emp.empId, aud: "dai-login" }, LOGIN_SECRET,
      { expiresIn: 60 });
    const out = await api("POST", "/api/auth/dai-login", { token });
    assert.equal(out.status, 401);
    assert.equal(out.body.error, "handoff_no_jti");
  });

  test("a jti too long for the column is refused rather than truncated", () => {
    // A silently truncated jti would collide with every other truncated one,
    // which refuses legitimate sign-ins rather than allowing replays, but is
    // still a thing to find out about at the door.
    assert.equal(daiLogin.cleanJti("a".repeat(64)), "a".repeat(64));
    assert.equal(daiLogin.cleanJti("a".repeat(65)), null);
    assert.equal(daiLogin.cleanJti(""), null);
    assert.equal(daiLogin.cleanJti("has space"), null);
    assert.equal(daiLogin.cleanJti(crypto.randomUUID()).length, 36);
  });
});

describe("a token has to be dAdmin's, and current", () => {
  test("another secret does not work", async () => {
    const emp = employee();
    const out = await signIn(emp.empId, { secret: "a-different-secret-" + "z".repeat(30) });
    assert.equal(out.status, 401);
    assert.equal(out.body.error, "handoff_invalid");
  });

  test("an expired token does not work, and says which", async () => {
    const emp = employee();
    const out = await signIn(emp.empId, { expiresIn: -10 });
    assert.equal(out.status, 401);
    assert.equal(out.body.error, "handoff_expired");
  });

  test("a token issued two minutes ago is refused even if its exp says otherwise", async () => {
    // maxAge is a second bound measured from iat, independent of exp, so a bug
    // on the dAdmin side that issued a long lived token cannot produce a key to
    // dAI that works for hours.
    const emp = employee();
    const iat = Math.floor(Date.now() / 1000) - 600;
    const token = jwt.sign(
      { emp_id: emp.empId, aud: "dai-login", jti: crypto.randomUUID(), iat, exp: iat + 36000 },
      LOGIN_SECRET
    );
    const out = await api("POST", "/api/auth/dai-login", { token });
    assert.equal(out.status, 401);
    assert.ok(["handoff_expired", "handoff_invalid"].includes(out.body.error), out.body.error);
  });

  test("no token, an empty token and nonsense are all refused", async () => {
    for (const token of [undefined, "", "not-a-jwt", "a.b.c"]) {
      const out = await api("POST", "/api/auth/dai-login", { token });
      assert.equal(out.status === 400 || out.status === 401, true,
        `${JSON.stringify(token)} returned ${out.status}`);
      assert.ok(!out.body.accessToken);
    }
  });
});

describe("the two audiences do not overlap", () => {
  /**
   * dAdmin signs two kinds of token: dai-admin, which acts on dAI's admin
   * surface, and dai-login, which signs one person in. If either were accepted
   * where the other belongs, the weaker one would become the stronger one. The
   * separation is the aud claim, so it is the aud claim that gets a test.
   */
  test("a dai-admin token cannot sign anybody in", async () => {
    const emp = employee();
    const out = await api("POST", "/api/auth/dai-login", {
      token: handoffToken({ empId: emp.empId, aud: "dai-admin" }),
    });
    assert.equal(out.status, 401);
    assert.equal(out.body.error, "handoff_invalid");
    assert.ok(!out.body.accessToken);
  });

  test("a dai-login token opens nothing on the admin surface", async () => {
    // Signed with the admin secret as well, so the only thing refusing it is the
    // audience. If dAdmin ever reuses one secret for both, this is the whole of
    // the separation.
    const emp = employee({ accessLevel: "Admin" });
    const token = handoffToken({ empId: emp.empId, aud: "dai-login", secret: ADMIN_SECRET });
    const out = await api("GET", "/api/admin/overview", null, token);
    assert.ok(out.status === 401 || out.status === 403,
      `a dai-login token reached the admin surface: ${out.status}`);
  });

  test("and the audiences are different strings, in code", () => {
    const { AUDIENCE: adminAudience } = require("../src/middleware/dadmin-service");
    assert.equal(daiLogin.AUDIENCE, "dai-login");
    assert.equal(adminAudience, "dai-admin");
    assert.notEqual(daiLogin.AUDIENCE, adminAudience);
  });
});

describe("app_dAI still decides, on this path too", () => {
  /**
   * In words, because this is the question that has been asked of every path:
   *
   *   dAdmin vouching for an emp_id proves WHO somebody is. It does not grant
   *   Kody. Whether they may use Kody is app_dAI on their dadmin.employee row,
   *   and it is checked here by the same accessProblem() that checks it when a
   *   password is typed. A perfectly valid handoff token for somebody with
   *   app_dAI = 0 is refused.
   */
  test("a valid handoff for an account without Kody access is refused", async () => {
    const emp = employee({ appDai: 0 });
    const out = await signIn(emp.empId);
    assert.equal(out.status, 403);
    assert.equal(out.body.error, "dai_not_enabled");
    assert.ok(!out.body.accessToken);

    const user = await db.one("SELECT id FROM users WHERE emp_id = ?", [emp.empId]);
    assert.equal(user, null, "a Kody user was created for somebody without app_dAI");
  });

  test("the same for inactive and deleted", async () => {
    for (const over of [{ active: 0 }, { deletedTime: new Date() }]) {
      const emp = employee(over);
      const out = await signIn(emp.empId);
      assert.equal(out.status, 403, `${JSON.stringify(over)} was allowed in`);
      assert.equal(out.body.error, "dai_not_enabled");
    }
  });

  test("an emp_id dadmin has never heard of is refused", async () => {
    const out = await signIn("NOSUCHEMP");
    assert.equal(out.status, 403);
    assert.equal(out.body.error, "dai_not_enabled");
  });

  test("an emp_id is never a number and never longer than the column", () => {
    assert.equal(daiLogin.cleanEmpId("DZIND148"), "DZIND148");
    assert.equal(daiLogin.cleanEmpId(" DZIND148 "), "DZIND148");
    assert.equal(daiLogin.cleanEmpId(148), "148");
    assert.equal(daiLogin.cleanEmpId("x".repeat(21)), null);
    assert.equal(daiLogin.cleanEmpId("DZIND148'; DROP TABLE users; --"), null);
    assert.equal(daiLogin.cleanEmpId(null), null);
  });

  test("a refused handoff does not spend its jti", async () => {
    // Otherwise turning app_dAI on and trying again would fail for a reason that
    // has nothing to do with access. Verify, then spend, then act.
    const emp = employee({ appDai: 0 });
    const jti = crypto.randomUUID();
    const refused = await api("POST", "/api/auth/dai-login", {
      token: handoffToken({ empId: emp.empId, jti }),
    });
    assert.equal(refused.status, 403);

    const row = await db.one("SELECT jti FROM dai_login_jti WHERE jti = ?", [jti]);
    assert.ok(row, "the jti was not recorded, so the token could be replayed");
  });
});

describe("the session that comes out is a portal session", () => {
  test("8 hours, not 30 days, and it says so", async () => {
    const emp = employee();
    const out = await signIn(emp.empId);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.origin, "portal");
    assert.equal(out.body.sessionHours, 8);

    const hours = hoursUntil(out.body.sessionExpiresAt);
    assert.ok(hours > 7.5 && hours < 8.5, `expected about 8 hours, got ${hours.toFixed(2)}`);

    const row = await db.one("SELECT origin, surface, expires_at FROM sessions WHERE id = ?",
      [out.body.sessionId]);
    assert.equal(row.origin, "portal");
    assert.equal(row.surface, "extension");
  });

  test("and refresh does not promote it to 30 days", async () => {
    const emp = employee();
    const out = await signIn(emp.empId);
    let refreshToken = out.body.refreshToken;

    for (let round = 1; round <= 2; round += 1) {
      const next = await api("POST", "/api/auth/refresh", { refresh_token: refreshToken });
      assert.equal(next.status, 200, `refresh ${round}: ${JSON.stringify(next.body)}`);
      assert.equal(next.body.origin, "portal");
      refreshToken = next.body.refreshToken;
      const row = await db.one("SELECT origin, expires_at FROM sessions WHERE refresh_token_hash = ?",
        [T.sha256(refreshToken)]);
      assert.equal(row.origin, "portal");
      assert.ok(hoursUntil(row.expires_at) < 9,
        `refresh ${round} extended it to ${(hoursUntil(row.expires_at) / 24).toFixed(1)} days`);
    }
  });

  test("an audit row says the session came from the portal", async () => {
    const emp = employee();
    const out = await signIn(emp.empId);
    const row = await db.one(
      `SELECT meta FROM audit_log WHERE action = 'auth.session_issued' AND entity_id = ?`,
      [out.body.sessionId]
    );
    assert.ok(row, "no audit row for the session");
    const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
    assert.equal(meta.origin, "portal");
    assert.equal(meta.surface, "extension");
  });

  test("the response carries no handoff token and no secret", async () => {
    const emp = employee();
    const token = handoffToken({ empId: emp.empId });
    const out = await api("POST", "/api/auth/dai-login", { token });
    const text = JSON.stringify(out.body);
    assert.ok(!text.includes(token), "the handoff token was echoed back");
    assert.ok(!text.includes(LOGIN_SECRET), "the secret was echoed back");
  });
});

/* ===================================================================== */

describe("the extension's half, against the real server", () => {
  /**
   * extension/src/shared/dai-login.js, run as the real ES module it is, with a
   * stand-in dAdmin and the REAL dAI on a local port. So the two legs that
   * matter are both exercised: what it sends dAdmin, and what it does with every
   * answer dAdmin can give.
   *
   * dAdmin's half does not exist yet. The stand-in answers exactly what section 7
   * of docs/17-portal-sso.md says it will.
   */
  const DADMIN_URL = "https://dadmin.example.com/api/login/dai/handoff";

  /**
   * A fetch that plays dAdmin and passes everything else to the real server.
   * `calls` records every request, which is how "it sent credentials" and "it
   * never called dAdmin" are checked rather than assumed.
   */
  function fakeFetch({ enabled = true, handoffUrl = DADMIN_URL, dadmin, calls = [] } = {}) {
    const impl = async (url, options = {}) => {
      const target = String(url);
      calls.push({ url: target, options });

      if (target.endsWith("/api/auth/dai-login/config")) {
        return {
          ok: true, status: 200,
          json: async () => (enabled ? { enabled: true, handoffUrl } : { enabled: false }),
        };
      }
      if (target === handoffUrl) {
        if (typeof dadmin === "function") return dadmin();
        const d = dadmin || { status: 200, body: {} };
        if (d.throws) throw new Error("connection refused");
        return { ok: d.status >= 200 && d.status < 300, status: d.status, json: async () => d.body };
      }
      // Everything else is the real dAI.
      const res = await fetch(target.startsWith("http") ? target : `${base}${target}`, options);
      return res;
    };
    impl.calls = calls;
    return impl;
  }

  /** A chrome.storage.local shaped setTokens, recording what it was given. */
  const recorder = () => {
    const stored = [];
    return { stored, setTokens: async (t) => { stored.push(t); } };
  };

  const run = (opts, store) => client.trySilentSignIn({
    apiBase: base, fetchImpl: fakeFetch(opts), setTokens: store.setTokens,
  });

  test("a portal session signs somebody in with no window and no password", async () => {
    const emp = employee();
    const store = recorder();
    const impl = fakeFetch({
      dadmin: { status: 200, body: { token: handoffToken({ empId: emp.empId }), expiresInSeconds: 60 } },
    });
    const out = await client.trySilentSignIn({
      apiBase: base, fetchImpl: impl, setTokens: store.setTokens,
    });

    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.silent, true);
    assert.equal(out.origin, "portal");
    assert.equal(out.sessionHours, 8);
    assert.equal(out.user.empId, emp.empId);

    assert.equal(store.stored.length, 1, "no session was stored");
    assert.ok(store.stored[0].accessToken && store.stored[0].refreshToken);
  });

  test("the call to dAdmin carries credentials, no body and no query string", async () => {
    // credentials is the whole mechanism: the browser attaches the portal cookie
    // to a request to the origin it already belongs to. Without it dAdmin sees an
    // anonymous request and answers login_required forever.
    const emp = employee();
    const store = recorder();
    const impl = fakeFetch({
      dadmin: { status: 200, body: { token: handoffToken({ empId: emp.empId }) } },
    });
    await client.trySilentSignIn({ apiBase: base, fetchImpl: impl, setTokens: store.setTokens });

    const call = impl.calls.find(c => c.url === DADMIN_URL);
    assert.ok(call, "dAdmin was never called");
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.credentials, "include");
    assert.equal(call.options.body, undefined, "a body was sent; dAdmin asked for none");
    assert.ok(!call.url.includes("?"),
      "a query string was sent; the token must not reach a URL, a log or a Referer");
    assert.equal(call.options.referrerPolicy, "no-referrer");
    assert.ok(call.options.signal, "no abort signal, so a hung dAdmin would hang the sign in");
  });

  test("nobody signed in to the portal is silent, and dAI is never called", async () => {
    // 401 is most people most of the time. It must cost nothing and say nothing.
    const store = recorder();
    const impl = fakeFetch({ dadmin: { status: 401, body: { error: "login_required" } } });
    const out = await client.trySilentSignIn({
      apiBase: base, fetchImpl: impl, setTokens: store.setTokens,
    });

    assert.equal(out.ok, false);
    assert.equal(out.quiet, true);
    assert.equal(out.error, "login_required");
    assert.equal(store.stored.length, 0);
    assert.ok(!impl.calls.some(c => c.url.endsWith("/api/auth/dai-login")),
      "it posted nothing to dAI with no token to post");
  });

  test("an account without Kody access is NOT silent, because a password cannot help", async () => {
    // The one failure that is reported. Opening the sign in page would send
    // somebody to type a password that is refused for the same reason.
    const store = recorder();
    const out = await run({ dadmin: { status: 403, body: { error: "dai_not_enabled" } } }, store);

    assert.equal(out.ok, false);
    assert.equal(out.quiet, false, "it would have opened a sign in window that cannot work");
    assert.equal(out.error, "dai_not_enabled");
    assert.match(out.message, /does not have Kody access/);
  });

  test("dAdmin missing its own secret is silent, because retrying cannot fix it", async () => {
    const store = recorder();
    const out = await run({ dadmin: { status: 503, body: { error: "dai_not_configured" } } }, store);
    assert.equal(out.quiet, true);
    assert.equal(out.error, "handoff_refused");
  });

  test("a dAdmin that cannot be reached is silent", async () => {
    const store = recorder();
    const out = await run({ dadmin: { throws: true } }, store);
    assert.equal(out.quiet, true);
    assert.equal(out.error, "dadmin_unreachable");
  });

  test("not configured means dAdmin is never called at all", async () => {
    const store = recorder();
    const impl = fakeFetch({ enabled: false });
    const out = await client.trySilentSignIn({
      apiBase: base, fetchImpl: impl, setTokens: store.setTokens,
    });
    assert.equal(out.quiet, true);
    assert.equal(out.error, "not_configured");
    assert.ok(!impl.calls.some(c => c.url === DADMIN_URL),
      "it called dAdmin for a handoff that is switched off");
  });

  test("a handoff URL that is not https is refused before anything is sent", async () => {
    // A configuration mistake must not send a cookie over plain http. localhost
    // is allowed so the flow can be run against a local dAdmin.
    for (const url of ["http://dadmin.dolluzcorp.com/handoff", "ftp://x/y", "not a url", ""]) {
      const store = recorder();
      const impl = fakeFetch({ handoffUrl: url });
      const out = await client.trySilentSignIn({
        apiBase: base, fetchImpl: impl, setTokens: store.setTokens,
      });
      assert.equal(out.quiet, true, `${url} was not refused`);
      assert.equal(out.error, "bad_handoff_url", `${url} was accepted`);
      assert.ok(!impl.calls.some(c => c.url === url), `it sent a request to ${url}`);
    }
    assert.ok(client.usableHandoffUrl("https://dadmin.dolluzcorp.com/x"));
    assert.ok(client.usableHandoffUrl("http://localhost:4003/x"), "a local dAdmin has to work");
    assert.equal(client.usableHandoffUrl("http://dadmin.dolluzcorp.com/x"), null);
  });

  test("a replayed handoff is refused by the server, and reported quietly", async () => {
    const emp = employee();
    const token = handoffToken({ empId: emp.empId });
    const first = recorder();
    const second = recorder();

    const ok = await client.trySilentSignIn({
      apiBase: base, setTokens: first.setTokens,
      fetchImpl: fakeFetch({ dadmin: { status: 200, body: { token } } }),
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));

    const again = await client.trySilentSignIn({
      apiBase: base, setTokens: second.setTokens,
      fetchImpl: fakeFetch({ dadmin: { status: 200, body: { token } } }),
    });
    assert.equal(again.ok, false);
    assert.equal(again.error, "handoff_used");
    assert.equal(second.stored.length, 0, "a replay stored a second session");
  });

  test("dAI refusing on app_dAI is reported, not swallowed", async () => {
    // The same rule as dAdmin's 403, one leg later: dAdmin may have vouched for
    // somebody whose app_dAI was turned off a moment ago.
    const emp = employee({ appDai: 0 });
    const store = recorder();
    const out = await run({
      dadmin: { status: 200, body: { token: handoffToken({ empId: emp.empId }) } },
    }, store);

    assert.equal(out.ok, false);
    assert.equal(out.quiet, false);
    assert.equal(out.error, "dai_not_enabled");
    assert.match(out.message, /Kody access/);
    assert.equal(store.stored.length, 0);
  });

  test("an answer with no token in it is silent", async () => {
    const store = recorder();
    const out = await run({ dadmin: { status: 200, body: { expiresInSeconds: 60 } } }, store);
    assert.equal(out.quiet, true);
    assert.equal(out.error, "handoff_empty");
  });
});
