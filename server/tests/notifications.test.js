"use strict";
/**
 * Notifications.
 *
 * Most of this exercises `decide()` directly, because the rules interact and a
 * pure function is the only honest way to test every combination. The rest
 * checks that the rules actually reach the database and the transports.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";
process.env.MAIL_DRIVER = "memory";
process.env.PUSH_DRIVER = "memory";

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");
const notify = require("../src/services/notifications.service");
const transport = require("../src/lib/transport");

const PASSWORD = "Kody!Dev2026";
let server, base, shoban, pavithran, vignesh, channelId, dmId;
const MARK = "ntfy" + Date.now().toString(36);

const api = async (method, p, body, token) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
};

const login = async (email) => {
  const r = await api("POST", "/api/auth/login", { email, password: PASSWORD });
  assert.ok(r.body.accessToken, `login failed for ${email}`);
  return r.body.accessToken;
};

const uid = () => "n-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
const settle = () => new Promise(r => setTimeout(r, 400));   // the fan-out is async

/** Baseline inputs for decide(), overridden per test. */
const base_ = (over = {}) => ({
  message: { senderId: 1, body: "hello there", conversationId: 10, kind: "text" },
  recipient: { id: 2, presence: "online", dndSchedule: false },
  membership: { notifLevel: "all", isMuted: false },
  prefs: { desktop: true, push: true, emailDigest: true, quietHours: false, keywords: [] },
  conversationKind: "channel",
  mentionedUserIds: [],
  now: new Date("2026-09-18T10:00:00"),
  ...over,
});

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  const ids = {};
  for (const email of ["shoban@dolluzcorp.com", "pavithran@dolluzcorp.com", "vignesh@dolluzcorp.com"]) {
    const u = await db.one("SELECT id FROM users WHERE email = ?", [email]);
    ids[email] = u.id;
    await authSvc.setPassword(u.id, PASSWORD);
    await db.query("UPDATE users SET is_active = 1, ooo = 0, presence = 'online' WHERE id = ?", [u.id]);
  }
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");

  shoban = { id: ids["shoban@dolluzcorp.com"], token: await login("shoban@dolluzcorp.com") };
  pavithran = { id: ids["pavithran@dolluzcorp.com"], token: await login("pavithran@dolluzcorp.com") };
  vignesh = { id: ids["vignesh@dolluzcorp.com"], token: await login("vignesh@dolluzcorp.com") };

  const ch = await api("POST", "/api/conversations", {
    kind: "channel", name: "Notify " + Date.now(), memberIds: [pavithran.id, vignesh.id],
  }, shoban.token);
  channelId = ch.body.conversation.id;

  const dm = await api("POST", "/api/conversations/dm", { userId: pavithran.id }, shoban.token);
  dmId = dm.body.conversation.id;

  transport.clearSent();
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("the decision rules", () => {
  test("never notifies you about your own message", () => {
    const d = notify.decide(base_({ recipient: { id: 1, presence: "online" } }));
    assert.equal(d.notify, false);
    assert.equal(d.reason, "own_message");
  });

  test("notifies on an ordinary channel message when the level is all", () => {
    const d = notify.decide(base_());
    assert.equal(d.notify, true);
    assert.equal(d.kind, "message");
    assert.equal(d.channels.inApp, true);
  });

  test("level none silences everything", () => {
    const d = notify.decide(base_({ membership: { notifLevel: "none", isMuted: false } }));
    assert.equal(d.notify, false);
    assert.equal(d.reason, "level_none");
  });

  test("level mentions drops ordinary messages", () => {
    const d = notify.decide(base_({ membership: { notifLevel: "mentions", isMuted: false } }));
    assert.equal(d.notify, false);
    assert.equal(d.reason, "mentions_only");
  });

  test("level mentions still delivers a direct mention", () => {
    const d = notify.decide(base_({
      membership: { notifLevel: "mentions", isMuted: false },
      mentionedUserIds: [2],
    }));
    assert.equal(d.notify, true);
    assert.equal(d.kind, "mention");
  });

  test("a muted channel is silent", () => {
    const d = notify.decide(base_({ membership: { notifLevel: "all", isMuted: true } }));
    assert.equal(d.notify, false);
    assert.equal(d.reason, "muted");
  });

  test("a muted channel still breaks through for a direct mention", () => {
    const d = notify.decide(base_({
      membership: { notifLevel: "all", isMuted: true },
      mentionedUserIds: [2],
    }));
    assert.equal(d.notify, true, "muting a channel should not mean missing a question aimed at you");
    assert.equal(d.kind, "mention");
  });

  test("a keyword alert fires even when the level is mentions only", () => {
    const d = notify.decide(base_({
      message: { senderId: 1, body: "this one is a CO-97 problem", conversationId: 10 },
      membership: { notifLevel: "mentions", isMuted: false },
      prefs: { desktop: true, push: true, quietHours: false, keywords: ["CO-97"] },
    }));
    assert.equal(d.notify, true);
    assert.equal(d.kind, "keyword");
  });

  test("a keyword match is case insensitive", () => {
    assert.equal(notify.matchesKeyword("Escalation needed now", ["escalation"]), "escalation");
    assert.equal(notify.matchesKeyword("nothing here", ["escalation"]), null);
  });

  test("a direct message always notifies", () => {
    const d = notify.decide(base_({ conversationKind: "dm" }));
    assert.equal(d.notify, true);
    assert.equal(d.kind, "dm");
  });

  test("@here notifies even at mentions only", () => {
    const d = notify.decide(base_({
      membership: { notifLevel: "mentions", isMuted: false }, hasHere: true,
    }));
    assert.equal(d.notify, true);
    assert.equal(d.kind, "mention");
  });

  test("quiet hours silence the interrupting channels but keep the record", () => {
    const d = notify.decide(base_({
      prefs: { desktop: true, push: true, quietHours: true, quietStart: "20:00", quietEnd: "08:00", keywords: [] },
      now: new Date("2026-09-18T22:30:00"),
    }));
    assert.equal(d.notify, true);
    assert.equal(d.channels.inApp, true, "still recorded, so nothing is lost overnight");
    assert.equal(d.channels.desktop, false);
    assert.equal(d.channels.push, false);
    assert.equal(d.suppressed, "quiet_hours");
  });

  test("outside quiet hours the noisy channels come back", () => {
    const d = notify.decide(base_({
      prefs: { desktop: true, push: true, quietHours: true, quietStart: "20:00", quietEnd: "08:00", keywords: [] },
      now: new Date("2026-09-18T12:00:00"),
    }));
    assert.equal(d.channels.desktop, true);
    assert.equal(d.channels.push, true);
    assert.equal(d.suppressed, null);
  });

  test("a DND schedule suppresses the same way", () => {
    const d = notify.decide(base_({
      recipient: { id: 2, presence: "online", dndSchedule: true, dndStart: "09:00", dndEnd: "11:00" },
      now: new Date("2026-09-18T10:00:00"),
    }));
    assert.equal(d.channels.inApp, true);
    assert.equal(d.channels.push, false);
    assert.equal(d.suppressed, "dnd_schedule");
  });

  test("manual do not disturb suppresses immediately", () => {
    const d = notify.decide(base_({ recipient: { id: 2, presence: "dnd", dndSchedule: false } }));
    assert.equal(d.suppressed, "dnd");
    assert.equal(d.channels.push, false);
  });

  test("a window that wraps past midnight is handled", () => {
    const at = (h) => new Date(`2026-09-18T${String(h).padStart(2, "0")}:00:00`);
    assert.equal(notify.withinWindow(at(23), "20:00", "08:00"), true);
    assert.equal(notify.withinWindow(at(3),  "20:00", "08:00"), true);
    assert.equal(notify.withinWindow(at(12), "20:00", "08:00"), false);
    assert.equal(notify.withinWindow(at(10), "09:00", "11:00"), true);
    assert.equal(notify.withinWindow(at(12), "09:00", "11:00"), false);
  });

  test("desktop and push follow the preference toggles", () => {
    const off = notify.decide(base_({
      prefs: { desktop: false, push: false, quietHours: false, keywords: [] },
    }));
    assert.equal(off.notify, true);
    assert.equal(off.channels.inApp, true);
    assert.equal(off.channels.desktop, false);
    assert.equal(off.channels.push, false);
  });
});

