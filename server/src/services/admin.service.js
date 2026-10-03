"use strict";
const db = require("../db");
const V = require("../lib/validate");
const { audit } = require("./auth.service");
const analytics = require("./analytics.service");
const config = require("../config");         // dAI: the routing table reports what is configured
const prompts = require("../ai/prompts");   // dAI: the routing table reports the prompt version

/**
 * The rest of the admin console.
 *
 * Settings are a whitelist with a type and a validator each. `org_settings`
 * stores strings, so without this every value would be whatever someone typed,
 * and a bad number would only surface as odd behaviour weeks later.
 */

class AdminError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bool = (v) => (v === true || v === "true") ? "true"
  : (v === false || v === "false") ? "false" : null;

const intIn = (min, max) => (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? String(n) : null;
};

const oneOf = (allowed) => (v) => (allowed.includes(String(v)) ? String(v) : null);

const text = (max) => (v) => {
  const s = String(v === undefined || v === null ? "" : v).trim();
  return s.length > 0 && s.length <= max ? s : null;
};

/**
 * dAI: the routing table, read only, for the dAdmin Kody AI page.
 *
 * Which model answers at which tier lives in dAI's environment and code, so
 * dAdmin cannot show it without asking. This says what is configured, and
 * nothing about whether it works: no key material, and no "is a key present"
 * flag either. Whether the model gateway is actually reachable is a readiness
 * question, and /health/ready is where that belongs.
 *
 * Tier 0 reports model: null on purpose. It is answered from the code tables
 * with no model call at all, and a page that shows the routing should show
 * that, because it is the rule that codes are looked up and never generated.
 */
function modelRouting() {
  return {
    tiers: [
      {
        tier: 0,
        name: "lookup",
        model: null,
        note: "answered from the code tables, no model call",
      },
      { tier: 1, name: "fast", model: config.ai.modelTier1 },
      { tier: 2, name: "standard", model: config.ai.modelTier2 },
      { tier: 3, name: "deep", model: config.ai.modelTier3 },
    ],
    primaryProvider: config.ai.primaryProvider,
    fallbackProvider: config.ai.fallbackProvider || null,
    webSearch: config.ai.webSearch,
    maxTokens: config.ai.maxTokens,
    maxRetries: config.ai.maxRetries,
    promptVersion: prompts.PROMPT_VERSION,
  };
}

/**
 * Every setting the console may write, with what a valid value looks like.
 *
 * dAI: a setting belongs here only if some code reads it. auth.require_mfa was
 * removed on 2026-10-03 because there is no multi-factor authentication in this
 * product at all: no implementation, no schema, nothing. The setting said
 * otherwise, and a security officer who ticked it would have believed they had
 * MFA. A control that does nothing is worse than no control, and a security
 * control that does nothing is worse again.
 *
 * If MFA is built, this comes back with the code that enforces it, in the same
 * commit, and not before.
 *
 * Six more went the same day, for the same reason: org.name, files.max_mb,
 * auth.access_token_minutes, auth.refresh_token_days, auth.code_ttl_seconds and
 * spaces.default_retention. Nothing read any of them. The four auth and files
 * ones were worse than merely dead, because the same values ARE configurable
 * through the environment and the environment is what applies: two control
 * panels for one thing, one of them wired to nothing.
 *
 * The rule this leaves behind: a key belongs here only when some code reads it.
 * Grep before adding one.
 */
const SETTINGS = {
  "points.per_cent":                    { cast: intIn(1, 1000000),             note: "Points required for one cent" },
  "points.show_cash":                   { cast: bool,                          note: "Show the cash value to associates" },
  "notifications.include_message_text": { cast: bool,                          note: "Let message text leave in emails and push" },
  "reports.allow_content_export":       { cast: bool,                          note: "Allow exports containing message text" },
};

async function listSettings() {
  const [rows] = await db.query(
    `SELECT s.setting_key AS settingKey, s.setting_value AS settingValue,
            s.updated_at AS updatedAt, u.full_name AS updatedBy
       FROM org_settings s LEFT JOIN users u ON u.id = s.updated_by
      ORDER BY s.setting_key`
  );
  const known = new Map(rows.map(r => [r.settingKey, r]));
  return Object.entries(SETTINGS).map(([key, def]) => {
    const row = known.get(key);
    return {
      key, value: row ? row.settingValue : null, note: def.note,
      updatedAt: row ? row.updatedAt : null, updatedBy: row ? row.updatedBy : null,
      editable: true,
    };
  });
}

