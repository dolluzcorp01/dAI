"use strict";
/**
 * What an error is allowed to put in a log.
 *
 * A mysql2 error carries `sql`: the statement with the values filled in. A Kody
 * question can carry patient detail, so logging the error object writes that
 * detail to disk, where it is kept, shipped and backed up. This suite holds the
 * line in two places: the describer itself, and every handler that logs one.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { describeError } = require("../src/lib/safe-error");

const SRC = path.join(__dirname, "..", "src");
const PHI = "Jane Doe, DOB 1974-03-02, MRN 55012";

/** A mysql2 error, shaped as the driver really builds it. */
function dbError() {
  const err = new Error("ER_NO_SUCH_TABLE: Table 'kody.x' doesn't exist");
  err.code = "ER_NO_SUCH_TABLE";
  err.errno = 1146;
  err.sqlState = "42S02";
  err.sqlMessage = "Table 'kody.x' doesn't exist";
  err.sql = `INSERT INTO kody_messages (body) VALUES ('Why was the claim for ${PHI} denied?')`;
  return err;
}

describe("the describer", () => {
  test("keeps the sql, and everything in it, out of the line", () => {
    const line = describeError(dbError());
    assert.ok(!line.includes(PHI), `the patient detail is in the log line: ${line}`);
    assert.ok(!/INSERT INTO|SELECT |UPDATE |DELETE /.test(line), `a statement is in the line: ${line}`);
    assert.ok(!line.includes("VALUES"), "values reached the line");
  });

  test("still says enough to find the fault", () => {
    const line = describeError(dbError());
    assert.match(line, /ER_NO_SUCH_TABLE/, "the driver code is what you search for");
    assert.match(line, /errno 1146/);
    assert.match(line, /sqlState 42S02/);
  });

  test("caps the message, so nothing arrives by being long", () => {
    const err = new Error("x".repeat(5000) + PHI);
    const line = describeError(err);
    assert.ok(line.length < 700, `the line is ${line.length} characters`);
    assert.ok(!line.includes(PHI));
  });

  test("survives what is not an error at all", () => {
    assert.equal(typeof describeError(null), "string");
    assert.equal(typeof describeError(undefined), "string");
    assert.equal(typeof describeError("a string"), "string");
    assert.equal(typeof describeError(42), "string");
    assert.equal(typeof describeError({}), "string");
  });

  test("names the frame inside our own code, not the driver's", () => {
    const err = dbError();
    err.stack = [
      "Error: boom",
      "    at PromisePool.query (C:/app/node_modules/mysql2/promise.js:36:22)",
      "    at Object.query (C:/app/server/src/db.js:41:15)",
      "    at ask (C:/app/server/src/services/kody.service.js:120:3)",
    ].join("\n");
    const line = describeError(err);
    assert.match(line, /db\.js:41/, "the first frame in our source is the useful one");
    assert.ok(!line.includes("node_modules"), "a driver frame is noise");
  });
});

describe("no handler logs an error object", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });

  test("every console.error passes a described string, never the error", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      if (!file.endsWith(".js")) continue;
      const rel = path.relative(SRC, file);
      if (rel === path.join("lib", "safe-error.js")) continue;   // the describer itself

      const src = fs.readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

      for (const call of src.match(/console\.error\([^)]*\)/g) || []) {
        // Passing a bare identifier that looks like an error is the fault. A
        // property of one (err.message, err.code) is fine, and so is a string.
        if (/,\s*(err|error|e)\s*\)/.test(call)) offenders.push(`${rel}: ${call.trim()}`);
      }
    }
    assert.deepEqual(offenders, [],
      `these would write err.sql to the log:\n  ${offenders.join("\n  ")}`);
  });

  test("the handlers that catch unknown faults use logError", () => {
    // The nine route handlers plus the app's last resort. These are the ones a
    // failed query actually reaches.
    const expected = [
      "app.js",
      path.join("middleware", "dadmin-service.js"),
      path.join("routes", "admin.routes.js"),
      path.join("routes", "auth.routes.js"),
      path.join("routes", "chat.routes.js"),
      path.join("routes", "files.routes.js"),
      path.join("routes", "knowledge.routes.js"),
      path.join("routes", "kody.routes.js"),
      path.join("routes", "notifications.routes.js"),
      path.join("routes", "search.routes.js"),
      path.join("routes", "users.routes.js"),
    ];
    for (const rel of expected) {
      const src = fs.readFileSync(path.join(SRC, rel), "utf8");
      assert.match(src, /logError\(/, `${rel} does not use logError`);
      assert.match(src, /require\(".*lib\/safe-error"\)/, `${rel} does not import it`);
    }
  });
});
