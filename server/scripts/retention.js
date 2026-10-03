#!/usr/bin/env node
"use strict";
/**
 * Retention sweep.
 *
 *   node scripts/retention.js                      dry run, says what it would delete
 *   node scripts/retention.js --apply              actually delete
 *   node scripts/retention.js --notifications 60 --digests 180 --apply
 *   node scripts/retention.js --user 42            one person only
 *
 * Dry run unless --apply is passed. Nothing here can be undone, and the whole
 * point of a retention job is that it runs unattended, so it should be possible
 * to see what the next run will do before it does it.
 *
 * What it removes:
 *
 *   notifications   READ ones older than --notifications days. Unread are never
 *                   touched at any age: an unread notification is somebody's
 *                   outstanding work, and it is not the sweeper's business to
 *                   decide they have missed their chance.
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
const CHUNK = 1000;

const TABLES = {
  notifications: {
    /** Read ones only, by when they arrived rather than when they were read. */
    where: "created_at < ? AND read_at IS NOT NULL",
    label: "read notifications",
  },
  digest_runs: {
    where: "created_at < ?",
    label: "digest runs",
  },
};

function parseArgs(argv) {
  const flags = { notifications: 90, digests: 90, apply: false, userIds: [], force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") flags.apply = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--notifications") flags.notifications = Number(argv[++i]);
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
function clauseFor(table, days, userIds) {
  const spec = TABLES[table];
  const where = [spec.where];
  const params = [cutoff(days)];
  if (userIds && userIds.length > 0) {
    where.push(`user_id IN (${userIds.map(() => "?").join(",")})`);
    params.push(...userIds);
  }
  return { sql: where.join(" AND "), params, label: spec.label };
}

/**
 * What a sweep would do, without doing it. Counts rather than estimates: on a
 * table this size the count is cheap, and an estimate that was wrong would make
 * the dry run worthless.
 */
async function plan({ notifications = 90, digests = 90, userIds = [] } = {}) {
  const out = {};
  for (const [table, days] of [["notifications", notifications], ["digest_runs", digests]]) {
    const { sql, params, label } = clauseFor(table, days, userIds);
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${sql}`, params);
    const [[total]] = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
    out[table] = {
      label,
      days,
      olderThan: cutoff(days).toISOString().slice(0, 19).replace("T", " "),
      wouldDelete: Number(row.n),
      total: Number(total.n),
    };
  }

  // Unread, reported so the operator can see what is being left behind and why
  // the number does not match the table size.
  const [[unread]] = await db.query("SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL");
  out.notifications.unreadKept = Number(unread.n);
  return out;
}

/** Delete in chunks, so no single statement holds a long lock. */
async function sweepTable(table, days, userIds) {
  const { sql, params } = clauseFor(table, days, userIds);
  let removed = 0;
  for (;;) {
    const [res] = await db.query(`DELETE FROM ${table} WHERE ${sql} LIMIT ${CHUNK}`, params);
    const n = res.affectedRows || 0;
    removed += n;
    if (n < CHUNK) break;
  }
  return removed;
}

async function sweep({ notifications = 90, digests = 90, userIds = [] } = {}) {
  return {
    notifications: await sweepTable("notifications", notifications, userIds),
    digest_runs: await sweepTable("digest_runs", digests, userIds),
  };
}

/* ---------------- the command line ---------------- */

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  for (const [name, days] of [["--notifications", flags.notifications], ["--digests", flags.digests]]) {
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

  const scope = flags.userIds.length > 0 ? ` for user ${flags.userIds.join(", ")}` : "";
  console.log(flags.apply ? `Retention sweep${scope}` : `Retention sweep, DRY RUN${scope}`);
  console.log("");

  const before = await plan(flags);
  for (const key of Object.keys(TABLES)) {
    const p = before[key];
    console.log(`${p.label}`);
    console.log(`  older than ${p.days} days, so before ${p.olderThan}`);
    console.log(`  ${p.wouldDelete} of ${p.total} rows`);
  }
  console.log(`unread notifications kept, whatever their age: ${before.notifications.unreadKept}`);
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

  console.log(`deleted ${done.notifications} read notifications`);
  console.log(`deleted ${done.digest_runs} digest runs`);
  console.log(`in ${Math.round((Date.now() - started) / 100) / 10}s`);

  const left = after.notifications.wouldDelete + after.digest_runs.wouldDelete;
  if (left > 0) console.log(`WARNING: ${left} rows still match. Something is writing faster than this deletes.`);

  await db.pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("retention sweep failed:", err.message);
    process.exit(1);
  });
}

module.exports = { plan, sweep, parseArgs, MIN_DAYS, CHUNK };
