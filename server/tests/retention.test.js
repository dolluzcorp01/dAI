"use strict";
/**
 * The retention sweep.
 *
 * This suite creates its own user and its own rows, backdates them, and asserts
 * on those alone (module rule 16). It scopes every call to that user, so it can
 * never delete another suite's rows and a failure here is never somebody else's
 * data disappearing.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

const db = require("../src/db");
const retention = require("../scripts/retention");

const stamp = Date.now().toString(36);
let userId;

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** A notification this suite owns, at a chosen age and read state. */
async function makeNotification({ age, read }) {
  const [res] = await db.query(
    `INSERT INTO notifications (user_id, kind, title, body, created_at, read_at)
     VALUES (?, 'sme', ?, 'body', ?, ?)`,
    [userId, `retention ${stamp}`, daysAgo(age), read ? daysAgo(age) : null]
  );
  return res.insertId;
}

async function makeDigestRun({ age }) {
  const [res] = await db.query(
    `INSERT INTO digest_runs (user_id, notifications, transport, status, created_at)
     VALUES (?, 1, 'email', 'sent', ?)`,
    [userId, daysAgo(age)]
  );
  return res.insertId;
}

const countMine = async (table) => {
  const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [userId]);
  return Number(row.n);
};

before(async () => {
  const [res] = await db.query(
    "INSERT INTO users (email, full_name, initials, is_active) VALUES (?,?,?,1)",
    [`retention-${stamp}@example.com`, `Retention ${stamp}`, "RT"]
  );
  userId = res.insertId;
});

after(async () => {
  // Take everything back out, including the user, so the next run starts clean.
  await db.query("DELETE FROM notifications WHERE user_id = ?", [userId]);
  await db.query("DELETE FROM digest_runs WHERE user_id = ?", [userId]);
  await db.query("DELETE FROM users WHERE id = ?", [userId]);
  await db.pool.end();
});

describe("what it would delete", () => {
  test("counts read notifications past the cutoff, and no others", async () => {
    await makeNotification({ age: 200, read: true });    // goes
    await makeNotification({ age: 200, read: true });    // goes
    await makeNotification({ age: 200, read: false });   // stays: unread
    await makeNotification({ age: 5, read: true });      // stays: recent

    const out = await retention.plan({ notifications: 90, digests: 90, userIds: [userId] });
    assert.equal(out.notifications.wouldDelete, 2,
      "only the old read ones, not the unread one and not the recent one");
  });

  test("a dry run changes nothing", async () => {
    const beforeCount = await countMine("notifications");
    await retention.plan({ notifications: 90, digests: 90, userIds: [userId] });
    assert.equal(await countMine("notifications"), beforeCount,
      "plan() is the dry run, and a dry run that deletes is worse than no dry run");
  });
});

describe("what it deletes", () => {
  test("old read notifications go, unread stay at any age", async () => {
    await db.query("DELETE FROM notifications WHERE user_id = ?", [userId]);
    const old1 = await makeNotification({ age: 400, read: true });
    const unreadAncient = await makeNotification({ age: 400, read: false });
    const recentRead = await makeNotification({ age: 10, read: true });

    const done = await retention.sweep({ notifications: 90, digests: 90, userIds: [userId] });
    assert.equal(done.notifications, 1);

    const [rows] = await db.query("SELECT id FROM notifications WHERE user_id = ?", [userId]);
    const left = rows.map(r => Number(r.id));
    assert.ok(!left.includes(Number(old1)), "the old read one should be gone");
    assert.ok(left.includes(Number(unreadAncient)),
      "an unread notification is somebody's outstanding work, at any age");
    assert.ok(left.includes(Number(recentRead)), "ten days old is not old");
  });

  test("digest runs go by age alone", async () => {
    await db.query("DELETE FROM digest_runs WHERE user_id = ?", [userId]);
    await makeDigestRun({ age: 400 });
    await makeDigestRun({ age: 100 });
    const recent = await makeDigestRun({ age: 3 });

    const done = await retention.sweep({ notifications: 90, digests: 90, userIds: [userId] });
    assert.equal(done.digest_runs, 2);

    const [rows] = await db.query("SELECT id FROM digest_runs WHERE user_id = ?", [userId]);
    assert.deepEqual(rows.map(r => Number(r.id)), [Number(recent)]);
  });

  test("it deletes in chunks rather than in one statement", async () => {
    // The first run after months of accumulation is exactly when a single
    // enormous DELETE holds a lock long enough to be noticed on one CPU.
    await db.query("DELETE FROM notifications WHERE user_id = ?", [userId]);
    const many = retention.CHUNK + 50;
    const values = [];
    const params = [];
    for (let i = 0; i < many; i++) {
      values.push("(?, 'sme', 'bulk', 'body', ?, ?)");
      params.push(userId, daysAgo(300), daysAgo(300));
    }
    await db.query(
      `INSERT INTO notifications (user_id, kind, title, body, created_at, read_at)
       VALUES ${values.join(",")}`, params);

    const done = await retention.sweep({ notifications: 90, digests: 90, userIds: [userId] });
    assert.equal(done.notifications, many,
      "the loop must keep going past the first chunk, or most rows survive for ever");
    assert.equal(await countMine("notifications"), 0);
  });

  test("a sweep scoped to one user leaves everyone else alone", async () => {
    const [res] = await db.query(
      "INSERT INTO users (email, full_name, initials, is_active) VALUES (?,?,?,1)",
      [`retention-other-${stamp}@example.com`, `Other ${stamp}`, "OT"]
    );
    const otherId = res.insertId;
    await db.query(
      `INSERT INTO notifications (user_id, kind, title, body, created_at, read_at)
       VALUES (?, 'sme', 'other', 'body', ?, ?)`,
      [otherId, daysAgo(400), daysAgo(400)]
    );

    await retention.sweep({ notifications: 90, digests: 90, userIds: [userId] });

    const [[row]] = await db.query("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?", [otherId]);
    assert.equal(Number(row.n), 1, "another user's rows must not be touched by a scoped sweep");

    await db.query("DELETE FROM notifications WHERE user_id = ?", [otherId]);
    await db.query("DELETE FROM users WHERE id = ?", [otherId]);
  });
});

describe("what it refuses", () => {
  test("it will not prune the audit log, whatever it is asked", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "scripts", "retention.js"), "utf8");
    assert.ok(!/DELETE FROM audit_log/.test(src),
      "an audit trail is what lets Dolluz answer for what happened");
    assert.match(src, /--audit-log/, "asking for it should be answered, not ignored");
    assert.ok(!/DELETE FROM messages/.test(src),
      "deleting chat history is a separate decision nobody has made");
  });

  test("a dangerously short window needs saying twice", () => {
    const flags = retention.parseArgs(["--notifications", "2"]);
    assert.equal(flags.notifications, 2);
    assert.equal(flags.force, false, "and without --force the script stops before deleting");
    assert.ok(retention.MIN_DAYS >= 7, "a week is the least that should pass unremarked");
  });

  test("dry run is the default, so a cron typo cannot delete anything", () => {
    assert.equal(retention.parseArgs([]).apply, false);
    assert.equal(retention.parseArgs(["--notifications", "30"]).apply, false);
    assert.equal(retention.parseArgs(["--apply"]).apply, true);
  });
});
