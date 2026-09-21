"use strict";
const db = require("../db");
const V = require("../lib/validate");

/**
 * Search.
 *
 * The single most important property here is that search is permission scoped
 * at the SQL level, not filtered afterwards. Every message query joins
 * `conversation_members` for the caller. A private channel or someone else's
 * DM cannot appear in a result set, not even as a count, because the rows are
 * never selected in the first place.
 *
 * Fulltext is used where the term is long enough for InnoDB to have indexed
 * it, and LIKE otherwise. InnoDB's default `innodb_ft_min_token_size` is 3, so
 * "CO" or "AR" would silently return nothing from MATCH. Those are exactly the
 * terms an RCM associate searches for.
 */

class SearchError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MIN_FULLTEXT_TOKEN = 3;

/**
 * Parse `from:pavithran in:denials-help has:file after:2026-09-01 inclusive denial`
 * into structured filters plus free text.
 */
function parseQuery(raw) {
  const out = { terms: [], from: null, in: null, before: null, after: null, has: null, is: null };
  const text = String(raw || "").trim();
  if (!text) return out;

  // Quoted phrases survive as single terms.
  const tokens = text.match(/"[^"]*"|\S+/g) || [];
  for (const token of tokens) {
    const m = token.match(/^(from|in|before|after|has|is):(.+)$/i);
    if (!m) {
      out.terms.push(token.replace(/^"|"$/g, "").toLowerCase());
      continue;
    }
    const key = m[1].toLowerCase();
    const value = m[2].replace(/^"|"$/g, "").replace(/^[@#]/, "").toLowerCase();
    if (key === "from") out.from = value;
    else if (key === "in") out.in = value;
    else if (key === "has") out.has = value;
    else if (key === "is") out.is = value;
    else if (key === "before" || key === "after") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) out[key] = value;
    }
  }
  out.terms = out.terms.filter(Boolean).slice(0, 10);
  out.text = out.terms.join(" ");
  return out;
}

const longEnoughForFulltext = (terms) =>
  terms.length > 0 && terms.every(t => t.length >= MIN_FULLTEXT_TOKEN);

/** A short window of text around the first match, for the result row. */
function snippet(body, terms, width = 160) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (text.length <= width) return text;
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return text.slice(0, width) + "...";
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  return (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
}

/* ---------------- messages ---------------- */

