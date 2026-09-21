"use strict";
const db = require("../db");
const V = require("../lib/validate");
const bus = require("../realtime/bus");
const { audit } = require("./auth.service");

class ConversationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const RETENTIONS = ["forever", "1y", "90d", "30d"];
const NOTIF_LEVELS = ["all", "mentions", "none"];
const MEMBER_ROLES = ["owner", "member", "guest"];

const slugify = (name) =>
  String(name).toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || null;

async function membership(conversationId, userId) {
  return db.one(
    `SELECT cm.member_role AS memberRole, cm.notif_level AS notifLevel,
            cm.is_muted AS isMuted, cm.is_favourite AS isFavourite,
            cm.last_read_seq AS lastReadSeq, cm.left_at AS leftAt
       FROM conversation_members cm
      WHERE cm.conversation_id = ? AND cm.user_id = ?`,
    [conversationId, userId]
  );
}

async function requireMember(conversationId, userId) {
  const m = await membership(conversationId, userId);
  if (!m || m.leftAt) {
    throw new ConversationError(403, "not_a_member", "You are not in this conversation.");
  }
  return m;
}

async function requireOwner(conversationId, userId) {
  const m = await requireMember(conversationId, userId);
  if (m.memberRole !== "owner") {
    throw new ConversationError(403, "owner_only", "Only an owner can do that.");
  }
  return m;
}

