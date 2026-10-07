"use strict";
/**
 * Single sign-on from Inside D (docs/17-portal-sso.md).
 *
 * Inside D does not exist yet. What exists is the contract, so these tests run
 * dAI's whole half of it against a fake Inside D on a local port: the token
 * endpoint is real HTTP, the exchange is real, the dadmin access check is real,
 * and the sessions that come out are real rows this file reads back.
 *
 * dadmin.employee is read only for dAI and CI has no dadmin database, so the
 * two reader functions are replaced by a fake employee table exactly as
 * tests/dadmin.test.js does. Nothing here writes to dadmin.
 *
 * The three things these tests exist to hold down, in order of how much damage
 * getting them wrong would do:
 *
 *   1. app_dAI is still enforced. Portal access is not Kody access.
 *   2. A portal session lasts 8 hours and STAYS 8 hours across refresh.
 *   3. Nothing in here ever sees a portal token, and a browser cannot vouch
 *      for an emp_id by putting one in a request body.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.AUTH_RATE_REFRESH_MAX = "10000";
process.env.AUTH_RATE_TOKEN_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
process.env.EXTENSION_IDS = EXT_ID;
const CALLBACK = `https://${EXT_ID}.chromiumapp.org/kody`;

/* The client secret is its own value. 48 bytes of nothing, but 48 bytes. */
const CLIENT_SECRET = "portal-test-client-secret-" + "x".repeat(40);
process.env.PORTAL_CLIENT_ID = "dai";
process.env.PORTAL_CLIENT_SECRET = CLIENT_SECRET;
process.env.PORTAL_AUTHORIZE_URL = "https://inside.example.com/authorize";
process.env.PORTAL_TOKEN_URL = "https://inside.example.com/oauth/token";
process.env.PORTAL_REDIRECT_URI = "https://dai.example.com/extension/authorize";
process.env.PORTAL_SESSION_HOURS = "8";

const { createApp } = require("../src/app");
const db = require("../src/db");
const config = require("../src/config");
const authSvc = require("../src/services/auth.service");
const portalSvc = require("../src/services/portal.service");
const dadmin = require("../src/services/dadmin.service");

const DADMIN_PASSWORD = "Portal!Test2026";
const stamp = Date.now().toString(36);
let counter = 0;
let server, base, inside, insidePort, hash;

/* ---------------- the fake dadmin.employee table ---------------- */

const employees = new Map();
const realFindByEmail = dadmin.findEmployeeByEmail;
const realFindByEmpId = dadmin.findEmployeeByEmpId;

