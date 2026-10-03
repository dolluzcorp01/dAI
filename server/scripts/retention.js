#!/usr/bin/env node
"use strict";
/**
 * Retention sweep.
 *
 *   node scripts/retention.js                      dry run, says what it would delete
 *   node scripts/retention.js --apply              actually delete
 *   node scripts/retention.js --notifications 60 --unread 540 --digests 180 --apply
 *   node scripts/retention.js --user 42            one person only
 *
 * Dry run unless --apply is passed. Nothing here can be undone, and the whole
 * point of a retention job is that it runs unattended, so it should be possible
 * to see what the next run will do before it does it.
 *
 * What it removes:
 *
 *   notifications   READ ones older than --notifications days (90 by default),
 *                   and UNREAD ones older than --unread days (365 by default).
 *
 *                   The two windows are far apart on purpose. An unread
 *                   notification is somebody's outstanding work, right up until
 *                   it obviously is not: a year-old unread notification is noise
 *                   and nobody is going to act on it. Keeping unread rows for
 *                   ever was measured and does not work, because 97.6% of
 *                   notifications are never read. A thumbs down notifies every
 *                   reviewer and most never open it, so a read-only policy
 *                   reclaims about one row in forty and the table grows anyway.
 *
 *                   The real fix is to send fewer, which is a Phase 2 question
 *                   about fan-out and not something a sweeper can answer.
 *   digest_runs     older than --digests days. A log of digest sends, useful for
 *                   a few months and never after that.
 *
 * What it deliberately does NOT remove:
 *
 *   audit_log       an audit trail. Pruning one is a decision about what the
 *                   organisation can still answer for, not a disk-space job, and
 *                   it needs its own approval. This script refuses to touch it,
 *                   and refusing loudly is better than a flag somebody sets at
 *                   two in the morning.
 *   messages        chat history. See docs/PHASES.md on the retention settings
 *                   that enforce nothing: deleting message history is a separate
 *                   decision that nobody has made yet.
 *
 * Deletes run in chunks. One statement removing a hundred thousand rows holds a
 * lock long enough to be noticed on a shared box with one CPU, and the first run
 * after months of accumulation is exactly when that happens.
 */
const db = require("../src/db");

const MIN_DAYS = 7;
const MIN_UNREAD_DAYS = 180;
const CHUNK = 1000;

/**
 * Each rule is one DELETE. Age is measured from when a row arrived, not from
 * when it was read: "after ninety days" is what a person means by it.
 */
const RULES = [
  {
    key: "notificationsRead",
    table: "notifications",
    window: "notifications",
    where: "created_at < ? AND read_at IS NOT NULL",
    label: "read notifications",
  },
  {
    key: "notificationsUnread",
    table: "notifications",
    window: "unread",
    where: "created_at < ? AND read_at IS NULL",
    label: "unread notifications",
  },
  {
    key: "digestRuns",
    table: "digest_runs",
    window: "digests",
    where: "created_at < ?",
    label: "digest runs",
  },
];

function parseArgs(argv) {
  const flags = {
    notifications: 90, unread: 365, digests: 90,
    apply: false, userIds: [], force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") flags.apply = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--notifications") flags.notifications = Number(argv[++i]);
    else if (a === "--unread") flags.unread = Number(argv[++i]);
    else if (a === "--digests") flags.digests = Number(argv[++i]);
    else if (a === "--user") flags.userIds.push(Number(argv[++i]));
    else if (a === "--audit-log") {
      console.error("This script does not prune audit_log. An audit trail is what lets");
      console.error("Dolluz answer for what happened, and shortening it is a decision");
      console.error("about that, not a disk-space job.");
      process.exit(2);
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag ${a}`);
      process.exit(1);
    }
  }
  return flags;
}

const cutoff = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** Build the WHERE and its parameters, including the optional user scope. */
function clauseFor(rule, days, userIds) {
  const where = [rule.where];
  const params = [cutoff(days)];
  if (userIds && userIds.length > 0) {
    where.push(`user_id IN (${userIds.map(() => "?").join(",")})`);
    params.push(...userIds);
  }
  return { sql: where.join(" AND "), params };
}

const windowsFrom = (opts) => ({
  notifications: opts.notifications === undefined ? 90 : opts.notifications,
  unread: opts.unread === undefined ? 365 : opts.unread,
  digests: opts.digests === undefined ? 90 : opts.digests,
});

/**
 * What a sweep would do, without doing it. Counts rather than estimates: on a
 * table this size the count is cheap, and an estimate that was wrong would make
 * the dry run worthless.
 */
async function plan(opts = {}) {
  const windows = windowsFrom(opts);
  const userIds = opts.userIds || [];
  const out = {};

  for (const rule of RULES) {
    const days = windows[rule.window];
    const { sql, params } = clauseFor(rule, days, userIds);
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${rule.table} WHERE ${sql}`, params);
    const [[total]] = await db.query(`SELECT COUNT(*) AS n FROM ${rule.table}`);
    out[rule.key] = {
      label: rule.label,
      table: rule.table,
      days,
      olderThan: cutoff(days).toISOString().slice(0, 19).replace("T", " "),
      wouldDelete: Number(row.n),
      total: Number(total.n),
    };
  }

  // What stays, so the operator can see what is being left behind rather than
  // inferring it from the difference between two numbers.
  const [[keptUnread]] = await db.query(
    `SELECT COUNT(*) AS n FROM notifications
      WHERE read_at IS NULL AND created_at >= ?`, [cutoff(windows.unread)]);
  out.notificationsUnread.keptNewer = Number(keptUnread.n);
  return out;
}