async function getRaw(id) {
  return db.one(
    `SELECT id, kind, slug, name, topic, purpose,
            is_private AS isPrivate, is_announcement AS isAnnouncement,
            is_default AS isDefault, is_archived AS isArchived,
            retention, created_by AS createdBy, last_seq AS lastSeq,
            last_message_at AS lastMessageAt, created_at AS createdAt
       FROM conversations WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
}

async function membersOf(conversationId) {
  const [rows] = await db.query(
    `SELECT cm.user_id AS userId, cm.member_role AS memberRole, cm.joined_at AS joinedAt,
            u.full_name AS fullName, u.initials, u.email, u.presence, u.job_title AS jobTitle
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ? AND cm.left_at IS NULL
      ORDER BY (cm.member_role = 'owner') DESC, u.full_name`,
    [conversationId]
  );
  return rows;
}

function shape(convo, mem, members) {
  return {
    ...convo,
    isPrivate: !!convo.isPrivate,
    isAnnouncement: !!convo.isAnnouncement,
    isDefault: !!convo.isDefault,
    isArchived: !!convo.isArchived,
    lastSeq: Number(convo.lastSeq),
    me: mem ? {
      memberRole: mem.memberRole,
      notifLevel: mem.notifLevel,
      isMuted: !!mem.isMuted,
      isFavourite: !!mem.isFavourite,
      lastReadSeq: Number(mem.lastReadSeq),
      unread: Math.max(0, Number(convo.lastSeq) - Number(mem.lastReadSeq)),
    } : null,
    members: members || undefined,
  };
}

async function get(conversationId, userId) {
  const convo = await getRaw(conversationId);
  if (!convo) throw new ConversationError(404, "not_found", "Conversation not found.");
  const mem = await membership(conversationId, userId);

  // A private space is invisible to anyone outside it, including its existence.
  if (!mem || mem.leftAt) {
    if (convo.isPrivate || convo.kind !== "channel") {
      throw new ConversationError(404, "not_found", "Conversation not found.");
    }
    return shape(convo, null, await membersOf(conversationId));
  }
  const out = shape(convo, mem, await membersOf(conversationId));
  // dAI: a DM has no stored name. Derive it from the other member, exactly as
  // listMine() does, so openDm and get return the same shape the UI reads.
  if (out && out.kind === "dm" && Array.isArray(out.members)) {
    const p = out.members.find(m => Number(m.userId) !== Number(userId));
    if (p) {
      out.peer = { userId: p.userId, fullName: p.fullName, initials: p.initials, presence: p.presence };
      out.name = p.fullName;
    }
  }
  return out;
}

/** Everything the user is in, favourites first, most recent next. */
async function listMine(userId, { includeArchived = false } = {}) {
  const [rows] = await db.query(
    `SELECT c.id, c.kind, c.slug, c.name, c.topic,
            c.is_private AS isPrivate, c.is_announcement AS isAnnouncement,
            c.is_archived AS isArchived, c.last_seq AS lastSeq,
            c.last_message_at AS lastMessageAt,
            cm.member_role AS memberRole, cm.notif_level AS notifLevel,
            cm.is_muted AS isMuted, cm.is_favourite AS isFavourite,
            cm.last_read_seq AS lastReadSeq,
            GREATEST(CAST(c.last_seq AS SIGNED) - CAST(cm.last_read_seq AS SIGNED), 0) AS unread
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id = ? AND cm.left_at IS NULL AND c.deleted_at IS NULL
            ${includeArchived ? "" : "AND c.is_archived = 0"}
      ORDER BY cm.is_favourite DESC, c.last_message_at IS NULL, c.last_message_at DESC`,
    [userId]
  );

  // DMs have no name, so derive it from the other member.
  const dmIds = rows.filter(r => r.kind === "dm").map(r => r.id);
  const others = new Map();
  if (dmIds.length > 0) {
    const [peers] = await db.query(
      `SELECT cm.conversation_id AS conversationId, u.id AS userId, u.full_name AS fullName,
              u.initials, u.presence
         FROM conversation_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id IN (?) AND cm.user_id <> ? AND cm.left_at IS NULL`,
      [dmIds, userId]
    );
    peers.forEach(p => others.set(p.conversationId, p));
  }

  return rows.map(r => ({
    ...r,
    isPrivate: !!r.isPrivate,
    isAnnouncement: !!r.isAnnouncement,
    isArchived: !!r.isArchived,
    isMuted: !!r.isMuted,
    isFavourite: !!r.isFavourite,
    lastSeq: Number(r.lastSeq),
    lastReadSeq: Number(r.lastReadSeq),
    unread: Number(r.unread),
    peer: r.kind === "dm" ? others.get(r.id) || null : undefined,
    name: r.kind === "dm" ? (others.get(r.id) || {}).fullName || "Direct message" : r.name,
  }));
}

/** Public channels, for the Browse screen. Private ones are excluded entirely. */
async function directory(userId, { q } = {}) {
  const params = [userId];
  let where = `c.kind = 'channel' AND c.deleted_at IS NULL AND c.is_private = 0`;
  if (q) {
    where += ` AND (c.name LIKE ? OR c.topic LIKE ?)`;
    const like = `%${String(q).slice(0, 80)}%`;
    params.push(like, like);
  }
  const [rows] = await db.query(
    `SELECT c.id, c.slug, c.name, c.topic, c.is_archived AS isArchived,
            (SELECT COUNT(*) FROM conversation_members m
              WHERE m.conversation_id = c.id AND m.left_at IS NULL) AS memberCount,
            EXISTS (SELECT 1 FROM conversation_members m2
                     WHERE m2.conversation_id = c.id AND m2.user_id = ? AND m2.left_at IS NULL) AS joined
       FROM conversations c
      WHERE ${where}
      ORDER BY c.is_archived, c.name`,
    params
  );
  return rows.map(r => ({ ...r, isArchived: !!r.isArchived, joined: !!r.joined }));
}

async function create(userId, body, ctx = {}) {
  const kind = V.oneOf(body.kind, "kind", ["group", "channel"]);
  const name = V.str(body.name, "name", { min: 1, max: 160 });
  const topic = V.str(body.topic, "topic", { max: 300, allowNull: true });
  const isPrivate = body.isPrivate === undefined ? (kind === "group" ? 1 : 0) : V.bool(body.isPrivate, "isPrivate");
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds.map(Number).filter(Number.isInteger) : [];

  let slug = null;
  if (kind === "channel") {
    slug = slugify(name);
    if (!slug) throw new V.ValidationError("That channel name has no usable characters.", "name");
    const clash = await db.one(`SELECT id FROM conversations WHERE slug = ? AND deleted_at IS NULL`, [slug]);
    if (clash) throw new ConversationError(409, "slug_taken", "A channel with that name already exists.");
  }

  const id = await db.transaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO conversations (kind, slug, name, topic, is_private, created_by)
       VALUES (?,?,?,?,?,?)`,
      [kind, slug, kind === "channel" ? slug : name, topic, isPrivate, userId]
    );
    const cid = res.insertId;
    await conn.query(
      `INSERT INTO conversation_members (conversation_id, user_id, member_role) VALUES (?,?,'owner')`,
      [cid, userId]
    );
    for (const uid of new Set(memberIds.filter(u => u !== userId))) {
      await conn.query(
        `INSERT IGNORE INTO conversation_members (conversation_id, user_id, member_role) VALUES (?,?,'member')`,
        [cid, uid]
      );
    }
    return cid;
  });

  for (const uid of new Set([userId, ...memberIds])) {
    await bus.joinUserToConversation(uid, id);
    bus.toUser(uid, "conversation:added", { conversationId: id });
  }
  await audit(null, {
    actorId: userId, action: "conversation.created", entityType: "conversation", entityId: id,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { kind, name },
  });
  return get(id, userId);
}