async function searchMessages(userId, q, { limit = 25, offset = 0 } = {}) {
  const parsed = parseQuery(q);
  if (parsed.terms.length === 0 && !parsed.from && !parsed.in && !parsed.has) {
    return { results: [], total: 0 };
  }

  // Membership is part of the query, never a filter applied to the results.
  const where = [
    "cm.user_id = ?",
    "cm.left_at IS NULL",
    "c.deleted_at IS NULL",
    "m.deleted_for_all_at IS NULL",
    "NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.message_id = m.id AND h.user_id = ?)",
  ];
  const params = [userId, userId];

  const useFulltext = longEnoughForFulltext(parsed.terms);
  if (parsed.terms.length > 0) {
    if (useFulltext) {
      where.push("MATCH(m.body) AGAINST (? IN NATURAL LANGUAGE MODE)");
      params.push(parsed.text);
    } else {
      // Short tokens are below InnoDB's index threshold, so fall back to LIKE.
      for (const t of parsed.terms) {
        where.push("m.body LIKE ?");
        params.push(`%${t}%`);
      }
    }
  }

  if (parsed.from) {
    where.push(`EXISTS (SELECT 1 FROM users u WHERE u.id = m.sender_id
                 AND (LOWER(u.full_name) LIKE ? OR LOWER(SUBSTRING_INDEX(u.email,'@',1)) = ?))`);
    params.push(`%${parsed.from}%`, parsed.from);
  }
  if (parsed.in) {
    where.push(`(LOWER(c.slug) = ? OR LOWER(c.name) LIKE ?)`);
    params.push(parsed.in, `%${parsed.in}%`);
  }
  if (parsed.has === "file" || parsed.has === "files") {
    where.push(`EXISTS (SELECT 1 FROM attachments a
                 WHERE a.message_id = m.id AND a.deleted_at IS NULL AND a.scan_status = 'clean')`);
  }
  if (parsed.has === "link") {
    where.push("m.body LIKE '%http%'");
  }
  if (parsed.is === "pinned") {
    where.push(`EXISTS (SELECT 1 FROM message_pins p WHERE p.message_id = m.id)`);
  }
  if (parsed.after)  { where.push("m.created_at >= ?"); params.push(parsed.after + " 00:00:00"); }
  if (parsed.before) { where.push("m.created_at <= ?"); params.push(parsed.before + " 23:59:59"); }

  const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  const clause = where.join(" AND ");

  const relevance = useFulltext
    ? "MATCH(m.body) AGAINST (? IN NATURAL LANGUAGE MODE)"
    : "1";
  const relevanceParams = useFulltext ? [parsed.text] : [];

  const [rows] = await db.query(
    `SELECT m.id, m.conversation_id AS conversationId, m.seq, m.body,
            m.sender_id AS senderId, m.created_at AS createdAt, m.kind,
            c.kind AS conversationKind, c.slug, c.name AS conversationName,
            u.full_name AS senderName, u.initials AS senderInitials,
            (SELECT COUNT(*) FROM attachments a
              WHERE a.message_id = m.id AND a.deleted_at IS NULL) AS fileCount,
            ${relevance} AS relevance
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN conversation_members cm ON cm.conversation_id = c.id
       LEFT JOIN users u ON u.id = m.sender_id
      WHERE ${clause}
      ORDER BY relevance DESC, m.created_at DESC
      LIMIT ? OFFSET ?`,
    [...relevanceParams, ...params, lim, off]
  );

  const total = await db.one(
    `SELECT COUNT(*) AS n
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE ${clause}`,
    params
  );

  return {
    results: rows.map(r => ({
      type: "message",
      id: r.id,
      conversationId: r.conversationId,
      conversationKind: r.conversationKind,
      conversationName: r.conversationKind === "channel" ? `#${r.slug}` : (r.conversationName || "Direct message"),
      seq: Number(r.seq),
      senderId: r.senderId,
      senderName: r.senderName || (r.kind === "kody" ? "Kody" : "Someone"),
      senderInitials: r.senderInitials,
      snippet: snippet(r.body, parsed.terms),
      fileCount: Number(r.fileCount),
      createdAt: r.createdAt,
    })),
    total: Number(total.n),
    limit: lim, offset: off,
  };
}

/* ---------------- files ---------------- */

async function searchFiles(userId, q, { limit = 20 } = {}) {
  const parsed = parseQuery(q);
  if (parsed.terms.length === 0 && !parsed.in) return { results: [] };

  const where = [
    "cm.user_id = ?", "cm.left_at IS NULL",
    "a.deleted_at IS NULL", "a.scan_status = 'clean'", "c.deleted_at IS NULL",
  ];
  const params = [userId];

  for (const t of parsed.terms) { where.push("LOWER(a.file_name) LIKE ?"); params.push(`%${t}%`); }
  if (parsed.in) { where.push("(LOWER(c.slug) = ? OR LOWER(c.name) LIKE ?)"); params.push(parsed.in, `%${parsed.in}%`); }

  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const [rows] = await db.query(
    `SELECT a.id, a.file_name AS fileName, a.media_kind AS mediaKind, a.size_bytes AS sizeBytes,
            a.created_at AS createdAt, a.conversation_id AS conversationId,
            c.kind AS conversationKind, c.slug, c.name AS conversationName,
            u.full_name AS uploaderName
       FROM attachments a
       JOIN conversations c ON c.id = a.conversation_id
       JOIN conversation_members cm ON cm.conversation_id = c.id
       LEFT JOIN users u ON u.id = a.uploader_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.created_at DESC LIMIT ?`,
    [...params, lim]
  );
  return {
    results: rows.map(r => ({
      type: "file", id: r.id, fileName: r.fileName, mediaKind: r.mediaKind,
      sizeBytes: Number(r.sizeBytes), uploaderName: r.uploaderName,
      conversationId: r.conversationId,
      conversationName: r.conversationKind === "channel" ? `#${r.slug}` : (r.conversationName || "Direct message"),
      createdAt: r.createdAt,
    })),
  };
}