describe("sending a message produces notifications", () => {
  test("members are notified and the sender is not", async () => {
    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `${MARK} first channel message`, clientMsgId: uid() }, shoban.token);
    await settle();

    const theirs = await api("GET", "/api/notifications?unreadOnly=true", null, pavithran.token);
    assert.ok(theirs.body.notifications.some(n => Number(n.conversationId) === Number(channelId)),
      "the other member was notified");

    const mine = await api("GET", "/api/notifications?unreadOnly=true", null, shoban.token);
    assert.ok(!mine.body.notifications.some(
      n => Number(n.conversationId) === Number(channelId) && Number(n.actorId) === shoban.id
    ), "the sender is not notified about themselves");
  });

  test("a mention is recorded as a mention", async () => {
    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `@pavithran ${MARK} can you look at this`, clientMsgId: uid() }, shoban.token);
    await settle();

    const r = await api("GET", "/api/notifications?unreadOnly=true", null, pavithran.token);
    assert.ok(r.body.notifications.some(n => n.kind === "mention"));
  });

  test("setting a channel to mentions only stops ordinary messages", async () => {
    await api("PATCH", `/api/conversations/${channelId}/membership`, { notifLevel: "mentions" }, vignesh.token);
    await api("PUT", "/api/notifications/read-all", null, vignesh.token);

    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `${MARK} ordinary chatter nobody needs`, clientMsgId: uid() }, shoban.token);
    await settle();

    const r = await api("GET", "/api/notifications?unreadOnly=true", null, vignesh.token);
    assert.equal(r.body.notifications.length, 0, "nothing for an ordinary message");

    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `@vignesh ${MARK} this one is for you`, clientMsgId: uid() }, shoban.token);
    await settle();

    const after = await api("GET", "/api/notifications?unreadOnly=true", null, vignesh.token);
    assert.ok(after.body.notifications.length > 0, "a mention still arrives");
    await api("PATCH", `/api/conversations/${channelId}/membership`, { notifLevel: "all" }, vignesh.token);
  });

  test("a keyword alert fires on an ordinary message", async () => {
    await db.query("DELETE FROM notification_keywords WHERE user_id = ?", [vignesh.id]);
    await db.query("INSERT INTO notification_keywords (user_id, keyword) VALUES (?, ?)",
      [vignesh.id, MARK + "keyword"]);
    await api("PUT", "/api/notifications/read-all", null, vignesh.token);

    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `something about ${MARK}keyword in passing`, clientMsgId: uid() }, shoban.token);
    await settle();

    const r = await api("GET", "/api/notifications?unreadOnly=true", null, vignesh.token);
    assert.ok(r.body.notifications.some(n => n.kind === "keyword"), "keyword alert delivered");
  });

  test("a muted channel is silent for ordinary messages", async () => {
    await api("PATCH", `/api/conversations/${channelId}/membership`, { isMuted: true }, vignesh.token);
    await db.query("DELETE FROM notification_keywords WHERE user_id = ?", [vignesh.id]);
    await api("PUT", "/api/notifications/read-all", null, vignesh.token);

    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `${MARK} muted chatter`, clientMsgId: uid() }, shoban.token);
    await settle();

    const r = await api("GET", "/api/notifications?unreadOnly=true", null, vignesh.token);
    assert.equal(r.body.notifications.length, 0);

    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `@vignesh ${MARK} muted but aimed at you`, clientMsgId: uid() }, shoban.token);
    await settle();

    const after = await api("GET", "/api/notifications?unreadOnly=true", null, vignesh.token);
    assert.ok(after.body.notifications.length > 0, "a direct mention breaks through a mute");
    await api("PATCH", `/api/conversations/${channelId}/membership`, { isMuted: false }, vignesh.token);
  });

  test("quiet hours record the notification and mark why it was silenced", async () => {
    await db.query(
      `UPDATE notification_prefs SET quiet_hours = 1, quiet_start = '00:00', quiet_end = '23:59'
        WHERE user_id = ?`, [pavithran.id]
    );
    await api("PUT", "/api/notifications/read-all", null, pavithran.token);

    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `${MARK} during quiet hours`, clientMsgId: uid() }, shoban.token);
    await settle();

    const r = await api("GET", "/api/notifications?unreadOnly=true", null, pavithran.token);
    const row = r.body.notifications[0];
    assert.ok(row, "still recorded");
    assert.equal(row.suppressedReason, "quiet_hours");

    await db.query("UPDATE notification_prefs SET quiet_hours = 0 WHERE user_id = ?", [pavithran.id]);
  });
});

