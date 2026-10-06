#!/usr/bin/env node
"use strict";
/**
 * Does this .env look like production, or like the template with a few edits?
 *
 *   node --env-file=.env scripts/check-env.js
 *   node --env-file=.env scripts/check-env.js --port 4011
 *
 * The --env-file matters. Plain `node -e` does not read .env, so a check
 * written without it fails on the first secret and proves nothing about the
 * rest. That mistake was made on 2026-10-05 and is why this file exists as a
 * script rather than a line in a runbook.
 *
 * src/config.js already refuses to start on a configuration that is dangerous:
 * development JWT secrets, no Redis, local disk, a scanner that is not real, a
 * mock model, a memory transport. This is for the other kind of mistake, the
 * one that starts perfectly well and is simply wrong:
 *
 *   PORT left at 4014 while nginx proxies 4011. Boots, serves nobody, and the
 *   site returns 502 until somebody thinks to compare two numbers.
 *   PUBLIC_URL left at localhost. Sign in builds URLs nobody can reach.
 *   MODEL_FALLBACK_PROVIDER left at openai with no OpenAI key. Fine until the
 *   day the primary fails, which is the day it was supposed to help.
 *
 * It reads .env.example to find what the template ships, so a value that is
 * still the template's own is reported rather than needing a list here that
 * somebody has to remember to update.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const EXAMPLE = path.join(ROOT, ".env.example");

const args = process.argv.slice(2);
const expectedPort = (() => {
  const at = args.indexOf("--port");
  return at >= 0 ? args[at + 1] : null;
})();

/** Parse .env.example into key to value, so "unchanged from the template" is knowable. */
function templateValues() {
  const out = new Map();
  if (!fs.existsSync(EXAMPLE)) return out;
  for (const line of fs.readFileSync(EXAMPLE, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const template = templateValues();
const env = process.env;
const isProd = env.NODE_ENV === "production";

const problems = [];
const notes = [];
const fail = (key, said) => problems.push(`${key}: ${said}`);
const note = (said) => notes.push(said);

const looksLocal = (v) => /localhost|127\.0\.0\.1|\[::1\]/i.test(String(v || ""));
const present = (k) => env[k] !== undefined && String(env[k]).trim() !== "";

/* ---------------- is this even production ---------------- */

if (!isProd) {
  note(`NODE_ENV is "${env.NODE_ENV || "unset"}", so the production guards in config.js are off.`);
}

/* ---------------- the ones that start fine and are still wrong ---------------- */

if (expectedPort && String(env.PORT) !== String(expectedPort)) {
  fail("PORT", `is ${env.PORT || "unset"}, and nginx proxies ${expectedPort}. `
    + "The app would boot, serve nobody, and the site would return 502.");
}
if (!expectedPort && template.get("PORT") && String(env.PORT) === template.get("PORT")) {
  note(`PORT is still the template's ${env.PORT}. Pass --port <what nginx proxies> to check it properly.`);
}

for (const key of ["PUBLIC_URL", "WEB_URL", "DADMIN_RESET_URL"]) {
  if (!present(key)) { fail(key, "is empty."); continue; }
  if (isProd && looksLocal(env[key])) {
    fail(key, `points at ${env[key]}, which nobody outside this box can reach.`);
  }
}

/* ---------------- secrets ---------------- */

for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "DADMIN_SHARED_JWT_SECRET", "DB_PASSWORD"]) {
  if (!present(key)) { fail(key, "is empty."); continue; }
  if (template.has(key) && template.get(key) !== "" && env[key] === template.get(key)) {
    fail(key, "is still the value .env.example ships.");
  }
  if (key.endsWith("SECRET") && String(env[key]).length < 32) {
    fail(key, `is ${String(env[key]).length} characters. Use: openssl rand -base64 48`);
  }
}

if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  fail("JWT_REFRESH_SECRET", "is the same string as JWT_ACCESS_SECRET. "
    + "An access token would then be accepted as a refresh token.");
}
if (env.DADMIN_SHARED_JWT_SECRET
    && (env.DADMIN_SHARED_JWT_SECRET === env.JWT_ACCESS_SECRET
        || env.DADMIN_SHARED_JWT_SECRET === env.JWT_REFRESH_SECRET)) {
  fail("DADMIN_SHARED_JWT_SECRET", "is one of this app's own JWT secrets. "
    + "It is shared with dAdmin and must be its own value.");
}

