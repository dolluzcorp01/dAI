"use strict";
/**
 * The extension sign in page (docs/PHASES.md 1.4d).
 *
 * No browser runs here, so the page's own authorize.js is executed in a small
 * DOM of our own, against the REAL server. That covers what actually matters:
 * which callbacks it will show a form for, what it posts, what it does with
 * the code, and what it does when the password is wrong. What it does NOT
 * cover is how any of it looks, which is stated in docs/14-extension.md.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";
const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
process.env.EXTENSION_IDS = EXT_ID;
const CALLBACK = `https://${EXT_ID}.chromiumapp.org/kody`;

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");
const T = require("../src/lib/tokens");

const PAGE_DIR = path.join(__dirname, "..", "public", "extension", "authorize");
const PAGE_SOURCE = fs.readFileSync(path.join(PAGE_DIR, "authorize.js"), "utf8");
const PAGE_HTML = fs.readFileSync(path.join(PAGE_DIR, "index.html"), "utf8");

const EMAIL = "shoban@dolluzcorp.com";
const PASSWORD = "Kody!Dev2026";
let server, base;

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  const u = await db.one("SELECT id FROM users WHERE email = ?", [EMAIL]);
  await authSvc.setPassword(u.id, PASSWORD);
  await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [u.id]);
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");
});

after(async () => {
  server.close();
  await db.pool.end();
});

/**
 * Enough DOM for this page and no more. Every id the HTML declares exists, so
 * a typo in the page shows up as a missing element rather than passing.
 */
function fakeDom({ state, redirectUri, fetchImpl, chromeStub, flow, storage, rawSearch,
                   withoutCrypto }) {
  // Start each element where the HTML starts it, hidden attribute included:
  // the page relies on #refused and #handoff being hidden until it says so.
  const tags = [...PAGE_HTML.matchAll(/<[a-z0-9]+[^>]*\bid="([a-z0-9-]+)"[^>]*>/g)];
  const ids = tags.map(m => m[1]);
  const hiddenAtStart = new Set(tags.filter(m => /\shidden\b/.test(m[0])).map(m => m[1]));
  const elements = new Map();
  const handlers = new Map();

  const makeElement = (id) => ({
    id,
    textContent: "",
    value: "",
    type: id === "password" ? "password" : "",
    hidden: hiddenAtStart.has(id),
    disabled: false,
    children: [],
    focused: false,
    attributes: new Map(attributesInHtml(id)),
    classes: new Set(),
    classList: {
      add(name) { elements.get(id).classes.add(name); },
      remove(name) { elements.get(id).classes.delete(name); },
      contains(name) { return elements.get(id).classes.has(name); },
    },
    focus() { this.focused = true; },
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) { handlers.set(`${id}:${type}`, fn); },
  });
  for (const id of ids) elements.set(id, makeElement(id));

  // Start from the attributes the HTML declares, so aria-pressed is "false"
  // here because the markup says so, not because the stub guessed.
  function attributesInHtml(id) {
    const tag = tags.find(m => m[1] === id);
    if (!tag) return [];
    return [...tag[0].matchAll(/([a-z-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]);
  }

  const navigations = [];
  // rawSearch is the leg back from Inside D, which carries a code or an error
  // and the PORTAL state, and no redirect_uri at all.
  const search = rawSearch !== undefined ? rawSearch
    : `?state=${encodeURIComponent(state)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}&surface=extension`
      + (flow ? `&flow=${flow}` : "");

  const context = {
    document: {
      getElementById: (id) => elements.get(id) || null,
      createElement: (tag) => ({ tag, textContent: "", appendChild() {} }),
      createTextNode: (text) => ({ text }),
    },
    location: {
      search,
      host: "dai.dolluzcorp.com",
      assign: (url) => navigations.push(url),
    },
    URL,
    URLSearchParams,
    console,
    // The page uses relative paths, as a page served from this origin does.
    fetch: fetchImpl || ((url, options) => fetch(`${base}${url}`, options)),
    // Present only when a test asks for it, so the redirect path stays the
    // default exactly as it is in a browser without the extension installed.
    ...(chromeStub ? { chrome: chromeStub } : {}),
    // This tab's own memory, and the browser's generator. Both are absent
    // unless a test supplies them, because the page has to work without
    // either: a private window is exactly that case.
    ...(storage ? { sessionStorage: storage } : {}),
    ...(withoutCrypto ? {} : { crypto: { getRandomValues(bytes) {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 37 + 11) % 256;
      return bytes;
    } } }),
  };
  context.window = context;

  vm.runInNewContext(PAGE_SOURCE, context, { filename: "authorize.js" });

  return {
    el: (id) => elements.get(id),
    navigations,
    // The portal legs are asynchronous: a fetch, then a decision. Nothing in
    // the page is on a timer, so one turn of the loop is enough, and 25ms is
    // one turn plus room for a real request to the local server.
    settle: (ms = 25) => new Promise(r => setTimeout(r, ms)),
    fire: (id, type, event = { preventDefault() {} }) => {
      const fn = handlers.get(`${id}:${type}`);
      assert.ok(fn, `nothing is listening for ${type} on ${id}`);
      return fn(event);
    },
  };
}

