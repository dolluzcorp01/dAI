"use strict";
const db = require("../db");
const V = require("../lib/validate");
const { audit } = require("./auth.service");

/**
 * Knowledge documents.
 *
 * The rule that shapes everything here: a published document is never edited
 * in place. An answer given in March cited the March wording, and
 * `kody_citations` points at that row. Editing it would silently rewrite what
 * Kody is recorded as having said.
 *
 * So an edit to a published document creates a new row, links it with
 * `supersedes_id`, and sets `effective_to` on the old one. Old citations keep
 * resolving to the text that was actually used.
 */

class KnowledgeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DOMAINS = ["rcm", "agile", "cyber", "dev", "general"];
const SOURCE_KINDS = ["sop", "payer_policy", "regulation", "training", "sme_answer", "other"];
const STATUSES = ["draft", "review", "published", "retired"];

const SELECT_DOC = `
  d.id, d.title, d.domain, d.source_kind AS sourceKind, d.body,
  d.effective_from AS effectiveFrom, d.effective_to AS effectiveTo,
  d.status, d.owner_id AS ownerId, d.approved_by AS approvedBy,
  d.approved_at AS approvedAt, d.supersedes_id AS supersedesId, d.version,
  d.created_at AS createdAt, d.updated_at AS updatedAt
`;

const yesterday = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

async function get(id) {
  const doc = await db.one(
    `SELECT ${SELECT_DOC},
            o.full_name AS ownerName, a.full_name AS approvedByName,
            (SELECT COUNT(*) FROM kody_citations c WHERE c.doc_id = d.id) AS timesCited,
            (SELECT id FROM knowledge_docs n WHERE n.supersedes_id = d.id LIMIT 1) AS supersededById
       FROM knowledge_docs d
       LEFT JOIN users o ON o.id = d.owner_id
       LEFT JOIN users a ON a.id = d.approved_by
      WHERE d.id = ?`,
    [id]
  );
  if (!doc) throw new KnowledgeError(404, "not_found", "Document not found.");
  doc.timesCited = Number(doc.timesCited);
  return doc;
}

