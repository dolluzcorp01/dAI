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