describe("message text does not leave the system", () => {
  test("by default the body names the space, not the message", async () => {
    const setting = await notify.includeMessageText();
    assert.equal(setting, false, "off by default");

    await api("PUT", "/api/notifications/read-all", null, pavithran.token);
    await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "Patient Jane Doe account 88213 balance 148.00", clientMsgId: uid() }, shoban.token);
    await settle();

    const r = await api("GET", "/api/notifications?unreadOnly=true", null, pavithran.token);
    const row = r.body.notifications.find(n => Number(n.conversationId) === Number(dmId));
    assert.ok(row, "notified");
    assert.ok(!/Jane Doe|88213|148\.00/.test(row.body),
      "claim detail is not copied into the notification");
    assert.match(row.body, /sent a message/);
  });

  test("the digest does not carry message text either", async () => {
    const r = await api("GET", "/api/notifications/digest/preview", null, pavithran.token);
    assert.equal(r.status, 200);
    if (!r.body.skipped) {
      assert.equal(r.body.includesMessageText, false);
      assert.ok(!/Jane Doe|88213/.test(r.body.text), "no claim detail in the email body");
      assert.match(r.body.text, /unread notification/);
    }
  });

  test("an organisation can opt in, and then it does", async () => {
    await db.query(
      `UPDATE org_settings SET setting_value = 'true' WHERE setting_key = 'notifications.include_message_text'`
    );
    await api("PUT", "/api/notifications/read-all", null, pavithran.token);

    await api("POST", `/api/conversations/${dmId}/messages`,
      { body: `${MARK} opted in message text`, clientMsgId: uid() }, shoban.token);
    await settle();

    const r = await api("GET", "/api/notifications?unreadOnly=true", null, pavithran.token);
    const row = r.body.notifications.find(n => Number(n.conversationId) === Number(dmId));
    assert.match(row.body, new RegExp(MARK), "text included once opted in");

    await db.query(
      `UPDATE org_settings SET setting_value = 'false' WHERE setting_key = 'notifications.include_message_text'`
    );
  });
});