/**
 * Find or create the DM between two people. Deterministic: the same pair
 * always resolves to the same conversation, so two clients cannot create
 * competing threads.
 */
async function openDm(userId, otherUserId, ctx = {}) {
  const other = Number(otherUserId);
  if (!Number.isInteger(other) || other === userId) {
    throw new V.ValidationError("Pick a different person.", "userId");
  }
  const exists = await db.one(
    `SELECT u.id FROM users u WHERE u.id = ? AND u.is_active = 1 AND u.deleted_at IS NULL`, [other]
  );
  if (!exists) throw new ConversationError(404, "user_not_found", "That person is not available.");

  const found = await db.one(
    `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
      WHERE c.kind = 'dm' AND c.deleted_at IS NULL
      GROUP BY c.id
     HAVING COUNT(DISTINCT CASE WHEN c.kind='dm' THEN 1 END) = 1
      LIMIT 1`,
    [userId, other]
  );
  if (found) return get(found.id, userId);

  const id = await db.transaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO conversations (kind, is_private, created_by) VALUES ('dm', 1, ?)`, [userId]
    );
    const cid = res.insertId;
    await conn.query(
      `INSERT INTO conversation_members (conversation_id, user_id, member_role)
       VALUES (?,?,'member'), (?,?,'member')`,
      [cid, userId, cid, other]
    );
    return cid;
  });

  for (const uid of [userId, other]) {
    await bus.joinUserToConversation(uid, id);
    bus.toUser(uid, "conversation:added", { conversationId: id });
  }
  return get(id, userId);
}

async function update(conversationId, userId, body, ctx = {}) {
  await requireOwner(conversationId, userId);
  const convo = await getRaw(conversationId);
  if (!convo) throw new ConversationError(404, "not_found", "Conversation not found.");
  if (convo.kind === "dm") throw new ConversationError(400, "dm_not_editable", "A direct message has no settings.");

  const input = V.pick(body, [
    "name", "topic", "purpose", "isPrivate", "isAnnouncement", "isDefault", "isArchived", "retention",
  ]);
  const set = {};

  if ("name" in input) {
    const name = V.str(input.name, "name", { min: 1, max: 160 });
    if (convo.kind === "channel") {
      const slug = slugify(name);
      if (!slug) throw new V.ValidationError("That channel name has no usable characters.", "name");
      const clash = await db.one(
        `SELECT id FROM conversations WHERE slug = ? AND id <> ? AND deleted_at IS NULL`, [slug, conversationId]
      );
      if (clash) throw new ConversationError(409, "slug_taken", "A channel with that name already exists.");
      set.slug = slug;
      set.name = slug;
    } else {
      set.name = name;
    }
  }
  if ("topic" in input)          set.topic           = V.str(input.topic, "topic", { max: 300, allowNull: true });
  if ("purpose" in input)        set.purpose         = V.str(input.purpose, "purpose", { max: 1000, allowNull: true });
  if ("isPrivate" in input)      set.is_private      = V.bool(input.isPrivate, "isPrivate");
  if ("isAnnouncement" in input) set.is_announcement = V.bool(input.isAnnouncement, "isAnnouncement");
  if ("isDefault" in input)      set.is_default      = V.bool(input.isDefault, "isDefault");
  if ("isArchived" in input)     set.is_archived     = V.bool(input.isArchived, "isArchived");
  if ("retention" in input)      set.retention       = V.oneOf(input.retention, "retention", RETENTIONS);

  if (Object.keys(set).length === 0) throw new V.ValidationError("Nothing to update.");

  const cols = Object.keys(set).map(k => `${k} = ?`).join(", ");
  await db.query(`UPDATE conversations SET ${cols} WHERE id = ?`, [...Object.values(set), conversationId]);

  const fresh = await get(conversationId, userId);
  bus.toConversation(conversationId, "conversation:updated", { conversation: fresh });
  await audit(null, {
    actorId: userId, action: "conversation.updated", entityType: "conversation", entityId: conversationId,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { fields: Object.keys(set) },
  });
  return fresh;
}

/** Per-user preferences. Not owner-gated, because they affect only that user. */
async function updateMyMembership(conversationId, userId, body) {
  await requireMember(conversationId, userId);
  const input = V.pick(body, ["notifLevel", "isMuted", "isFavourite"]);
  const set = {};
  if ("notifLevel" in input)  set.notif_level  = V.oneOf(input.notifLevel, "notifLevel", NOTIF_LEVELS);
  if ("isMuted" in input)     set.is_muted     = V.bool(input.isMuted, "isMuted");
  if ("isFavourite" in input) set.is_favourite = V.bool(input.isFavourite, "isFavourite");
  if (Object.keys(set).length === 0) throw new V.ValidationError("Nothing to update.");

  const cols = Object.keys(set).map(k => `${k} = ?`).join(", ");
  await db.query(
    `UPDATE conversation_members SET ${cols} WHERE conversation_id = ? AND user_id = ?`,
    [...Object.values(set), conversationId, userId]
  );
  return get(conversationId, userId);
}

async function addMember(conversationId, userId, targetId, ctx = {}) {
  await requireOwner(conversationId, userId);
  const convo = await getRaw(conversationId);
  if (convo.kind === "dm") throw new ConversationError(400, "dm_fixed", "A direct message has exactly two people.");

  const target = await db.one(
    `SELECT id FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`, [targetId]
  );
  if (!target) throw new ConversationError(404, "user_not_found", "That person is not available.");

  await db.query(
    `INSERT INTO conversation_members (conversation_id, user_id, member_role)
     VALUES (?,?,'member')
     ON DUPLICATE KEY UPDATE left_at = NULL`,
    [conversationId, targetId]
  );

  await bus.joinUserToConversation(targetId, conversationId);
  bus.toUser(targetId, "conversation:added", { conversationId });
  bus.toConversation(conversationId, "member:added", { conversationId, userId: Number(targetId) });
  await audit(null, {
    actorId: userId, action: "conversation.member_added", entityType: "conversation",
    entityId: conversationId, ip: ctx.ip, userAgent: ctx.userAgent, meta: { targetId },
  });
  return { members: await membersOf(conversationId) };
}

async function removeMember(conversationId, userId, targetId, ctx = {}) {
  await requireOwner(conversationId, userId);
  const convo = await getRaw(conversationId);
  if (convo.kind === "dm") throw new ConversationError(400, "dm_fixed", "A direct message has exactly two people.");

  const owners = await db.one(
    `SELECT COUNT(*) AS n FROM conversation_members
      WHERE conversation_id = ? AND member_role = 'owner' AND left_at IS NULL`,
    [conversationId]
  );
  const targetMem = await membership(conversationId, targetId);
  if (targetMem && targetMem.memberRole === "owner" && Number(owners.n) <= 1) {
    throw new ConversationError(400, "last_owner", "A space must keep at least one owner.");
  }

  await db.query(
    `UPDATE conversation_members SET left_at = NOW()
      WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL`,
    [conversationId, targetId]
  );
  await bus.leaveUserFromConversation(targetId, conversationId);
  bus.toUser(targetId, "conversation:removed", { conversationId });
  bus.toConversation(conversationId, "member:removed", { conversationId, userId: Number(targetId) });
  await audit(null, {
    actorId: userId, action: "conversation.member_removed", entityType: "conversation",
    entityId: conversationId, ip: ctx.ip, userAgent: ctx.userAgent, meta: { targetId },
  });
  return { members: await membersOf(conversationId) };
}

async function setMemberRole(conversationId, userId, targetId, role, ctx = {}) {
  await requireOwner(conversationId, userId);
  const memberRole = V.oneOf(role, "memberRole", MEMBER_ROLES);

  if (memberRole !== "owner") {
    const owners = await db.one(
      `SELECT COUNT(*) AS n FROM conversation_members
        WHERE conversation_id = ? AND member_role = 'owner' AND left_at IS NULL`,
      [conversationId]
    );
    const targetMem = await membership(conversationId, targetId);
    if (targetMem && targetMem.memberRole === "owner" && Number(owners.n) <= 1) {
      throw new ConversationError(400, "last_owner", "A space must keep at least one owner.");
    }
  }

  const [res] = await db.query(
    `UPDATE conversation_members SET member_role = ?
      WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL`,
    [memberRole, conversationId, targetId]
  );
  if (res.affectedRows === 0) {
    throw new ConversationError(404, "not_a_member", "That person is not in this conversation.");
  }
  await audit(null, {
    actorId: userId, action: "conversation.role_changed", entityType: "conversation",
    entityId: conversationId, ip: ctx.ip, userAgent: ctx.userAgent, meta: { targetId, memberRole },
  });
  return { members: await membersOf(conversationId) };
}

/** Join a public channel. Private channels need an invitation. */
async function join(conversationId, userId) {
  const convo = await getRaw(conversationId);
  if (!convo || convo.kind !== "channel") {
    throw new ConversationError(404, "not_found", "Channel not found.");
  }
  if (convo.isPrivate) {
    throw new ConversationError(403, "private_channel", "This channel is invitation only.");
  }
  if (convo.isArchived) {
    throw new ConversationError(403, "archived", "This channel is archived.");
  }
  await db.query(
    `INSERT INTO conversation_members (conversation_id, user_id, member_role)
     VALUES (?,?,'member') ON DUPLICATE KEY UPDATE left_at = NULL`,
    [conversationId, userId]
  );
  await bus.joinUserToConversation(userId, conversationId);
  bus.toConversation(conversationId, "member:added", { conversationId, userId });
  return get(conversationId, userId);
}

async function leave(conversationId, userId) {
  const mem = await requireMember(conversationId, userId);
  const convo = await getRaw(conversationId);
  if (convo.kind === "dm") throw new ConversationError(400, "dm_fixed", "You cannot leave a direct message.");

  if (mem.memberRole === "owner") {
    const owners = await db.one(
      `SELECT COUNT(*) AS n FROM conversation_members
        WHERE conversation_id = ? AND member_role = 'owner' AND left_at IS NULL`,
      [conversationId]
    );
    if (Number(owners.n) <= 1) {
      throw new ConversationError(400, "last_owner", "Hand ownership to someone else before leaving.");
    }
  }

  await db.query(
    `UPDATE conversation_members SET left_at = NOW() WHERE conversation_id = ? AND user_id = ?`,
    [conversationId, userId]
  );
  await bus.leaveUserFromConversation(userId, conversationId);
  bus.toConversation(conversationId, "member:removed", { conversationId, userId });
  return { left: true };
}

/** Soft delete, so message history survives for audit and eDiscovery. */
async function remove(conversationId, userId, ctx = {}) {
  await requireOwner(conversationId, userId);
  const convo = await getRaw(conversationId);
  if (convo.kind === "dm") throw new ConversationError(400, "dm_fixed", "A direct message cannot be deleted.");

  await db.query(`UPDATE conversations SET deleted_at = NOW() WHERE id = ?`, [conversationId]);
  bus.toConversation(conversationId, "conversation:deleted", { conversationId });
  await audit(null, {
    actorId: userId, action: "conversation.deleted", entityType: "conversation",
    entityId: conversationId, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { deleted: true };
}

module.exports = {
  ConversationError, membership, requireMember, requireOwner,
  get, listMine, directory, create, openDm, update, updateMyMembership,
  addMember, removeMember, setMemberRole, join, leave, remove, membersOf, slugify,
};