const employee = (over = {}) => {
  counter += 1;
  const row = {
    empId: `P${stamp}${counter}`.slice(0, 20),
    email: `portal-${stamp}-${counter}@example.com`,
    passwordHash: hash,
    firstName: "Portal",
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

/* ---------------- the fake Inside D ---------------- */

/**
 * What Inside D will answer next, and what it was asked. Each test sets reply
 * and then reads asked, which is how the client secret and the redirect_uri
 * actually leaving dAI are checked rather than assumed.
 */
const insideD = {
  reply: { status: 200, body: {} },
  asked: null,
  codes: new Map(),      // code -> emp_id, single use, as the contract requires
};

const api = async (method, p, body, token, cookie) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  return { status: res.status, body: json || {} };
};

/** The return leg only: a portal code in, a Kody one-time code out. */
const authorizeThroughPortal = async (empId, state, redirectUri = CALLBACK) => {
  const code = `portal-code-${Math.random().toString(36).slice(2)}`;
  insideD.codes.set(code, empId);
  insideD.reply = null;   // answer from the code table, as the contract says
  return api("POST", "/api/auth/portal/callback", {
    portal_code: code, state, redirect_uri: redirectUri, surface: "extension",
  });
};

/** And the whole flow: portal code in, Kody tokens out. */
const signInThroughPortal = async (empId, state) => {
  const authorized = await authorizeThroughPortal(empId, state);
  if (authorized.status !== 200) return { authorized, tokens: null };
  const tokens = await api("POST", "/api/auth/token", {
    code: authorized.body.code, state, redirect_uri: CALLBACK,
  });
  return { authorized, tokens };
};

/* A browser carrying a portal cookie. The value is deliberately nonsense: dAI
   must never do anything with it except notice that there is one. */
const PORTAL_COOKIE = "dolluzcorp_token=not-a-real-token-and-never-read";

const sessionRow = (id) => db.one(
  "SELECT id, origin, surface, expires_at, revoked_at FROM sessions WHERE id = ?", [id]
);

/** Hours from now until a DATETIME, as a number so it can be compared loosely. */
const hoursUntil = (when) => (new Date(when).getTime() - Date.now()) / 3600000;

before(async () => {
  hash = bcrypt.hashSync(DADMIN_PASSWORD, 10);

  dadmin.findEmployeeByEmail = async (email) => employees.get(String(email || "").trim()) || null;
  dadmin.findEmployeeByEmpId = async (empId) =>
    [...employees.values()].find(e => e.empId === String(empId || "").trim()) || null;

  inside = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = null;
      try { body = JSON.parse(raw); } catch (_) { body = null; }
      insideD.asked = { url: req.url, method: req.method, body };

      if (insideD.reply) {
        res.writeHead(insideD.reply.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(insideD.reply.body));
        return;
      }
      // The contract: single use, and the code dies when it is redeemed.
      const code = body && body.code;
      const empId = insideD.codes.get(code);
      insideD.codes.delete(code);
      if (!empId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ emp_id: empId }));
    });
  });
  inside.listen(0);
  await new Promise(r => inside.once("listening", r));
  insidePort = inside.address().port;

  // The URL has to be known before config is read, and the port is not known
  // until the fake server is listening. Pointed here rather than at a made up
  // https host; the https rule is a production guard and has its own test.
  config.portal.tokenUrl = `http://127.0.0.1:${insidePort}/oauth/token`;

  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  dadmin.findEmployeeByEmail = realFindByEmail;
  dadmin.findEmployeeByEmpId = realFindByEmpId;
  inside.close();
  server.close();
  await db.pool.end();
});

/* ===================================================================== */

describe("what the sign in page is told", () => {
  test("it is told where to send people, and nothing secret", async () => {
    // With a portal cookie on the request. Without one the answer is
    // enabled:false, which has its own tests below.
    const { status, body } = await api("GET", "/api/auth/portal/config", null, null, PORTAL_COOKIE);
    assert.equal(status, 200);
    assert.equal(body.enabled, true);
    assert.equal(body.authorizeUrl, "https://inside.example.com/authorize");
    assert.equal(body.clientId, "dai");
    assert.equal(body.redirectUri, "https://dai.example.com/extension/authorize");
    assert.equal(body.sessionHours, 8);

    // The whole response, as a string, must not contain the client secret.
    // A field added later without thinking about it fails here.
    assert.ok(!JSON.stringify(body).includes(CLIENT_SECRET),
      "the client secret reached the browser");
    assert.ok(!("clientSecret" in body) && !("client_secret" in body));
  });

  test("with nothing configured it says so, and the callback refuses", async () => {
    // This is the state the repository ships in: the Inside D half does not
    // exist, so the whole feature has to do nothing at all.
    const real = config.portal.clientId;
    config.portal.clientId = "";
    try {
      assert.equal(portalSvc.enabled(), false);
      const cfg = await api("GET", "/api/auth/portal/config", null, null, PORTAL_COOKIE);
      assert.deepEqual(cfg.body, { enabled: false, reason: "not_configured" });

      const out = await api("POST", "/api/auth/portal/callback",
        { portal_code: "anything", state: "s".repeat(24), redirect_uri: CALLBACK });
      assert.equal(out.status, 503);
      assert.equal(out.body.error, "portal_disabled");
    } finally {
      config.portal.clientId = real;
    }
  });
});

