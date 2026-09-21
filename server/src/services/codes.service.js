"use strict";
const db = require("../db");
const V = require("../lib/validate");

/**
 * Tier 0 and retrieval.
 *
 * Codes are looked up, never generated. A model inventing a plausible CPT code
 * is this product's worst failure mode, so anything that resolves here never
 * reaches a model at all.
 *
 * Every query filters on effective dates. A documented medical RAG failure
 * traced to a missing temporal filter, where superseded guidance was returned
 * alongside current guidance.
 */

/** A token that looks like a code: CO-97, D0140, 99213, M54.50, PR-1. */
const CODE_SHAPE = /^[A-Z]{0,3}[-]?[A-Z0-9]{1,7}(\.[A-Z0-9]{1,4})?$/i;

function looksLikeCode(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const words = t.split(/\s+/);
  // A bare code, or a very short phrase containing one.
  if (words.length > 6) return null;
  for (const w of words) {
    // Strip punctuation from the ends only. An internal period is part of the
    // code: ICD-10 uses M54.50, E11.9. Stripping it would mangle every ICD
    // lookup into a value that can never match.
    const clean = w
      .replace(/^[^\w-]+/, "")
      .replace(/[^\w.-]+$/, "")
      .replace(/\.$/, "");
    if (clean.length >= 3 && /\d/.test(clean) && CODE_SHAPE.test(clean)) return clean.toUpperCase();
  }
  return null;
}

/** Exact lookup, current entries only. */
async function lookupCode(code, { on = null } = {}) {
  const asOf = on ? new Date(on) : new Date();
  const [rows] = await db.query(
    `SELECT ce.id, ce.code, ce.description, ce.guidance,
            ce.effective_from AS effectiveFrom, ce.effective_to AS effectiveTo,
            cs.code AS codeSet, cs.label AS codeSetLabel, cs.licensed
       FROM code_entries ce
       JOIN code_sets cs ON cs.id = ce.code_set_id
      WHERE UPPER(ce.code) = UPPER(?)
        AND (ce.effective_from IS NULL OR ce.effective_from <= ?)
        AND (ce.effective_to   IS NULL OR ce.effective_to   >= ?)
      ORDER BY ce.effective_from DESC
      LIMIT 5`,
    [String(code), asOf, asOf]
  );
  return rows.map(r => ({ ...r, licensed: !!r.licensed }));
}

/** Free-text search across code descriptions, for "which code for X". */
async function searchCodes(q, { codeSet = null, limit = 10 } = {}) {
  const term = V.str(q, "q", { min: 2, max: 120 });
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const params = [`%${term}%`, `%${term}%`, new Date(), new Date()];
  let setFilter = "";
  if (codeSet) { setFilter = "AND cs.code = ?"; params.push(String(codeSet).toUpperCase()); }

  const [rows] = await db.query(
    `SELECT ce.id, ce.code, ce.description, ce.guidance, cs.code AS codeSet
       FROM code_entries ce
       JOIN code_sets cs ON cs.id = ce.code_set_id
      WHERE (ce.description LIKE ? OR ce.code LIKE ?)
        AND (ce.effective_from IS NULL OR ce.effective_from <= ?)
        AND (ce.effective_to   IS NULL OR ce.effective_to   >= ?)
        ${setFilter}
      ORDER BY (UPPER(ce.code) = UPPER(?)) DESC, ce.code
      LIMIT ?`,
    [...params, term, lim]
  );
  return rows;
}

/**
 * Retrieval for tier 2 and 3.
 *
 * MySQL fulltext today. When the corpus grows this is the seam where pgvector
 * or Qdrant goes in; the caller does not change. Only published documents,
 * only currently effective ones.
 */
async function retrieve(question, { domain = null, limit = 4 } = {}) {
  const q = String(question || "").trim();
  if (q.length < 3) return [];
  const lim = Math.min(Math.max(Number(limit) || 4, 1), 10);

  const params = [q];
  let domainFilter = "";
  if (domain && domain !== "general") { domainFilter = "AND kd.domain = ?"; params.push(domain); }

  const [rows] = await db.query(
    `SELECT kd.id, kd.title, kd.body, kd.domain, kd.source_kind AS sourceKind,
            kd.effective_from AS effectiveFrom, kd.effective_to AS effectiveTo,
            MATCH(kd.title, kd.body) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance
       FROM knowledge_docs kd
      WHERE kd.status = 'published'
        AND (kd.effective_from IS NULL OR kd.effective_from <= CURDATE())
        AND (kd.effective_to   IS NULL OR kd.effective_to   >= CURDATE())
        ${domainFilter}
      HAVING relevance > 0
      ORDER BY relevance DESC
      LIMIT ?`,
    [...params, lim]
  );
  return rows.map(r => ({ ...r, relevance: Number(r.relevance) }));
}

/** Format a tier 0 hit into the same answer shape a model would return. */
function answerFromCode(entry) {
  const text = entry.guidance
    ? entry.guidance
    : `${entry.code} is ${entry.description}.`;
  return {
    domain: "rcm",
    text,
    confidence: "high",
    sourceName: `${entry.codeSet} code set`,
    // dAI: mysql2 returns a DATE as a Date object, and String(date) begins "Thu Jan 01",
    // so format it explicitly. A string (another driver, a fixture) still passes through.
    sourceAsOf: entry.effectiveFrom instanceof Date
      ? entry.effectiveFrom.toISOString().slice(0, 10)
      : (entry.effectiveFrom ? String(entry.effectiveFrom).slice(0, 10) : null),
    disclaimer: null,
    links: [],
    citedDocIds: [],
    lookupCode: entry.code,
    lookupSet: entry.codeSet,
    lookupDescription: entry.description,
  };
}

module.exports = { looksLikeCode, lookupCode, searchCodes, retrieve, answerFromCode, CODE_SHAPE };
