"use strict";
const db = require("../db");
const config = require("../config");
const V = require("../lib/validate");
const gateway = require("../ai/gateway");
const prompts = require("../ai/prompts");
const codes = require("./codes.service");
const msgs = require("./messages.service");
const bus = require("../realtime/bus");
const notify = require("./notifications.service");   // dAI: the SME loop (docs/PHASES.md 1.3)
const { audit } = require("./auth.service");

class KodyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ---------------- threads ---------------- */

async function createThread(userId, title) {
  const [res] = await db.query(
    `INSERT INTO kody_threads (user_id, title) VALUES (?,?)`,
    [userId, title ? String(title).slice(0, 300) : null]
  );
  return res.insertId;
}

async function requireThread(threadId, userId) {
  const t = await db.one(
    `SELECT id, user_id AS userId, title FROM kody_threads
      WHERE id = ? AND deleted_at IS NULL`, [threadId]
  );
  if (!t) throw new KodyError(404, "not_found", "Conversation not found.");
  if (Number(t.userId) !== Number(userId)) {
    throw new KodyError(404, "not_found", "Conversation not found.");
  }
  return t;
}

async function listThreads(userId, { limit = 30, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  const [rows] = await db.query(
    `SELECT t.id, t.title, t.created_at AS createdAt, t.updated_at AS updatedAt,
            (SELECT body FROM kody_messages m WHERE m.thread_id = t.id AND m.role = 'user'
              ORDER BY m.id LIMIT 1) AS firstQuestion,
            (SELECT domain FROM kody_messages m WHERE m.thread_id = t.id AND m.role = 'assistant'
              ORDER BY m.id DESC LIMIT 1) AS lastDomain
       FROM kody_threads t
      WHERE t.user_id = ? AND t.deleted_at IS NULL
      ORDER BY t.updated_at DESC LIMIT ? OFFSET ?`,
    [userId, lim, off]
  );
  return rows;
}

async function hydrateMessages(ids) {
  if (ids.length === 0) return [];
  const [rows] = await db.query(
    `SELECT id, thread_id AS threadId, role, body, domain, confidence, tier,
            used_web_search AS usedWebSearch, used_retrieval AS usedRetrieval,
            model_name AS modelName, prompt_version AS promptVersion,
            latency_ms AS latencyMs, input_tokens AS inputTokens, output_tokens AS outputTokens,
            source_name AS sourceName, source_as_of AS sourceAsOf, disclaimer,
            lookup_code AS lookupCode, lookup_set AS lookupSet,
            lookup_description AS lookupDescription,
            conversation_id AS conversationId, created_at AS createdAt
       FROM kody_messages WHERE id IN (?) ORDER BY id`,
    [ids]
  );
  const [links] = await db.query(
    `SELECT kody_message_id AS messageId, title, url FROM kody_answer_links
      WHERE kody_message_id IN (?) ORDER BY position, id`, [ids]
  );
  const [cites] = await db.query(
    `SELECT c.kody_message_id AS messageId, c.doc_id AS docId, d.title
       FROM kody_citations c JOIN knowledge_docs d ON d.id = c.doc_id
      WHERE c.kody_message_id IN (?)`, [ids]
  );
  const [votes] = await db.query(
    `SELECT kody_message_id AS messageId, user_id AS userId, vote
       FROM kody_feedback WHERE kody_message_id IN (?)`, [ids]
  );

  const byId = new Map(rows.map(r => [r.id, {
    ...r,
    usedWebSearch: !!r.usedWebSearch,
    usedRetrieval: !!r.usedRetrieval,
    links: [], citations: [], myVote: null,
  }]));
  links.forEach(l => { const m = byId.get(l.messageId); if (m) m.links.push({ title: l.title, url: l.url }); });
  cites.forEach(c => { const m = byId.get(c.messageId); if (m) m.citations.push({ docId: c.docId, title: c.title }); });
  votes.forEach(v => { const m = byId.get(v.messageId); if (m) m.votes = [...(m.votes || []), v]; });
  return [...byId.values()];
}

async function getThread(threadId, userId) {
  const thread = await requireThread(threadId, userId);
  const [rows] = await db.query(
    `SELECT id FROM kody_messages WHERE thread_id = ? ORDER BY id`, [threadId]
  );
  const messages = await hydrateMessages(rows.map(r => r.id));
  messages.forEach(m => {
    const mine = (m.votes || []).find(v => Number(v.userId) === Number(userId));
    m.myVote = mine ? mine.vote : null;
    delete m.votes;
  });
  return { thread, messages };
}

/* ---------------- the ask pipeline ---------------- */

/**
 * Ask Kody.
 *
 * Order:
 *   1. Tier 0. An exact code match answers from the database with no model.
 *   2. Retrieval. Published, currently effective documents for the domain.
 *   3. Model, through the gateway, with retry and provider failover.
 *   4. Parse defensively. A malformed reply degrades visibly.
 *   5. Persist everything needed to reproduce the answer later.
 */
async function ask(userId, { question, threadId, conversationId }) {
  const text = V.str(question, "question", { min: 1, max: 4000 });
  const started = Date.now();

  let tid = threadId ? (await requireThread(threadId, userId)).id : null;
  if (!tid) tid = await createThread(userId, text.slice(0, 120));

  // history for continuity, oldest first, capped so the prompt stays bounded
  const [histRows] = await db.query(
    `SELECT role, body FROM kody_messages
      WHERE thread_id = ? AND body IS NOT NULL
      ORDER BY id DESC LIMIT 20`, [tid]
  );
  const history = histRows.reverse().map(r => ({
    role: r.role === "assistant" ? "assistant" : "user",
    content: r.body,
  }));

  await db.query(
    `INSERT INTO kody_messages (thread_id, user_id, role, body, conversation_id)
     VALUES (?,?, 'user', ?, ?)`,
    [tid, userId, text, conversationId || null]
  );

  /* ---- tier 0 ---- */
  const maybeCode = codes.looksLikeCode(text);
  if (maybeCode) {
    const hits = await codes.lookupCode(maybeCode);
    if (hits.length > 0) {
      const answer = codes.answerFromCode(hits[0]);
      const saved = await persistAnswer({
        threadId: tid, userId, answer, tier: 0,
        modelName: null, latencyMs: Date.now() - started,
        usedWebSearch: false, usedRetrieval: false, conversationId,
      });
      return { threadId: tid, message: saved };
    }
  }

  /* ---- retrieval ---- */
  const tier = gateway.chooseTier(text);
  let documents = [];
  if (tier >= 2) {
    documents = await codes.retrieve(text, { limit: 4 });
  }

  const system = prompts.buildSystemPrompt({ documents });

  /* ---- model ---- */
  let completion;
  try {
    completion = await gateway.complete({
      tier, system,
      messages: [...history, { role: "user", content: text }],
      maxTokens: config.ai.maxTokens,
      webSearch: config.ai.webSearch,
    });
  } catch (err) {
    const saved = await persistAnswer({
      threadId: tid, userId, tier, modelName: null,
      latencyMs: Date.now() - started, usedWebSearch: false,
      usedRetrieval: documents.length > 0, conversationId,
      answer: {
        domain: "general",
        text: "Kody could not reach the answer service just now, so this is not a real answer. Try again in a moment.",
        confidence: "low",
        sourceName: "Service unavailable",
        sourceAsOf: null,
        disclaimer: "Degraded response. No model answered this question.",
        links: [], citedDocIds: [],
      },
      degraded: true,
    });
    return { threadId: tid, message: saved, degraded: true, error: err.code };
  }

  /* ---- parse ---- */
  const parsed = prompts.parseAnswer(completion.text);
  if (!parsed.ok) {
    const saved = await persistAnswer({
      threadId: tid, userId, tier,
      modelName: completion.model, latencyMs: completion.latencyMs,
      usedWebSearch: completion.usedWebSearch, usedRetrieval: documents.length > 0,
      inputTokens: completion.inputTokens, outputTokens: completion.outputTokens,
      conversationId,
      answer: {
        domain: "general",
        text: "Kody received a reply it could not read. This has been logged rather than guessed at.",
        confidence: "low",
        sourceName: "Malformed response",
        sourceAsOf: null,
        disclaimer: "Degraded response. Ask again, or rephrase the question.",
        links: [], citedDocIds: [],
      },
      degraded: true,
    });
    await audit(null, {
      actorId: userId, action: "kody.malformed_response", entityType: "kody_message",
      entityId: saved.id, meta: { reason: parsed.reason, model: completion.model },
    });
    return { threadId: tid, message: saved, degraded: true, error: parsed.reason };
  }

  const saved = await persistAnswer({
    threadId: tid, userId, tier,
    modelName: completion.model, latencyMs: completion.latencyMs,
    usedWebSearch: completion.usedWebSearch, usedRetrieval: documents.length > 0,
    inputTokens: completion.inputTokens, outputTokens: completion.outputTokens,
    answer: parsed.answer, conversationId,
    availableDocIds: documents.map(d => d.id),
  });

  return { threadId: tid, message: saved, degraded: !!completion.degraded };
}

async function persistAnswer({
  threadId, userId, answer, tier, modelName, latencyMs,
  usedWebSearch, usedRetrieval, inputTokens, outputTokens,
  conversationId, availableDocIds = [], degraded = false,
}) {
  const id = await db.transaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO kody_messages
        (thread_id, user_id, role, body, domain, confidence, tier,
         used_web_search, used_retrieval, model_name, prompt_version,
         latency_ms, input_tokens, output_tokens,
         source_name, source_as_of, disclaimer, lookup_code, lookup_set, lookup_description, conversation_id)
       VALUES (?,?, 'assistant', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [threadId, userId, answer.text, answer.domain, answer.confidence, tier,
       usedWebSearch ? 1 : 0, usedRetrieval ? 1 : 0, modelName, prompts.PROMPT_VERSION,
       latencyMs, inputTokens || null, outputTokens || null,
       answer.sourceName, answer.sourceAsOf, answer.disclaimer,
       answer.lookupCode || null, answer.lookupSet || null,
       answer.lookupDescription ? String(answer.lookupDescription).slice(0, 600) : null,   // dAI: migration 007
       conversationId || null]
    );
    const mid = res.insertId;

    for (let i = 0; i < (answer.links || []).length; i++) {
      const l = answer.links[i];
      await conn.query(
        `INSERT INTO kody_answer_links (kody_message_id, title, url, position) VALUES (?,?,?,?)`,
        [mid, l.title, l.url, i]
      );
    }
    // Only cite documents that were actually supplied, so a model cannot
    // invent a citation to a document it never saw.
    const allowed = new Set(availableDocIds.map(Number));
    for (const docId of (answer.citedDocIds || [])) {
      if (!allowed.has(Number(docId))) continue;
      await conn.query(
        `INSERT IGNORE INTO kody_citations (kody_message_id, doc_id) VALUES (?,?)`, [mid, docId]
      );
    }
    await conn.query(`UPDATE kody_threads SET updated_at = NOW() WHERE id = ?`, [threadId]);
    return mid;
  });

  const [message] = await hydrateMessages([id]);
  message.degraded = degraded;
  if (answer.lookupDescription) message.lookupDescription = answer.lookupDescription;
  return message;
}

