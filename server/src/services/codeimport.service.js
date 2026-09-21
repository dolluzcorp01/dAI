"use strict";
const crypto = require("crypto");
const db = require("../db");
const V = require("../lib/validate");
const { audit } = require("./auth.service");

/**
 * Code set import.
 *
 * Tier 0 answers come from these rows, so an import is the highest-leverage
 * and highest-risk operation in the system. Three rules:
 *
 * 1. A licensed set cannot be imported until someone records the licence.
 *    CPT is AMA and CDT is ADA, both royalty bearing. Importing one without a
 *    licence is a contractual problem, not a technical one, so the code
 *    refuses rather than warning.
 *
 * 2. Nothing is destructive. A code whose description changed is superseded,
 *    not overwritten, so an answer given last year still explains why it said
 *    what it said.
 *
 * 3. Dry run first. An import reports exactly what it would do and changes
 *    nothing, because getting this wrong silently corrupts every future
 *    tier 0 answer.
 */

class ImportError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Minimal CSV reader. Handles quoted fields, embedded commas, escaped quotes
 * and CRLF. Deliberately dependency free: this runs against files from CMS and
 * X12 and the format is stable.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const src = String(text).replace(/^\uFEFF/, "");   // strip a BOM if present
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || "").trim() !== "");
}