async function list({ status, domain, q, sourceKind, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];

  if (status) { where.push("d.status = ?"); params.push(V.oneOf(status, "status", STATUSES)); }
  if (domain) { where.push("d.domain = ?"); params.push(V.oneOf(domain, "domain", DOMAINS)); }
  if (sourceKind) { where.push("d.source_kind = ?"); params.push(V.oneOf(sourceKind, "sourceKind", SOURCE_KINDS)); }
  if (q) {
    where.push("(d.title LIKE ? OR d.body LIKE ?)");
    const like = `%${String(q).slice(0, 120)}%`;
    params.push(like, like);
  }

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows] = await db.query(
    `SELECT ${SELECT_DOC}, o.full_name AS ownerName,
            (SELECT COUNT(*) FROM kody_citations c WHERE c.doc_id = d.id) AS timesCited
       FROM knowledge_docs d LEFT JOIN users o ON o.id = d.owner_id
       ${clause}
      ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  const total = await db.one(
    `SELECT COUNT(*) AS n FROM knowledge_docs d ${clause}`, params
  );
  return {
    docs: rows.map(r => ({ ...r, timesCited: Number(r.timesCited) })),
    total: Number(total.n), limit: lim, offset: off,
  };
}

async function create(userId, body, ctx = {}) {
  const title = V.str(body.title, "title", { min: 3, max: 400 });
  const text = V.str(body.body, "body", { min: 10, max: 200000 });
  const domain = V.oneOf(body.domain, "domain", DOMAINS);
  const sourceKind = V.oneOf(body.sourceKind || "sop", "sourceKind", SOURCE_KINDS);
  const effectiveFrom = body.effectiveFrom ? String(body.effectiveFrom).slice(0, 10) : null;

  const [res] = await db.query(
    `INSERT INTO knowledge_docs (title, domain, source_kind, body, status, owner_id, effective_from)
     VALUES (?,?,?,?, 'draft', ?, ?)`,
    [title, domain, sourceKind, text, userId, effectiveFrom]
  );
  await audit(null, {
    actorId: userId, action: "knowledge.created", entityType: "knowledge_doc",
    entityId: res.insertId, ip: ctx.ip, userAgent: ctx.userAgent, meta: { title, domain },
  });
  return get(res.insertId);
}

/**
 * Update.
 *
 * A draft or a document in review is edited in place, because nothing has
 * cited it. A published document is superseded instead.
 */
async function update(userId, id, body, ctx = {}) {
  const current = await get(id);

  if (current.status === "published") {
    return supersede(userId, id, body, ctx);
  }
  if (current.status === "retired") {
    throw new KnowledgeError(400, "retired", "A retired document cannot be edited. Create a new one.");
  }

  const input = V.pick(body, ["title", "body", "domain", "sourceKind", "effectiveFrom"]);
  const set = {};
  if ("title" in input)      set.title        = V.str(input.title, "title", { min: 3, max: 400 });
  if ("body" in input)       set.body         = V.str(input.body, "body", { min: 10, max: 200000 });
  if ("domain" in input)     set.domain       = V.oneOf(input.domain, "domain", DOMAINS);
  if ("sourceKind" in input) set.source_kind  = V.oneOf(input.sourceKind, "sourceKind", SOURCE_KINDS);
  if ("effectiveFrom" in input) {
    set.effective_from = input.effectiveFrom ? String(input.effectiveFrom).slice(0, 10) : null;
  }
  if (Object.keys(set).length === 0) throw new V.ValidationError("Nothing to update.");

  const cols = Object.keys(set).map(k => `${k} = ?`).join(", ");
  await db.query(`UPDATE knowledge_docs SET ${cols} WHERE id = ?`, [...Object.values(set), id]);
  await audit(null, {
    actorId: userId, action: "knowledge.updated", entityType: "knowledge_doc", entityId: id,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { fields: Object.keys(set) },
  });
  return get(id);
}

/**
 * Supersede a published document with a new version.
 *
 * The old row keeps its text and gains an `effective_to`, so retrieval stops
 * returning it while every citation still resolves.
 */
async function supersede(userId, id, body, ctx = {}) {
  const current = await get(id);
  if (current.status !== "published") {
    throw new KnowledgeError(400, "not_published", "Only a published document is superseded.");
  }
  const already = await db.one(
    `SELECT id FROM knowledge_docs WHERE supersedes_id = ?`, [id]
  );
  if (already) {
    throw new KnowledgeError(409, "already_superseded", "This version has already been replaced.");
  }

  const title = body.title !== undefined
    ? V.str(body.title, "title", { min: 3, max: 400 }) : current.title;
  const text = body.body !== undefined
    ? V.str(body.body, "body", { min: 10, max: 200000 }) : current.body;
  const domain = body.domain !== undefined
    ? V.oneOf(body.domain, "domain", DOMAINS) : current.domain;
  const from = body.effectiveFrom ? String(body.effectiveFrom).slice(0, 10) : new Date().toISOString().slice(0, 10);

  const newId = await db.transaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO knowledge_docs
        (title, domain, source_kind, body, status, owner_id, approved_by, approved_at,
         effective_from, supersedes_id, version)
       VALUES (?,?,?,?, 'published', ?, ?, NOW(), ?, ?, ?)`,
      [title, domain, current.sourceKind, text, userId, userId, from, id, current.version + 1]
    );
    // The old version stops being current the day before the new one starts.
    await conn.query(
      `UPDATE knowledge_docs SET effective_to = ?, status = 'retired' WHERE id = ?`,
      [yesterday(), id]
    );
    return res.insertId;
  });

  await audit(null, {
    actorId: userId, action: "knowledge.superseded", entityType: "knowledge_doc", entityId: id,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { newId, version: current.version + 1 },
  });
  return get(newId);
}

