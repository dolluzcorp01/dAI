"use strict";
/**
 * The hook that makes every suite clean up after itself.
 *
 * These are guards on three traps that were all hit while writing it, and each
 * one made the application look broken rather than the hook. They are static
 * checks on purpose: the hook's real behaviour is proven by the fact that two
 * consecutive full runs leave the row counts unchanged, which no unit test can
 * assert about itself.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const HELPER = path.join(__dirname, "helpers", "cleanup.mjs");
const RUNNER = path.join(__dirname, "run.js");
const hook = fs.readFileSync(HELPER, "utf8");
const runner = fs.readFileSync(RUNNER, "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

/**
 * Strip comments before grepping. Half of this file's assertions are about
 * things the hook must NOT do, and the hook explains at length why it does not
 * do them. Without this, the explanation fails the test it is explaining.
 */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

describe("the cleanup hook is loaded for every suite", () => {
  test("npm test goes through the runner, not straight to node --test", () => {
    // If this stops being true, nothing loads the hook and suites quietly start
    // leaving rows behind again.
    assert.match(pkg.scripts.test, /tests[/\\]run\.js/,
      "npm test must go through the runner that loads the cleanup hook");
  });

  test("the runner passes the hook through NODE_OPTIONS", () => {
    // Not --import. node --test runs each file in a child process, and --import
    // on the parent does not reach them; NODE_OPTIONS is inherited and does.
    assert.match(runner, /NODE_OPTIONS/,
      "a parent-only --import never reaches the test children");
    assert.match(runner, /cleanup\.mjs/);
    assert.match(runner, /--dirty|KODY_TEST_NO_CLEANUP/,
      "there has to be a way to keep the rows when inspecting a failure");
  });
});

describe("the traps it has already fallen into", () => {
  test("it waits for the suite to finish, rather than for an idle moment", () => {
    // beforeExit fires whenever the event loop happens to be empty, which during
    // an async run is not the same as the process finishing. The first version
    // used it and deleted sessions and refresh tokens while auth.test.js was
    // still using them: ten failures that read like the API was broken.
    assert.ok(!/beforeExit/.test(code(hook)),
      "beforeExit fires mid-run and deletes rows the suite is still using");
    assert.match(hook, /from "node:test"/);
    assert.match(hook, /after\(/, "a root after() hook runs when the file is genuinely done");
  });

  test("it does not load the application's config", () => {
    // Requiring src/config here builds and caches it before the test file runs,
    // and several suites set an environment variable at the top of the file and
    // expect config to pick it up. auth.test.js sets AUTH_RATE_LOGIN_MAX, lost
    // it, and hit the real login rate limit.
    assert.ok(!/require\(["'][^"']*src\/config/.test(code(hook)),
      "loading config here freezes it before suites can set their environment");
    assert.ok(!/require\(["']\.\.\/\.\.\/src\//.test(code(hook)),
      "the hook must not touch the application's modules at all");
    assert.match(hook, /process\.env\.DB_NAME|DB_NAME/, "it reads the database settings itself");
  });

  test("it never empties the migrations table", () => {
    // Deleting those rows would leave a migrated database looking unmigrated,
    // and /health/ready would report not-ready for a reason nobody could find.
    assert.match(hook, /schema_migrations/);
    const never = hook.slice(hook.indexOf("const NEVER"), hook.indexOf("const NEVER") + 300);
    assert.match(never, /schema_migrations/);
  });

  test("it refuses to load in production", () => {
    assert.match(hook, /NODE_ENV === "production"/);
    assert.match(hook, /must never load in production/);
  });

  test("it only removes rows newer than the mark it took", () => {
    // The whole safety property: seed data and anything another run created
    // sits below the mark and is never touched.
    assert.match(hook, /MAX\(id\)/, "it has to know where the suite started");
    assert.match(hook, /WHERE id > \?/, "and only delete above that");
  });
});

describe("tables with no auto-increment id", () => {
  /**
   * The id-based sweep covers every table with an auto-increment column, read
   * from the schema. dai_login_jti has none: it is keyed on the jti itself,
   * because the unique key IS the single-use enforcement (migration 014). So it
   * was never cleaned, and sixty rows survived one run of the suite.
   *
   * The time-based sweep that fixes it then did nothing at all, silently, for a
   * reason worth a test of its own: this pool did not set its session time zone,
   * so NOW() came back in the server's local zone while the rows the suite wrote
   * carried UTC. On an IST box the mark landed five and a half hours in the
   * future and the DELETE matched nothing. A sweep that removes zero rows looks
   * exactly like a sweep with nothing to remove.
   */
  test("are swept by time, from an explicit list", () => {
    assert.match(hook, /const TIME_KEYED = new Map\(/,
      "there is no time-based sweep, so a table without an id is never cleaned");
    assert.match(hook, /\["dai_login_jti", "created_at"\]/,
      "dai_login_jti is not in the list, so it accumulates a row per sign in");
    assert.match(code(hook), /DELETE FROM .+ WHERE .+ >= \?/,
      "the time-based delete is missing");
  });

  test("and this pool speaks UTC, or the mark is hours out", () => {
    // The whole of the bug above, in one line of configuration. src/db.js does
    // the same thing to the application's pool and says why.
    assert.match(code(hook), /SET time_zone = '\+00:00'/,
      "without this, a time-based mark is compared against rows in another zone");
    assert.match(code(hook), /pool\.on\("connection"/,
      "it has to be per connection: a pool hands out more than one");
  });

  test("the mark crosses as a string, not a Date", () => {
    // A DATETIME becomes a JS Date and back, through two conversions that only
    // agree when everything about both zones is right.
    assert.match(code(hook), /DATE_FORMAT\(NOW\(\), '%Y-%m-%d %H:%i:%s'\)/,
      "NOW() should come back formatted, so nothing converts it");
  });

  test("a time-based sweep is still refused for anything on the NEVER list", () => {
    assert.match(code(hook), /if \(NEVER\.has\(table\)\) continue;/,
      "the time-based path skips the NEVER check, so it could empty a table the "
      + "id-based path protects");
  });
});