describe("a browser with no portal cookie is not sent on a round trip", () => {
  /**
   * An AR caller never opens the portal, so prompt=none could only ever come
   * back login_required for them: one wasted redirect on every single sign in,
   * for people who will never benefit. The cookie is on .dolluzcorp.com, so it
   * reaches this server even though the page's JavaScript cannot see it, and
   * noticing that it is ABSENT is enough to skip the trip.
   *
   * Presence is a hint, not proof. Nothing is authorised on the strength of it:
   * the worst case of a wrong yes is the redirect that used to happen anyway.
   */
  const configWith = (cookie) =>
    api("GET", "/api/auth/portal/config", null, null, cookie);

  test("no cookie header at all: the handoff is off, and says why", async () => {
    const { status, body } = await configWith(undefined);
    assert.equal(status, 200);
    assert.equal(body.enabled, false);
    assert.equal(body.reason, "no_portal_cookie");
    assert.ok(!body.authorizeUrl, "it still told the page where to go");
  });

  test("a portal cookie: the handoff is on", async () => {
    const { body } = await configWith(PORTAL_COOKIE);
    assert.equal(body.enabled, true);
    assert.ok(body.authorizeUrl);
  });

  test("other cookies but not that one: still off", async () => {
    const { body } = await configWith("theme=dark; sidebar=open; _ga=GA1.2.3");
    assert.equal(body.enabled, false);
    assert.equal(body.reason, "no_portal_cookie");
  });

  test("the name inside somebody else's cookie does not count", async () => {
    // A substring test over the header would pass all three of these, and each
    // one is a browser with no portal session at all.
    for (const header of [
      "other=dolluzcorp_token",                 // the name as a VALUE
      "not_dolluzcorp_token=x",                 // a longer name containing it
      "dolluzcorp_token_old=x",                 // ditto, the other way round
    ]) {
      const { body } = await configWith(header);
      assert.equal(body.enabled, false, `"${header}" was read as a portal session`);
      assert.equal(body.reason, "no_portal_cookie");
    }
  });

  test("an empty value is a signed out browser", async () => {
    // Express clearCookie expires it, so a signed out browser usually sends
    // nothing at all, but an empty value is the same situation.
    for (const header of ["dolluzcorp_token=", "dolluzcorp_token= ", "a=1; dolluzcorp_token=; b=2"]) {
      const { body } = await configWith(header);
      assert.equal(body.enabled, false, `"${header}" was read as a portal session`);
    }
  });

  test("spacing and position do not matter", async () => {
    for (const header of [
      "dolluzcorp_token=abc",
      " dolluzcorp_token=abc ",
      "theme=dark;dolluzcorp_token=abc",
      "theme=dark; dolluzcorp_token=abc; other=1",
      "dolluzcorp_token=abc; dolluzcorp_token=def",
    ]) {
      const { body } = await configWith(header);
      assert.equal(body.enabled, true, `"${header}" was not read as a portal session`);
    }
  });

  test("the cookie value is never echoed back", async () => {
    const secret = "this-value-must-not-come-back-" + Math.random().toString(36).slice(2);
    const { body } = await configWith(`dolluzcorp_token=${secret}`);
    assert.ok(!JSON.stringify(body).includes(secret),
      "the portal cookie value came back in the response");
  });

  test("not configured beats no cookie, because that is the more useful answer", async () => {
    const real = config.portal.clientId;
    config.portal.clientId = "";
    try {
      const { body } = await configWith(PORTAL_COOKIE);
      assert.deepEqual(body, { enabled: false, reason: "not_configured" });
    } finally {
      config.portal.clientId = real;
    }
  });

  test("the gate does not touch the callback, which arrives from a redirect", async () => {
    // Gating the return leg on a cookie would add a way for the handoff to fail
    // halfway through, for no benefit: by then Inside D has already answered.
    const emp = employee();
    const out = await api("POST", "/api/auth/portal/callback", {
      portal_code: "x", state: "I".repeat(24), redirect_uri: CALLBACK,
    }, null, undefined);
    assert.notEqual(out.status, 503, "the callback refused a request with no cookie");
    assert.ok(emp.empId);
  });

  test("hasPortalCookie answers a boolean and nothing else", () => {
    const { hasPortalCookie, PORTAL_COOKIE_NAME } = require("../src/lib/portal-cookie");
    assert.equal(PORTAL_COOKIE_NAME, "dolluzcorp_token");

    // Nothing it is handed can make it throw or return a value.
    for (const req of [undefined, null, {}, { headers: {} }, { headers: { cookie: null } },
                       { headers: { cookie: "" } }, { headers: { cookie: ";;;" } },
                       { headers: { cookie: "=" } }, { headers: { cookie: "novalue" } },
                       { headers: { cookie: 42 } }]) {
      assert.equal(hasPortalCookie(req), false, `${JSON.stringify(req)} was not false`);
    }
    assert.equal(hasPortalCookie({ headers: { cookie: "dolluzcorp_token=v" } }), true);
    assert.equal(typeof hasPortalCookie({ headers: { cookie: "dolluzcorp_token=v" } }), "boolean");
  });
});