/** Map header names to our three fields, tolerating the variants CMS uses. */
function columnMap(header) {
  const norm = header.map(h => String(h || "").trim().toLowerCase());
  const find = (...names) => {
    for (const n of names) {
      const i = norm.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const code = find("code", "code value", "cpt", "cdt", "icd10", "icd-10", "carc", "hcpcs");
  const description = find("description", "long description", "descriptor", "text", "long_description");
  const guidance = find("guidance", "notes", "note", "usage", "comment");
  if (code === -1) throw new ImportError(400, "no_code_column", 'The file needs a column named "code".');
  if (description === -1) {
    throw new ImportError(400, "no_description_column", 'The file needs a column named "description".');
  }
  return { code, description, guidance };
}

async function licenceOk(codeSetCode) {
  const row = await db.one(
    `SELECT setting_value AS v FROM org_settings WHERE setting_key = ?`,
    [`codes.licence.${codeSetCode}`]
  );
  return !!row && row.v === "true";
}

/**
 * Import.
 *
 * @param {object} opts
 *  - codeSet     'ICD-10-CM' | 'CARC' | ...
 *  - csv         file contents
 *  - sourceName  file name, recorded for provenance
 *  - effectiveFrom  the date this edition takes effect
 *  - dryRun      report only
 *  - retireMissing  retire current codes absent from the file
 */
async function importCodes(userId, {
  codeSet, csv, sourceName, effectiveFrom, dryRun = true, retireMissing = false,
}) {
  const setCode = V.str(codeSet, "codeSet", { min: 2, max: 24 }).toUpperCase();
  const from = effectiveFrom
    ? String(effectiveFrom).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    throw new V.ValidationError("effectiveFrom must be a date like 2026-01-01.", "effectiveFrom");
  }

  const set = await db.one(
    `SELECT id, code, label, licensed FROM code_sets WHERE code = ?`, [setCode]
  );
  if (!set) throw new ImportError(404, "unknown_code_set", `No code set named ${setCode}.`);

  if (set.licensed && !(await licenceOk(set.code))) {
    throw new ImportError(403, "licence_not_recorded",
      `${set.code} is licensed from ${set.label.includes("Dental") ? "the ADA" : "the AMA"}. ` +
      `Set org_settings 'codes.licence.${set.code}' to true once Dolluz holds the licence.`);
  }

  const rows = parseCsv(csv);
  if (rows.length < 2) throw new ImportError(400, "empty_file", "The file has no data rows.");

  const cols = columnMap(rows[0]);
  const checksum = crypto.createHash("sha256").update(String(csv)).digest("hex");

  const incoming = new Map();
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = String(r[cols.code] || "").trim().toUpperCase();
    const description = String(r[cols.description] || "").trim();
    if (!code || !description) { skipped++; continue; }
    if (code.length > 32 || description.length > 600) { skipped++; continue; }
    const guidance = cols.guidance !== -1 ? String(r[cols.guidance] || "").trim() || null : null;
    if (incoming.has(code)) { skipped++; continue; }   // first wins, duplicates skipped
    incoming.set(code, { code, description, guidance });
  }

  const [currentRows] = await db.query(
    `SELECT id, code, description, guidance, effective_from AS effectiveFrom
       FROM code_entries
      WHERE code_set_id = ? AND (effective_to IS NULL OR effective_to >= ?)`,
    [set.id, from]
  );
  const current = new Map(currentRows.map(r => [r.code.toUpperCase(), r]));

  const toAdd = [];
  const toSupersede = [];
  const toCorrect = [];       // same edition, corrected in place
  let unchanged = 0;

  const sameDay = (d) => d && new Date(d).toISOString().slice(0, 10) === from;

  for (const [code, next] of incoming) {
    const existing = current.get(code);
    if (!existing) { toAdd.push(next); continue; }
    const same = existing.description === next.description &&
                 (existing.guidance || null) === (next.guidance || null);
    if (same) { unchanged++; continue; }

    // Superseding writes a new row with this effective_from, and the unique
    // key is (code_set_id, code, effective_from). If the current row already
    // starts on the same date this is the SAME edition being corrected, not a
    // new one, so it is updated in place. Without this, re-importing an
    // edition on its own effective date fails on a duplicate key.
    if (sameDay(existing.effectiveFrom)) toCorrect.push({ existing, next });
    else toSupersede.push({ existing, next });
  }

  const toRetire = retireMissing
    ? currentRows.filter(r => !incoming.has(r.code.toUpperCase()))
    : [];

  const summary = {
    codeSet: set.code,
    sourceName: sourceName || "unnamed",
    effectiveFrom: from,
    parsed: incoming.size,
    added: toAdd.length,
    updated: toSupersede.length + toCorrect.length,
    superseded: toSupersede.length,
    corrected: toCorrect.length,
    unchanged,
    retired: toRetire.length,
    skipped,
    dryRun: !!dryRun,
    samples: {
      added: toAdd.slice(0, 5).map(r => r.code),
      updated: [...toSupersede, ...toCorrect].slice(0, 5).map(r => r.existing.code),
      retired: toRetire.slice(0, 5).map(r => r.code),
    },
  };

  if (dryRun) return summary;

  const dayBefore = (() => {
    const d = new Date(from + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const importId = await db.transaction(async (conn) => {
    const [imp] = await conn.query(
      `INSERT INTO code_imports
        (code_set_id, source_name, source_sha256, effective_from,
         rows_added, rows_updated, rows_retired, rows_skipped, dry_run, imported_by)
       VALUES (?,?,?,?,?,?,?,?,0,?)`,
      [set.id, summary.sourceName, checksum, from,
       toAdd.length, toSupersede.length + toCorrect.length, toRetire.length, skipped, userId]
    );
    const iid = imp.insertId;

    for (const row of toAdd) {
      await conn.query(
        `INSERT INTO code_entries (code_set_id, code, description, guidance, import_id, effective_from)
         VALUES (?,?,?,?,?,?)`,
        [set.id, row.code, row.description, row.guidance, iid, from]
      );
    }

    // A changed code is superseded, never overwritten.
    for (const { existing, next } of toSupersede) {
      await conn.query(
        `UPDATE code_entries SET effective_to = ? WHERE id = ?`, [dayBefore, existing.id]
      );
      await conn.query(
        `INSERT INTO code_entries (code_set_id, code, description, guidance, import_id, effective_from)
         VALUES (?,?,?,?,?,?)`,
        [set.id, next.code, next.description, next.guidance, iid, from]
      );
    }

    // Same edition, corrected in place. No new row, so no key collision.
    for (const { existing, next } of toCorrect) {
      await conn.query(
        `UPDATE code_entries SET description = ?, guidance = ?, import_id = ? WHERE id = ?`,
        [next.description, next.guidance, iid, existing.id]
      );
    }

    for (const row of toRetire) {
      await conn.query(`UPDATE code_entries SET effective_to = ? WHERE id = ?`, [dayBefore, row.id]);
    }

    await conn.query(
      `UPDATE code_sets SET version_year = ? WHERE id = ?`, [from.slice(0, 4), set.id]
    );
    return iid;
  });

  await audit(null, {
    actorId: userId, action: "codes.imported", entityType: "code_set", entityId: set.id,
    meta: { codeSet: set.code, added: toAdd.length, updated: toSupersede.length,
            retired: toRetire.length, importId, checksum },
  });

  return { ...summary, importId };
}

async function importHistory(codeSet) {
  const params = [];
  let filter = "";
  if (codeSet) {
    filter = "WHERE cs.code = ?";
    params.push(String(codeSet).toUpperCase());
  }
  const [rows] = await db.query(
    `SELECT i.id, cs.code AS codeSet, i.source_name AS sourceName, i.effective_from AS effectiveFrom,
            i.rows_added AS added, i.rows_updated AS updated, i.rows_retired AS retired,
            i.rows_skipped AS skipped, i.created_at AS createdAt, u.full_name AS importedBy
       FROM code_imports i
       JOIN code_sets cs ON cs.id = i.code_set_id
       LEFT JOIN users u ON u.id = i.imported_by
       ${filter}
      ORDER BY i.created_at DESC LIMIT 50`,
    params
  );
  return rows;
}

async function codeSetStatus() {
  const [rows] = await db.query(
    `SELECT cs.code, cs.label, cs.licensed, cs.version_year AS versionYear,
            (SELECT COUNT(*) FROM code_entries ce
              WHERE ce.code_set_id = cs.id
                AND (ce.effective_to IS NULL OR ce.effective_to >= CURDATE())) AS currentEntries,
            (SELECT MAX(created_at) FROM code_imports i WHERE i.code_set_id = cs.id) AS lastImport
       FROM code_sets cs ORDER BY cs.licensed, cs.code`
  );
  const out = [];
  for (const r of rows) {
    out.push({
      ...r,
      licensed: !!r.licensed,
      currentEntries: Number(r.currentEntries),
      licenceRecorded: r.licensed ? await licenceOk(r.code) : true,
    });
  }
  return out;
}

async function setLicence(userId, codeSetCode, held) {
  const set = await db.one(`SELECT code, licensed FROM code_sets WHERE code = ?`,
    [String(codeSetCode).toUpperCase()]);
  if (!set) throw new ImportError(404, "unknown_code_set", "No such code set.");
  if (!set.licensed) throw new ImportError(400, "not_licensed", "That set is not a licensed one.");

  await db.query(
    `INSERT INTO org_settings (setting_key, setting_value, updated_by) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [`codes.licence.${set.code}`, held ? "true" : "false", userId]
  );
  await audit(null, {
    actorId: userId, action: "codes.licence_changed", entityType: "code_set",
    entityId: null, meta: { codeSet: set.code, held: !!held },
  });
  return { codeSet: set.code, licenceRecorded: !!held };
}

module.exports = {
  ImportError, parseCsv, columnMap, importCodes, importHistory,
  codeSetStatus, setLicence, licenceOk,
};