/**
 * @kody inside a chat conversation. The answer is posted into the room as a
 * message of kind 'kody', so everyone present sees it.
 */
async function askInConversation(userId, conversationId, question) {
  const mem = await msgs.membership(conversationId, userId);
  if (!mem) throw new KodyError(403, "not_a_member", "You are not in this conversation.");

  const out = await ask(userId, { question, conversationId });

  const posted = await db.transaction(async (conn) => {
    const [[row]] = await conn.query(
      `SELECT last_seq FROM conversations WHERE id = ? FOR UPDATE`, [conversationId]
    );
    const seq = Number(row.last_seq) + 1;
    await conn.query(
      `UPDATE conversations SET last_seq = ?, last_message_at = NOW() WHERE id = ?`,
      [seq, conversationId]
    );
    const [res] = await conn.query(
      `INSERT INTO messages (conversation_id, seq, sender_id, kind, body)
       VALUES (?,?,NULL,'kody',?)`,
      [conversationId, seq, out.message.body]
    );
    return res.insertId;
  });

  const [chatMessage] = await msgs.hydrate([posted]);
  chatMessage.kody = {
    domain: out.message.domain,
    confidence: out.message.confidence,
    tier: out.message.tier,
    sourceName: out.message.sourceName,
    sourceAsOf: out.message.sourceAsOf,
    disclaimer: out.message.disclaimer,
    links: out.message.links,
    citations: out.message.citations,
    kodyMessageId: out.message.id,
  };
  bus.toConversation(conversationId, "message:new", { message: chatMessage });
  return { chatMessage, kodyMessage: out.message, degraded: out.degraded };
}

