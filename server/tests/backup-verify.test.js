"use strict";
/**
 * What backup.sh will and will not call a good dump.
 *
 * Exercised through `backup.sh --verify-only` against dumps crafted here, so it
 * needs no database and no server. That matters: the case that caused this
 * suite to exist is a database with no tables, which is awkward to produce on a
 * machine where the only database you have is the one the tests use.
 *
 * The four failures this guards are the four ways a backup job runs green for
 * months and gives you nothing on the day: too small, unreadable, truncated,
 * or missing the tables that matter.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "..", "deploy", "backup.sh");
const FOOTER = "-- Dump completed on 2026-10-06  3:00:00\n";

function dumpWith(sql) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kody-dump-")), "kody-test.sql.gz");
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(sql, "utf8")));
  return file;
}

/**
 * A dump that looks like mysqldump's output for these tables.
 *
 * The padding is random hex, not repeated characters. The size check measures
 * the GZIPPED file, and 20 KB of the same character compresses to under 300
 * bytes, so a first attempt at this produced "dumps" that tripped the size
 * floor and tested nothing they were meant to.
 */
const dumpOf = (tables, { footer = true, padding = 40000 } = {}) => dumpWith(
  "-- MySQL dump 10.13\n"
  + tables.map(t => `DROP TABLE IF EXISTS \`${t}\`;\nCREATE TABLE \`${t}\` (\n  \`id\` bigint NOT NULL\n);\n`).join("")
  + "-- " + require("node:crypto").randomBytes(padding / 2).toString("hex") + "\n"
  + (footer ? FOOTER : "")
);

function verify(file) {
  try {
    const out = execFileSync("bash", [SCRIPT, "--verify-only", file],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (err) {
    // Rule 7: if bash is not here this cannot run, and an unrunnable check is
    // not a pass. Fail loudly rather than skipping.
    if (err.code === "ENOENT") assert.fail("bash is not available, so backup.sh cannot be verified");
    return { code: err.status, out: String(err.stdout || "") + String(err.stderr || "") };
  }
}

const REQUIRED = ["users", "messages", "conversations", "schema_migrations"];

describe("a dump it accepts", () => {
  test("all four required tables, complete, big enough", () => {
    const r = verify(dumpOf([...REQUIRED, "kody_messages", "notifications"]));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /verified/);
  });
});

describe("a database that has not been migrated yet", () => {
  test("no tables at all is not a failure, it is a first deploy", () => {
    // This is the case that mattered: on the first deploy the schema does not
    // exist, and failing here would stop the deploy that creates it.
    const r = verify(dumpOf([]));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /not been migrated yet/);
    assert.match(r.out, /not a failure/);
  });

  test("and the size floor does not fire on it either", () => {
    const r = verify(dumpWith("-- MySQL dump 10.13\n" + FOOTER));
    assert.equal(r.code, 0, r.out);
  });
});

describe("the four ways a backup is worthless", () => {
  test("missing a table that matters", () => {
    const r = verify(dumpOf(["users", "messages", "conversations"]));
    assert.equal(r.code, 1);
    assert.match(r.out, /schema_migrations/);
    assert.match(r.out, /Wrong database, or the dump was filtered/);
  });

  test("stopped partway, with no completion marker", () => {
    const r = verify(dumpOf(REQUIRED, { footer: false }));
    assert.equal(r.code, 1);
    assert.match(r.out, /stopped partway/);
  });

  test("small, yet it claims to contain tables", () => {
    // Truncated: a real schema would never fit in a few hundred bytes.
    const r = verify(dumpOf(REQUIRED, { padding: 10 }));
    assert.equal(r.code, 1);
    assert.match(r.out, /truncated it/);
  });

  test("not readable as gzip at all", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kody-dump-")), "broken.sql.gz");
    fs.writeFileSync(file, Buffer.from("this is not gzip, it is an error message from mysqldump"));
    const r = verify(file);
    assert.equal(r.code, 1);
    assert.match(r.out, /gzip cannot read/);
  });

  test("not there at all", () => {
    const r = verify(path.join(os.tmpdir(), "kody-no-such-dump.sql.gz"));
    assert.equal(r.code, 1);
    assert.match(r.out, /no such dump/);
  });
});