/* ---------------- the extension ---------------- */

if (!present("EXTENSION_IDS")) {
  fail("EXTENSION_IDS", "is empty, so the extension cannot sign anyone in.");
} else {
  for (const id of env.EXTENSION_IDS.split(",").map(s => s.trim()).filter(Boolean)) {
    if (!/^[a-p]{32}$/.test(id)) fail("EXTENSION_IDS", `"${id}" is not a Chrome extension id.`);
  }
}

/* ---------------- the model gateway ---------------- */

const primary = env.MODEL_PRIMARY_PROVIDER;
const fallback = env.MODEL_FALLBACK_PROVIDER;

if (primary === "anthropic" && !present("ANTHROPIC_API_KEY")) {
  fail("ANTHROPIC_API_KEY", "is empty while anthropic is the primary provider.");
}
if (fallback === "openai" && !present("OPENAI_API_KEY")) {
  fail("MODEL_FALLBACK_PROVIDER", "is openai and OPENAI_API_KEY is empty. "
    + "That is fine until the primary fails, which is the day it was meant to help. "
    + "Leave it empty if there is no OpenAI key.");
}
if (fallback === "anthropic" && !present("ANTHROPIC_API_KEY")) {
  fail("MODEL_FALLBACK_PROVIDER", "is anthropic and ANTHROPIC_API_KEY is empty.");
}
if (primary === "mock" || fallback === "mock") {
  if (isProd && env.ALLOW_MOCK_MODEL !== "1") {
    fail("MODEL_PRIMARY_PROVIDER", "is mock and NODE_ENV is production, so the app will "
      + "refuse to start. Set ALLOW_MOCK_MODEL=1 if this is a deliberate plumbing deploy.");
  } else {
    note("THE MOCK PROVIDER IS IN USE: every answer is canned and no model is called. "
      + "Deliberate for a first deploy. Remove it, and ALLOW_MOCK_MODEL, before anyone "
      + "relies on an answer.");
  }
}

/* ---------------- things that only matter in a test environment ---------------- */

if (isProd && present("TEST_REDIRECT")) {
  note("TEST_REDIRECT is set. It is only read by the test suite, so it is harmless here, "
    + "but it suggests this file came from a development copy.");
}
if (isProd && looksLocal(env.ALLOWED_REDIRECT_URIS)) {
  note("ALLOWED_REDIRECT_URIS contains a localhost address. The extension does not need it, "
    + "since EXTENSION_IDS covers the chromiumapp callbacks.");
}

/* ---------------- anything the template has that this file does not ---------------- */

const missing = [...template.keys()].filter(k => env[k] === undefined);
if (missing.length > 0) {
  note(`not set at all, so the code's defaults apply: ${missing.join(", ")}`);
}

/* ---------------- report ---------------- */

console.log(`Checking .env for ${isProd ? "PRODUCTION" : env.NODE_ENV || "an unset NODE_ENV"}`);
console.log("");

for (const n of notes) console.log(`  note    ${n}`);
if (notes.length > 0) console.log("");

if (problems.length === 0) {
  console.log("  Nothing looks like the template. This file is configured for where it is.");
  process.exit(0);
}

for (const p of problems) console.log(`  WRONG   ${p}`);
console.log("");
console.log(`${problems.length} thing${problems.length === 1 ? "" : "s"} to fix.`);
process.exit(1);