/**
 * sessionStorage as a browser gives it: it can also THROW rather than return
 * null, which is what a private window or blocked site data does, and that is
 * the case the page has to survive.
 */
function fakeStorage({ throws = false, start = {} } = {}) {
  const map = new Map(Object.entries(start));
  const writes = [];
  const guard = () => { if (throws) throw new Error("site data is blocked in this window"); };
  return {
    map,
    writes,
    setItem(key, value) { guard(); writes.push([key, String(value)]); map.set(key, String(value)); },
    getItem(key) { guard(); return map.has(key) ? map.get(key) : null; },
    removeItem(key) { guard(); map.delete(key); },
  };
}

const PORTAL_CONFIG = {
  enabled: true,
  authorizeUrl: "https://inside.dolluzcorp.com/authorize",
  clientId: "dai",
  redirectUri: "https://dai.dolluzcorp.com/extension/authorize",
  sessionHours: 8,
};

/**
 * A fetch that answers the portal endpoints from a script and sends everything
 * else to the real server, so the password path in the same test file is still
 * talking to real code.
 */
function portalFetch({ config: cfg = PORTAL_CONFIG, callback: cb, calls = [] } = {}) {
  const impl = (url, options) => {
    const path = String(url);
    calls.push({ path, body: options && options.body ? JSON.parse(options.body) : null });
    if (path.startsWith("/api/auth/portal/config")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => cfg });
    }
    if (path.startsWith("/api/auth/portal/callback")) {
      const answer = cb || { ok: true, status: 200, body: { code: "kody-code", origin: "portal", sessionHours: 8 } };
      return Promise.resolve({ ok: answer.ok, status: answer.status, json: async () => answer.body });
    }
    return fetch(`${base}${path}`, options);
  };
  impl.calls = calls;
  return impl;
}

describe("the page decides whether to show a password field at all", () => {
  test("shows the form for a real extension callback", () => {
    const dom = fakeDom({ state: "a".repeat(24), redirectUri: CALLBACK });
    assert.equal(dom.el("card").hidden, false);
    assert.equal(dom.el("refused").hidden, true);
    assert.equal(dom.el("email").focused, true, "the cursor starts in the email field");
    assert.equal(dom.el("host").textContent, "dai.dolluzcorp.com");
  });

  test("refuses anything that is not an extension callback", () => {
    const bad = [
      "https://evil.example.com/steal",
      "http://evil.example.com/steal",
      "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org.evil.com/kody",
      "https://short.chromiumapp.org/kody",
      "https://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP.chromiumapp.org/kody",
      "javascript:alert(1)",
      "",
    ];
    for (const redirectUri of bad) {
      const dom = fakeDom({ state: "a".repeat(24), redirectUri });
      assert.equal(dom.el("card").hidden, true, `${redirectUri} was shown a password field`);
      assert.equal(dom.el("refused").hidden, false, `${redirectUri} was not refused`);
    }
  });

  test("refuses a missing or trivial state, which is the CSRF guard", () => {
    for (const state of ["", "short"]) {
      const dom = fakeDom({ state, redirectUri: CALLBACK });
      assert.equal(dom.el("card").hidden, true);
      assert.equal(dom.el("refused").hidden, false);
    }
  });

  test("the page and the server agree on which callbacks are acceptable", () => {
    // The server is the authority. The page must not be laxer than it is.
    const cases = [CALLBACK, "https://evil.example.com/x", "https://short.chromiumapp.org/k"];
    for (const uri of cases) {
      const dom = fakeDom({ state: "a".repeat(24), redirectUri: uri });
      const pageAccepts = dom.el("card").hidden === false;
      const serverAccepts = T.isAllowedRedirect(uri);
      assert.equal(pageAccepts, serverAccepts, `${uri}: page ${pageAccepts}, server ${serverAccepts}`);
    }
  });
});