describe("out of office", () => {
  test("replies once per sender per conversation per day", async () => {
    await db.query(
      `UPDATE users SET ooo = 1, ooo_message = 'Away until Monday. Contact Manasi for AR.' WHERE id = ?`,
      [pavithran.id]
    );
    await db.query("DELETE FROM ooo_replies WHERE from_user_id = ?", [pavithran.id]);
    await api("PUT", "/api/notifications/read-all", null, shoban.token);

    await api("POST", `/api/conversations/${dmId}/messages`,
      { body: `${MARK} are you there`, clientMsgId: uid() }, shoban.token);
    await settle();

    let r = await api("GET", "/api/notifications?unreadOnly=true", null, shoban.token);
    const replies = r.body.notifications.filter(n => /away/i.test(n.title || ""));
    assert.equal(replies.length, 1, "one auto-reply");
    assert.match(replies[0].body, /Away until Monday/);

    await api("POST", `/api/conversations/${dmId}/messages`,
      { body: `${MARK} following up`, clientMsgId: uid() }, shoban.token);
    await settle();

    r = await api("GET", "/api/notifications?unreadOnly=true", null, shoban.token);
    assert.equal(r.body.notifications.filter(n => /away/i.test(n.title || "")).length, 1,
      "still only one, not one per message");

    await db.query("UPDATE users SET ooo = 0 WHERE id = ?", [pavithran.id]);
  });
});

