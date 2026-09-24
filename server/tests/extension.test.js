"use strict";
/**
 * Extension tests.
 *
 * No browser runs here, so this suite covers three things that can be verified
 * honestly:
 *
 *   1. The manifest is a valid MV3 manifest and every file it names exists.
 *   2. Static safety rules hold: no innerHTML on model output, no eval, no
 *      remote script, and no token reaching the content script.
 *   3. The auth handoff works against the REAL server, with a fake chrome
 *      storage. This is the part most likely to be wrong and it is fully
 *      exercised.
 *
 * What it does NOT cover is stated plainly in docs/14-extension.md.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";
// A real Chrome extension id: thirty two letters a to p. The server only hands
// a code to an id it has been told about.
const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
process.env.EXTENSION_IDS = EXT_ID;
const REDIRECT = `https://${EXT_ID}.chromiumapp.org/kody`;

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");

const EXT = path.join(__dirname, "..", "..", "extension");
const readExt = (rel) => fs.readFileSync(path.join(EXT, rel), "utf8");
const manifest = JSON.parse(readExt("manifest.json"));

const PASSWORD = "Kody!Dev2026";
let server, base, auth, config;

/** A chrome.storage.local that behaves like the real one. */
function fakeStorage() {
  const data = new Map();
  return {
    _data: data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (data.has(k)) out[k] = data.get(k);
      return out;
    },
    async set(patch) { for (const [k, v] of Object.entries(patch)) data.set(k, v); },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) data.delete(k);
    },
  };
}

before(async () => {
  // crypto.getRandomValues is used by randomState
  if (!global.crypto) global.crypto = require("node:crypto").webcrypto;

  auth = await import(`file://${path.join(EXT, "src", "shared", "auth.js")}`);
  config = await import(`file://${path.join(EXT, "src", "shared", "config.js")}`);

  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  const u = await db.one("SELECT id FROM users WHERE email = 'shoban@dolluzcorp.com'");
  await authSvc.setPassword(u.id, PASSWORD);
  await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [u.id]);
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("the manifest", () => {
  test("is Manifest V3", () => {
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.name && manifest.version && manifest.description);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "a store-acceptable version");
  });

  test("has no Manifest V2 keys, which Chrome 139 removed entirely", () => {
    for (const dead of ["background_page", "browser_action", "page_action",
                        "content_security_policy_string", "web_accessible_resources_v2"]) {
      assert.ok(!(dead in manifest), `${dead} must not be present`);
    }
    assert.equal(typeof manifest.background.service_worker, "string",
      "a service worker, not a background page");
    assert.ok(!manifest.background.scripts, "background.scripts is MV2");
  });

  test("every file it names exists on disk", () => {
    const missing = [];
    const check = (rel) => { if (!fs.existsSync(path.join(EXT, rel))) missing.push(rel); };

    check(manifest.background.service_worker);
    check(manifest.action.default_popup);
    check(manifest.side_panel.default_path);
    Object.values(manifest.icons).forEach(check);
    Object.values(manifest.action.default_icon).forEach(check);
    manifest.content_scripts.forEach(cs => {
      (cs.js || []).forEach(check);
      (cs.css || []).forEach(check);
    });
    manifest.web_accessible_resources.forEach(w => w.resources.forEach(check));

    assert.deepEqual(missing, [], `missing files: ${missing.join(", ")}`);
  });

  test("the icons are real PNGs at the right sizes", () => {
    for (const [size, rel] of Object.entries(manifest.icons)) {
      const buf = fs.readFileSync(path.join(EXT, rel));
      assert.equal(buf.slice(1, 4).toString(), "PNG", `${rel} is a PNG`);
      // width and height live at bytes 16 to 24 of the IHDR chunk
      assert.equal(buf.readUInt32BE(16), Number(size), `${rel} is ${size} wide`);
      assert.equal(buf.readUInt32BE(20), Number(size), `${rel} is ${size} tall`);
    }
  });

  test("asks for narrow permissions", () => {
    for (const dangerous of ["<all_urls>", "tabs", "webRequest", "cookies", "debugger",
                             "management", "proxy", "nativeMessaging"]) {
      assert.ok(!manifest.permissions.includes(dangerous),
        `${dangerous} should not be a required permission`);
    }
    assert.deepEqual(manifest.host_permissions, ["https://dai.dolluzcorp.com/*"],
      "only our own API, not every site");
    assert.ok(manifest.optional_permissions.includes("identity"),
      "identity is requested only when the person signs in");
  });

  test("the content script runs on pages but not on identity providers", () => {
    const cs = manifest.content_scripts[0];
    assert.ok(cs.matches.includes("https://*/*"));
    assert.ok(cs.exclude_matches.some(m => m.includes("accounts.google.com")));
    assert.ok(cs.exclude_matches.some(m => m.includes("login.microsoftonline.com")));
    assert.equal(cs.all_frames, false, "one bubble per tab, not one per iframe");
  });

  test("the content security policy forbids remote and inline script", () => {
    const csp = manifest.content_security_policy.extension_pages;
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/unsafe-eval/.test(csp));
    assert.ok(!/unsafe-inline/.test(csp));
    assert.ok(!/https?:/.test(csp), "no remote script origin is allowed");
  });

  test("declares the keyboard shortcuts the prototype promised", () => {
    assert.ok(manifest.commands["toggle-kody"]);
    assert.match(manifest.commands["toggle-kody"].suggested_key.default, /Ctrl\+Shift\+K/);
    assert.ok(manifest.commands["ask-selection"]);
  });
});