describe("signing in, against the real server", () => {
  test("a correct password hands a usable code to the extension callback", async () => {
    const state = "b".repeat(24);
    const dom = fakeDom({ state, redirectUri: CALLBACK });
    dom.el("email").value = EMAIL;
    dom.el("password").value = PASSWORD;
    await dom.fire("form", "submit");

    assert.equal(dom.navigations.length, 1, "the page did not hand anything back");
    const target = new URL(dom.navigations[0]);
    assert.equal(target.origin, `https://${EXT_ID}.chromiumapp.org`);
    assert.equal(target.searchParams.get("state"), state);
    const code = target.searchParams.get("code");
    assert.ok(code && code.length > 20, "no code in the callback");

    assert.equal(dom.el("handoff").hidden, false, "the handoff screen is not showing");
    assert.equal(dom.el("card").hidden, true);
    assert.equal(dom.el("password").value, "", "the password is still sitting in the page");

    // The code is the real thing: it exchanges for real tokens.
    const res = await fetch(`${base}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.ok(body.accessToken && body.refreshToken);
    assert.equal(body.user.email, EMAIL);

    const again = await fetch(`${base}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
    });
    assert.equal(again.status, 400, "the code was reusable");
  });

  test("a wrong password says so and hands nothing back", async () => {
    const dom = fakeDom({ state: "c".repeat(24), redirectUri: CALLBACK });
    dom.el("email").value = EMAIL;
    dom.el("password").value = "not the password";
    await dom.fire("form", "submit");

    assert.equal(dom.navigations.length, 0, "it navigated anyway");
    assert.equal(dom.el("error").hidden, false);
    assert.match(dom.el("error").textContent, /not right/);
    assert.equal(dom.el("handoff").hidden, true);
    assert.equal(dom.el("submit").disabled, false, "the button never came back");
    assert.equal(dom.el("password").value, "", "the wrong password is still in the page");
  });

  test("an empty form is refused before anything is sent", async () => {
    const dom = fakeDom({ state: "d".repeat(24), redirectUri: CALLBACK });
    await dom.fire("form", "submit");
    assert.equal(dom.navigations.length, 0);
    assert.match(dom.el("error").textContent, /required/);
  });

  test("forgot password points at dAdmin and never says whether the account exists", async () => {
    const dom = fakeDom({ state: "e".repeat(24), redirectUri: CALLBACK });
    dom.el("email").value = "nobody@dolluzcorp.com";
    await dom.fire("forgot", "click");
    assert.match(dom.el("error").textContent, /Dolluz sign-in password/);
    assert.ok(!/no account|not found|unknown/i.test(dom.el("error").textContent));
  });
});

describe("the handoff says when it has finished", () => {
  /** A chrome that accepts the code, as the extension does. */
  const acceptingChrome = (accept) => ({
    runtime: {
      sendMessage(extensionId, message, callback) {
        callback(accept ? { ok: true } : { ok: false, error: "untrusted_origin" });
      },
    },
  });

  test("the spinner becomes a tick and the words change with it", async () => {
    // It used to say "you can close this tab" under a spinner that was still
    // turning. The one thing on the page that moves said wait while the text
    // said done, so it read as still working.
    const dom = fakeDom({
      state: "k".repeat(24), redirectUri: CALLBACK, flow: "tab",
      chromeStub: acceptingChrome(true),
    });
    dom.el("email").value = EMAIL;
    dom.el("password").value = PASSWORD;
    await dom.fire("form", "submit");

    assert.equal(dom.el("handoff").hidden, false);
    assert.ok(dom.el("spinner").classList.contains("done"),
      "the spinner is still spinning after it has finished");
    assert.equal(dom.el("handoff-title").textContent, "Signed in");
    assert.match(dom.el("handoff-note").textContent, /close this tab/);
    assert.equal(dom.navigations.length, 0, "it handed the code over, so it must not redirect");
  });

  test("a chrome that refuses the code falls back to the redirect", async () => {
    // The extension only accepts a message from its own trusted origin. If it
    // says no, the callback redirect is still the way home.
    const dom = fakeDom({
      state: "l".repeat(24), redirectUri: CALLBACK, flow: "tab",
      chromeStub: acceptingChrome(false),
    });
    dom.el("email").value = EMAIL;
    dom.el("password").value = PASSWORD;
    await dom.fire("form", "submit");

    assert.equal(dom.navigations.length, 1, "it should fall back to the callback");
    assert.ok(!dom.el("spinner").classList.contains("done"),
      "nothing finished, so nothing should say it did");
  });
});