/* ---------------- people and channels ---------------- */

async function searchPeople(q, { limit = 10 } = {}) {
  const parsed = parseQuery(q);
  if (parsed.terms.length === 0) return { results: [] };
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);

  const where = [];
  const params = [];
  for (const t of parsed.terms) {
    where.push(`(LOWER(u.full_name) LIKE ? OR LOWER(u.job_title) LIKE ? OR LOWER(u.team) LIKE ?
                 OR LOWER(u.email) LIKE ?
                 OR EXISTS (SELECT 1 FROM user_skills us JOIN skills s ON s.id = us.skill_id
                             WHERE us.user_id = u.id AND LOWER(s.name) LIKE ?))`);
    const like = `%${t}%`;
    params.push(like, like, like, like, like);
  }

  const [rows] = await db.query(
    `SELECT u.id, u.full_name AS fullName, u.initials, u.job_title AS jobTitle,
            u.team, u.presence
       FROM users u
      WHERE u.is_active = 1 AND u.deleted_at IS NULL AND ${where.join(" AND ")}
      ORDER BY u.full_name LIMIT ?`,
    [...params, lim]
  );
  return { results: rows.map(r => ({ type: "person", ...r })) };
}

/** Only channels the caller could actually open: public, or ones they are in. */
async function searchChannels(userId, q, { limit = 10 } = {}) {
  const parsed = parseQuery(q);
  if (parsed.terms.length === 0) return { results: [] };
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);

  const where = [
    "c.kind = 'channel'", "c.deleted_at IS NULL",
    `(c.is_private = 0 OR EXISTS (SELECT 1 FROM conversation_members m
        WHERE m.conversation_id = c.id AND m.user_id = ? AND m.left_at IS NULL))`,
  ];
  const params = [userId];
  for (const t of parsed.terms) {
    where.push("(LOWER(c.name) LIKE ? OR LOWER(c.topic) LIKE ?)");
    params.push(`%${t}%`, `%${t}%`);
  }

  const [rows] = await db.query(
    `SELECT c.id, c.slug, c.name, c.topic, c.is_private AS isPrivate, c.is_archived AS isArchived,
            (SELECT COUNT(*) FROM conversation_members m2
              WHERE m2.conversation_id = c.id AND m2.left_at IS NULL) AS memberCount,
            EXISTS (SELECT 1 FROM conversation_members m3
                     WHERE m3.conversation_id = c.id AND m3.user_id = ? AND m3.left_at IS NULL) AS joined
       FROM conversations c
      WHERE ${where.join(" AND ")}
      ORDER BY c.name LIMIT ?`,
    [userId, ...params, lim]
  );
  return {
    results: rows.map(r => ({
      type: "channel", id: r.id, slug: r.slug, name: r.name, topic: r.topic,
      isPrivate: !!r.isPrivate, isArchived: !!r.isArchived,
      memberCount: Number(r.memberCount), joined: !!r.joined,
    })),
  };
}

/* ---------------- my Kody answers ---------------- */

async function searchKodyAnswers(userId, q, { limit = 10 } = {}) {
  const parsed = parseQuery(q);
  if (parsed.terms.length === 0) return { results: [] };
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);

  const where = ["t.user_id = ?", "t.deleted_at IS NULL", "m.role = 'assistant'"];
  const params = [userId];
  for (const t of parsed.terms) { where.push("LOWER(m.body) LIKE ?"); params.push(`%${t}%`); }

  const [rows] = await db.query(
    `SELECT m.id, m.thread_id AS threadId, m.body, m.domain, m.confidence,
            m.lookup_code AS lookupCode, m.created_at AS createdAt
       FROM kody_messages m JOIN kody_threads t ON t.id = m.thread_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.created_at DESC LIMIT ?`,
    [...params, lim]
  );
  return {
    results: rows.map(r => ({
      type: "answer", id: r.id, threadId: r.threadId, domain: r.domain,
      confidence: r.confidence, lookupCode: r.lookupCode,
      snippet: snippet(r.body, parsed.terms), createdAt: r.createdAt,
    })),
  };
}

/* ---------------- everything at once ---------------- */

