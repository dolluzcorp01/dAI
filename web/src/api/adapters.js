/**
 * Adapters.
 *
 * The v10 prototype was frozen as the UI contract, and the backend was built
 * to its own naming. Every field differs. Rather than rewrite 2,000 lines of
 * reviewed and approved UI, the mapping lives here, in one file, tested.
 *
 * Read this before changing either side. If you rename a backend column,
 * this is the only place the client needs to change.
 *
 *   backend                     v10 UI
 *   --------------------------  --------------------------
 *   conversationId              convo   (as "kind:id")
 *   senderId                    from
 *   body                        text
 *   createdAt                   ts
 *   editedAt                    edited  (boolean)
 *   deletedForAllAt             deletedForAll (boolean)
 *   replyToId                   replyTo
 *   threadParentId              threadParent
 *   forwardedFromId             forwarded (boolean)
 *   sourceName/sourceAsOf       source: { name, asOf }
 *   lookupCode/Set/Description  lookup: { code, set, desc }
 *   latencyMs                   ms
 *   usedWebSearch               live
 *   fullName                    name
 *   jobTitle                    role
 *   presence                    status
 */

/** The UI keys conversations as "dm:1", "group:g1", "channel:c1". */
export function convoKey(conversation) {
  if (!conversation) return null;
  return `${conversation.kind}:${conversation.id}`;
}

export function parseConvoKey(key) {
  const [kind, id] = String(key || "").split(":");
  return { kind, id: Number(id) };
}

/**
 * Delivery state.
 *
 * The backend has no per-message state column; it is derived. A message is
 * read when every other member's read cursor has passed its seq. This is why
 * the UI must be given the cursors, not just the messages.
 */
export function deliveryState(message, { myUserId, memberCursors = [], acknowledged = true }) {
  if (message.senderId !== myUserId) return null;       // only your own messages show ticks
  if (message.pending) return "sending";
  if (message.failed) return "failed";
  if (!acknowledged) return "sending";

  const others = memberCursors.filter(c => c.userId !== myUserId);
  if (others.length === 0) return "sent";
  const allRead = others.every(c => Number(c.lastReadSeq) >= Number(message.seq));
  if (allRead) return "read";
  const anyRead = others.some(c => Number(c.lastReadSeq) >= Number(message.seq));
  return anyRead ? "delivered" : "sent";
}

export function toUiMessage(m, ctx = {}) {
  if (!m) return null;
  const { myUserId, memberCursors, conversationKind = "dm" } = ctx;
  return {
    id: String(m.id),
    seq: Number(m.seq),
    convo: `${conversationKind}:${m.conversationId}`,
    conversationId: m.conversationId,
    from: m.senderId === null ? "kody" : m.senderId,
    me: myUserId !== undefined && m.senderId === myUserId,
    text: m.body || "",
    ts: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
    state: deliveryState(m, { myUserId, memberCursors, acknowledged: !m.pending }),
    reactions: m.reactions || {},
    files: (m.files || []).map(toUiFile),
    replyTo: m.replyToId ? String(m.replyToId) : null,
    threadParent: m.threadParentId ? String(m.threadParentId) : null,
    edited: !!m.editedAt,
    deletedForAll: !!m.deletedForAllAt,
    forwarded: !!m.forwardedFromId,
    clientMsgId: m.clientMsgId || null,
    kody: m.kody ? toUiAnswer(m.kody) : (m.kind === "kody" ? { bare: true } : null),
  };
}

export function toUiFile(f) {
  if (!f) return null;
  return {
    id: String(f.id),
    name: f.fileName,
    kind: f.mediaKind,
    size: f.size || null,
    sizeBytes: f.sizeBytes,
    scanStatus: f.scanStatus || "clean",
    url: f.id ? `/api/files/${f.id}/download` : null,
  };
}

/** A Kody answer, in the shape the v10 AnswerCard reads. */
export function toUiAnswer(a) {
  if (!a) return null;
  const lookup = a.lookupCode
    ? { code: a.lookupCode, set: a.lookupSet, desc: a.lookupDescription || "" }
    : null;
  return {
    id: a.id !== undefined ? String(a.id) : undefined,
    text: a.body !== undefined ? (a.body || "") : (a.text || ""),
    domain: a.domain || "general",
    confidence: a.confidence || "medium",
    source: { name: a.sourceName || "Kody", asOf: a.sourceAsOf || null },
    disclaimer: a.disclaimer || null,
    lookup,
    links: a.links || [],
    citations: a.citations || [],
    tier: a.tier,
    ms: a.latencyMs,
    live: !!a.usedWebSearch,
    retrieved: !!a.usedRetrieval,
    degraded: !!a.degraded,
    myVote: a.myVote || null,
    ts: a.createdAt
      ? new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : undefined,
  };
}

export function toUiPerson(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.fullName,
    role: u.jobTitle || "",
    team: u.team || null,
    status: u.presence || "offline",
    initials: u.initials || initialsOf(u.fullName),
    skills: u.skills || [],
    localTime: u.localTime || null,
    statusText: u.statusText || null,
    statusEmoji: u.statusEmoji || null,
    ooo: !!u.ooo,
  };
}

export function toUiConversation(c, myUserId) {
  if (!c) return null;
  const kind = c.kind;
  return {
    key: `${kind}:${c.id}`,
    id: c.id,
    kind,
    name: kind === "dm" ? (c.peer ? c.peer.fullName : c.name) : c.name,
    sub: c.topic || "",
    status: c.peer ? c.peer.presence : undefined,
    initials: c.peer ? c.peer.initials : undefined,
    private: !!c.isPrivate,
    announcement: !!c.isAnnouncement,
    archived: !!c.isArchived,
    muted: !!c.isMuted,
    favourite: !!c.isFavourite,
    unread: Number(c.unread || 0),
    lastSeq: Number(c.lastSeq || 0),
    lastReadSeq: Number(c.lastReadSeq || 0),
    memberRole: c.memberRole || (c.me && c.me.memberRole) || "member",
    notifLevel: c.notifLevel || (c.me && c.me.notifLevel) || "all",
    members: c.members ? c.members.map(m => ({
      id: m.userId, name: m.fullName, initials: m.initials,
      role: m.jobTitle || "", memberRole: m.memberRole, status: m.presence,
    })) : undefined,
  };
}

function initialsOf(name) {
  return String(name || "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join("") || "??";
}

/** Server error codes to sentences a person can act on. */
export const ERROR_TEXT = {
  not_a_member: "You are not in this conversation.",
  announcement_only: "Only owners can post in this channel.",
  archived: "This space is archived.",
  owner_only: "Only an owner can change that.",
  last_owner: "A space must keep at least one owner.",
  private_channel: "This channel is invitation only.",
  slug_taken: "A channel with that name already exists.",
  type_not_allowed: "That file type is not accepted.",
  too_large: "That file is too large.",
  infected: "That file was rejected by the malware scanner.",
  scan_pending: "That file is still being scanned.",
  not_clean: "That file is not available.",
  not_author: "You can only edit your own messages.",
  already_deleted: "That message was deleted.",
  rate_limited: "Too many requests. Wait a moment.",
  account_locked: "Too many failed attempts. Try again later.",
  session_revoked: "Your session ended. Sign in again.",
  refresh_reused: "Your session ended for security. Sign in again.",
};

export function errorText(err) {
  if (!err) return "Something went wrong.";
  return ERROR_TEXT[err.code] || err.message || "Something went wrong.";
}
