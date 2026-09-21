"use strict";
const db = require("../db");
const V = require("../lib/validate");

/**
 * The write path for messages.
 *
 * Everything here exists to protect one invariant: `seq` is contiguous and
 * unique per conversation, because every client uses it to order and to sync.
 */

class MessageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MENTION_RE = /@([a-z][\w.-]*)/gi;

async function membership(conversationId, userId) {
  return db.one(
    `SELECT cm.conversation_id AS conversationId, cm.user_id AS userId,
            cm.member_role AS memberRole, cm.last_read_seq AS lastReadSeq,
            c.kind, c.is_announcement AS isAnnouncement, c.is_archived AS isArchived,
            c.last_seq AS lastSeq, c.name, c.slug
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id = ? AND cm.user_id = ? AND cm.left_at IS NULL
            AND c.deleted_at IS NULL`,
    [conversationId, userId]
  );
}

async function conversationIdsFor(userId) {
  const [rows] = await db.query(
    `SELECT cm.conversation_id AS id FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id = ? AND cm.left_at IS NULL AND c.deleted_at IS NULL`,
    [userId]
  );
  return rows.map(r => r.id);
}

async function memberIds(conversationId) {
  const [rows] = await db.query(
    `SELECT user_id AS userId FROM conversation_members
      WHERE conversation_id = ? AND left_at IS NULL`,
    [conversationId]
  );
  return rows.map(r => r.userId);
}

/** Resolve @handles to user ids. The handle is the part before @ in the email. */
async function resolveMentions(body) {
  const out = { users: [], here: false, channel: false };
  if (!body) return out;
  const handles = new Set();
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(body)) !== null) {
    const h = m[1].toLowerCase();
    if (h === "here") out.here = true;
    else if (h === "channel") out.channel = true;
    else if (h !== "kody") handles.add(h);
  }
  if (handles.size > 0) {
    const [rows] = await db.query(
      `SELECT id, SUBSTRING_INDEX(email, '@', 1) AS handle FROM users
        WHERE SUBSTRING_INDEX(email, '@', 1) IN (?)`,
      [[...handles]]
    );
    out.users = rows.map(r => r.id);
  }
  return out;
}