describe("reading", () => {
  test("lists with an unread count", async () => {
    const r = await api("GET", "/api/notifications", null, pavithran.token);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.unread === "number");
  });

  test("marks specific ones read", async () => {
    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `${MARK} to be marked read`, clientMsgId: uid() }, shoban.token);
    await settle();

    const before = await api("GET", "/api/notifications?unreadOnly=true", null, pavithran.token);
    assert.ok(before.body.notifications.length > 0);

    const ids = [before.body.notifications[0].id];
    const marked = await api("PUT", "/api/notifications/read", { ids }, pavithran.token);
    assert.equal(marked.body.marked, 1);

    const after = await api("GET", "/api/notifications?unreadOnly=true", null, pavithran.token);
    assert.ok(!after.body.notifications.some(n => n.id === ids[0]));
  });

  test("cannot mark someone else's notification read", async () => {
    await api("POST", `/api/conversations/${channelId}/messages`,
      { body: `${MARK} for vignesh only`, clientMsgId: uid() }, shoban.token);
    await settle();

    const theirs = await api("GET", "/api/notifications?unreadOnly=true", null, vignesh.token);
    const targetId = theirs.body.notifications[0].id;

    const attempt = await api("PUT", "/api/notifications/read", { ids: [targetId] }, pavithran.token);
    assert.equal(attempt.body.marked, 0, "nothing marked, it is not theirs");

    const still = await api("GET", "/api/notifications?unreadOnly=true", null, vignesh.token);
    assert.ok(still.body.notifications.some(n => n.id === targetId), "still unread for the owner");
  });

  test("marks all read", async () => {
    await api("PUT", "/api/notifications/read-all", null, pavithran.token);
    const r = await api("GET", "/api/notifications?unreadOnly=true", null, pavithran.token);
    assert.equal(r.body.notifications.length, 0);
    assert.equal(r.body.unread, 0);
  });

  test("rejects a bad ids payload", async () => {
    assert.equal((await api("PUT", "/api/notifications/read", { ids: [] }, pavithran.token)).status, 400);
    assert.equal((await api("PUT", "/api/notifications/read", { ids: "all" }, pavithran.token)).status, 400);
  });

  test("requires a token", async () => {
    assert.equal((await api("GET", "/api/notifications")).status, 401);
  });
});