/* ---------------- feedback, points and the SME queue ---------------- */

/**
 * dAI: the SME loop notifications (docs/PHASES.md 1.3).
 *
 * The walkthrough found the gap: a thumbs down opened an sme_queue row that
 * nobody was told about, and resolving it told the person who reported it
 * nothing either. Both ends now ring a bell.
 *
 * No answer text and no question text goes into a notification. A question an
 * associate typed can carry claim detail just as an answer can, and a
 * notification is read on a lock screen and can leave in an email digest
 * (module rule 17, docs/11-notifications.md). The notification says what
 * happened and points at the queue item; the text is read inside Kody.
 */

/** Must match the roles that can reach GET /api/kody/sme. */
const SME_ROLES = ["admin", "super_admin", "coordinator", "sub_admin"];

async function smeReviewers(exceptUserId) {
  const [rows] = await db.query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.code IN (?) AND u.is_active = 1 AND u.deleted_at IS NULL
        AND (? IS NULL OR u.id <> ?)`,
    [SME_ROLES, exceptUserId || null, exceptUserId || 0]
  );
  return rows.map(r => r.id);
}

/** Best effort: a notification failure must never fail the vote or the resolution. */
async function notifySmeRaised({ smeQueueId, raisedBy, domain }) {
  try {
    const reviewers = await smeReviewers(raisedBy);
    for (const userId of reviewers) {
      await notify.create(userId, {
        kind: "sme",
        title: "SME review",
        body: `A Kody answer${domain ? " about " + domain : ""} was marked not helpful and is waiting in the SME queue.`,
        refType: "sme_queue", refId: smeQueueId,
        actorId: raisedBy || null,
        channels: { inApp: true },
      });
    }
    return reviewers.length;
  } catch (err) {
    console.error("SME raised notification failed:", err.message);
    return 0;
  }
}

async function notifySmeResolved({ smeQueueId, raisedBy, resolvedBy, docId, published }) {
  if (!raisedBy || Number(raisedBy) === Number(resolvedBy)) return 0;
  try {
    await notify.create(raisedBy, {
      kind: "sme",
      title: "Your report was answered",
      body: published
        ? "An expert corrected the answer you reported, and it is now part of what Kody knows."
        : "An expert answered the report you raised. The correction is waiting to be published.",
      refType: published && docId ? "knowledge_doc" : "sme_queue",
      refId: published && docId ? docId : smeQueueId,
      actorId: resolvedBy || null,
      channels: { inApp: true },
    });
    return 1;
  } catch (err) {
    console.error("SME resolved notification failed:", err.message);
    return 0;
  }
}

/**
 * A thumbs up credits points, once, capped daily. A thumbs down opens an SME
 * review. The idempotency key is what stops a one-click button becoming a
 * money button.
 */
async function feedback(userId, kodyMessageId, vote, comment) {
  const v = V.oneOf(vote, "vote", ["up", "down"]);
  const message = await db.one(
    `SELECT m.id, m.thread_id AS threadId, m.role, t.user_id AS ownerId
       FROM kody_messages m JOIN kody_threads t ON t.id = m.thread_id
      WHERE m.id = ?`, [kodyMessageId]
  );
  if (!message) throw new KodyError(404, "not_found", "Answer not found.");
  if (message.role !== "assistant") throw new KodyError(400, "not_an_answer", "You can only rate an answer.");

  await db.query(
    `INSERT INTO kody_feedback (kody_message_id, user_id, vote, comment)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE vote = VALUES(vote), comment = VALUES(comment)`,
    [kodyMessageId, userId, v, comment ? String(comment).slice(0, 1000) : null]
  );

  let points = null;
  let smeId = null;

  if (v === "up") {
    points = await creditPoints(userId, "helpful", "kody_message", kodyMessageId);
  } else {
    const existing = await db.one(
      `SELECT id FROM sme_queue WHERE kody_message_id = ? AND status IN ('open','in_review')`,
      [kodyMessageId]
    );
    if (existing) smeId = existing.id;
    else {
      const [res] = await db.query(
        `INSERT INTO sme_queue (kody_message_id, raised_by, status) VALUES (?,?, 'open')`,
        [kodyMessageId, userId]
      );
      smeId = res.insertId;
      // dAI: tell the people who work the queue. Only for a new item, so a
      // second thumbs down on the same answer does not ring the bell twice.
      const answer = await db.one(`SELECT domain FROM kody_messages WHERE id = ?`, [kodyMessageId]);
      await notifySmeRaised({
        smeQueueId: smeId, raisedBy: userId, domain: answer ? answer.domain : null,
      });
    }
  }

  return { vote: v, points, smeQueueId: smeId };
}

/** Append-only ledger with a daily cap. Balance is always a SUM. */
async function creditPoints(userId, eventCode, refType, refId) {
  const rule = await db.one(
    `SELECT event_code AS eventCode, label, points, daily_cap AS dailyCap, is_active AS isActive
       FROM point_rules WHERE event_code = ?`, [eventCode]
  );
  if (!rule || !rule.isActive) return { credited: 0, reason: "rule_inactive" };

  const key = `${eventCode}:${refType}:${refId}:${userId}`;
  const already = await db.one(`SELECT id FROM point_events WHERE idempotency_key = ?`, [key]);
  if (already) return { credited: 0, reason: "already_credited" };

  if (rule.dailyCap > 0) {
    const today = await db.one(
      `SELECT COALESCE(SUM(points),0) AS n FROM point_events
        WHERE user_id = ? AND event_code = ? AND created_at >= CURDATE()`,
      [userId, eventCode]
    );
    if (Number(today.n) + rule.points > rule.dailyCap) {
      return { credited: 0, reason: "daily_cap_reached", cap: rule.dailyCap };
    }
  }

  try {
    await db.query(
      `INSERT INTO point_events (user_id, event_code, points, ref_type, ref_id, idempotency_key)
       VALUES (?,?,?,?,?,?)`,
      [userId, eventCode, rule.points, refType, refId, key]
    );
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") return { credited: 0, reason: "already_credited" };
    throw err;
  }
  return { credited: rule.points, reason: null };
}

async function pointsBalance(userId) {
  const row = await db.one(
    `SELECT COALESCE(SUM(points),0) AS balance FROM point_events WHERE user_id = ?`, [userId]
  );
  const today = await db.one(
    `SELECT COALESCE(SUM(points),0) AS earned FROM point_events
      WHERE user_id = ? AND created_at >= CURDATE()`, [userId]
  );
  const perCent = await db.one(
    `SELECT setting_value AS v FROM org_settings WHERE setting_key = 'points.per_cent'`
  );
  const showCash = await db.one(
    `SELECT setting_value AS v FROM org_settings WHERE setting_key = 'points.show_cash'`
  );
  const [ledger] = await db.query(
    `SELECT id, event_code AS eventCode, points, created_at AS createdAt
       FROM point_events WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [userId]
  );
  const pc = Number((perCent && perCent.v) || 1000);
  return {
    balance: Number(row.balance),
    earnedToday: Number(today.earned),
    pointsPerCent: pc,
    cents: Number(row.balance) / pc,
    showCash: showCash ? showCash.v === "true" : false,
    ledger,
  };
}