describe("the portal token reaches dAI, and dAI never touches it", () => {
  /**
   * Inside D sets dolluzcorp_token on .dolluzcorp.com with SameSite=None in
   * production (dApps/dolluzcorp, Login_server.js cookieOptions), so the browser
   * sends it to dai.dolluzcorp.com on every request. HttpOnly keeps it from the
   * page's JavaScript but not from this server.
   *
   * Which means the one credential this whole design exists to avoid holding is
   * already sitting in dAI's request headers. The protection is not that it
   * cannot arrive, because it does: it is that nothing here reads it. That is a
   * thing somebody can undo by accident while adding a feature, so it is a test
   * rather than a paragraph.
   */
  const SRC = path.join(__dirname, "..", "src");

  /** Every .js under src, with comments stripped: this is about code. */
  const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory()
      ? sourceFiles(path.join(dir, e.name))
      : (e.name.endsWith(".js") ? [path.join(dir, e.name)] : [])));

  const codeOf = (file) => fs.readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

  test("exactly one file in server/src reads a cookie, and it is the small one", () => {
    // It was none until the presence gate, and the invariant is now "one, and
    // that one". A second file appearing here is the thing to look at: the
    // portal token is one of the cookies on this origin, so a cookie read
    // anywhere else is a read of a credential dAI must not hold.
    const readers = [];
    for (const file of sourceFiles(SRC)) {
      const code = codeOf(file);
      if (/req\.cookies|cookieParser|cookie-parser|headers\.cookie|headers\[.cookie.\]|get\(\s*["']cookie["']\s*\)/i.test(code)) {
        readers.push(path.relative(SRC, file).replace(/\\/g, "/"));
      }
    }
    assert.deepEqual(readers, ["lib/portal-cookie.js"],
      "a cookie is read somewhere it should not be: " + readers.join(", "));
  });

  test("and that file hands back a boolean, never a value", () => {
    const code = codeOf(path.join(SRC, "lib", "portal-cookie.js"));
    // It must not be able to return, log or store the value. The only thing it
    // is allowed to learn from one is whether there is one.
    assert.ok(!/console\.|logError|JSON\.stringify/.test(code),
      "portal-cookie.js can write a cookie value somewhere");
    assert.match(code, /\.length > 0;/, "it should measure the value, not read it");
    assert.ok(!/return\s+pair\.slice\(eq \+ 1\)\s*;/.test(code),
      "it returns the value itself");
    // Small enough to read in full before trusting it.
    assert.ok(code.split("\n").filter(l => l.trim()).length < 40,
      "portal-cookie.js has grown; it is meant to stay readable in one sitting");
  });

  test("and there is no cookie parser to make it easy", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(!Object.keys(deps).some(d => /cookie/i.test(d)),
      "a cookie parser was added, which puts dolluzcorp_token one property access away");
  });

  test("the exchange body is built from configuration, never from the request", () => {
    // The route hands portal.exchange a code and nothing else, and the service
    // fills in client_id and client_secret from config. A request cannot steer
    // where the exchange goes or what it claims to be.
    const svcSrc = codeOf(path.join(SRC, "services", "portal.service.js"));
    assert.ok(!/\breq\b/.test(svcSrc),
      "portal.service.js touches a request object; it should only ever see a code string");
    assert.match(svcSrc, /client_secret: config\.portal\.clientSecret/);
    assert.match(svcSrc, /config\.portal\.tokenUrl/);
  });
});