describe("the Dolluz portal is asked before a password is", () => {
  /**
   * docs/17-portal-sso.md. Inside D does not exist yet, so the page's whole
   * half of the handoff runs here against a scripted /portal/config: what it
   * sends people to, what it keeps while they are away, what it does with the
   * answer, and every way it can fall back to the password form.
   */
  const STORE_KEY = "kody.portal.request";
  const TRIED_KEY = "kody.portal.tried";

  test("with the portal not configured it does nothing at all", async () => {
    // The state this repository ships in. The Inside D half is a separate
    // repository and does not exist, so the feature has to be inert: the real
    // server answers enabled:false here, and the page must never leave it.
    const storage = fakeStorage();
    const dom = fakeDom({ state: "p".repeat(24), redirectUri: CALLBACK, storage });
    await dom.settle();

    assert.equal(dom.navigations.length, 0, "it sent somebody to a portal that is not configured");
    assert.equal(dom.el("card").hidden, false, "the password form must be there");
    assert.equal(dom.el("checking").hidden, true);
    assert.equal(dom.el("portal-note").hidden, true, "it explained something that did not happen");
    assert.deepEqual(storage.writes, [], "it wrote to the tab for a feature that is off");
  });

  test("with it configured, the person goes to Inside D and not to a password field", async () => {
    const storage = fakeStorage();
    const dom = fakeDom({
      state: "q".repeat(24), redirectUri: CALLBACK, storage, flow: "tab",
      fetchImpl: portalFetch(),
    });
    await dom.settle();

    assert.equal(dom.navigations.length, 1, "nobody was sent to the portal");
    const url = new URL(dom.navigations[0]);
    assert.equal(url.origin + url.pathname, "https://inside.dolluzcorp.com/authorize");
    assert.equal(url.searchParams.get("client_id"), "dai");
    assert.equal(url.searchParams.get("redirect_uri"), PORTAL_CONFIG.redirectUri);
    assert.equal(url.searchParams.get("response_type"), "code");

    // prompt=none is what stops this being a trap. Inside D answers either way
    // and never shows its own sign in page, so somebody with no portal session
    // comes straight back to Kody's form instead of landing somewhere
    // unfamiliar with no way out.
    assert.equal(url.searchParams.get("prompt"), "none");

    // A state of its own, from the browser's generator, long enough to matter.
    const portalState = url.searchParams.get("state");
    assert.match(portalState, /^[0-9a-f]{32}$/);
    assert.notEqual(portalState, "q".repeat(24), "it reused the extension's state");

    // And the card is gone, so nobody starts typing a password into a page
    // that is about to navigate away.
    assert.equal(dom.el("card").hidden, true);
    assert.equal(dom.el("checking").hidden, false);
  });

  test("what the extension asked for is kept, because the URL cannot carry it", async () => {
    // Inside D is given ONE fixed redirect_uri with no query of its own: an
    // allowlist that has to tolerate varying query strings is not much of an
    // allowlist. So the state, the callback and the flow wait in this tab.
    const storage = fakeStorage();
    const dom = fakeDom({
      state: "r".repeat(24), redirectUri: CALLBACK, storage, flow: "tab",
      fetchImpl: portalFetch(),
    });
    await dom.settle();

    const saved = JSON.parse(storage.map.get(STORE_KEY));
    assert.equal(saved.state, "r".repeat(24));
    assert.equal(saved.redirectUri, CALLBACK);
    assert.equal(saved.flow, "tab");
    assert.match(saved.portalState, /^[0-9a-f]{32}$/);
    assert.equal(storage.map.get(TRIED_KEY), "1");

    // Nothing else. A password is never near this, and neither is an email.
    assert.deepEqual(Object.keys(saved).sort(),
      ["flow", "portalState", "redirectUri", "state", "surface"]);
  });

  test("nowhere to keep the state means no round trip", async () => {
    // A private window, or site data blocked. The reply could not be checked
    // on the way back, and a round trip whose answer cannot be checked is
    // worse than asking for a password.
    const storage = fakeStorage({ throws: true });
    const dom = fakeDom({
      state: "s".repeat(24), redirectUri: CALLBACK, storage,
      fetchImpl: portalFetch(),
    });
    await dom.settle();

    assert.equal(dom.navigations.length, 0, "it went anyway, with nothing to compare on return");
    assert.equal(dom.el("card").hidden, false);
    assert.equal(dom.el("portal-note").hidden, false, "it did not say why a password is needed");
    assert.match(dom.el("portal-note").textContent, /password/);
  });

  test("no sessionStorage at all is the same answer, not an exception", async () => {
    // Older or stricter embedders. The page is a password form that works.
    const dom = fakeDom({
      state: "t".repeat(24), redirectUri: CALLBACK, fetchImpl: portalFetch(),
    });
    await dom.settle();
    assert.equal(dom.navigations.length, 0);
    assert.equal(dom.el("card").hidden, false);
  });

  test("no generator means no portal, because the state would not be random", async () => {
    const storage = fakeStorage();
    const dom = fakeDom({
      state: "u".repeat(24), redirectUri: CALLBACK, storage, withoutCrypto: true,
      fetchImpl: portalFetch(),
    });
    await dom.settle();
    assert.equal(dom.navigations.length, 0, "it invented a state value without a generator");
    assert.equal(dom.el("card").hidden, false);
  });

  test("it does not go round a second time", async () => {
    // The loop this prevents: come back from the portal with an error, reload,
    // go again, come back with an error. The marker is set before leaving.
    const storage = fakeStorage({ start: { [TRIED_KEY]: "1" } });
    const dom = fakeDom({
      state: "v".repeat(24), redirectUri: CALLBACK, storage,
      fetchImpl: portalFetch(),
    });
    await dom.settle();
    assert.equal(dom.navigations.length, 0, "it bounced to the portal a second time");
    assert.equal(dom.el("card").hidden, false);
  });

  test("a portal that cannot be asked at all leaves the form exactly as it was", async () => {
    const storage = fakeStorage();
    const dom = fakeDom({
      state: "w".repeat(24), redirectUri: CALLBACK, storage,
      fetchImpl: () => Promise.reject(new Error("offline")),
    });
    await dom.settle();
    assert.equal(dom.navigations.length, 0);
    assert.equal(dom.el("card").hidden, false);
    assert.equal(dom.el("error").hidden, true, "a portal that is down is not a sign in error");
  });
});