async function updateSettings(userId, patch, ctx = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new V.ValidationError("Send an object of settings to change.");
  }
  const changed = [];
  const rejected = [];

  for (const [key, raw] of Object.entries(patch)) {
    const def = SETTINGS[key];
    if (!def) { rejected.push({ key, reason: "unknown_setting" }); continue; }
    const value = def.cast(raw);
    if (value === null) { rejected.push({ key, reason: "invalid_value" }); continue; }
    await db.query(
      `INSERT INTO org_settings (setting_key, setting_value, updated_by) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [key, value, userId]
    );
    changed.push({ key, value });
  }

  if (rejected.length > 0 && changed.length === 0) {
    throw new V.ValidationError(
      `Nothing was changed. Rejected: ${rejected.map(r => `${r.key} (${r.reason})`).join(", ")}.`
    );
  }
  if (changed.length > 0) {
    await audit(null, {
      actorId: userId, action: "org.settings_changed", entityType: "org_settings", entityId: null,
      ip: ctx.ip, userAgent: ctx.userAgent, meta: { changed, rejected },
    });
    analytics.clearCache();
  }
  return { changed, rejected };
}

/* ---------------- points rules ---------------- */

async function listPointRules() {
  const [rows] = await db.query(
    `SELECT event_code AS eventCode, label, points, daily_cap AS dailyCap, is_active AS isActive
       FROM point_rules ORDER BY event_code`
  );
  const perCent = await db.one(
    `SELECT setting_value AS v FROM org_settings WHERE setting_key = 'points.per_cent'`
  );
  const showCash = await db.one(
    `SELECT setting_value AS v FROM org_settings WHERE setting_key = 'points.show_cash'`
  );
  return {
    rules: rows.map(r => ({ ...r, points: Number(r.points), dailyCap: Number(r.dailyCap), isActive: !!r.isActive }),),
    pointsPerCent: Number((perCent && perCent.v) || 1000),
    showCash: !!showCash && showCash.v === "true",
  };
}

async function updatePointRule(userId, eventCode, patch, ctx = {}) {
  const existing = await db.one(
    `SELECT event_code AS eventCode FROM point_rules WHERE event_code = ?`, [eventCode]
  );
  if (!existing) throw new AdminError(404, "unknown_event", "No such earning event.");

  const set = {};
  if (patch.points !== undefined) {
    const n = Number(patch.points);
    if (!Number.isInteger(n) || n < 0 || n > 100000) {
      throw new V.ValidationError("points must be a whole number between 0 and 100000.", "points");
    }
    set.points = n;
  }
  if (patch.dailyCap !== undefined) {
    const n = Number(patch.dailyCap);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) {
      throw new V.ValidationError("dailyCap must be a whole number, 0 for no cap.", "dailyCap");
    }
    set.daily_cap = n;
  }
  if (patch.isActive !== undefined) set.is_active = patch.isActive ? 1 : 0;
  if (Object.keys(set).length === 0) throw new V.ValidationError("Nothing to update.");

  const cols = Object.keys(set).map(k => `${k} = ?`).join(", ");
  await db.query(`UPDATE point_rules SET ${cols} WHERE event_code = ?`, [...Object.values(set), eventCode]);
  await audit(null, {
    actorId: userId, action: "points.rule_changed", entityType: "point_rule", entityId: null,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { eventCode, ...set },
  });
  return listPointRules();
}

/* ---------------- spaces, org wide ---------------- */

async function allSpaces({ includeArchived = false, q, limit = 100, offset = 0 } = {}) {
  const where = ["c.deleted_at IS NULL", "c.kind <> 'dm'"];
  const params = [];
  if (!includeArchived) where.push("c.is_archived = 0");
  if (q) { where.push("(c.name LIKE ? OR c.slug LIKE ? OR c.topic LIKE ?)");
           const like = `%${String(q).slice(0, 80)}%`; params.push(like, like, like); }

  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);

  const [rows] = await db.query(
    `SELECT c.id, c.kind, c.slug, c.name, c.topic,
            c.is_private AS isPrivate, c.is_announcement AS isAnnouncement,
            c.is_default AS isDefault, c.is_archived AS isArchived,
            c.retention, c.last_message_at AS lastMessageAt, c.last_seq AS lastSeq,
            (SELECT COUNT(*) FROM conversation_members m
              WHERE m.conversation_id = c.id AND m.left_at IS NULL) AS memberCount,
            (SELECT GROUP_CONCAT(u.full_name SEPARATOR ', ') FROM conversation_members m2
              JOIN users u ON u.id = m2.user_id
             WHERE m2.conversation_id = c.id AND m2.member_role = 'owner' AND m2.left_at IS NULL) AS owners
       FROM conversations c
      WHERE ${where.join(" AND ")}
      ORDER BY c.last_message_at IS NULL, c.last_message_at DESC
      LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  const total = await db.one(
    `SELECT COUNT(*) AS n FROM conversations c WHERE ${where.join(" AND ")}`, params
  );
  return {
    spaces: rows.map(r => ({
      ...r,
      isPrivate: !!r.isPrivate, isAnnouncement: !!r.isAnnouncement,
      isDefault: !!r.isDefault, isArchived: !!r.isArchived,
      memberCount: Number(r.memberCount), lastSeq: Number(r.lastSeq),
    })),
    total: Number(total.n), limit: lim, offset: off,
  };
}

/* ---------------- sessions, org wide ---------------- */

async function allSessions({ limit = 100 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const [rows] = await db.query(
    `SELECT s.id, s.surface, s.issued_at AS issuedAt, s.last_used_at AS lastUsedAt,
            s.expires_at AS expiresAt, s.ip_address AS ip, s.user_agent AS userAgent,
            u.id AS userId, u.full_name AS fullName, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL AND s.expires_at > NOW()
      ORDER BY s.last_used_at DESC LIMIT ?`,
    [lim]
  );
  return rows.map(r => ({
    ...r,
    ip: r.ip ? Array.from(r.ip).join(".") : null,
    userAgent: r.userAgent ? String(r.userAgent).slice(0, 120) : null,
  }));
}

/** An admin can revoke anyone's session. A user can only revoke their own. */
async function revokeSession(userId, sessionId, ctx = {}) {
  const [res] = await db.query(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'revoked_by_admin'
      WHERE id = ? AND revoked_at IS NULL`, [sessionId]
  );
  if (res.affectedRows === 0) throw new AdminError(404, "not_found", "Session not found or already revoked.");
  await audit(null, {
    actorId: userId, action: "auth.session_revoked_by_admin", entityType: "session",
    entityId: sessionId, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { revoked: true };
}

/* ---------------- versions ---------------- */

async function listVersions() {
  const [rows] = await db.query(
    `SELECT v.id, v.surface, v.version, v.released_on AS releasedOn, v.release_note AS releaseNote,
            v.is_current AS isCurrent, v.created_at AS createdAt, u.full_name AS createdBy
       FROM app_versions v LEFT JOIN users u ON u.id = v.created_by
      ORDER BY v.surface, v.created_at DESC`
  );
  return rows.map(r => ({ ...r, isCurrent: !!r.isCurrent }));
}

async function publishVersion(userId, { surface, version, releaseNote, releasedOn, announce = false }, ctx = {}) {
  const s = V.oneOf(surface, "surface", ["server", "web", "extension", "desktop", "android", "ios"]);
  const v = V.str(version, "version", { min: 1, max: 40 });
  const note = releaseNote ? V.str(releaseNote, "releaseNote", { max: 4000, allowNull: true }) : null;
  const on = releasedOn && /^\d{4}-\d{2}-\d{2}$/.test(releasedOn)
    ? releasedOn : new Date().toISOString().slice(0, 10);

  await db.transaction(async (conn) => {
    await conn.query(`UPDATE app_versions SET is_current = 0 WHERE surface = ?`, [s]);
    await conn.query(
      `INSERT INTO app_versions (surface, version, released_on, release_note, is_current, created_by)
       VALUES (?,?,?,?,1,?)`,
      [s, v, on, note, userId]
    );
  });

  if (announce && note) {
    const notifications = require("./notifications.service");
    await notifications.announce(userId, {
      kind: "update", title: `Kody ${v} for ${s}`, body: note.slice(0, 600),
    });
  }
  await audit(null, {
    actorId: userId, action: "version.published", entityType: "app_version", entityId: null,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { surface: s, version: v, announced: !!announce },
  });
  return listVersions();
}

/* ---------------- default quick links ---------------- */

async function listDefaultLinks() {
  const [rows] = await db.query(
    `SELECT id, label, url, position FROM quick_links
      WHERE user_id IS NULL ORDER BY position, id`
  );
  return rows;
}

async function addDefaultLink(userId, { label, url, position }, ctx = {}) {
  const l = V.str(label, "label", { min: 1, max: 160 });
  const u = V.url(url, "url", { allowNull: false });
  const p = V.int(position === undefined ? 0 : position, "position", { min: 0, max: 999 });
  const [res] = await db.query(
    `INSERT INTO quick_links (user_id, label, url, position) VALUES (NULL,?,?,?)`, [l, u, p]
  );
  await audit(null, {
    actorId: userId, action: "quick_link.added", entityType: "quick_link", entityId: res.insertId,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { label: l },
  });
  return listDefaultLinks();
}

async function removeDefaultLink(userId, id, ctx = {}) {
  const [res] = await db.query(
    `DELETE FROM quick_links WHERE id = ? AND user_id IS NULL`, [id]
  );
  if (res.affectedRows === 0) {
    throw new AdminError(404, "not_found", "That is not a default link.");
  }
  await audit(null, {
    actorId: userId, action: "quick_link.removed", entityType: "quick_link", entityId: id,
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return listDefaultLinks();
}

/* ---------------- dismissing an unanswered question ---------------- */

/**
 * dAI: the unanswered panel is an aggregate, so a row has no id. It carries a
 * questionKey instead, and that is what is dismissed here.
 *
 * Nothing stores the question text: the key is a hash, and a question an
 * associate typed can carry claim detail. Dismissing is reversible, and both
 * directions are audited, because "who decided we would not answer this" is a
 * question someone will ask later.
 */
const KEY_SHAPE = /^[0-9a-f]{64}$/;

function questionKey(key) {
  const clean = String(key || "").trim().toLowerCase();
  if (!KEY_SHAPE.test(clean)) {
    throw new V.ValidationError("questionKey must be the 64 character key the panel returned.", "questionKey");
  }
  return clean;
}

async function dismissUnanswered(userId, { key, domain, note } = {}, ctx = {}) {
  const clean = questionKey(key);
  const why = note ? V.str(note, "note", { max: 200, allowNull: true }) : null;
  const scope = domain ? V.str(domain, "domain", { max: 16, allowNull: true }) : null;

  await db.query(
    `INSERT INTO unanswered_dismissals (question_key, domain, note, dismissed_by)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE note = VALUES(note), dismissed_by = VALUES(dismissed_by),
                             dismissed_at = CURRENT_TIMESTAMP`,
    [clean, scope, why, userId]
  );
  await audit(null, {
    actorId: userId, action: "analytics.unanswered_dismissed", entityType: "unanswered",
    entityId: null, ip: ctx.ip, userAgent: ctx.userAgent,
    meta: { questionKey: clean, domain: scope, note: why },
  });
  analytics.clearCache();     // the overview carries this panel
  return { dismissed: true, questionKey: clean };
}

async function restoreUnanswered(userId, key, ctx = {}) {
  const clean = questionKey(key);
  const [res] = await db.query(
    `DELETE FROM unanswered_dismissals WHERE question_key = ?`, [clean]
  );
  if (res.affectedRows === 0) {
    throw new AdminError(404, "not_dismissed", "That question is not dismissed.");
  }
  await audit(null, {
    actorId: userId, action: "analytics.unanswered_restored", entityType: "unanswered",
    entityId: null, ip: ctx.ip, userAgent: ctx.userAgent, meta: { questionKey: clean },
  });
  analytics.clearCache();
  return { restored: true, questionKey: clean };
}

/** What is currently hidden, and who hid it. No question text: there is none stored. */
async function listDismissedUnanswered({ limit = 100 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const [rows] = await db.query(
    `SELECT d.question_key AS questionKey, d.domain, d.note,
            d.dismissed_at AS dismissedAt, u.full_name AS dismissedBy
       FROM unanswered_dismissals d LEFT JOIN users u ON u.id = d.dismissed_by
      ORDER BY d.dismissed_at DESC LIMIT ?`,
    [lim]
  );
  return rows;
}

/* ---------------- audit log ---------------- */

async function auditLog({ action, actorId, from, to, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (action) { where.push("a.action LIKE ?"); params.push(`${String(action).slice(0, 60)}%`); }
  if (actorId) { where.push("a.actor_id = ?"); params.push(Number(actorId)); }
  if (from) { where.push("a.created_at >= ?"); params.push(from + " 00:00:00"); }
  if (to) { where.push("a.created_at <= ?"); params.push(to + " 23:59:59"); }

  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows] = await db.query(
    `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
            a.ip_address AS ip, a.created_at AS createdAt, a.meta,
            u.full_name AS actorName
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ${clause}
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  const total = await db.one(`SELECT COUNT(*) AS n FROM audit_log a ${clause}`, params);
  return {
    entries: rows.map(r => ({
      ...r, ip: r.ip ? Array.from(r.ip).join(".") : null,
      actorName: r.actorName || "system",
    })),
    total: Number(total.n), limit: lim, offset: off,
  };
}

async function auditActions() {
  const [rows] = await db.query(
    `SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC LIMIT 50`
  );
  return rows.map(r => ({ action: r.action, n: Number(r.n) }));
}

module.exports = {
  AdminError, SETTINGS,
  listSettings, updateSettings,
  listPointRules, updatePointRule,
  allSpaces, allSessions, revokeSession,
  listVersions, publishVersion,
  listDefaultLinks, addDefaultLink, removeDefaultLink,
  auditLog, auditActions,
  dismissUnanswered, restoreUnanswered, listDismissedUnanswered,   // dAI
  modelRouting,                                                    // dAI
};