describe("the exchange with Inside D", () => {
  test("dAI authenticates itself with the client secret, not with a portal token", async () => {
    insideD.reply = { status: 200, body: { emp_id: employee().empId } };
    await portalSvc.exchange("a-code");

    const asked = insideD.asked;
    assert.equal(asked.method, "POST");
    assert.equal(asked.body.client_id, "dai");
    assert.equal(asked.body.client_secret, CLIENT_SECRET);
    assert.equal(asked.body.code, "a-code");
    assert.equal(asked.body.redirect_uri, "https://dai.example.com/extension/authorize");

    // The point of the whole design: there is no portal credential to send, so
    // there is nothing here that Inside D could have got from its own cookie.
    // The named fields, not a loose word match: grant_type is legitimately
    // "authorization_code" and a match on "authorization" would pass for the
    // wrong reason and then fail for the wrong reason.
    for (const forbidden of ["dolluzcorp_token", "token", "cookie", "Cookie",
                             "access_token", "id_token", "session", "password"]) {
      assert.ok(!(forbidden in asked.body),
        `dAI sent ${forbidden} to Inside D, and it has no business holding one`);
    }
    assert.deepEqual(Object.keys(asked.body).sort(),
      ["client_id", "client_secret", "code", "grant_type", "redirect_uri"],
      "the exchange body grew a field");
  });

  test("it reads emp_id and drops everything else the portal volunteers", async () => {
    // If a later Inside D starts returning a name or an access level, dAI must
    // not start believing them: those belong to dadmin.employee, and reading
    // them here would let the portal change who somebody is in Kody.
    const emp = employee();
    insideD.reply = {
      status: 200,
      body: {
        emp_id: emp.empId,
        name: "Somebody Else",
        email: "attacker@example.com",
        access_level: "Admin",
        roles: ["admin"],
      },
    };
    const out = await portalSvc.exchange("code");
    assert.deepEqual(out, { empId: emp.empId });
  });

  test("a refusal, a nonsense answer and silence are three different errors", async () => {
    insideD.reply = { status: 401, body: { error: "invalid_grant" } };
    await assert.rejects(() => portalSvc.exchange("code"), (e) => e.code === "portal_refused");

    insideD.reply = { status: 200, body: { ok: true } };
    await assert.rejects(() => portalSvc.exchange("code"), (e) => e.code === "portal_bad_response");

    const real = config.portal.tokenUrl;
    // Port 1. Nothing listens there, so the connection is refused at once.
    // insidePort + 1 was tried first and turned out to be something that was
    // listening, which answered 404 and made this read as portal_refused.
    config.portal.tokenUrl = "http://127.0.0.1:1/oauth/token";
    try {
      await assert.rejects(() => portalSvc.exchange("code"), (e) => e.code === "portal_unreachable");
    } finally {
      config.portal.tokenUrl = real;
    }
  });

  test("an emp_id is never a number and never longer than the column", () => {
    // emp_id is VARCHAR(20) holding codes like DZIND148 (CLAUDE.md rule 4).
    assert.equal(portalSvc.cleanEmpId("DZIND148"), "DZIND148");
    assert.equal(portalSvc.cleanEmpId("  DZIND148  "), "DZIND148");
    assert.equal(portalSvc.cleanEmpId(148), "148");
    assert.equal(portalSvc.cleanEmpId("x".repeat(21)), null);
    assert.equal(portalSvc.cleanEmpId("DZIND148'; DROP TABLE users; --"), null);
    assert.equal(portalSvc.cleanEmpId(""), null);
    assert.equal(portalSvc.cleanEmpId(null), null);
  });
});