/** Delete in chunks, so no single statement holds a long lock. */
async function sweepRule(rule, days, userIds) {
  const { sql, params } = clauseFor(rule, days, userIds);
  let removed = 0;
  for (;;) {
    const [res] = await db.query(`DELETE FROM ${rule.table} WHERE ${sql} LIMIT ${CHUNK}`, params);
    const n = res.affectedRows || 0;
    removed += n;
    if (n < CHUNK) break;
  }
  return removed;
}

async function sweep(opts = {}) {
  const windows = windowsFrom(opts);
  const userIds = opts.userIds || [];
  const out = {};
  for (const rule of RULES) {
    out[rule.key] = await sweepRule(rule, windows[rule.window], userIds);
  }
  return out;
}

/* ---------------- the command line ---------------- */

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  for (const [name, days] of [["--notifications", flags.notifications],
                             ["--unread", flags.unread], ["--digests", flags.digests]]) {
    if (!Number.isFinite(days) || days <= 0) {
      console.error(`${name} must be a number of days.`);
      process.exit(1);
    }
    if (days < MIN_DAYS && !flags.force) {
      console.error(`${name} ${days} would delete things barely a week old.`);
      console.error(`If that is really what you want, add --force.`);
      process.exit(1);
    }
  }

  // Unread is held to a higher bar than read, because deleting something nobody
  // has seen is a different act from deleting something they have.
  if (flags.unread < MIN_UNREAD_DAYS && !flags.force) {
    console.error(`--unread ${flags.unread} is under ${MIN_UNREAD_DAYS} days.`);
    console.error("An unread notification is somebody's outstanding work until it is");
    console.error("obviously not. If you mean it, add --force.");
    process.exit(1);
  }
  if (flags.unread < flags.notifications && !flags.force) {
    console.error(`--unread ${flags.unread} is shorter than --notifications ${flags.notifications},`);
    console.error("which would delete unread notifications sooner than read ones.");
    process.exit(1);
  }

  const scope = flags.userIds.length > 0 ? ` for user ${flags.userIds.join(", ")}` : "";
  console.log(flags.apply ? `Retention sweep${scope}` : `Retention sweep, DRY RUN${scope}`);
  console.log("");

  const before = await plan(flags);
  for (const rule of RULES) {
    const p = before[rule.key];
    console.log(`${p.label}`);
    console.log(`  older than ${p.days} days, so before ${p.olderThan}`);
    console.log(`  ${p.wouldDelete} of ${p.total} rows`);
  }
  console.log(`unread notifications newer than ${flags.unread} days, kept: ${before.notificationsUnread.keptNewer}`);
  console.log("");
  console.log("audit_log is not touched by this script, at any age.");
  console.log("");

  if (!flags.apply) {
    console.log("Dry run. Nothing was deleted. Add --apply to do it.");
    await db.pool.end();
    return;
  }

  const started = Date.now();
  const done = await sweep(flags);
  const after = await plan(flags);

  console.log(`deleted ${done.notificationsRead} read notifications`);
  console.log(`deleted ${done.notificationsUnread} unread notifications older than ${flags.unread} days`);
  console.log(`deleted ${done.digestRuns} digest runs`);
  console.log(`in ${Math.round((Date.now() - started) / 100) / 10}s`);

  const left = RULES.reduce((n, rule) => n + after[rule.key].wouldDelete, 0);
  if (left > 0) console.log(`WARNING: ${left} rows still match. Something is writing faster than this deletes.`);

  await db.pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("retention sweep failed:", err.message);
    process.exit(1);
  });
}

module.exports = { plan, sweep, parseArgs, RULES, MIN_DAYS, MIN_UNREAD_DAYS, CHUNK };
