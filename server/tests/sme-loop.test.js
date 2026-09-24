"use strict";
/**
 * The SME loop rings both bells (docs/PHASES.md 1.3).
 *
 * A thumbs down tells the people who work the queue, and resolving it tells the
 * person who reported it. Neither notification carries the answer or the
 * question: an associate's question can contain claim detail just as an answer
 * can, and a notification is read on a lock screen and can leave in the email
 * digest (module rule 17).
 *
 * This suite creates its own reviewer, its own reporter and its own answers, so
 * it passes twice against the same database (module rule 16).
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.KODY_RATE_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");

const PASSWORD = "Kody!Dev2026";
const stamp = Date.now().toString(36);
/* Something that would be unmistakable if it ever reached a notification. */
const CLAIM_DETAIL = `patient Jane ${stamp} account 88213 balance 148.00`;

let server, base;
let reporter, reviewer, outsider, admin;

const api = async (method, p, body, token) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json || {} };
};

/** A user this suite owns, with one role. */
const makeUser = async (label, role) => {
  const email = `sme-${label}-${stamp}@example.com`;
  const [res] = await db.query(
    "INSERT INTO users (email, full_name, initials, is_active) VALUES (?,?,?,1)",
    [email, `SME ${label} ${stamp}`, "SM"]
  );
  const id = res.insertId;
  if (role) {
    await db.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?", [id, role]
    );
  }
  await authSvc.setPassword(id, PASSWORD);
  const login = await api("POST", "/api/auth/login", { email, password: PASSWORD });
  assert.equal(login.status, 200, `${label} must be able to sign in`);
  return { id, email, token: login.body.accessToken };
};

const unread = async (token) =>
  (await api("GET", "/api/notifications?unreadOnly=true&limit=100", null, token)).body.notifications || [];

/** Ask, then vote it down. Returns the sme_queue id. */
const raiseSmeItem = async (question, token) => {
  const asked = await api("POST", "/api/kody/ask", { question }, token);
  assert.equal(asked.status, 200);
  const voted = await api("POST", `/api/kody/messages/${asked.body.message.id}/feedback`,
    { vote: "down" }, token);
  assert.equal(voted.status, 200);
  assert.ok(voted.body.smeQueueId);
  return { smeQueueId: voted.body.smeQueueId, messageId: asked.body.message.id };
};

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");
  reporter = await makeUser("reporter", "member");
  reviewer = await makeUser("reviewer", "coordinator");
  outsider = await makeUser("outsider", "member");

  const seed = await db.one("SELECT id FROM users WHERE email = 'shoban@dolluzcorp.com'");
  await authSvc.setPassword(seed.id, PASSWORD);
  await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [seed.id]);
  const login = await api("POST", "/api/auth/login",
    { email: "shoban@dolluzcorp.com", password: PASSWORD });
  admin = { id: seed.id, token: login.body.accessToken };
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("a thumbs down reaches the people who work the queue", () => {
  let raised;

  test("the reviewer is notified, with kind sme", async () => {
    await api("PUT", "/api/notifications/read-all", null, reviewer.token);
    raised = await raiseSmeItem(`What do we do about ${CLAIM_DETAIL}`, reporter.token);

    const rows = await unread(reviewer.token);
    const bell = rows.find(n => n.kind === "sme" && Number(n.refId) === Number(raised.smeQueueId));
    assert.ok(bell, "the coordinator's bell lit up");
    assert.equal(bell.refType, "sme_queue");
    assert.equal(Number(bell.actorId), reporter.id);
  });

  test("the notification carries no question and no answer text", async () => {
    const rows = await unread(reviewer.token);
    const bell = rows.find(n => n.kind === "sme" && Number(n.refId) === Number(raised.smeQueueId));
    const whole = `${bell.title} ${bell.body}`;
    assert.ok(!whole.includes(CLAIM_DETAIL), "no question text");
    assert.ok(!/Jane|88213|148\.00/.test(whole), "not even part of it");
    assert.ok(!whole.includes("Mock answer"), "no answer text");
    assert.match(bell.body, /SME queue/, "it says where to go and nothing more");
  });

  test("an admin is notified too, and a plain member is not", async () => {
    const adminRows = await unread(admin.token);
    assert.ok(adminRows.some(n => n.kind === "sme" && Number(n.refId) === Number(raised.smeQueueId)),
      "an admin works the queue as well");

    const outsiderRows = await unread(outsider.token);
    assert.ok(!outsiderRows.some(n => Number(n.refId) === Number(raised.smeQueueId)),
      "a member is not on the queue and is not told");
  });

  test("the person who reported it is not notified of their own report", async () => {
    const rows = await unread(reporter.token);
    assert.ok(!rows.some(n => n.kind === "sme" && Number(n.refId) === Number(raised.smeQueueId)));
  });

  test("an SME who reports something is not notified about their own report", async () => {
    // The reporter above is a member, who is never in the reviewer list, so this
    // is the case that actually exercises the exclusion.
    await api("PUT", "/api/notifications/read-all", null, reviewer.token);
    await api("PUT", "/api/notifications/read-all", null, admin.token);
    const own = await raiseSmeItem(`The reviewer reports this one ${stamp}`, reviewer.token);

    const mine = await unread(reviewer.token);
    assert.ok(!mine.some(n => n.kind === "sme" && Number(n.refId) === Number(own.smeQueueId)),
      "nobody needs a bell for a queue item they just created");

    const theirs = await unread(admin.token);
    assert.ok(theirs.some(n => n.kind === "sme" && Number(n.refId) === Number(own.smeQueueId)),
      "and the other reviewers are still told");
  });

  test("a second thumbs down on the same answer does not ring the bell again", async () => {
    await api("PUT", "/api/notifications/read-all", null, reviewer.token);
    const again = await api("POST", `/api/kody/messages/${raised.messageId}/feedback`,
      { vote: "down" }, reporter.token);
    assert.equal(again.body.smeQueueId, raised.smeQueueId, "the same queue item");

    const rows = await unread(reviewer.token);
    assert.equal(rows.filter(n => n.kind === "sme").length, 0, "no second notification");
  });
});