/* ===================================================================== */

describe("app_dAI is still what decides, on the portal path too", () => {
  /**
   * In words, because this is the question that was asked and the answer has to
   * survive somebody reading it in a year:
   *
   *   Being signed in to the Dolluz portal proves WHO you are. It does not
   *   grant Kody. Whether you may use Kody is app_dAI on your dadmin.employee
   *   row, and it is checked on the portal path by the same accessProblem()
   *   that checks it when you type your password. A perfectly good portal
   *   session with app_dAI = 0 is refused.
   */
  test("portal access is not Kody access: app_dAI = 0 is refused", async () => {
    const emp = employee({ appDai: 0 });
    const { authorized } = await signInThroughPortal(emp.empId, "q".repeat(24));

    assert.equal(authorized.status, 403);
    assert.equal(authorized.body.error, "dai_not_enabled");
    assert.ok(!authorized.body.code, "a code was minted for somebody without app_dAI");

    // And nothing was created for them either.
    const user = await db.one("SELECT id FROM users WHERE emp_id = ?", [emp.empId]);
    assert.equal(user, null, "a Kody user was created for somebody without app_dAI");
  });

  test("the same for an inactive employee and a deleted one", async () => {
    for (const over of [{ active: 0 }, { deletedTime: new Date() }]) {
      const emp = employee(over);
      const { authorized } = await signInThroughPortal(emp.empId, "r".repeat(24));
      assert.equal(authorized.status, 403, `${JSON.stringify(over)} was allowed in`);
      assert.equal(authorized.body.error, "dai_not_enabled");
      const user = await db.one("SELECT id FROM users WHERE emp_id = ?", [emp.empId]);
      assert.equal(user, null);
    }
  });

  test("an emp_id dadmin has never heard of is refused, in development too", async () => {
    // The password path falls through to a local Kody password outside
    // production. The portal path must not: a vouched emp_id that dadmin does
    // not have is a fault at Inside D or a forged exchange.
    assert.equal(config.isProd(), false, "this test is about NOT being production");
    const { authorized } = await signInThroughPortal("NOSUCHEMP", "t".repeat(24));
    assert.equal(authorized.status, 403);
    assert.equal(authorized.body.error, "dai_not_enabled");
  });

  test("the same gate runs whichever way in was used", async () => {
    // Both paths end at dadmin's accessProblem(). Proven by turning app_dAI off
    // for one employee and watching both doors shut.
    const emp = employee({ appDai: 0 });
    const password = await api("POST", "/api/auth/authorize", {
      email: emp.email, password: DADMIN_PASSWORD,
      state: "u".repeat(24), redirect_uri: CALLBACK,
    });
    const { authorized: portal } = await signInThroughPortal(emp.empId, "v".repeat(24));

    assert.equal(password.status, 403);
    assert.equal(portal.status, 403);
    assert.equal(password.body.error, portal.body.error);
  });

  test("a browser cannot vouch for an emp_id by putting one in the body", async () => {
    // The ONLY way portalEmpId is set is the route filling it in after a
    // server to server exchange. If /authorize read it from the request, the
    // whole design would be a suggestion.
    const emp = employee();
    const out = await api("POST", "/api/auth/authorize", {
      portal_emp_id: emp.empId, portalEmpId: emp.empId, emp_id: emp.empId,
      state: "w".repeat(24), redirect_uri: CALLBACK,
    });
    assert.equal(out.status, 400);
    assert.equal(out.body.error, "missing_fields");
    assert.ok(!out.body.code);
  });
});