async function setStatus(userId, id, status, ctx = {}) {
  const target = V.oneOf(status, "status", STATUSES);
  const current = await get(id);

  if (current.status === target) return current;
  if (target === "draft" && current.status === "published") {
    throw new KnowledgeError(400, "cannot_unpublish",
      "A published document cannot go back to draft. Retire it or supersede it.");
  }

  const fields = { status: target };
  if (target === "published") {
    fields.approved_by = userId;
    fields.approved_at = new Date();
    if (!current.effectiveFrom) fields.effective_from = new Date().toISOString().slice(0, 10);
  }
  if (target === "retired" && !current.effectiveTo) {
    fields.effective_to = new Date().toISOString().slice(0, 10);
  }

  const cols = Object.keys(fields).map(k => `${k} = ?`).join(", ");
  await db.query(`UPDATE knowledge_docs SET ${cols} WHERE id = ?`, [...Object.values(fields), id]);
  await audit(null, {
    actorId: userId, action: `knowledge.${target}`, entityType: "knowledge_doc", entityId: id,
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return get(id);
}

/** The full version chain, oldest first. */
async function versions(id) {
  const chain = [];
  const seen = new Set();

  // walk back to the original
  let cursor = await db.one(`SELECT id, supersedes_id AS supersedesId FROM knowledge_docs WHERE id = ?`, [id]);
  if (!cursor) throw new KnowledgeError(404, "not_found", "Document not found.");
  let rootId = cursor.id;
  while (cursor && cursor.supersedesId && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    rootId = cursor.supersedesId;
    cursor = await db.one(
      `SELECT id, supersedes_id AS supersedesId FROM knowledge_docs WHERE id = ?`, [cursor.supersedesId]
    );
  }

  // then forward to the newest
  let node = rootId;
  const walked = new Set();
  while (node && !walked.has(node)) {
    walked.add(node);
    chain.push(await get(node));
    const next = await db.one(`SELECT id FROM knowledge_docs WHERE supersedes_id = ?`, [node]);
    node = next ? next.id : null;
  }
  return { versions: chain };
}

/** Documents that have never been cited, so you can see what nobody uses. */
async function unusedDocs({ limit = 50 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [rows] = await db.query(
    `SELECT ${SELECT_DOC}
       FROM knowledge_docs d
      WHERE d.status = 'published'
        AND NOT EXISTS (SELECT 1 FROM kody_citations c WHERE c.doc_id = d.id)
      ORDER BY d.created_at LIMIT ?`,
    [lim]
  );
  return { docs: rows };
}

/** What the corpus looks like. Feeds the admin dashboard in module 12. */
async function stats() {
  const [byStatus] = await db.query(
    `SELECT status, COUNT(*) AS n FROM knowledge_docs GROUP BY status`
  );
  const [byDomain] = await db.query(
    `SELECT domain, COUNT(*) AS n FROM knowledge_docs WHERE status = 'published' GROUP BY domain`
  );
  const [bySource] = await db.query(
    `SELECT source_kind AS sourceKind, COUNT(*) AS n FROM knowledge_docs
      WHERE status = 'published' GROUP BY source_kind`
  );
  const cited = await db.one(
    `SELECT COUNT(DISTINCT doc_id) AS n FROM kody_citations`
  );
  const published = await db.one(
    `SELECT COUNT(*) AS n FROM knowledge_docs WHERE status = 'published'`
  );
  const codes = await db.one(
    `SELECT COUNT(*) AS n FROM code_entries
      WHERE (effective_to IS NULL OR effective_to >= CURDATE())`
  );
  return {
    byStatus, byDomain, bySource,
    publishedDocs: Number(published.n),
    citedDocs: Number(cited.n),
    currentCodeEntries: Number(codes.n),
  };
}

module.exports = {
  KnowledgeError, DOMAINS, SOURCE_KINDS, STATUSES,
  get, list, create, update, supersede, setStatus, versions, unusedDocs, stats,
};
