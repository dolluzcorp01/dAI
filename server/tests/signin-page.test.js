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
function fakeDom({ state, redirectUri }) {
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
    hidden: hiddenAtStart.has(id),
    disabled: false,
    children: [],
    focused: false,
    focus() { this.focused = true; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) { handlers.set(`${id}:${type}`, fn); },
  });
  for (const id of ids) elements.set(id, makeElement(id));

  const navigations = [];
  const search = `?state=${encodeURIComponent(state)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}&surface=extension`;

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
    fetch: (url, options) => fetch(`${base}${url}`, options),
  };
  context.window = context;

  vm.runInNewContext(PAGE_SOURCE, context, { filename: "authorize.js" });

  return {
    el: (id) => elements.get(id),
    navigations,
    fire: (id, type, event = { preventDefault() {} }) => {
      const fn = handlers.get(`${id}:${type}`);
      assert.ok(fn, `nothing is listening for ${type} on ${id}`);
      return fn(event);
    },
  };
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
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(PAGE_SOURCE),
      "a password page must not persist anything");
    assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(PAGE_SOURCE));
    assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(PAGE_SOURCE));
  });
});