/* ===================================================================== */

describe("how long a portal session lasts", () => {
  test("a portal sign-in works, and lasts hours rather than a month", async () => {
    const emp = employee();
    const { authorized, tokens } = await signInThroughPortal(emp.empId, "x".repeat(24));

    assert.equal(authorized.status, 200, JSON.stringify(authorized.body));
    assert.equal(authorized.body.origin, "portal");
    assert.equal(authorized.body.sessionHours, 8);

    assert.equal(tokens.status, 200, JSON.stringify(tokens.body));
    assert.ok(tokens.body.accessToken && tokens.body.refreshToken);
    assert.equal(tokens.body.origin, "portal");
    assert.equal(tokens.body.user.emp_id || tokens.body.user.empId || emp.empId, emp.empId);

    const row = await sessionRow(tokens.body.sessionId);
    assert.equal(row.origin, "portal");
    const hours = hoursUntil(row.expires_at);
    assert.ok(hours > 7.5 && hours < 8.5,
      `a portal session should expire in about 8 hours, not ${hours.toFixed(1)}`);
  });

  test("a password sign-in still gets the full 30 days", async () => {
    const emp = employee();
    const authorized = await api("POST", "/api/auth/authorize", {
      email: emp.email, password: DADMIN_PASSWORD,
      state: "y".repeat(24), redirect_uri: CALLBACK,
    });
    assert.equal(authorized.status, 200, JSON.stringify(authorized.body));
    assert.equal(authorized.body.origin, "password");

    const tokens = await api("POST", "/api/auth/token", {
      code: authorized.body.code, state: "y".repeat(24), redirect_uri: CALLBACK,
    });
    const row = await sessionRow(tokens.body.sessionId);
    assert.equal(row.origin, "password");
    const days = hoursUntil(row.expires_at) / 24;
    assert.ok(days > 29 && days < 31, `a password session should last 30 days, not ${days.toFixed(1)}`);
  });

  test("refresh does NOT promote a portal session to 30 days", async () => {
    // Rotation INSERTs a new session row every fifteen minutes. If the origin
    // did not travel with it, the shorter lifetime would survive exactly one
    // refresh and then quietly become a month. This is the test for that.
    const emp = employee();
    const { tokens } = await signInThroughPortal(emp.empId, "z".repeat(24));
    assert.equal(tokens.status, 200, JSON.stringify(tokens.body));

    let refreshToken = tokens.body.refreshToken;
    for (let round = 1; round <= 3; round += 1) {
      const out = await api("POST", "/api/auth/refresh", { refresh_token: refreshToken });
      assert.equal(out.status, 200, `refresh ${round}: ${JSON.stringify(out.body)}`);
      assert.equal(out.body.origin, "portal", `refresh ${round} lost the origin`);
      refreshToken = out.body.refreshToken;

      const row = await db.one(
        "SELECT origin, expires_at FROM sessions WHERE refresh_token_hash = ?",
        [require("../src/lib/tokens").sha256(refreshToken)]
      );
      assert.equal(row.origin, "portal", `refresh ${round} wrote the wrong origin`);
      const hours = hoursUntil(row.expires_at);
      assert.ok(hours < 9,
        `refresh ${round} extended the session to ${(hours / 24).toFixed(1)} days`);
    }
  });

  test("when it ends, it says why instead of just failing", async () => {
    // Somebody who signed in through the portal in the morning and finds Kody
    // signed out in the evening will assume it is broken unless told.
    const emp = employee();
    const { tokens } = await signInThroughPortal(emp.empId, "A".repeat(24));
    await db.query("UPDATE sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?",
      [tokens.body.sessionId]);

    const out = await api("POST", "/api/auth/refresh", { refresh_token: tokens.body.refreshToken });
    assert.equal(out.status, 401);
    assert.equal(out.body.error, "portal_session_ended");
    assert.match(out.body.message, /Dolluz portal/);
    assert.match(out.body.message, /8 hours/);
    assert.match(out.body.message, /30 days/);
  });

  test("an expired password session still says the ordinary thing", async () => {
    const emp = employee();
    const authorized = await api("POST", "/api/auth/authorize", {
      email: emp.email, password: DADMIN_PASSWORD,
      state: "B".repeat(24), redirect_uri: CALLBACK,
    });
    const tokens = await api("POST", "/api/auth/token", {
      code: authorized.body.code, state: "B".repeat(24), redirect_uri: CALLBACK,
    });
    await db.query("UPDATE sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?",
      [tokens.body.sessionId]);

    const out = await api("POST", "/api/auth/refresh", { refresh_token: tokens.body.refreshToken });
    assert.equal(out.status, 401);
    assert.equal(out.body.error, "refresh_expired");
  });

  test("an unrecognised origin gets the shorter life, not the longer one", () => {
    const T = require("../src/lib/tokens");
    const odd = (T.sessionExpiry("something-new").getTime() - Date.now()) / 3600000;
    assert.ok(odd <= 8.1, `a typo lengthened a session to ${(odd / 24).toFixed(1)} days`);
  });
});

