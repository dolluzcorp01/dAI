"use strict";
/**
 * The .env checker.
 *
 * src/config.js refuses to START on a configuration that is dangerous. This
 * covers the other kind of mistake: the one that starts perfectly well and is
 * simply wrong, which nothing else catches and which a list in a runbook is a
 * weak defence against.
 *
 * Each case here is a mistake that is easy to make and expensive to diagnose.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "check-env.js");

const GOOD = {
  NODE_ENV: "production",
  PORT: "4011",
  PUBLIC_URL: "https://dai.dolluzcorp.com",
  WEB_URL: "https://dai.dolluzcorp.com",
  PASSWORD_RESET_URL: "https://inside.dolluzcorp.com/login",
  DB_PASSWORD: "a-real-password",
  JWT_ACCESS_SECRET: "A".repeat(44),
  JWT_REFRESH_SECRET: "B".repeat(44),
  DADMIN_SHARED_JWT_SECRET: "C".repeat(44),
  EXTENSION_IDS: "ikamkodfpkklimdldhfpnhmmlapdjpmn",
  MODEL_PRIMARY_PROVIDER: "mock",
  MODEL_FALLBACK_PROVIDER: "",
  // The first deploy runs on mock deliberately, and production demands that
  // it be said out loud rather than inferred.
  ALLOW_MOCK_MODEL: "1",
};

/**
 * Run the checker over these values. Returns {code, out}.
 *
 * The values go in as the child's environment rather than through --env-file.
 * --env-file does NOT override a variable that is already set, and this suite
 * runs inside a process that was itself started with the repository's .env, so
 * a temporary file would be ignored and every case would silently test the
 * developer's own configuration instead. That happened once; hence the note.
 */
function check(overrides = {}, args = ["--port", "4011"]) {
  const values = { ...GOOD, ...overrides };
  for (const [k, v] of Object.entries(overrides)) if (v === null) delete values[k];

  // Only what a process needs to start, plus the values under test.
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    ...values,
  };

  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: String(err.stdout || "") + String(err.stderr || "") };
  }
}

describe("a configuration that is right", () => {
  test("passes, and says so", () => {
    const r = check();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Nothing looks like the template/);
  });
});

describe("the mistakes that start fine and are still wrong", () => {
  test("the port nginx does not proxy", () => {
    // The worst of them: the app boots, serves nobody, and the site returns 502
    // until somebody thinks to compare two numbers in two different files.
    const r = check({ PORT: "4014" });
    assert.equal(r.code, 1);
    assert.match(r.out, /PORT/);
    assert.match(r.out, /502/, "it should say what the symptom will be");
  });

  test("a public URL nobody outside the box can reach", () => {
    for (const url of ["http://localhost:4011", "http://127.0.0.1:4011"]) {
      const r = check({ PUBLIC_URL: url });
      assert.equal(r.code, 1, `${url} was accepted`);
      assert.match(r.out, /PUBLIC_URL/);
    }
  });

  test("a fallback provider with no key behind it", () => {
    // Fine until the primary fails, which is the day it was meant to help.
    const r = check({ MODEL_FALLBACK_PROVIDER: "openai" });
    assert.equal(r.code, 1);
    assert.match(r.out, /OPENAI_API_KEY is empty/);
  });

  test("a primary provider with no key behind it", () => {
    const r = check({ MODEL_PRIMARY_PROVIDER: "anthropic" });
    assert.equal(r.code, 1);
    assert.match(r.out, /ANTHROPIC_API_KEY/);
  });
});

describe("secrets", () => {
  test("one secret used twice", () => {
    // An access token would then verify as a refresh token.
    const r = check({ JWT_REFRESH_SECRET: GOOD.JWT_ACCESS_SECRET });
    assert.equal(r.code, 1);
    assert.match(r.out, /same string/);
  });

  test("the dAdmin secret must be its own", () => {
    const r = check({ DADMIN_SHARED_JWT_SECRET: GOOD.JWT_ACCESS_SECRET });
    assert.equal(r.code, 1);
    assert.match(r.out, /DADMIN_SHARED_JWT_SECRET/);
  });

  test("a secret short enough to guess", () => {
    const r = check({ JWT_ACCESS_SECRET: "short" });
    assert.equal(r.code, 1);
    assert.match(r.out, /characters/);
    assert.match(r.out, /openssl rand/, "it should say how to make a good one");
  });

  test("an empty secret or password", () => {
    for (const key of ["JWT_ACCESS_SECRET", "DB_PASSWORD", "DADMIN_SHARED_JWT_SECRET"]) {
      const r = check({ [key]: "" });
      assert.equal(r.code, 1, `${key} empty was accepted`);
      assert.match(r.out, new RegExp(key));
    }
  });
});

describe("the extension", () => {
  test("an id that is not a Chrome id", () => {
    const r = check({ EXTENSION_IDS: "notavalidid" });
    assert.equal(r.code, 1);
    assert.match(r.out, /not a Chrome extension id/);
  });

  test("no id at all, which means nobody can sign in", () => {
    const r = check({ EXTENSION_IDS: "" });
    assert.equal(r.code, 1);
    assert.match(r.out, /cannot sign anyone in/);
  });

  test("two real ids are fine", () => {
    const r = check({ EXTENSION_IDS: "ikamkodfpkklimdldhfpnhmmlapdjpmn,abcdefghijklmnopabcdefghijklmnop" });
    assert.equal(r.code, 0, r.out);
  });
});