describe("static safety", () => {
  /**
   * Strip comments and string literals before grepping. A comment that says
   * "no innerHTML here" would otherwise fail a test looking for innerHTML,
   * which is the test catching its own documentation.
   */
  const code = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

  const files = {
    worker: code(readExt("src/background/service-worker.js")),
    bubble: code(readExt("src/content/bubble.js")),
    panel: code(readExt("src/sidepanel/sidepanel.js")),
    popup: code(readExt("src/popup/popup.js")),
    auth: code(readExt("src/shared/auth.js")),
  };

  test("no file uses eval or the Function constructor", () => {
    for (const [name, src] of Object.entries(files)) {
      assert.ok(!/\beval\s*\(/.test(src), `${name} uses eval`);
      assert.ok(!/new\s+Function\s*\(/.test(src), `${name} uses new Function`);
    }
  });

  test("no file loads a remote script, which the CSP would block anyway", () => {
    for (const [name, src] of Object.entries(files)) {
      assert.ok(!/importScripts\s*\(/.test(src), `${name} uses importScripts`);
      assert.ok(!/<script[^>]+src=["']https?:/.test(src), `${name} injects a remote script`);
    }
  });

  test("the side panel never uses innerHTML on model output", () => {
    assert.ok(!/innerHTML/.test(files.panel),
      "an answer is model output, so it is built with textContent only");
    assert.ok(!/insertAdjacentHTML|outerHTML|document\.write/.test(files.panel));
  });

  test("the bubble never uses innerHTML either", () => {
    assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(files.bubble));
  });

  test("the HTML pages carry no inline script", () => {
    for (const rel of ["src/popup/index.html", "src/sidepanel/index.html"]) {
      const html = readExt(rel);
      const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) || [];
      assert.equal(inline.length, 0, `${rel} has inline script, which the CSP blocks`);
      assert.ok(!/\son\w+=/.test(html), `${rel} has an inline event handler`);
    }
  });

  test("the content script never reads a token", () => {
    assert.ok(!/kody_access|kody_refresh|accessToken|refreshToken/.test(files.bubble),
      "the page's world must never see a token");
    assert.ok(!/shared\/auth/.test(files.bubble),
      "the content script does not even import the auth module");
  });

  test("the worker refuses to hand a token to a content script", () => {
    assert.match(files.worker, /case "kody:token"/);
    const block = files.worker.slice(files.worker.indexOf('case "kody:token"'));
    assert.match(block.slice(0, 400), /fromContentScript/,
      "the token branch checks where the request came from");
  });

  test("external messages are accepted only from the Dolluz site", () => {
    assert.match(files.worker, /onMessageExternal/);
    assert.match(files.worker, /untrusted_origin/);
    assert.match(files.worker, /origin !== SITE_BASE/);
  });

  test("the panel only follows http and https links", () => {
    assert.match(files.panel, /protocol === "http:"/);
    assert.match(files.panel, /protocol === "https:"/);
    assert.match(files.panel, /noreferrer noopener/);
  });

  test("state is generated with crypto, not Math.random", () => {
    assert.match(files.auth, /crypto\.getRandomValues/);
    assert.ok(!/Math\.random/.test(files.auth), "a CSRF guard must not be predictable");
  });
});

/* ---------------- dAI: 1.4c, the side panel and where it points ---------------- */

describe("where the extension talks to", () => {
  test("defaults to production when nothing is configured", async () => {
    const where = await config.endpoints(fakeStorage());
    assert.equal(where.apiBase, "https://dai.dolluzcorp.com");
    assert.equal(where.siteBase, "https://dai.dolluzcorp.com");
    assert.equal(where.isProduction, true);
  });

  test("falls back to production when storage itself fails", async () => {
    const broken = { async get() { throw new Error("no storage"); } };
    const where = await config.endpoints(broken);
    assert.equal(where.isProduction, true);
  });

  test("accepts a local server and reports it is not production", async () => {
    const storage = fakeStorage();
    const set = await config.setEndpoints(
      { apiBase: "http://localhost:4014/", siteBase: "http://127.0.0.1:3000" }, storage);
    assert.equal(set.ok, true);
    assert.equal(set.apiBase, "http://localhost:4014", "the trailing slash is trimmed");

    const where = await config.endpoints(storage);
    assert.equal(where.apiBase, "http://localhost:4014");
    assert.equal(where.siteBase, "http://127.0.0.1:3000");
    assert.equal(where.isProduction, false);
  });

  test("refuses plain http to anywhere but this machine", async () => {
    const storage = fakeStorage();
    for (const bad of ["http://dai.dolluzcorp.com", "http://192.168.1.9:4014",
                       "http://localhost.evil.com", "ftp://localhost:4014",
                       "javascript:alert(1)", "not a url", ""]) {
      const out = await config.setEndpoints({ apiBase: bad, siteBase: bad }, storage);
      assert.equal(out.ok, false, `${bad} was accepted`);
      assert.equal(storage._data.size, 0, `${bad} was written to storage`);
    }
    assert.equal(config.cleanBase("https://dai.example.com/api/"), "https://dai.example.com");
  });

  test("both bases are required together, so sign-in cannot point one way and the API another", async () => {
    const storage = fakeStorage();
    const out = await config.setEndpoints(
      { apiBase: "http://localhost:4014", siteBase: "" }, storage);
    assert.equal(out.ok, false);
    assert.equal(storage._data.size, 0);
  });

  test("clearing puts it back to production", async () => {
    const storage = fakeStorage();
    await config.setEndpoints(
      { apiBase: "http://localhost:4014", siteBase: "http://localhost:3000" }, storage);
    await config.clearEndpoints(storage);
    assert.equal((await config.endpoints(storage)).isProduction, true);
  });

  test("the manifest asks for localhost optionally, never as a granted host", () => {
    assert.deepEqual(manifest.optional_host_permissions,
      ["http://localhost/*", "http://127.0.0.1/*"]);
    for (const host of manifest.host_permissions) {
      assert.ok(host.startsWith("https://"), `${host} is not https`);
      assert.ok(!/localhost|127\.0\.0\.1/.test(host),
        "a shipped build must not hold a local host permission");
    }
  });
});

describe("the side panel", () => {
  const panelSrc = readExt("src/sidepanel/sidepanel.js");
  const panelHtml = readExt("src/sidepanel/index.html");
  const workerSrc = readExt("src/background/service-worker.js");

  test("has the four tabs of the prototype, and Chats says it is Phase 2", () => {
    for (const id of ["tab-ask", "tab-chats", "tab-saved", "tab-history"]) {
      assert.ok(panelHtml.includes(`id="${id}"`), `${id} is missing`);
      assert.ok(panelSrc.includes(id.replace("tab-", "")), `${id} is not wired up`);
    }
    assert.match(panelHtml, /Coming in Phase 2/);
  });

  test("draws the recent codes strip, the points wallet and the feedback buttons", () => {
    assert.match(panelHtml, /id="codes"/);
    assert.match(panelHtml, /id="points"/);
    assert.match(panelSrc, /kody:feedback/);
    assert.match(panelSrc, /kody:points/);
    assert.match(panelSrc, /"Helpful"/);
    assert.match(panelSrc, /"Not helpful"/);
  });

  test("never holds a token and never calls the API itself", () => {
    assert.ok(!/kody_access|kody_refresh|accessToken|refreshToken/.test(panelSrc),
      "the panel asks the worker; only the worker holds tokens");
    assert.ok(!/fetch\s*\(/.test(panelSrc), "every call goes through the worker");
    assert.ok(!/shared\/(api|auth|sdk)/.test(panelSrc),
      "the panel does not import the API client");
  });

  test("the worker answers every message the panel sends", () => {
    const sent = new Set([...panelSrc.matchAll(/type:\s*"(kody:[a-z-]+)"/g)].map(m => m[1]));
    assert.ok(sent.size >= 6, `the panel sends only ${sent.size} kinds of message`);
    for (const type of sent) {
      assert.ok(workerSrc.includes(`case "${type}"`), `the worker has no case for ${type}`);
    }
  });

  test("every API call in the worker refuses when nobody is signed in", () => {
    for (const type of ["kody:ask", "kody:threads", "kody:thread", "kody:feedback", "kody:points"]) {
      const at = workerSrc.indexOf(`case "${type}"`);
      assert.ok(at > 0, `${type} is missing`);
      assert.match(workerSrc.slice(at, at + 260), /isSignedIn\(\)/,
        `${type} does not check the session`);
    }
  });

  test("the vendored SDK is byte for byte the SDK in web/src/api", () => {
    for (const name of ["client.js", "adapters.js", "endpoints.js"]) {
      const shipped = fs.readFileSync(path.join(EXT, "src", "shared", "sdk", name));
      const source = fs.readFileSync(path.join(EXT, "..", "web", "src", "api", name));
      assert.ok(shipped.equals(source),
        `src/shared/sdk/${name} has drifted. Run: node extension/build.js --sync`);
    }
  });
});

describe("the auth handoff, against the real server", () => {
  test("generates a distinct state every time", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(auth.randomState());
    assert.equal(seen.size, 200, "no collisions");
    assert.match(auth.randomState(), /^[0-9a-f]{48}$/);
  });

  test("beginSignIn stores the state and builds the site URL", async () => {
    const storage = fakeStorage();
    const { url, state } = await auth.beginSignIn({
      storage, redirectUri: REDIRECT,
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("state"), state);
    assert.equal(parsed.searchParams.get("redirect_uri"), REDIRECT);
    assert.equal(parsed.searchParams.get("surface"), "extension");

    const stored = await storage.get("kody_oauth_state");
    assert.equal(stored.kody_oauth_state.state, state);
  });

  test("a real code is exchanged for real tokens", async () => {
    const storage = fakeStorage();
    const { state } = await auth.beginSignIn({
      storage, redirectUri: REDIRECT,
    });

    // The site mints the code. This is the real endpoint.
    const res = await fetch(`${base}/api/auth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "shoban@dolluzcorp.com", password: PASSWORD,
        state, redirect_uri: REDIRECT,
      }),
    });
    const minted = await res.json();
    assert.equal(res.status, 200, JSON.stringify(minted));
    assert.ok(minted.code, "the site returned a one time code");
    assert.ok(!minted.accessToken, "no token travels through the redirect");

    const redirect = `https://abc.chromiumapp.org/kody?code=${minted.code}&state=${minted.state}`;
    const out = await auth.completeSignIn(redirect, { storage, apiBase: base });

    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.user.email, "shoban@dolluzcorp.com");

    const tokens = await auth.getTokens(storage);
    assert.ok(tokens.accessToken, "access token stored");
    assert.ok(tokens.refreshToken, "refresh token stored");

    const cleared = await storage.get("kody_oauth_state");
    assert.equal(cleared.kody_oauth_state, undefined, "the state was consumed");
  });

  test("a code cannot be used twice", async () => {
    const storage = fakeStorage();
    const { state } = await auth.beginSignIn({ storage, redirectUri: REDIRECT });
    const minted = await (await fetch(`${base}/api/auth/authorize`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "shoban@dolluzcorp.com", password: PASSWORD,
                             state, redirect_uri: REDIRECT }),
    })).json();

    const url = `https://abc.chromiumapp.org/kody?code=${minted.code}&state=${minted.state}`;
    const first = await auth.completeSignIn(url, { storage, apiBase: base });
    assert.equal(first.ok, true);

    // replay: put the state back and try the same code again
    await storage.set({ kody_oauth_state: { state, createdAt: Date.now() } });
    const second = await auth.completeSignIn(url, { storage, apiBase: base });
    assert.equal(second.ok, false, "a one time code really is one time");
  });

  test("a code minted for a different state is refused before any network call", async () => {
    const storage = fakeStorage();
    await auth.beginSignIn({ storage, redirectUri: REDIRECT });

    let called = false;
    const out = await auth.completeSignIn(
      "https://abc.chromiumapp.org/kody?code=someone-elses&state=not-ours",
      { storage, apiBase: base, fetchImpl: async () => { called = true; } }
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "state_mismatch");
    assert.equal(called, false, "refused locally, the code was never sent");
  });

  test("an expired state is refused", async () => {
    const storage = fakeStorage();
    const { state } = await auth.beginSignIn({ storage, redirectUri: REDIRECT });
    await storage.set({ kody_oauth_state: { state, createdAt: Date.now() - 10 * 60 * 1000 } });

    const out = await auth.completeSignIn(
      `https://abc.chromiumapp.org/kody?code=anything&state=${state}`,
      { storage, apiBase: base }
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "state_expired");
  });

  test("an extension the server does not know is refused a code", async () => {
    const res = await fetch(`${base}/api/auth/authorize`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "shoban@dolluzcorp.com", password: PASSWORD, state: "a".repeat(24),
        redirect_uri: "https://ponmlkjihgfedcbaponmlkjihgfedcba.chromiumapp.org/kody",
      }),
    });
    assert.equal(res.status, 400, "an unlisted extension id gets nothing");
    const body = await res.json();
    assert.equal(body.error, "bad_redirect_uri");
  });

  test("a refusal from the site is surfaced, not swallowed", async () => {
    const storage = fakeStorage();
    const out = await auth.completeSignIn(
      "https://abc.chromiumapp.org/kody?error=access_denied", { storage, apiBase: base }
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "access_denied");
  });
});