describe("resolving it reaches the person who reported it", () => {
  test("the reporter is told, and the body carries no answer text", async () => {
    await api("PUT", "/api/notifications/read-all", null, reporter.token);
    const raised = await raiseSmeItem(`Another question about ${CLAIM_DETAIL}`, reporter.token);

    const resolved = await api("POST", `/api/kody/sme/${raised.smeQueueId}/resolve`, {
      title: `Correction ${stamp}`,
      resolution: "Check the primary procedure on the remittance before adjusting the account.",
      domain: "rcm", publish: true,
    }, reviewer.token);
    assert.equal(resolved.status, 200);
    assert.ok(resolved.body.docId);

    const rows = await unread(reporter.token);
    const bell = rows.find(n => n.kind === "sme");
    assert.ok(bell, "the reporter's bell lit up");
    assert.equal(Number(bell.actorId), reviewer.id);
    assert.equal(bell.refType, "knowledge_doc");
    assert.equal(Number(bell.refId), Number(resolved.body.docId), "it points at the published document");

    const whole = `${bell.title} ${bell.body}`;
    assert.ok(!whole.includes(CLAIM_DETAIL), "no question text");
    assert.ok(!whole.includes("Check the primary procedure"), "no resolution text either");
  });

  test("an SME who resolves their own report is not notified about it", async () => {
    await api("PUT", "/api/notifications/read-all", null, reviewer.token);
    const raised = await raiseSmeItem(`A question the reviewer raises ${stamp}`, reviewer.token);

    const resolved = await api("POST", `/api/kody/sme/${raised.smeQueueId}/resolve`, {
      title: `Self resolution ${stamp}`,
      resolution: "The reviewer answered their own report, so nobody needs telling.",
      domain: "rcm", publish: true,
    }, reviewer.token);
    assert.equal(resolved.status, 200);

    const rows = await unread(reviewer.token);
    assert.ok(!rows.some(n => n.kind === "sme" && Number(n.refId) === Number(resolved.body.docId)),
      "no notification to yourself");
  });
});

describe("who counts as working the queue", () => {
  test("matches the roles that can open the SME queue", async () => {
    const kody = require("../src/services/kody.service");
    assert.deepEqual([...kody.SME_ROLES].sort(),
      ["admin", "coordinator", "sub_admin", "super_admin"],
      "if this list and the requireRole on GET /api/kody/sme drift apart, someone is notified " +
      "about a queue they cannot open, or works a queue nobody tells them about");

    const reviewers = await kody.smeReviewers(null);
    assert.ok(reviewers.includes(reviewer.id));
    assert.ok(!reviewers.includes(outsider.id));
  });
});