describe("coming back from the Dolluz portal", () => {
  const STORE_KEY = "kody.portal.request";

  /** The tab as it is when Inside D sends somebody back. */
  const returning = ({ portalState = "a".repeat(32), stored = true, flow = "tab",
                       code, error, state }) => {
    const request = JSON.stringify({
      portalState, state: "x".repeat(24), redirectUri: CALLBACK, flow, surface: "extension",
    });
    const storage = fakeStorage({ start: stored ? { [STORE_KEY]: request } : {} });
    const params = new URLSearchParams();
    if (code) params.set("code", code);
    if (error) params.set("error", error);
    params.set("state", state === undefined ? portalState : state);
    return { storage, rawSearch: `?${params.toString()}` };
  };

  const chromeAccepting = () => {
    const asked = [];
    return {
      asked,
      runtime: {
        sendMessage(extensionId, message, callback) { asked.push(message); callback({ ok: true }); },
      },
    };
  };

  test("nobody signed in to the portal is a quiet line, not an error", async () => {
    // login_required is what Inside D says when there is no portal session,
    // which is most of the time. Painting that red teaches people to ignore
    // red, so it goes above the form in the colour the page uses for "read
    // this" and the form works as it always did.
    const { storage, rawSearch } = returning({ error: "login_required" });
    const dom = fakeDom({ storage, rawSearch, fetchImpl: portalFetch() });
    await dom.settle();

    assert.equal(dom.el("card").hidden, false, "the password form has to be there");
    assert.equal(dom.el("refused").hidden, true);
    assert.equal(dom.el("error").hidden, true, "not signed in to the portal is not an error");
    assert.equal(dom.el("portal-note").hidden, false);
    assert.match(dom.el("portal-note").textContent, /not signed in to the Dolluz portal/);
    assert.equal(dom.navigations.length, 0);
  });

  test("a portal that refused says the portal refused, not that a password is wrong", async () => {
    const { storage, rawSearch } = returning({ error: "access_denied" });
    const dom = fakeDom({ storage, rawSearch, fetchImpl: portalFetch() });
    await dom.settle();
    assert.match(dom.el("portal-note").textContent, /Dolluz portal did not allow/);
    assert.equal(dom.el("card").hidden, false);
  });

  test("a state that does not match is refused, and nothing is exchanged", async () => {
    // Somebody else's handoff code, pushed at this page. The state was made
    // here, kept here, and never left this origin except as a value Inside D
    // echoes back, so this is the check that catches it.
    const impl = portalFetch();
    const { storage, rawSearch } = returning({ code: "someone-elses-code", state: "b".repeat(32) });
    const dom = fakeDom({ storage, rawSearch, fetchImpl: impl });
    await dom.settle();

    assert.equal(dom.el("refused").hidden, false, "it carried on with a state that did not match");
    assert.equal(dom.el("card").hidden, true);
    assert.ok(!impl.calls.some(c => c.path.includes("/portal/callback")),
      "it exchanged a code whose state did not match");
  });

  test("a tab that never started the trip is refused", async () => {
    const impl = portalFetch();
    const { storage, rawSearch } = returning({ code: "a-code", stored: false });
    const dom = fakeDom({ storage, rawSearch, fetchImpl: impl });
    await dom.settle();

    assert.equal(dom.el("refused").hidden, false);
    assert.match(dom.el("refused-body").textContent, /did not start in this tab/);
    assert.ok(!impl.calls.some(c => c.path.includes("/portal/callback")));
  });

  test("the stored request is used once and dropped", async () => {
    // Otherwise going back in history replays the whole leg.
    const { storage, rawSearch } = returning({ error: "login_required" });
    const dom = fakeDom({ storage, rawSearch, fetchImpl: portalFetch() });
    await dom.settle();
    assert.equal(storage.map.has(STORE_KEY), false, "the request is still sitting in the tab");
  });

  test("a code is swapped on the server, and the extension gets a Kody code", async () => {
    const impl = portalFetch();
    const chromeStub = chromeAccepting();
    const { storage, rawSearch } = returning({ code: "portal-code-1" });
    const dom = fakeDom({ storage, rawSearch, fetchImpl: impl, chromeStub });
    await dom.settle();

    const post = impl.calls.find(c => c.path.includes("/portal/callback"));
    assert.ok(post, "the code was never exchanged");
    assert.equal(post.body.portal_code, "portal-code-1");
    // Bound to what the EXTENSION asked for, recovered from this tab.
    assert.equal(post.body.state, "x".repeat(24));
    assert.equal(post.body.redirect_uri, CALLBACK);

    assert.equal(chromeStub.asked.length, 1, "the extension was never given the code");
    assert.equal(chromeStub.asked[0].code, "kody-code");
    assert.equal(dom.el("handoff").hidden, false);
    assert.equal(dom.el("checking").hidden, true);
    assert.ok(dom.el("spinner").classList.contains("done"));
  });

  test("a portal sign-in says out loud that it lasts hours, not a month", async () => {
    // It is shorter than a password sign-in on purpose. Somebody who is not
    // told that just finds Kody signed out in the evening and reasonably
    // concludes it is broken. docs/17-portal-sso.md.
    const { storage, rawSearch } = returning({ code: "portal-code-2" });
    const dom = fakeDom({
      storage, rawSearch, chromeStub: chromeAccepting(),
      fetchImpl: portalFetch(),
    });
    await dom.settle();

    const note = dom.el("handoff-note").textContent;
    assert.match(note, /8 hours/);
    assert.match(note, /30 days/);
    assert.match(note, /Dolluz portal/);
    assert.match(dom.el("step-1").textContent, /Dolluz portal/);
  });

  test("a password sign-in says nothing about hours, because it has 30 days", async () => {
    const chromeStub = chromeAccepting();
    const dom = fakeDom({
      state: "y".repeat(24), redirectUri: CALLBACK, flow: "tab", chromeStub,
      storage: fakeStorage(),
    });
    dom.el("email").value = EMAIL;
    dom.el("password").value = PASSWORD;
    await dom.fire("form", "submit");
    await dom.settle();

    assert.equal(dom.el("handoff").hidden, false, "the password path broke");
    assert.ok(!/hours/.test(dom.el("handoff-note").textContent),
      `a password sign-in talked about hours: ${dom.el("handoff-note").textContent}`);
  });

  test("an account without Kody access is NOT offered the password form", async () => {
    // The password would be refused for the same reason. Sending them to type
    // one is sending them to fail twice.
    const { storage, rawSearch } = returning({ code: "portal-code-3" });
    const dom = fakeDom({
      storage, rawSearch,
      fetchImpl: portalFetch({
        callback: { ok: false, status: 403, body: { error: "dai_not_enabled" } },
      }),
    });
    await dom.settle();

    assert.equal(dom.el("error").hidden, false, "it said nothing about the real problem");
    assert.match(dom.el("error").textContent, /does not have Kody access/);
    assert.equal(dom.el("portal-note").hidden, true,
      "it suggested a password, which will be refused for the same reason");
  });

  test("a portal that did not answer sends them to the password form, and says so", async () => {
    const { storage, rawSearch } = returning({ code: "portal-code-4" });
    const dom = fakeDom({
      storage, rawSearch,
      fetchImpl: portalFetch({
        callback: { ok: false, status: 502, body: { error: "portal_unreachable" } },
      }),
    });
    await dom.settle();

    assert.equal(dom.el("card").hidden, false);
    assert.equal(dom.el("checking").hidden, true);
    assert.match(dom.el("portal-note").textContent, /did not answer/);
    assert.match(dom.el("portal-note").textContent, /password/);
  });

  test("Kody itself not answering is not blamed on the portal", async () => {
    const { storage, rawSearch } = returning({ code: "portal-code-5" });
    const dom = fakeDom({
      storage, rawSearch,
      fetchImpl: (url) => (String(url).includes("/portal/callback")
        ? Promise.reject(new Error("dropped"))
        : Promise.resolve({ ok: true, status: 200, json: async () => PORTAL_CONFIG })),
    });
    await dom.settle();

    assert.equal(dom.el("card").hidden, false);
    assert.match(dom.el("portal-note").textContent, /Kody did not answer/);
  });
});