describe("the email digest", () => {
  test("sends one email covering the unread notifications", async () => {
    transport.clearSent();
    await db.query("UPDATE notification_prefs SET email_digest = 1 WHERE user_id = ?", [vignesh.id]);
    // dAI: a digest covers at most 200 notifications per run. This user's history
    // grows with every run, and since Phase 1.3 a coordinator is also told about
    // every SME report, so unreading all of it made the next test find a second
    // batch waiting and report "sent". Park everything, then unread a handful:
    // the pair of tests is about not sending the same ones twice (rule 16).
    await db.query("UPDATE notifications SET read_at = NOW(), delivered_email = 1 WHERE user_id = ?", [vignesh.id]);
    await db.query(
      "UPDATE notifications SET read_at = NULL, delivered_email = 0 WHERE user_id = ? ORDER BY id DESC LIMIT 5",
      [vignesh.id]
    );

    const out = await notify.sendDigest(vignesh.id);
    assert.equal(out.status, "sent");
    assert.ok(out.count > 0);
    assert.equal(transport.sentEmails.length, 1);
    assert.match(transport.sentEmails[0].subject, /unread notification/);
    assert.equal(transport.sentEmails[0].to, "vignesh@dolluzcorp.com");
  });

  test("does not send the same notifications twice", async () => {
    transport.clearSent();
    const again = await notify.sendDigest(vignesh.id);
    assert.equal(again.status, "skipped");
    assert.equal(again.detail, "nothing_unread");
    assert.equal(transport.sentEmails.length, 0);
  });

  test("respects the digest preference", async () => {
    await db.query("UPDATE notification_prefs SET email_digest = 0 WHERE user_id = ?", [vignesh.id]);
    await db.query("UPDATE notifications SET read_at = NULL, delivered_email = 0 WHERE user_id = ?", [vignesh.id]);
    const out = await notify.sendDigest(vignesh.id);
    assert.equal(out.status, "skipped");
    assert.equal(out.detail, "digest_disabled");
    await db.query("UPDATE notification_prefs SET email_digest = 1 WHERE user_id = ?", [vignesh.id]);
  });

  test("a failed send leaves the notifications for the next run", async () => {
    await db.query("UPDATE notifications SET read_at = NULL, delivered_email = 0 WHERE user_id = ?", [vignesh.id]);
    const before = await db.one(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND delivered_email = 0`, [vignesh.id]
    );

    const real = transport.emailTransport;
    require("../src/lib/transport").emailTransport = () => ({
      name: "broken",
      async send() { throw new Error("smtp exploded"); },
    });
    const out = await notify.sendDigest(vignesh.id);
    require("../src/lib/transport").emailTransport = real;

    assert.equal(out.status, "failed");
    const after = await db.one(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND delivered_email = 0`, [vignesh.id]
    );
    assert.equal(Number(after.n), Number(before.n), "nothing marked as emailed");

    const run = await db.one(
      `SELECT status, detail FROM digest_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [vignesh.id]
    );
    assert.equal(run.status, "failed");
    assert.match(run.detail, /smtp exploded/);
  });

  test("the batch run only touches users with something unread", async () => {
    transport.clearSent();
    const out = await notify.sendAllDigests();
    assert.ok(typeof out.users === "number");
    assert.ok(out.results.every(r => ["sent", "skipped", "failed"].includes(r.status)));
  });

  test("a member cannot trigger the digest run", async () => {
    const r = await api("POST", "/api/notifications/digest/run", null, vignesh.token);
    assert.equal(r.status, 403);
  });
});

describe("announcements", () => {
  test("an admin can announce to everyone", async () => {
    const r = await api("POST", "/api/notifications/announce", {
      kind: "feature", title: "New in Kody", body: `${MARK} search now supports operators`,
    }, shoban.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.sent > 0);

    const theirs = await api("GET", "/api/notifications?unreadOnly=true", null, vignesh.token);
    assert.ok(theirs.body.notifications.some(n => n.kind === "feature"));
  });

  test("a member cannot announce", async () => {
    const r = await api("POST", "/api/notifications/announce",
      { kind: "update", body: "everyone look at me" }, vignesh.token);
    assert.equal(r.status, 403);
  });

  test("rejects an announcement kind that is not a product notice", async () => {
    const r = await api("POST", "/api/notifications/announce",
      { kind: "mention", body: "pretending to be a mention" }, shoban.token);
    assert.equal(r.status, 400);
  });
});

describe("push delivery", () => {
  test("goes to every registered device, and nowhere if there are none", async () => {
    transport.clearSent();
    const none = await notify.deliverPush(vignesh.id, { title: "t", body: "b" }, null);
    assert.equal(none.sent, 0);
    assert.equal(transport.sentPushes.length, 0);

    await db.query(
      `INSERT INTO devices (user_id, platform, push_token) VALUES (?, 'android', ?)`,
      [vignesh.id, "tok-" + MARK]
    );
    const some = await notify.deliverPush(vignesh.id, { title: "Kody", body: "You have a mention" }, null);
    assert.equal(some.sent, 1);
    assert.equal(transport.sentPushes.length, 1);
    assert.equal(transport.sentPushes[0].token, "tok-" + MARK);

    await db.query("DELETE FROM devices WHERE push_token = ?", ["tok-" + MARK]);
  });
});
