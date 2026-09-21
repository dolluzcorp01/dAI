"use strict";
const db = require("../db");
const config = require("../config");
const V = require("../lib/validate");
const bus = require("../realtime/bus");
const transport = require("../lib/transport");

/**
 * Notifications.
 *
 * The decision of whether to notify is a pure function, `decide()`, separated
 * from the delivery. That matters because the rules interact: a muted channel
 * still notifies on a direct mention, quiet hours suppress the noisy channels
 * but never the in-app record, and a keyword alert outranks a channel set to
 * mentions only. Rules that interact need to be testable without a database.
 *
 * One rule shapes the rest: message text does not leave the system by default.
 * An RCM message can contain claim detail, and an email subject line or a lock
 * screen preview is PHI the moment it arrives there.
 */

class NotificationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const KINDS = ["feature", "update", "highlight", "mention", "keyword", "sme",
               "system", "message", "dm", "reply", "reaction"];

/** Is `now` inside a window that may wrap past midnight? */
function withinWindow(now, start, end) {
  if (!start || !end) return false;
  const toMin = (t) => {
    const [h, m] = String(t).split(":");
    return Number(h) * 60 + Number(m);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = toMin(start), e = toMin(end);
  return s <= e ? (cur >= s && cur <= e) : (cur >= s || cur <= e);
}

function matchesKeyword(body, keywords) {
  if (!body || !keywords || keywords.length === 0) return null;
  const text = String(body).toLowerCase();
  for (const k of keywords) {
    const needle = String(k).toLowerCase().trim();
    if (!needle) continue;
    if (text.includes(needle)) return k;
  }
  return null;
}

/**
 * Should this recipient be notified, and through which channels.
 *
 * Pure. No database, no clock of its own. Everything it needs is passed in,
 * so every combination of rules can be tested directly.
 */
function decide({
  message,          // { senderId, body, conversationId, kind }
  recipient,        // { id, handle, presence, dndSchedule, dndStart, dndEnd }
  membership,       // { notifLevel, isMuted }
  prefs,            // { desktop, push, emailDigest, quietHours, quietStart, quietEnd, keywords }
  conversationKind, // dm | group | channel
  mentionedUserIds = [],
  hasHere = false,
  hasChannelMention = false,
  now = new Date(),
}) {
  const result = {
    notify: false, kind: null, reason: null,
    channels: { inApp: false, desktop: false, push: false },
    suppressed: null,
  };

  // Never notify someone about their own message.
  if (Number(message.senderId) === Number(recipient.id)) {
    result.reason = "own_message";
    return result;
  }

  const directMention = mentionedUserIds.map(Number).includes(Number(recipient.id));
  const keyword = matchesKeyword(message.body, prefs.keywords);
  const isDm = conversationKind === "dm";

  // What kind of event is this, from this recipient's point of view.
  if (directMention) result.kind = "mention";
  else if (keyword) result.kind = "keyword";
  else if (isDm) result.kind = "dm";
  else if (hasHere || hasChannelMention) result.kind = "mention";
  else result.kind = "message";

  const isTargeted = directMention || !!keyword || isDm;

  // Level. A muted conversation still breaks through for a direct mention,
  // because muting a channel should not mean missing someone asking you a
  // question in it.
  if (membership.notifLevel === "none") {
    result.reason = "level_none";
    return result;
  }
  if (membership.isMuted && !directMention) {
    result.reason = "muted";
    return result;
  }
  if (membership.notifLevel === "mentions" && !isTargeted && !hasHere && !hasChannelMention) {
    result.reason = "mentions_only";
    return result;
  }

  result.notify = true;
  result.channels.inApp = true;      // always recorded, so nothing is lost

  // Quiet hours and a DND schedule silence the interrupting channels only.
  // The in-app record still appears when the person comes back.
  const quiet = prefs.quietHours && withinWindow(now, prefs.quietStart, prefs.quietEnd);
  const dnd = recipient.dndSchedule && withinWindow(now, recipient.dndStart, recipient.dndEnd);
  const manualDnd = recipient.presence === "dnd";

  if (quiet || dnd || manualDnd) {
    result.suppressed = quiet ? "quiet_hours" : (dnd ? "dnd_schedule" : "dnd");
    return result;
  }

  result.channels.desktop = !!prefs.desktop;
  result.channels.push = !!prefs.push;
  return result;
}

/* ---------------- persistence and delivery ---------------- */

async function prefsFor(userId) {
  let p = await db.one(
    `SELECT desktop, push, email_digest AS emailDigest, quiet_hours AS quietHours,
            quiet_start AS quietStart, quiet_end AS quietEnd
       FROM notification_prefs WHERE user_id = ?`, [userId]
  );
  if (!p) {
    await db.query(`INSERT IGNORE INTO notification_prefs (user_id) VALUES (?)`, [userId]);
    p = { desktop: 0, push: 0, emailDigest: 1, quietHours: 0, quietStart: null, quietEnd: null };
  }
  const [kw] = await db.query(
    `SELECT keyword FROM notification_keywords WHERE user_id = ?`, [userId]
  );
  return {
    desktop: !!p.desktop, push: !!p.push, emailDigest: !!p.emailDigest,
    quietHours: !!p.quietHours, quietStart: p.quietStart, quietEnd: p.quietEnd,
    keywords: kw.map(k => k.keyword),
  };
}

async function includeMessageText() {
  const row = await db.one(
    `SELECT setting_value AS v FROM org_settings WHERE setting_key = 'notifications.include_message_text'`
  );
  return !!row && row.v === "true";
}

async function create(userId, {
  kind, title, body, refType, refId, conversationId, actorId,
  channels = { inApp: true }, suppressed = null,
}) {
  const k = V.oneOf(kind, "kind", KINDS);
  const [res] = await db.query(
    `INSERT INTO notifications
       (user_id, kind, title, body, ref_type, ref_id, conversation_id, actor_id,
        delivered_inapp, delivered_desktop, delivered_push, suppressed_reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [userId, k, title || null, String(body || "").slice(0, 600), refType || null, refId || null,
     conversationId || null, actorId || null,
     channels.inApp ? 1 : 0, channels.desktop ? 1 : 0, channels.push ? 1 : 0, suppressed]
  );
  const row = await db.one(
    `SELECT id, kind, title, body, ref_type AS refType, ref_id AS refId,
            conversation_id AS conversationId, actor_id AS actorId,
            read_at AS readAt, created_at AS createdAt
       FROM notifications WHERE id = ?`, [res.insertId]
  );

  // Straight to any open socket, so the bell updates without polling.
  bus.toUser(userId, "notification", { notification: row });
  return row;
}

/**
 * Fan out for one chat message. Called after the message is persisted.
 *
 * Deliberately best effort: a notification failure must never fail a send, so
 * the caller does not await this.
 */
async function notifyMessage({ message, conversation, mentions = {} }) {
  const [members] = await db.query(
    `SELECT cm.user_id AS userId, cm.notif_level AS notifLevel, cm.is_muted AS isMuted,
            u.presence, u.dnd_schedule AS dndSchedule, u.dnd_start AS dndStart, u.dnd_end AS dndEnd,
            u.full_name AS fullName, u.email
       FROM conversation_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ? AND cm.left_at IS NULL`,
    [message.conversationId]
  );

  const sender = await db.one(`SELECT full_name AS fullName FROM users WHERE id = ?`, [message.senderId]);
  const senderName = (sender && sender.fullName) || "Someone";
  const withText = await includeMessageText();
  const created = [];

  const spaceName = conversation.kind === "channel"
    ? `#${conversation.slug}`
    : (conversation.kind === "group" ? conversation.name : "a direct message");

  for (const m of members) {
    const prefs = await prefsFor(m.userId);
    const verdict = decide({
      message,
      recipient: {
        id: m.userId, presence: m.presence, dndSchedule: !!m.dndSchedule,
        dndStart: m.dndStart, dndEnd: m.dndEnd,
      },
      membership: { notifLevel: m.notifLevel, isMuted: !!m.isMuted },
      prefs,
      conversationKind: conversation.kind,
      mentionedUserIds: mentions.users || [],
      hasHere: !!mentions.here,
      hasChannelMention: !!mentions.channel,
    });

    if (!verdict.notify) continue;

    // Body carries the text only when the organisation has opted in.
    const body = withText
      ? `${senderName}: ${String(message.body || "").slice(0, 200)}`
      : `${senderName} sent a message in ${spaceName}`;

    const row = await create(m.userId, {
      kind: verdict.kind,
      title: conversation.kind === "dm" ? senderName : spaceName,
      body,
      refType: "message", refId: message.id,
      conversationId: message.conversationId,
      actorId: message.senderId,
      channels: verdict.channels,
      suppressed: verdict.suppressed,
    });
    created.push({ userId: m.userId, notificationId: row.id, verdict });

    if (verdict.channels.push) {
      await deliverPush(m.userId, {
        title: conversation.kind === "dm" ? senderName : spaceName,
        body,
        data: { conversationId: String(message.conversationId), messageId: String(message.id) },
      }, row.id);
    }
  }

  await sendOooReplies({ message, conversation, members });
  return created;
}

async function deliverPush(userId, payload, notificationId) {
  const [devices] = await db.query(
    `SELECT push_token AS token FROM devices
      WHERE user_id = ? AND push_token IS NOT NULL`, [userId]
  );
  if (devices.length === 0) return { sent: 0 };
  const t = transport.pushTransport();
  let sent = 0;
  for (const d of devices) {
    try {
      await t.send({ token: d.token, ...payload });
      sent++;
    } catch (err) {
      console.error("push failed:", err.message);
    }
  }
  if (sent > 0 && notificationId) {
    await db.query(`UPDATE notifications SET delivered_push = 1 WHERE id = ?`, [notificationId]);
  }
  return { sent };
}

/**
 * Out of office. One reply per sender per conversation per day, enforced by a
 * unique key rather than a check, so two messages arriving together cannot
 * both slip through.
 */
async function sendOooReplies({ message, conversation, members }) {
  if (conversation.kind !== "dm") return { sent: 0 };
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;

  for (const m of members) {
    if (Number(m.userId) === Number(message.senderId)) continue;
    const away = await db.one(
      `SELECT ooo, ooo_message AS oooMessage FROM users WHERE id = ?`, [m.userId]
    );
    if (!away || !away.ooo) continue;

    try {
      await db.query(
        `INSERT INTO ooo_replies (from_user_id, to_user_id, conversation_id, sent_on)
         VALUES (?,?,?,?)`,
        [m.userId, message.senderId, message.conversationId, today]
      );
    } catch (err) {
      if (err && err.code === "ER_DUP_ENTRY") continue;   // already answered today
      throw err;
    }

    await create(message.senderId, {
      kind: "system",
      title: `${m.fullName} is away`,
      body: away.oooMessage || `${m.fullName} is currently out of office.`,
      refType: "conversation", refId: message.conversationId,
      conversationId: message.conversationId, actorId: m.userId,
      channels: { inApp: true },
    });
    sent++;
  }
  return { sent };
}

/* ---------------- reading ---------------- */

async function list(userId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const where = ["n.user_id = ?"];
  const params = [userId];
  if (unreadOnly) where.push("n.read_at IS NULL");

  const [rows] = await db.query(
    `SELECT n.id, n.kind, n.title, n.body, n.ref_type AS refType, n.ref_id AS refId,
            n.conversation_id AS conversationId, n.actor_id AS actorId,
            n.read_at AS readAt, n.suppressed_reason AS suppressedReason,
            n.created_at AS createdAt,
            u.full_name AS actorName, u.initials AS actorInitials
       FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
      WHERE ${where.join(" AND ")}
      ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  const unread = await db.one(
    `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`, [userId]
  );
  return { notifications: rows, unread: Number(unread.n), limit: lim, offset: off };
}

async function markRead(userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new V.ValidationError("Pass a list of notification ids.", "ids");
  }
  const clean = ids.map(Number).filter(Number.isInteger).slice(0, 500);
  if (clean.length === 0) throw new V.ValidationError("No valid ids.", "ids");
  const [res] = await db.query(
    `UPDATE notifications SET read_at = NOW()
      WHERE user_id = ? AND read_at IS NULL AND id IN (?)`,
    [userId, clean]
  );
  return { marked: res.affectedRows };
}

async function markAllRead(userId) {
  const [res] = await db.query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL`, [userId]
  );
  bus.toUser(userId, "notification:cleared", { count: res.affectedRows });
  return { marked: res.affectedRows };
}

/* ---------------- email digest ---------------- */

/**
 * One digest per user per run, covering unread notifications not already
 * emailed. `delivered_email` is set only after the transport succeeds, so a
 * failure leaves them in the next run rather than losing them.
 */
async function buildDigest(userId) {
  const user = await db.one(
    `SELECT id, email, full_name AS fullName FROM users
      WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`, [userId]
  );
  if (!user) return null;

  const prefs = await prefsFor(userId);
  if (!prefs.emailDigest) return { skipped: "digest_disabled" };

  const [rows] = await db.query(
    `SELECT n.id, n.kind, n.title, n.body, n.conversation_id AS conversationId,
            n.created_at AS createdAt
       FROM notifications n
      WHERE n.user_id = ? AND n.read_at IS NULL AND n.delivered_email = 0
      ORDER BY n.created_at LIMIT 200`,
    [userId]
  );
  if (rows.length === 0) return { skipped: "nothing_unread" };

  const withText = await includeMessageText();
  const bySpace = new Map();
  for (const r of rows) {
    const key = r.title || "Kody";
    if (!bySpace.has(key)) bySpace.set(key, []);
    bySpace.get(key).push(r);
  }

  const lines = [`Hello ${user.fullName.split(" ")[0]},`, ""];
  lines.push(`You have ${rows.length} unread notification${rows.length === 1 ? "" : "s"} in Kody.`);
  lines.push("");
  for (const [space, items] of bySpace) {
    lines.push(`${space}: ${items.length}`);
    if (withText) {
      for (const i of items.slice(0, 3)) lines.push(`  ${i.body}`);
    }
  }
  lines.push("");
  lines.push(`Open Kody: ${config.webUrl}`);
  lines.push("");
  lines.push("You can turn this digest off in Kody under Settings, Notifications.");

  return {
    user,
    ids: rows.map(r => r.id),
    count: rows.length,
    subject: `Kody: ${rows.length} unread notification${rows.length === 1 ? "" : "s"}`,
    text: lines.join("\n"),
    includesText: withText,
  };
}

async function sendDigest(userId) {
  const digest = await buildDigest(userId);
  if (!digest) return { status: "skipped", detail: "no_such_user" };
  if (digest.skipped) {
    await db.query(
      `INSERT INTO digest_runs (user_id, notifications, transport, status, detail)
       VALUES (?,0,?, 'skipped', ?)`,
      [userId, config.mail.driver, digest.skipped]
    );
    return { status: "skipped", detail: digest.skipped };
  }

  const t = transport.emailTransport();
  try {
    await t.send({ to: digest.user.email, subject: digest.subject, text: digest.text });
  } catch (err) {
    await db.query(
      `INSERT INTO digest_runs (user_id, notifications, transport, status, detail)
       VALUES (?,?,?, 'failed', ?)`,
      [userId, digest.count, t.name, String(err.message).slice(0, 400)]
    );
    return { status: "failed", detail: err.message };
  }

  await db.query(
    `UPDATE notifications SET delivered_email = 1 WHERE id IN (?)`, [digest.ids]
  );
  await db.query(
    `INSERT INTO digest_runs (user_id, notifications, transport, status) VALUES (?,?,?, 'sent')`,
    [userId, digest.count, t.name]
  );
  return { status: "sent", count: digest.count };
}

async function sendAllDigests() {
  const [users] = await db.query(
    `SELECT DISTINCT n.user_id AS userId
       FROM notifications n
       JOIN notification_prefs p ON p.user_id = n.user_id
      WHERE n.read_at IS NULL AND n.delivered_email = 0 AND p.email_digest = 1`
  );
  const results = [];
  for (const u of users) {
    results.push({ userId: u.userId, ...(await sendDigest(u.userId)) });
  }
  return { users: users.length, results };
}

/* ---------------- product announcements ---------------- */

async function announce(actorId, { kind, title, body, userIds }) {
  const k = V.oneOf(kind, "kind", ["feature", "update", "highlight", "system"]);
  const text = V.str(body, "body", { min: 1, max: 600 });

  let targets = userIds;
  if (!Array.isArray(targets) || targets.length === 0) {
    const [all] = await db.query(
      `SELECT id FROM users WHERE is_active = 1 AND deleted_at IS NULL`
    );
    targets = all.map(u => u.id);
  }
  for (const uid of targets) {
    await create(uid, { kind: k, title, body: text, actorId, channels: { inApp: true } });
  }
  return { sent: targets.length };
}

module.exports = {
  NotificationError, KINDS, decide, withinWindow, matchesKeyword,
  prefsFor, create, notifyMessage, sendOooReplies, deliverPush,
  list, markRead, markAllRead,
  buildDigest, sendDigest, sendAllDigests, announce, includeMessageText,
};