describe("which way it hands the code back", () => {
  /** A chrome that records whether it was asked, and accepts. */
  const watchfulChrome = () => {
    const asked = [];
    return {
      asked,
      runtime: {
        sendMessage(extensionId, message, callback) {
          asked.push(message);
          callback({ ok: true });
        },
      },
    };
  };

  const signIn = async (dom) => {
    dom.el("email").value = EMAIL;
    dom.el("password").value = PASSWORD;
    await dom.fire("form", "submit");
  };

  test("flow=webauth redirects, and never messages the extension", async () => {
    // Chrome's own sign in window resolves on the navigation to the callback.
    // Messaging the extension instead leaves Chrome waiting, and the extension
    // closing that window to tidy up looks exactly like the person dismissing
    // it: the sign in works and says "The user did not approve access" at the
    // same time. That is the fault this prevents.
    const chromeStub = watchfulChrome();
    const dom = fakeDom({
      state: "m".repeat(24), redirectUri: CALLBACK, flow: "webauth", chromeStub,
    });
    await signIn(dom);

    assert.equal(chromeStub.asked.length, 0,
      "it messaged the extension inside Chrome's own flow, which causes the race");
    assert.equal(dom.navigations.length, 1, "it must navigate to the callback");
    assert.match(dom.navigations[0], /chromiumapp\.org/);
  });

  test("flow=tab messages the extension, because the redirect goes nowhere", async () => {
    const chromeStub = watchfulChrome();
    const dom = fakeDom({
      state: "n".repeat(24), redirectUri: CALLBACK, flow: "tab", chromeStub,
    });
    await signIn(dom);

    assert.equal(chromeStub.asked.length, 1, "an ordinary tab has to hand the code over");
    assert.equal(chromeStub.asked[0].type, "kody:auth-code");
    assert.equal(dom.navigations.length, 0);
    assert.ok(dom.el("spinner").classList.contains("done"));
  });

  test("no flow at all redirects, which is the path Chrome drives", async () => {
    // An older extension. The safe assumption is the one Chrome is waiting on.
    const chromeStub = watchfulChrome();
    const dom = fakeDom({ state: "o".repeat(24), redirectUri: CALLBACK, chromeStub });
    await signIn(dom);

    assert.equal(chromeStub.asked.length, 0);
    assert.equal(dom.navigations.length, 1);
  });
});