/* ===================================================================== */

describe("the portal path still obeys the extension handoff rules", () => {
  test("the code is bound to the state and the callback the extension asked for", async () => {
    const emp = employee();
    const state = "C".repeat(24);
    const authorized = await authorizeThroughPortal(emp.empId, state);
    assert.equal(authorized.status, 200, JSON.stringify(authorized.body));

    // Wrong state, then wrong callback, then right both.
    const wrongState = await api("POST", "/api/auth/token",
      { code: authorized.body.code, state: "D".repeat(24), redirect_uri: CALLBACK });
    assert.equal(wrongState.status, 400);
    assert.equal(wrongState.body.error, "state_mismatch");

    const wrongUri = await api("POST", "/api/auth/token",
      { code: authorized.body.code, state, redirect_uri: "https://evil.example.com/" });
    assert.equal(wrongUri.status, 400);
    assert.equal(wrongUri.body.error, "redirect_mismatch");

    const right = await api("POST", "/api/auth/token",
      { code: authorized.body.code, state, redirect_uri: CALLBACK });
    assert.equal(right.status, 200);
  });

  test("a callback that is not an extension is refused before the exchange", async () => {
    const emp = employee();
    const out = await authorizeThroughPortal(emp.empId, "E".repeat(24),
      "https://evil.example.com/steal");
    assert.equal(out.status, 400);
    assert.equal(out.body.error, "bad_redirect_uri");
  });

  test("the Kody code is single use on the portal path as well", async () => {
    const emp = employee();
    const state = "F".repeat(24);
    // authorizeThroughPortal, not signInThroughPortal: that one redeems the
    // code itself, so this test would be spending an already spent code and
    // passing for the wrong reason.
    const authorized = await authorizeThroughPortal(emp.empId, state);
    assert.equal(authorized.status, 200, JSON.stringify(authorized.body));

    const first = await api("POST", "/api/auth/token",
      { code: authorized.body.code, state, redirect_uri: CALLBACK });
    assert.equal(first.status, 200);
    const second = await api("POST", "/api/auth/token",
      { code: authorized.body.code, state, redirect_uri: CALLBACK });
    assert.equal(second.status, 400);
    assert.equal(second.body.error, "code_used");
  });

  test("an audit row says the session came from the portal", async () => {
    const emp = employee();
    const { tokens } = await signInThroughPortal(emp.empId, "G".repeat(24));
    const row = await db.one(
      `SELECT meta FROM audit_log WHERE action = 'auth.session_issued' AND entity_id = ?`,
      [tokens.body.sessionId]
    );
    assert.ok(row, "no audit row for the session");
    const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
    assert.equal(meta.origin, "portal");
  });
});
