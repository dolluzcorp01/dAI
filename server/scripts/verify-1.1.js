#!/usr/bin/env node
"use strict";
/**
 * Done-check for docs/PHASES.md item 1.1, run by hand against a live API.
 *
 *   node scripts/verify-1.1.js
 *
 * It asks for the dAdmin password with the echo off and prints no password and
 * no token. It reads dadmin.employee (the granted columns only) and never
 * writes to dadmin: the app_dAI toggle is flipped by you, in dAdmin, and this
 * script refuses to continue until the column actually reads what the step
 * needs. A step that cannot be set up properly stops the run rather than
 * passing (CLAUDE.md: a check that cannot run is inconclusive, never a pass).
 *
 * Why there are two sessions: refresh rotates, and rotating revokes the old
 * session row. Checking the rotated-away token proves nothing, because it is
 * dead either way. Session B is opened separately, is proven alive AFTER
 * session A rotates, and is only then expected to die when access is removed.
 */
const path = require("path");
const readline = require("readline");

try { process.loadEnvFile(path.join(__dirname, "..", "..", ".env")); }
catch (_) { /* running with --env-file, or no .env: config falls back to defaults */ }

const config = require("../src/config");
const db = require("../src/db");

const BASE = process.env.DAI_BASE || `http://127.0.0.1:${config.port}`;
const EMP_ID = process.env.DAI_EMP_ID || "DZIND148";

let passes = 0;
let failures = 0;

const check = (label, ok, detail) => {
  if (ok) passes += 1; else failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
};

const post = async (p, body, token) => {
  const res = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body || {}),
  });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json || {} };
};

const get = async (p, token) => {
  const res = await fetch(BASE + p, { headers: token ? { Authorization: "Bearer " + token } : {} });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json || {} };
};

/** Password prompt with the echo off. */
function askPassword(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) return reject(new Error("Run this in a terminal: it prompts for a password."));
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let value = "";
    const onData = (char) => {
      if (char === "\r" || char === "\n") {
        input.setRawMode(false); input.pause(); input.removeListener("data", onData);
        process.stdout.write("\n"); return resolve(value);
      }
      if (char === "\u0003") {                       // ctrl C
        input.setRawMode(false); input.pause(); process.stdout.write("\n"); process.exit(130);
      }
      if (char === "\u007f" || char === "\b") { value = value.slice(0, -1); return; }
      value += char;
    };
    input.on("data", onData);
  });
}

const ask = (question) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(question, (a) => { rl.close(); resolve(a); });
});

/** The nine granted columns are all this may read. */
const readEmployee = () => db.one(
  `SELECT emp_id AS empId, emp_mail_id AS email, active, deleted_time AS deletedTime, app_dAI AS appDai
     FROM \`${config.dadmin.dbName}\`.employee WHERE emp_id = ? LIMIT 1`,
  [EMP_ID]
);

/**
 * Wait until dadmin actually reads the value this step needs. The toggle lives
 * in dAdmin App Configuration, which needs "Edit access" clicked before it
 * saves, so a run can otherwise continue against a value that never changed.
 */
async function requireAppDai(expected, instruction) {
  for (;;) {
    const row = await readEmployee();
    if (!row) throw new Error(`${EMP_ID} is not in ${config.dadmin.dbName}.employee`);
    if (Number(row.appDai) === expected) {
      console.log(`    dadmin.employee.app_dAI reads ${expected}, as this step needs.`);
      return row;
    }
    console.log(`\n${instruction}`);
    console.log(`    app_dAI currently reads ${row.appDai}, this step needs ${expected}.`);
    const answer = await ask("Press Enter to re-read, or type skip to abandon the run: ");
    if (answer.trim().toLowerCase() === "skip") throw new Error("abandoned: app_dAI was never set to " + expected);
  }
}