describe("the password field behaves like dAdmin's", () => {
  test("the eye shows and hides, and says which it will do", async () => {
    const dom = fakeDom({ state: "f".repeat(24), redirectUri: CALLBACK });
    const eye = dom.el("toggle-password");
    const field = dom.el("password");

    assert.equal(field.type, "password");
    assert.equal(eye.getAttribute("aria-pressed"), "false");
    assert.equal(eye.getAttribute("aria-label"), "Show password");
    assert.equal(eye.getAttribute("tabindex"), "-1", "the eye must stay out of the tab order");

    await dom.fire("toggle-password", "click");
    assert.equal(field.type, "text");
    assert.equal(eye.getAttribute("aria-pressed"), "true");
    assert.equal(eye.getAttribute("aria-label"), "Hide password");

    await dom.fire("toggle-password", "click");
    assert.equal(field.type, "password");
    assert.equal(eye.getAttribute("aria-label"), "Show password");
  });

  test("Caps Lock is called out, because it is why a right password gets typed wrong", async () => {
    const dom = fakeDom({ state: "g".repeat(24), redirectUri: CALLBACK });
    assert.equal(dom.el("caps").hidden, true);

    await dom.fire("password", "keyup", { getModifierState: (k) => k === "CapsLock" });
    assert.equal(dom.el("caps").hidden, false);

    await dom.fire("password", "keyup", { getModifierState: () => false });
    assert.equal(dom.el("caps").hidden, true);
  });
});