async function hydrate(messageIds) {
  if (messageIds.length === 0) return [];
  const [rows] = await db.query(
    `SELECT m.id, m.conversation_id AS conversationId, m.seq, m.sender_id AS senderId,
            m.kind, m.body, m.reply_to_id AS replyToId, m.thread_parent_id AS threadParentId,
            m.client_msg_id AS clientMsgId, m.forwarded_from_id AS forwardedFromId,
            m.edited_at AS editedAt, m.deleted_for_all_at AS deletedForAllAt,
            m.created_at AS createdAt
       FROM messages m WHERE m.id IN (?) ORDER BY m.seq`,
    [messageIds]
  );
  const [reactions] = await db.query(
    `SELECT message_id AS messageId, emoji, user_id AS userId
       FROM message_reactions WHERE message_id IN (?)`,
    [messageIds]
  );
  const [files] = await db.query(
    `SELECT id, message_id AS messageId, file_name AS fileName, media_kind AS mediaKind,
            size_bytes AS sizeBytes, scan_status AS scanStatus
       FROM attachments WHERE message_id IN (?) AND deleted_at IS NULL`,
    [messageIds]
  );

  const byId = new Map(rows.map(r => [r.id, { ...r, reactions: {}, files: [] }]));
  for (const r of reactions) {
    const msg = byId.get(r.messageId);
    if (!msg) continue;
    (msg.reactions[r.emoji] = msg.reactions[r.emoji] || []).push(r.userId);
  }
  for (const f of files) {
    const msg = byId.get(f.messageId);
    if (msg) msg.files.push(f);
  }
  // A message deleted for everyone keeps its slot but carries no content.
  for (const msg of byId.values()) {
    if (msg.deletedForAllAt) { msg.body = null; msg.files = []; }
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Send.
 *
 * `seq` is allocated with SELECT ... FOR UPDATE inside the same transaction as
 * the INSERT. Without the row lock two concurrent senders read the same
 * last_seq and one insert is rejected by the unique index.
 *
 * `clientMsgId` makes a retry safe: the second attempt returns the message the
 * first one created rather than a duplicate.
 */
async function send(userId, { conversationId, body, clientMsgId, replyToId, threadParentId }) {
  const text = body === undefined || body === null ? null : V.str(body, "body", { max: 16000, allowNull: true });
  if (!text) throw new MessageError(400, "empty_message", "A message needs text.");

  const mem = await membership(conversationId, userId);
  if (!mem) throw new MessageError(403, "not_a_member", "You are not in this conversation.");
  if (mem.isArchived) throw new MessageError(403, "archived", "This space is archived.");
  if (mem.isAnnouncement && mem.memberRole !== "owner") {
    throw new MessageError(403, "announcement_only", "Only owners can post in this channel.");
  }

  if (clientMsgId) {
    const existing = await db.one(
      `SELECT id FROM messages WHERE conversation_id = ? AND client_msg_id = ?`,
      [conversationId, clientMsgId]
    );
    if (existing) {
      const [msg] = await hydrate([existing.id]);
      return { message: msg, duplicate: true };
    }
  }

  if (replyToId) {
    const parent = await db.one(
      `SELECT id FROM messages WHERE id = ? AND conversation_id = ?`, [replyToId, conversationId]
    );
    if (!parent) throw new MessageError(400, "bad_reply", "That message is not in this conversation.");
  }
  if (threadParentId) {
    const root = await db.one(
      `SELECT id FROM messages WHERE id = ? AND conversation_id = ?`, [threadParentId, conversationId]
    );
    if (!root) throw new MessageError(400, "bad_thread", "That thread root is not in this conversation.");
  }

  const mentions = await resolveMentions(text);

  let insertedId;
  try {
    insertedId = await db.transaction(async (conn) => {
      const [[row]] = await conn.query(
        `SELECT last_seq FROM conversations WHERE id = ? FOR UPDATE`, [conversationId]
      );
      const seq = Number(row.last_seq) + 1;
      await conn.query(
        `UPDATE conversations SET last_seq = ?, last_message_at = NOW() WHERE id = ?`,
        [seq, conversationId]
      );
      const [res] = await conn.query(
        `INSERT INTO messages (conversation_id, seq, sender_id, kind, body,
                               reply_to_id, thread_parent_id, client_msg_id)
         VALUES (?,?,?,'text',?,?,?,?)`,
        [conversationId, seq, userId, text, replyToId || null, threadParentId || null, clientMsgId || null]
      );
      const id = res.insertId;

      for (const uid of mentions.users) {
        await conn.query(
          `INSERT IGNORE INTO message_mentions (message_id, mention_kind, user_id) VALUES (?, 'user', ?)`,
          [id, uid]
        );
      }
      if (mentions.here) {
        await conn.query(`INSERT IGNORE INTO message_mentions (message_id, mention_kind) VALUES (?, 'here')`, [id]);
      }
      if (mentions.channel) {
        await conn.query(`INSERT IGNORE INTO message_mentions (message_id, mention_kind) VALUES (?, 'channel')`, [id]);
      }

      // the sender has by definition read their own message
      await conn.query(
        `UPDATE conversation_members SET last_read_seq = ?, last_read_at = NOW()
          WHERE conversation_id = ? AND user_id = ?`,
        [seq, conversationId, userId]
      );
      return id;
    });
  } catch (err) {
    // A concurrent duplicate from the same client id lands here.
    if (err && err.code === "ER_DUP_ENTRY" && clientMsgId) {
      const existing = await db.one(
        `SELECT id FROM messages WHERE conversation_id = ? AND client_msg_id = ?`,
        [conversationId, clientMsgId]
      );
      if (existing) {
        const [msg] = await hydrate([existing.id]);
        return { message: msg, duplicate: true };
      }
    }
    throw err;
  }

  const [message] = await hydrate([insertedId]);
  return { message, duplicate: false, mentions };
}

/**
 * Everything the caller has not seen. This single query is how reconnect,
 * offline flush, multi-device sync and pagination all work.
 */
async function since(userId, conversationId, afterSeq, limit = 200) {
  const mem = await membership(conversationId, userId);
  if (!mem) throw new MessageError(403, "not_a_member", "You are not in this conversation.");
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  // Messages this user deleted for themselves must not come back on sync.
  const [rows] = await db.query(
    `SELECT m.id FROM messages m
      WHERE m.conversation_id = ? AND m.seq > ?
        AND NOT EXISTS (SELECT 1 FROM message_hides h
                         WHERE h.message_id = m.id AND h.user_id = ?)
      ORDER BY m.seq LIMIT ?`,
    [conversationId, Number(afterSeq) || 0, userId, lim]
  );
  const messages = await hydrate(rows.map(r => r.id));
  return { conversationId, messages, lastSeq: mem.lastSeq, hasMore: rows.length === lim };
}

/** Older messages, for scrolling up. */
async function before(userId, conversationId, beforeSeq, limit = 50) {
  const mem = await membership(conversationId, userId);
  if (!mem) throw new MessageError(403, "not_a_member", "You are not in this conversation.");
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [rows] = await db.query(
    `SELECT m.id FROM messages m
      WHERE m.conversation_id = ? AND m.seq < ?
        AND NOT EXISTS (SELECT 1 FROM message_hides h
                         WHERE h.message_id = m.id AND h.user_id = ?)
      ORDER BY m.seq DESC LIMIT ?`,
    [conversationId, Number(beforeSeq) || 0, userId, lim]
  );
  const messages = await hydrate(rows.map(r => r.id));
  return { conversationId, messages, hasMore: rows.length === lim };
}

/**
 * Move the read cursor forward only. Going backwards would make an already
 * read message unread again on another device.
 */
async function markRead(userId, conversationId, seq) {
  const mem = await membership(conversationId, userId);
  if (!mem) throw new MessageError(403, "not_a_member", "You are not in this conversation.");
  const target = Math.min(Number(seq) || 0, Number(mem.lastSeq));
  if (target <= Number(mem.lastReadSeq)) {
    return { conversationId, lastReadSeq: Number(mem.lastReadSeq), unchanged: true };
  }
  await db.query(
    `UPDATE conversation_members SET last_read_seq = ?, last_read_at = NOW()
      WHERE conversation_id = ? AND user_id = ?`,
    [target, conversationId, userId]
  );
  return { conversationId, lastReadSeq: target, unchanged: false };
}

/** Unread counts for every conversation the user is in. */
async function unreadSummary(userId) {
  const [rows] = await db.query(
    `SELECT c.id AS conversationId, c.kind, c.name, c.slug,
            c.last_seq AS lastSeq, cm.last_read_seq AS lastReadSeq,
            GREATEST(CAST(c.last_seq AS SIGNED) - CAST(cm.last_read_seq AS SIGNED), 0) AS unread,
            cm.is_muted AS isMuted, cm.notif_level AS notifLevel
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id = ? AND cm.left_at IS NULL AND c.deleted_at IS NULL
      ORDER BY c.last_message_at DESC`,
    [userId]
  );
  return rows.map(r => ({ ...r, isMuted: !!r.isMuted }));
}

module.exports = {
  MessageError, membership, conversationIdsFor, memberIds,
  send, since, before, markRead, unreadSummary, hydrate, resolveMentions,
};

/* ===================================================================
   Message mutations. Added in module 6.
   Each one broadcasts so the HTTP path and the socket path stay in step.
   =================================================================== */

const bus = require("../realtime/bus");

async function getOwned(messageId, conversationId) {
  return db.one(
    `SELECT id, conversation_id AS conversationId, sender_id AS senderId, seq,
            deleted_for_all_at AS deletedForAllAt
       FROM messages WHERE id = ?${conversationId ? " AND conversation_id = ?" : ""}`,
    conversationId ? [messageId, conversationId] : [messageId]
  );
}

/** Only the author may edit, and never a message already deleted for everyone. */
async function edit(userId, messageId, body) {
  const text = V.str(body, "body", { min: 1, max: 16000 });
  const msg = await getOwned(messageId);
  if (!msg) throw new MessageError(404, "not_found", "Message not found.");
  await membershipOrThrow(msg.conversationId, userId);
  if (Number(msg.senderId) !== Number(userId)) {
    throw new MessageError(403, "not_author", "You can only edit your own messages.");
  }
  if (msg.deletedForAllAt) {
    throw new MessageError(400, "already_deleted", "That message was deleted.");
  }

  await db.query(`UPDATE messages SET body = ?, edited_at = NOW() WHERE id = ?`, [text, messageId]);
  const [updated] = await hydrate([messageId]);
  bus.toConversation(msg.conversationId, "message:updated", { message: updated });
  return updated;
}

async function membershipOrThrow(conversationId, userId) {
  const mem = await membership(conversationId, userId);
  if (!mem) throw new MessageError(403, "not_a_member", "You are not in this conversation.");
  return mem;
}

/** Hidden for this user only. Everyone else still sees it. */
async function deleteForMe(userId, messageId) {
  const msg = await getOwned(messageId);
  if (!msg) throw new MessageError(404, "not_found", "Message not found.");
  await membershipOrThrow(msg.conversationId, userId);
  await db.query(
    `INSERT IGNORE INTO message_hides (message_id, user_id) VALUES (?,?)`, [messageId, userId]
  );
  return { messageId: Number(messageId), hidden: true };
}

/**
 * The author, or an owner of the space, may delete for everyone. The row
 * survives so the seq is not orphaned and the audit trail holds; the body and
 * attachments are cleared.
 */
async function deleteForAll(userId, messageId, ctx = {}) {
  const msg = await getOwned(messageId);
  if (!msg) throw new MessageError(404, "not_found", "Message not found.");
  const mem = await membershipOrThrow(msg.conversationId, userId);

  const isAuthor = Number(msg.senderId) === Number(userId);
  if (!isAuthor && mem.memberRole !== "owner") {
    throw new MessageError(403, "not_allowed", "Only the author or an owner can do that.");
  }
  if (msg.deletedForAllAt) return { messageId: Number(messageId), alreadyDeleted: true };

  await db.transaction(async (conn) => {
    await conn.query(
      `UPDATE messages SET deleted_for_all_at = NOW(), body = NULL WHERE id = ?`, [messageId]
    );
    await conn.query(`UPDATE attachments SET deleted_at = NOW() WHERE message_id = ?`, [messageId]);
    await conn.query(`DELETE FROM message_reactions WHERE message_id = ?`, [messageId]);
    await conn.query(`DELETE FROM message_pins WHERE message_id = ?`, [messageId]);
  });

  bus.toConversation(msg.conversationId, "message:deleted", {
    conversationId: msg.conversationId, messageId: Number(messageId), deletedBy: userId,
  });
  return { messageId: Number(messageId), deleted: true };
}

async function react(userId, messageId, emoji, on = true) {
  const e = V.str(emoji, "emoji", { min: 1, max: 32 });
  const msg = await getOwned(messageId);
  if (!msg) throw new MessageError(404, "not_found", "Message not found.");
  await membershipOrThrow(msg.conversationId, userId);
  if (msg.deletedForAllAt) throw new MessageError(400, "already_deleted", "That message was deleted.");

  if (on) {
    await db.query(
      `INSERT IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?,?,?)`,
      [messageId, userId, e]
    );
  } else {
    await db.query(
      `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`,
      [messageId, userId, e]
    );
  }
  const [updated] = await hydrate([messageId]);
  bus.toConversation(msg.conversationId, "message:reaction", {
    conversationId: msg.conversationId, messageId: Number(messageId),
    emoji: e, userId, on, reactions: updated.reactions,
  });
  return updated;
}

async function pin(userId, messageId, on = true) {
  const msg = await getOwned(messageId);
  if (!msg) throw new MessageError(404, "not_found", "Message not found.");
  await membershipOrThrow(msg.conversationId, userId);
  if (msg.deletedForAllAt) throw new MessageError(400, "already_deleted", "That message was deleted.");

  if (on) {
    await db.query(
      `INSERT IGNORE INTO message_pins (conversation_id, message_id, pinned_by) VALUES (?,?,?)`,
      [msg.conversationId, messageId, userId]
    );
  } else {
    await db.query(
      `DELETE FROM message_pins WHERE conversation_id = ? AND message_id = ?`,
      [msg.conversationId, messageId]
    );
  }
  bus.toConversation(msg.conversationId, "message:pin", {
    conversationId: msg.conversationId, messageId: Number(messageId), pinned: on, by: userId,
  });
  return { messageId: Number(messageId), pinned: on };
}

async function listPins(userId, conversationId) {
  await membershipOrThrow(conversationId, userId);
  const [rows] = await db.query(
    `SELECT message_id AS messageId FROM message_pins WHERE conversation_id = ? ORDER BY pinned_at DESC`,
    [conversationId]
  );
  return { conversationId: Number(conversationId), messages: await hydrate(rows.map(r => r.messageId)) };
}

/** Copy a message into another conversation the caller is also in. */
async function forward(userId, messageId, targetConversationId) {
  const source = await db.one(
    `SELECT id, conversation_id AS conversationId, body, deleted_for_all_at AS deletedForAllAt
       FROM messages WHERE id = ?`, [messageId]
  );
  if (!source) throw new MessageError(404, "not_found", "Message not found.");
  if (source.deletedForAllAt) throw new MessageError(400, "already_deleted", "That message was deleted.");

  await membershipOrThrow(source.conversationId, userId);   // must be able to see it
  const out = await send(userId, {                          // and able to post there
    conversationId: targetConversationId,
    body: source.body,
    clientMsgId: `fwd-${messageId}-${Date.now()}`,
  });

  await db.query(`UPDATE messages SET forwarded_from_id = ? WHERE id = ?`, [messageId, out.message.id]);
  const [final] = await hydrate([out.message.id]);
  bus.toConversation(targetConversationId, "message:new", { message: final });
  return final;
}

/** Replies hanging off one message. */
async function threadOf(userId, messageId) {
  const root = await getOwned(messageId);
  if (!root) throw new MessageError(404, "not_found", "Message not found.");
  await membershipOrThrow(root.conversationId, userId);
  const [rows] = await db.query(
    `SELECT id FROM messages WHERE thread_parent_id = ? ORDER BY seq`, [messageId]
  );
  const [rootMsg] = await hydrate([messageId]);
  return { root: rootMsg, replies: await hydrate(rows.map(r => r.id)) };
}

/** One draft per user per conversation, so switching conversations keeps it. */
async function saveDraft(userId, conversationId, body) {
  await membershipOrThrow(conversationId, userId);
  const text = body === null || body === undefined ? "" : String(body).slice(0, 16000);
  if (text.trim() === "") {
    await db.query(`DELETE FROM drafts WHERE user_id = ? AND conversation_id = ?`, [userId, conversationId]);
    return { conversationId: Number(conversationId), body: null };
  }
  await db.query(
    `INSERT INTO drafts (user_id, conversation_id, body) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE body = VALUES(body)`,
    [userId, conversationId, text]
  );
  return { conversationId: Number(conversationId), body: text };
}

async function listDrafts(userId) {
  const [rows] = await db.query(
    `SELECT conversation_id AS conversationId, body, updated_at AS updatedAt
       FROM drafts WHERE user_id = ?`, [userId]
  );
  return rows;
}

module.exports.edit = edit;
module.exports.deleteForMe = deleteForMe;
module.exports.deleteForAll = deleteForAll;
module.exports.react = react;
module.exports.pin = pin;
module.exports.listPins = listPins;
module.exports.forward = forward;
module.exports.threadOf = threadOf;
module.exports.saveDraft = saveDraft;
module.exports.listDrafts = listDrafts;