describe("refresh behaviour", () => {
  test("refreshes and stores the rotated pair", async () => {
    auth._resetRefresh();
    const storage = fakeStorage();
    const { state } = await auth.beginSignIn({ storage, redirectUri: REDIRECT });
    const minted = await (await fetch(`${base}/api/auth/authorize`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "shoban@dolluzcorp.com", password: PASSWORD,
                             state, redirect_uri: REDIRECT }),
    })).json();
    await auth.completeSignIn(
      `https://abc.chromiumapp.org/kody?code=${minted.code}&state=${minted.state}`,
      { storage, apiBase: base }
    );

    const before = await auth.getTokens(storage);
    const out = await auth.refreshAccessToken({ storage, apiBase: base });
    assert.equal(out.ok, true);

    const after = await auth.getTokens(storage);
    assert.notEqual(after.refreshToken, before.refreshToken, "the refresh token rotated");
    assert.notEqual(after.accessToken, before.accessToken);
  });

  test("ten concurrent refreshes make exactly one request", async () => {
    auth._resetRefresh();
    const storage = fakeStorage();
    const { state } = await auth.beginSignIn({ storage, redirectUri: REDIRECT });
    const minted = await (await fetch(`${base}/api/auth/authorize`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "shoban@dolluzcorp.com", password: PASSWORD,
                             state, redirect_uri: REDIRECT }),
    })).json();
    await auth.completeSignIn(
      `https://abc.chromiumapp.org/kody?code=${minted.code}&state=${minted.state}`,
      { storage, apiBase: base }
    );

    let calls = 0;
    const counting = async (...args) => { calls++; return fetch(...args); };

    // Without a single in-flight refresh, nine of these would present an
    // already rotated token, the server would call it theft, and every session
    // for this user would be revoked.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => auth.refreshAccessToken({ storage, apiBase: base, fetchImpl: counting }))
    );
    assert.ok(results.every(r => r.ok), "all ten resolved successfully");
    assert.equal(calls, 1, "exactly one network refresh");

    // and the session is still alive afterwards
    const { accessToken } = await auth.getTokens(storage);
    const check = await fetch(`${base}/api/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(check.status, 200, "the session survived");
  });

  test("a revoked refresh token clears storage rather than looping", async () => {
    auth._resetRefresh();
    const storage = fakeStorage();
    await storage.set({ kody_access: "stale", kody_refresh: "not-a-real-token" });

    const out = await auth.refreshAccessToken({ storage, apiBase: base });
    assert.equal(out.ok, false);
    assert.equal(out.signedOut, true);

    const tokens = await auth.getTokens(storage);
    assert.equal(tokens.refreshToken, null, "storage was cleared");
  });

  test("apiFetch retries once after a refresh and then gives up", async () => {
    auth._resetRefresh();
    const storage = fakeStorage();
    const { state } = await auth.beginSignIn({ storage, redirectUri: REDIRECT });
    const minted = await (await fetch(`${base}/api/auth/authorize`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "shoban@dolluzcorp.com", password: PASSWORD,
                             state, redirect_uri: REDIRECT }),
    })).json();
    await auth.completeSignIn(
      `https://abc.chromiumapp.org/kody?code=${minted.code}&state=${minted.state}`,
      { storage, apiBase: base }
    );

    // corrupt only the access token
    const good = (await auth.getTokens(storage)).refreshToken;
    await storage.set({ kody_access: "not.a.jwt", kody_refresh: good });

    const res = await auth.apiFetch("/api/users/me", {}, { storage, apiBase: base });
    assert.equal(res.status, 200, "recovered by refreshing rather than signing the person out");
  });
});
