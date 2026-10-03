/**
 * Every suite cleans up after itself, whether it remembers to or not.
 *
 * Four suites have now failed on a SECOND run while passing the first, all for
 * the same reason: they left rows behind, and the next run had a higher bar to
 * clear. The SME queue page is the newest 200 and rows backdated to February
 * fell off it. The unanswered panel is the top 50 by how often a question was
 * asked, and a suite asking 20 times began tying with its own history. The
 * quick switcher reads 200 conversations and the seed user reached 345. The
 * notification digest covers 200 and one user reached 263.
 *
 * Each was fixed where it broke, and the fifth was always going to arrive. So
 * this does it for everyone, in a way a new suite cannot forget: it is loaded
 * into every test process through NODE_OPTIONS by tests/run.js, not imported by
 * any suite.
 *
 * How it works: note the highest id in every table before the suite starts, and
 * delete anything above those marks when the process is about to exit. That
 * catches rows made through HTTP, through the service layer and through raw
 * SQL alike, which is what a helper the suites had to call would not.
 *
 * What it does NOT undo: changes to rows that already existed. A suite that
 * rewrites a seed user's password or flips a setting still has to put it back.
 * That is a different problem and this does not pretend to solve it.
 *
 * Switch it off with KODY_TEST_NO_CLEANUP=1 when a failure needs the rows left
 * in place to look at.
 */
import { after } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

/**
 * The database settings come from the environment, NOT from src/config.
 *
 * This module is loaded before the test file, and requiring src/config here
 * would build and cache it first. Several suites set an environment variable at
 * the top of the file, AUTH_RATE_LOGIN_MAX among them, and expect config to
 * pick it up when the app is required. Importing config from here took that
 * away: auth.test.js ran into the real login rate limit and ten tests failed
 * with 400s and 401s that looked like the application was broken.
 *
 * So this reads what it needs and touches none of the application's modules.
 */
const DB = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const OFF = process.env.KODY_TEST_NO_CLEANUP === "1" || !DB.database;

/**
 * Never in production. This deletes rows, and the only thing standing between
 * it and real data is which database the environment points at, so it checks
 * rather than trusting that nobody will ever run the tests on a server.
 */
if (process.env.NODE_ENV === "production") {
  throw new Error("The test cleanup hook must never load in production.");
}

/** Tables whose rows this must not remove, whatever their id. */
const NEVER = new Set([
  "schema_migrations",   // removing these would make the database look unmigrated
]);

let marks = null;
let pool = null;

const connect = () => mysql.createPool({ ...DB, connectionLimit: 2, timezone: "Z" });

/**
 * Every table with an auto-increment id, read from the schema rather than
 * listed here. A list would be correct until somebody adds a table, which is
 * the same way this problem started.
 */
async function autoIncrementTables(conn) {
  const [rows] = await conn.query(
    `SELECT t.TABLE_NAME AS name
       FROM information_schema.TABLES t
       JOIN information_schema.COLUMNS c
         ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
      WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
        AND c.EXTRA = 'auto_increment'`,
    [DB.database]
  );
  return rows.map(r => r.name).filter(n => !NEVER.has(n));
}

/**
 * Note the marks, then close the connection again.
 *
 * Holding it open would be the obvious thing and is wrong: an open pool is an
 * active handle, the event loop never empties, beforeExit never fires, and the
 * test process hangs for ever instead of exiting. That is exactly what happened
 * the first time this was written.
 */
async function takeMarks() {
  const conn = connect();
  try {
    const tables = await autoIncrementTables(conn);
    const out = new Map();
    for (const table of tables) {
      const [[row]] = await conn.query(`SELECT COALESCE(MAX(id), 0) AS hi FROM \`${table}\``);
      out.set(table, Number(row.hi));
    }
    return out;
  } finally {
    await conn.end();
  }
}

async function sweepBack() {
  if (!marks || marks.size === 0) return;

  // A fresh connection: the suite has finished and closed its own, and this one
  // closes again below so the process can still exit.
  let conn;
  try {
    pool = connect();
    conn = await pool.getConnection();
  } catch (_) {
    return;
  }

  let removed = 0;
  const touched = [];
  try {
    // Order would otherwise matter, and working it out from the foreign keys is
    // a lot of machinery for a test database. Everything above the marks goes
    // together, so nothing can be left pointing at a deleted parent.
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const [table, hi] of marks) {
      const [res] = await conn.query(`DELETE FROM \`${table}\` WHERE id > ?`, [hi]);
      if (res.affectedRows > 0) {
        removed += res.affectedRows;
        touched.push(`${table}:${res.affectedRows}`);
      }
    }
  } catch (err) {
    process.stderr.write(`test cleanup failed: ${err.code || err.message}\n`);
  } finally {
    try { await conn.query("SET FOREIGN_KEY_CHECKS = 1"); } catch (_) { /* closing anyway */ }
    try { conn.release(); } catch (_) { /* already gone */ }
    try { await pool.end(); } catch (_) { /* already ended */ }
  }

  if (removed > 0) {
    const file = (process.argv[1] || "").split(/[\\/]/).pop();
    process.stderr.write(`cleanup ${file}: removed ${removed} rows (${touched.join(", ")})\n`);
  }
}

if (!OFF) {
  marks = await takeMarks();

  // A root after() hook, not process.on("beforeExit").
  //
  // beforeExit fires whenever the event loop happens to be empty, which during
  // an async test run is not the same as "the process is finishing": the first
  // version of this deleted sessions and refresh tokens while auth.test.js was
  // still using them, and nineteen tests failed in ways that looked like the
  // application was broken. after() at the root runs when the file's tests are
  // genuinely done.
  let swept = false;
  after(async () => {
    if (swept) return;
    swept = true;
    await sweepBack();
  });
}

export { takeMarks, sweepBack };