async function global(userId, q, { limit = 10 } = {}) {
  const parsed = parseQuery(q);
  const [messages, files, people, channels, answers] = await Promise.all([
    searchMessages(userId, q, { limit }),
    searchFiles(userId, q, { limit: 5 }),
    searchPeople(q, { limit: 5 }),
    searchChannels(userId, q, { limit: 5 }),
    searchKodyAnswers(userId, q, { limit: 5 }),
  ]);
  return {
    query: q,
    parsed: {
      terms: parsed.terms, from: parsed.from, in: parsed.in,
      has: parsed.has, is: parsed.is, before: parsed.before, after: parsed.after,
    },
    messages: messages.results,
    messageTotal: messages.total,
    files: files.results,
    people: people.results,
    channels: channels.results,
    answers: answers.results,
  };
}

/**
 * Quick switcher. Conversations and people only, ordered by recency, built to
 * answer in a single round trip while someone is typing.
 */
async function quickSwitch(userId, q, { limit = 8 } = {}) {
  const term = String(q || "").trim().toLowerCase().replace(/^[@#]/, "");
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const like = `%${term}%`;

  const [convos] = await db.query(
    `SELECT c.id, c.kind, c.slug, c.name, c.last_message_at AS lastMessageAt,
            (SELECT u.full_name FROM conversation_members m2 JOIN users u ON u.id = m2.user_id
              WHERE m2.conversation_id = c.id AND m2.user_id <> ? AND m2.left_at IS NULL LIMIT 1) AS peerName
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE cm.user_id = ? AND cm.left_at IS NULL AND c.deleted_at IS NULL AND c.is_archived = 0
      ORDER BY c.last_message_at IS NULL, c.last_message_at DESC
      LIMIT 200`,
    [userId, userId]
  );

  const matched = convos
    .map(c => ({
      type: c.kind === "channel" ? "channel" : c.kind,
      id: c.id, kind: c.kind,
      label: c.kind === "channel" ? `#${c.slug}` : (c.kind === "dm" ? c.peerName || "Direct message" : c.name),
    }))
    .filter(c => !term || c.label.toLowerCase().includes(term))
    .slice(0, lim);

  if (matched.length >= lim || !term) return { results: matched };

  const [people] = await db.query(
    `SELECT id, full_name AS fullName, initials FROM users
      WHERE is_active = 1 AND deleted_at IS NULL AND id <> ?
        AND (LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)
      ORDER BY full_name LIMIT ?`,
    [userId, like, like, lim - matched.length]
  );

  return {
    results: [
      ...matched,
      ...people.map(p => ({ type: "person", id: p.id, label: p.fullName, initials: p.initials })),
    ],
  };
}

/* ---------------- saved searches ---------------- */

async function listSaved(userId) {
  const [rows] = await db.query(
    `SELECT id, label, query, created_at AS createdAt FROM saved_searches
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  return rows;
}

async function saveSearch(userId, query, label) {
  const q = V.str(query, "query", { min: 1, max: 500 });
  const existing = await db.one(
    `SELECT id FROM saved_searches WHERE user_id = ? AND query = ?`, [userId, q]
  );
  if (existing) return db.one(`SELECT id, label, query FROM saved_searches WHERE id = ?`, [existing.id]);

  const count = await db.one(`SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?`, [userId]);
  if (Number(count.n) >= 50) {
    throw new SearchError(400, "too_many_saved", "You can keep up to 50 saved searches.");
  }
  const [res] = await db.query(
    `INSERT INTO saved_searches (user_id, label, query) VALUES (?,?,?)`,
    [userId, label ? String(label).slice(0, 160) : null, q]
  );
  return db.one(`SELECT id, label, query FROM saved_searches WHERE id = ?`, [res.insertId]);
}

async function deleteSaved(userId, id) {
  const [res] = await db.query(
    `DELETE FROM saved_searches WHERE id = ? AND user_id = ?`, [id, userId]
  );
  return { deleted: res.affectedRows > 0 };
}

module.exports = {
  SearchError, parseQuery, snippet, MIN_FULLTEXT_TOKEN,
  searchMessages, searchFiles, searchPeople, searchChannels, searchKodyAnswers,
  global, quickSwitch, listSaved, saveSearch, deleteSaved,
};