(async () => {
  console.log(`dAI 1.1 done-check
  API:      ${BASE}
  employee: ${EMP_ID} in ${config.dadmin.dbName}.employee
`);

  const health = await get("/health").catch(() => ({ status: 0 }));
  if (health.status !== 200) {
    console.error(`The API is not answering on ${BASE}. Start it with: cd server && npm run dev`);
    await db.end(); process.exit(1);
  }

  const employee = await requireAppDai(1, "Turn app_dAI ON for this employee in dAdmin App Configuration.");
  const EMAIL = employee.email;
  console.log(`    signing in as ${EMAIL}\n`);

  const existedBefore = await db.one("SELECT id FROM users WHERE emp_id = ?", [EMP_ID]);
  console.log(`Kody user for ${EMP_ID} before this run: ${existedBefore ? "id " + existedBefore.id : "none"}\n`);

  const password = await askPassword("dAdmin password (not echoed, not stored): ");
  console.log("");

  /* ---- sign in, session A ---- */
  const a = await post("/api/auth/login", { email: EMAIL, password });
  check("sign in with dAdmin credentials", a.status === 200, `HTTP ${a.status}${a.status !== 200 ? " " + JSON.stringify(a.body) : ""}`);
  if (a.status !== 200) { await db.end(); process.exit(1); }
  console.log(`    user ${JSON.stringify(a.body.user)}  roles ${JSON.stringify(a.body.roles)}`);

  const user = await db.one(
    "SELECT id, emp_id AS empId, email, full_name AS fullName, initials FROM users WHERE emp_id = ?", [EMP_ID]);
  check("the Kody user exists and carries the emp_id", !!user && user.empId === EMP_ID, JSON.stringify(user));
  check("nobody created it by hand", !existedBefore || existedBefore.id === user.id,
    existedBefore ? "it already existed from an earlier run, which is the same row" : "created by signing in");

  const me = await get("/api/auth/me", a.body.accessToken);
  check("the issued access token works", me.status === 200, `HTTP ${me.status}`);

  const answer = await post("/api/kody/ask", { question: "CO-45" }, a.body.accessToken);
  check("asks Kody as this user", answer.status === 200 && answer.body.message && answer.body.message.tier === 0,
    answer.status === 200 ? `tier ${answer.body.message.tier}, as of ${answer.body.message.sourceAsOf}` : JSON.stringify(answer.body));

  /* ---- session B: a second surface, never rotated ---- */
  const b = await post("/api/auth/login", { email: EMAIL, password, surface: "extension" });
  check("a second sign-in opens an independent session", b.status === 200, `HTTP ${b.status}`);
  if (b.status !== 200) { await db.end(); process.exit(1); }

  /* ---- rotate A, and prove B is unaffected ---- */
  const a2 = await post("/api/auth/refresh", { refresh_token: a.body.refreshToken });
  check("refresh works while access remains", a2.status === 200, `HTTP ${a2.status}`);

  const bAfterRotation = await get("/api/auth/me", b.body.accessToken);
  check("session B is alive AFTER session A rotated", bAfterRotation.status === 200,
    `HTTP ${bAfterRotation.status}. This is what stops the revocation check below passing for the wrong reason.`);
  if (bAfterRotation.status !== 200) {
    console.error("\nSession B died before access was removed, so the next check would prove nothing. Stopping.");
    await db.end(); process.exit(1);
  }

  /* ---- remove access in dAdmin ---- */
  await requireAppDai(0, "Now turn app_dAI OFF for this employee in dAdmin App Configuration (click Edit access first).");

  const refused = await post("/api/auth/refresh", { refresh_token: a2.body.refreshToken });
  check("refresh is refused once app_dAI is off",
    refused.status === 403 && refused.body.error === "dai_not_enabled",
    `HTTP ${refused.status} ${refused.body.error || ""}`);

  const bAfterRevoke = await get("/api/auth/me", b.body.accessToken);
  check("the other live session is revoked too, with session_revoked",
    bAfterRevoke.status === 401 && bAfterRevoke.body.error === "session_revoked",
    `HTTP ${bAfterRevoke.status} ${bAfterRevoke.body.error || ""}`);

  const live = await db.one(
    `SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE u.emp_id = ? AND s.revoked_at IS NULL`, [EMP_ID]);
  check("no live session is left for this employee", Number(live.n) === 0, `${live.n} live`);

  const reason = await db.one(
    `SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE u.emp_id = ? AND s.revoked_reason = 'dadmin_access_revoked'`, [EMP_ID]);
  check("the sessions say why they were revoked", Number(reason.n) > 0, `${reason.n} row(s) marked dadmin_access_revoked`);

  const loginOff = await post("/api/auth/login", { email: EMAIL, password });
  check("signing in again is refused while app_dAI is off",
    loginOff.status === 403 && loginOff.body.error === "dai_not_enabled",
    `HTTP ${loginOff.status} ${loginOff.body.error || ""}`);

  /* ---- restore access ---- */
  await requireAppDai(1, "Now turn app_dAI back ON for this employee.");

  const back = await post("/api/auth/login", { email: EMAIL, password });
  check("signing in works again once it is on", back.status === 200, `HTTP ${back.status}`);

  const rows = await db.one("SELECT COUNT(*) AS n FROM users WHERE emp_id = ?", [EMP_ID]);
  check("still exactly one Kody user for this employee", Number(rows.n) === 1, `${rows.n} row(s)`);

  console.log(`\n${passes} passed, ${failures} failed.`);
  console.log("No password and no token was printed or stored by this script.");
  await db.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error("\ncheck stopped:", err.message);
  try { await db.end(); } catch (_) {}
  process.exit(1);
});