describe("no answer is not the same as a refusal", () => {
  test("a server that is not there does not blame the password", async () => {
    const dom = fakeDom({
      state: "h".repeat(24), redirectUri: CALLBACK,
      fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    dom.el("email").value = EMAIL;
    dom.el("password").value = PASSWORD;
    await dom.fire("form", "submit");

    const said = dom.el("error").textContent;
    assert.match(said, /did not answer/);
    assert.match(said, /was not checked/, "it must say the password was never tested");
    assert.ok(!/password is not right|incorrect/i.test(said), `it blamed the password: ${said}`);
    assert.equal(dom.navigations.length, 0);
    assert.equal(dom.el("submit").disabled, false);
  });

  test("a broken server says so, and does not blame the password either", async () => {
    const dom = fakeDom({
      state: "i".repeat(24), redirectUri: CALLBACK,
      fetchImpl: () => Promise.resolve({
        ok: false, status: 502,
        json: () => Promise.reject(new SyntaxError("not JSON")),
      }),
    });
    dom.el("email").value = EMAIL;
    dom.el("password").value = PASSWORD;
    await dom.fire("form", "submit");

    const said = dom.el("error").textContent;
    assert.match(said, /502/, "the status is what makes this diagnosable");
    assert.ok(!/password is not right/i.test(said), `it blamed the password: ${said}`);
  });

  test("a refused credential still says exactly that", async () => {
    const dom = fakeDom({ state: "j".repeat(24), redirectUri: CALLBACK });
    dom.el("email").value = EMAIL;
    dom.el("password").value = "not the password";
    await dom.fire("form", "submit");
    assert.match(dom.el("error").textContent, /not right/);
    assert.ok(!/did not answer/.test(dom.el("error").textContent));
  });
});

describe("how the page is served", () => {
  test("the page is HTML with its own strict policy and is never cached", async () => {
    const res = await fetch(`${base}/extension/authorize`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);

    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp), `policy is loose: ${csp}`);
    assert.match(csp, /frame-ancestors 'none'/, "a password page must not be framable");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-frame-options"), "DENY");

    const html = await res.text();
    assert.match(html, /Sign in to Kody/);
    const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) || [];
    assert.equal(inline.length, 0, "inline script, which this page's own CSP blocks");
    assert.ok(!/\son\w+=/.test(html), "an inline event handler");
  });

  test("the stylesheet and the script are served, and nothing else is", async () => {
    for (const file of ["authorize.css", "authorize.js", "logo.svg"]) {
      const res = await fetch(`${base}/extension/authorize/${file}`);
      assert.equal(res.status, 200, `${file} is not served`);
    }
    // No directory listing, and nothing outside the folder.
    for (const bad of ["/extension/", "/extension/../src/app.js", "/extension/authorize/logo.svg/../../../src/app.js"]) {
      const res = await fetch(`${base}${bad}`);
      assert.ok(res.status === 404 || res.status === 301, `${bad} returned ${res.status}`);
    }
  });

  test("the page never keeps the password anywhere", () => {
    // Nothing that outlives the tab, ever. localStorage and a cookie would
    // still be there tomorrow and are shared with every other page on this
    // origin, so they stay banned outright.
    assert.ok(!/localStorage|indexedDB|document\.cookie/.test(PAGE_SOURCE),
      "a password page must not persist anything beyond the tab");

    // sessionStorage IS used, for the portal round trip (docs/17-portal-sso.md),
    // and it is reachable in exactly three places: one to write by key, one to
    // read by key, one to remove by key. Nothing in the page can put a literal
    // in storage, which is the property that matters here, and a fourth
    // appearance fails this test rather than being reviewed by hand later.
    // Code lines only. A comment that mentions sessionStorage is a comment, and
    // a test that counted those would be measuring the prose.
    const lines = PAGE_SOURCE.split("\n")
      .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .filter(l => l.includes("sessionStorage"));
    assert.equal(lines.length, 3, `sessionStorage is touched in ${lines.length} places:\n${lines.join("\n")}`);
    assert.match(lines[0], /sessionStorage\.setItem\(key, value\)/);
    assert.match(lines[1], /sessionStorage\.getItem\(key\)/);
    assert.match(lines[2], /sessionStorage\.removeItem\(key\)/);

    assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(PAGE_SOURCE));
    assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(PAGE_SOURCE));
  });

  test("and a password sign-in writes nothing to the tab", async () => {
    // The static check above says a literal cannot be stored. This says that
    // on the path where a password exists, nothing is stored at all.
    const storage = fakeStorage();
    const dom = fakeDom({ state: "H".repeat(24), redirectUri: CALLBACK, storage });
    dom.el("email").value = EMAIL;
    dom.el("password").value = PASSWORD;
    await dom.fire("form", "submit");
    await dom.settle();

    assert.deepEqual(storage.writes, [],
      `the page wrote ${JSON.stringify(storage.writes)} while signing in with a password`);
  });
});