/* ---------------- SME queue ---------------- */

async function smeQueue({ status = "open", limit = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [rows] = await db.query(
    `SELECT q.id, q.status, q.created_at AS createdAt, q.assigned_to AS assignedTo,
            m.id AS kodyMessageId, m.body AS answerBody, m.domain, m.confidence,
            m.model_name AS modelName, m.prompt_version AS promptVersion, m.tier,
            (SELECT body FROM kody_messages q2
              WHERE q2.thread_id = m.thread_id AND q2.role = 'user' AND q2.id < m.id
              ORDER BY q2.id DESC LIMIT 1) AS question,
            u.full_name AS raisedByName
       FROM sme_queue q
       JOIN kody_messages m ON m.id = q.kody_message_id
       LEFT JOIN users u ON u.id = q.raised_by
      WHERE q.status = ?
      ORDER BY q.created_at LIMIT ?`,
    [status, lim]
  );
  return rows;
}

/**
 * Resolving an SME item turns a wrong answer into a knowledge document, which
 * is how the corpus grows from nothing. The person who raised it is credited.
 */
async function resolveSme(smeUserId, smeQueueId, { resolution, title, domain, publish = true }) {
  const item = await db.one(
    `SELECT q.id, q.status, q.raised_by AS raisedBy, m.domain
       FROM sme_queue q JOIN kody_messages m ON m.id = q.kody_message_id
      WHERE q.id = ?`, [smeQueueId]
  );
  if (!item) throw new KodyError(404, "not_found", "Queue item not found.");
  if (item.status === "resolved") throw new KodyError(400, "already_resolved", "Already resolved.");

  const body = V.str(resolution, "resolution", { min: 10, max: 20000 });
  const docTitle = V.str(title, "title", { min: 3, max: 400 });
  const docDomain = V.oneOf(domain || item.domain || "rcm", "domain", prompts.DOMAINS);

  const docId = await db.transaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO knowledge_docs (title, domain, source_kind, body, status, owner_id, approved_by, approved_at, effective_from)
       VALUES (?,?, 'sme_answer', ?, ?, ?, ?, NOW(), CURDATE())`,
      [docTitle, docDomain, body, publish ? "published" : "review", smeUserId, smeUserId]
    );
    const did = res.insertId;
    await conn.query(
      `UPDATE sme_queue SET status = 'resolved', assigned_to = ?, resolution = ?,
              resolved_doc_id = ?, resolved_at = NOW() WHERE id = ?`,
      [smeUserId, body, did, smeQueueId]
    );
    return did;
  });

  if (item.raisedBy) {
    await creditPoints(item.raisedBy, "sme_accepted", "sme_queue", smeQueueId);
    // dAI: tell the person who reported it that it was answered.
    await notifySmeResolved({
      smeQueueId, raisedBy: item.raisedBy, resolvedBy: smeUserId, docId, published: publish,
    });
  }
  await audit(null, {
    actorId: smeUserId, action: "kody.sme_resolved", entityType: "sme_queue", entityId: smeQueueId,
    meta: { docId, published: publish },
  });
  return { resolved: true, docId };
}

module.exports = {
  KodyError, ask, askInConversation, getThread, listThreads, createThread,
  feedback, creditPoints, pointsBalance, smeQueue, resolveSme, hydrateMessages,
  SME_ROLES, smeReviewers,   // dAI: docs/PHASES.md 1.3
};