describe("what it reports without failing", () => {
  test("mock with the opt-in is a note, because a first deploy runs on it", () => {
    const r = check({ MODEL_PRIMARY_PROVIDER: "mock", ALLOW_MOCK_MODEL: "1" });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /canned/);
    assert.match(r.out, /before anyone relies on an answer/,
      "it should say when to take it out, not just that it is on");
  });

  test("mock in production without the opt-in is an error, since the app will refuse", () => {
    // The app itself refuses this, so the checker should say so before the
    // deploy gets as far as pm2 restarting into a crash loop.
    const r = check({ MODEL_PRIMARY_PROVIDER: "mock", ALLOW_MOCK_MODEL: null });
    assert.equal(r.code, 1);
    assert.match(r.out, /ALLOW_MOCK_MODEL=1/);
  });

  test("it names keys the template has that this file does not", () => {
    // MAIL_FROM, because the template ships it and the checker does not demand
    // it: a key that is merely absent should appear in the note and nowhere
    // else. It used to be DADMIN_RESET_URL, which the template no longer ships
    // uncommented, so the test was passing on a key that was not there either.
    const r = check({ MAIL_FROM: null });
    assert.match(r.out, /not set at all[\s\S]*MAIL_FROM/, "a key dropped entirely should be reported");
  });

  test("the renamed reset URL is accepted under either name, and nagged under the old one", () => {
    // config.js reads PASSWORD_RESET_URL and falls back to DADMIN_RESET_URL, so
    // a box that has not been updated keeps its link. The checker used to
    // require the OLD name, which would have reported a correctly configured
    // box as missing it.
    const current = check();
    assert.equal(current.code, 0, current.out);

    const old = check({ PASSWORD_RESET_URL: null, DADMIN_RESET_URL: "https://inside.dolluzcorp.com/login" });
    assert.equal(old.code, 0, old.out);
    assert.match(old.out, /DADMIN_RESET_URL is the old name/);
    assert.match(old.out, /Rename it/);

    const neither = check({ PASSWORD_RESET_URL: null });
    assert.equal(neither.code, 1);
    assert.match(neither.out, /PASSWORD_RESET_URL/);
  });
});

describe("single sign-on from Inside D (docs/17-portal-sso.md)", () => {
  const PORTAL = {
    PORTAL_CLIENT_ID: "dai",
    PORTAL_CLIENT_SECRET: "D".repeat(44),
    PORTAL_AUTHORIZE_URL: "https://inside.dolluzcorp.com/authorize",
    PORTAL_TOKEN_URL: "https://inside.dolluzcorp.com/oauth/token",
    PORTAL_REDIRECT_URI: "https://dai.dolluzcorp.com/extension/authorize",
  };

  test("none of it set is reported as off, not as broken", () => {
    // Which is how production is configured today. The Inside D half does not
    // exist, and a checker that called that a fault would train people to
    // ignore it.
    const r = check();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /portal sign-on is off/);
    assert.match(r.out, /until Inside D has built its half/);
  });

  test("all five set passes", () => {
    const r = check(PORTAL);
    assert.equal(r.code, 0, r.out);
  });

  test("four of five is caught here, before pm2 restarts into a crash loop", () => {
    for (const missing of Object.keys(PORTAL)) {
      const r = check({ ...PORTAL, [missing]: null });
      assert.equal(r.code, 1, `${missing} missing passed: ${r.out}`);
      assert.match(r.out, /half configured/);
      assert.match(r.out, new RegExp(missing));
    }
  });

  test("the client secret may not be a signing secret", () => {
    for (const other of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "DADMIN_SHARED_JWT_SECRET"]) {
      const r = check({ ...PORTAL, PORTAL_CLIENT_SECRET: GOOD[other] });
      assert.equal(r.code, 1, `${other} reused as the client secret passed: ${r.out}`);
      assert.match(r.out, new RegExp(`same string as ${other}`));
      assert.match(r.out, /signs nothing/);
    }
  });

  test("a short client secret is caught, with the command to make one", () => {
    const r = check({ ...PORTAL, PORTAL_CLIENT_SECRET: "too-short" });
    assert.equal(r.code, 1);
    assert.match(r.out, /openssl rand/);
  });

  test("a portal URL that is not https is caught in production", () => {
    const r = check({ ...PORTAL, PORTAL_TOKEN_URL: "http://inside.dolluzcorp.com/oauth/token" });
    assert.equal(r.code, 1);
    assert.match(r.out, /PORTAL_TOKEN_URL: is http:/);
    assert.match(r.out, /refuses a non-https portal URL/);
  });

  test("a redirect URI that is not on this host is caught", () => {
    // Inside D would send people somewhere this app does not serve, and the
    // round trip would end on somebody else's 404.
    const r = check({ ...PORTAL, PORTAL_REDIRECT_URI: "https://kody.example.com/extension/authorize" });
    assert.equal(r.code, 1);
    assert.match(r.out, /not on PUBLIC_URL/);
  });
});
