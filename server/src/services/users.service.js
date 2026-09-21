"use strict";
const db = require("../db");
const V = require("../lib/validate");
const { audit } = require("./auth.service");

const PRESENCES = ["online", "away", "busy", "dnd", "offline"];

/* Fields a user may change about themselves. Anything not here, such as
   is_active or email, is deliberately unreachable from the profile route. */
const PROFILE_FIELDS = [
  "fullName", "jobTitle", "team", "timezone", "initials", "avatarUrl",
  "workStart", "workEnd", "ooo", "oooMessage",
  "dndSchedule", "dndStart", "dndEnd",
];

const SETTINGS_FIELDS = [
  "accent", "wallpaper", "kodyAvatar", "kodyAvatarUrl",
  "predictive", "fontScale", "locale",
];

const ACCENTS = ["gold", "teal", "indigo", "plum"];
const WALLPAPERS = ["none", "paper", "dusk", "mint", "slate", "sand"];
const AVATARS = ["mark", "m1", "m2", "f1", "f2", "photo"];

const SELECT_USER = `
  u.id, u.email, u.full_name AS fullName, u.initials, u.job_title AS jobTitle,
  u.team, u.timezone, u.avatar_url AS avatarUrl, u.presence,
  u.status_emoji AS statusEmoji, u.status_text AS statusText,
  u.status_expires_at AS statusExpiresAt,
  u.work_start AS workStart, u.work_end AS workEnd,
  u.ooo, u.ooo_message AS oooMessage,
  u.dnd_schedule AS dndSchedule, u.dnd_start AS dndStart, u.dnd_end AS dndEnd,
  u.last_seen_at AS lastSeenAt, u.is_active AS isActive, u.created_at AS createdAt
`;

/**
 * A custom status with a past expiry is treated as absent. Doing this on read
 * means a status always looks correct even if the sweeper has not run.
 */
function applyStatusExpiry(user) {
  if (!user) return user;
  if (user.statusExpiresAt && new Date(user.statusExpiresAt) < new Date()) {
    user.statusEmoji = null;
    user.statusText = null;
    user.statusExpiresAt = null;
  }
  return user;
}

function localTimeFor(tz) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date());
  } catch (_) {
    return null;
  }
}

/** Are they inside their stated working hours, in their own timezone. */
function withinWorkingHours(user) {
  if (!user.workStart || !user.workEnd) return null;
  const now = localTimeFor(user.timezone);
  if (!now) return null;
  const toMin = (t) => {
    const [h, m] = String(t).split(":");
    return Number(h) * 60 + Number(m);
  };
  const cur = toMin(now), s = toMin(user.workStart), e = toMin(user.workEnd);
  return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e; // handles an overnight shift
}

function decorate(user) {
  if (!user) return null;
  applyStatusExpiry(user);
  user.localTime = localTimeFor(user.timezone);
  user.withinWorkingHours = withinWorkingHours(user);
  user.ooo = !!user.ooo;
  user.dndSchedule = !!user.dndSchedule;
  user.isActive = user.isActive === undefined ? undefined : !!user.isActive;
  return user;
}

async function skillsFor(userIds) {
  if (userIds.length === 0) return new Map();
  const [rows] = await db.query(
    `SELECT us.user_id AS userId, s.name FROM user_skills us
       JOIN skills s ON s.id = us.skill_id
      WHERE us.user_id IN (?) ORDER BY s.name`,
    [userIds]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.userId)) map.set(r.userId, []);
    map.get(r.userId).push(r.name);
  }
  return map;
}

async function getUser(id, { withSkills = true } = {}) {
  const user = await db.one(
    `SELECT ${SELECT_USER} FROM users u WHERE u.id = ? AND u.deleted_at IS NULL`, [id]
  );
  if (!user) return null;
  decorate(user);
  if (withSkills) {
    const map = await skillsFor([user.id]);
    user.skills = map.get(user.id) || [];
  }
  return user;
}

async function updateProfile(userId, body, ctx = {}) {
  const input = V.pick(body, PROFILE_FIELDS);
  const set = {};

  if ("fullName" in input)     set.full_name   = V.str(input.fullName, "fullName", { min: 1, max: 160 });
  if ("initials" in input)     set.initials    = V.str(input.initials, "initials", { max: 4 }).toUpperCase();
  if ("jobTitle" in input)     set.job_title   = V.str(input.jobTitle, "jobTitle", { max: 160, allowNull: true });
  if ("team" in input)         set.team        = V.str(input.team, "team", { max: 80, allowNull: true });
  if ("timezone" in input)     set.timezone    = V.timezone(input.timezone, "timezone");
  if ("avatarUrl" in input)    set.avatar_url  = V.url(input.avatarUrl, "avatarUrl");
  if ("workStart" in input)    set.work_start  = V.time(input.workStart, "workStart");
  if ("workEnd" in input)      set.work_end    = V.time(input.workEnd, "workEnd");
  if ("ooo" in input)          set.ooo         = V.bool(input.ooo, "ooo");
  if ("oooMessage" in input)   set.ooo_message = V.str(input.oooMessage, "oooMessage", { max: 500, allowNull: true });
  if ("dndSchedule" in input)  set.dnd_schedule = V.bool(input.dndSchedule, "dndSchedule");
  if ("dndStart" in input)     set.dnd_start   = V.time(input.dndStart, "dndStart");
  if ("dndEnd" in input)       set.dnd_end     = V.time(input.dndEnd, "dndEnd");

  if (Object.keys(set).length === 0) {
    throw new V.ValidationError("No recognised fields to update.");
  }

  const cols = Object.keys(set).map(k => `${k} = ?`).join(", ");
  await db.query(`UPDATE users SET ${cols} WHERE id = ?`, [...Object.values(set), userId]);
  await audit(null, {
    actorId: userId, action: "user.profile_updated", entityType: "user", entityId: userId,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { fields: Object.keys(set) },
  });
  return getUser(userId);
}

async function setPresence(userId, body) {
  const presence = V.oneOf(body.presence, "presence", PRESENCES);
  await db.query(
    `UPDATE users SET presence = ?, last_seen_at = NOW() WHERE id = ?`, [presence, userId]
  );
  return getUser(userId, { withSkills: false });
}

/**
 * Custom status. expiresInMinutes of 0 or null means no expiry.
 * Sending an empty text clears it.
 */
async function setStatus(userId, body) {
  const emoji = V.str(body.emoji, "emoji", { max: 16, allowNull: true });
  const text = V.str(body.text, "text", { max: 160, allowNull: true });
  const mins = V.int(body.expiresInMinutes, "expiresInMinutes", { min: 0, max: 60 * 24 * 30, allowNull: true });

  if (!text && !emoji) {
    await db.query(
      `UPDATE users SET status_emoji = NULL, status_text = NULL, status_expires_at = NULL WHERE id = ?`,
      [userId]
    );
    return getUser(userId, { withSkills: false });
  }

  await db.query(
    `UPDATE users SET status_emoji = ?, status_text = ?,
            status_expires_at = ${mins ? "DATE_ADD(NOW(), INTERVAL ? MINUTE)" : "NULL"}
      WHERE id = ?`,
    mins ? [emoji, text, mins, userId] : [emoji, text, userId]
  );
  return getUser(userId, { withSkills: false });
}

async function getSettings(userId) {
  let row = await db.one(
    `SELECT accent, wallpaper, kody_avatar AS kodyAvatar, kody_avatar_url AS kodyAvatarUrl,
            predictive, font_scale AS fontScale, locale
       FROM user_settings WHERE user_id = ?`, [userId]
  );
  if (!row) {
    await db.query(`INSERT IGNORE INTO user_settings (user_id) VALUES (?)`, [userId]);
    row = await db.one(
      `SELECT accent, wallpaper, kody_avatar AS kodyAvatar, kody_avatar_url AS kodyAvatarUrl,
              predictive, font_scale AS fontScale, locale
         FROM user_settings WHERE user_id = ?`, [userId]
    );
  }
  row.predictive = !!row.predictive;
  row.fontScale = Number(row.fontScale);
  return row;
}

async function updateSettings(userId, body) {
  const input = V.pick(body, SETTINGS_FIELDS);
  const set = {};

  if ("accent" in input)        set.accent          = V.oneOf(input.accent, "accent", ACCENTS);
  if ("wallpaper" in input)     set.wallpaper       = V.oneOf(input.wallpaper, "wallpaper", WALLPAPERS);
  if ("kodyAvatar" in input)    set.kody_avatar     = V.oneOf(input.kodyAvatar, "kodyAvatar", AVATARS);
  if ("kodyAvatarUrl" in input) set.kody_avatar_url = V.url(input.kodyAvatarUrl, "kodyAvatarUrl");
  if ("predictive" in input)    set.predictive      = V.bool(input.predictive, "predictive");
  if ("locale" in input)        set.locale          = V.str(input.locale, "locale", { max: 12 });
  if ("fontScale" in input) {
    const n = Number(input.fontScale);
    if (!Number.isFinite(n) || n < 0.8 || n > 1.6) {
      throw new V.ValidationError("fontScale must be between 0.8 and 1.6.", "fontScale");
    }
    set.font_scale = n.toFixed(2);
  }

  if (Object.keys(set).length === 0) throw new V.ValidationError("No recognised settings to update.");

  await db.query(`INSERT IGNORE INTO user_settings (user_id) VALUES (?)`, [userId]);
  const cols = Object.keys(set).map(k => `${k} = ?`).join(", ");
  await db.query(`UPDATE user_settings SET ${cols} WHERE user_id = ?`, [...Object.values(set), userId]);
  return getSettings(userId);
}

/**
 * Directory. Searches name, job title, team and skill in one query.
 * Paginated because it is a list that grows.
 */
async function directory({ q, team, skill, presence, limit = 25, offset = 0 } = {}) {
  const where = ["u.deleted_at IS NULL", "u.is_active = 1"];
  const params = [];

  if (q) {
    where.push(`(u.full_name LIKE ? OR u.job_title LIKE ? OR u.team LIKE ? OR u.email LIKE ?
                 OR EXISTS (SELECT 1 FROM user_skills us JOIN skills s ON s.id = us.skill_id
                             WHERE us.user_id = u.id AND s.name LIKE ?))`);
    const like = `%${String(q).slice(0, 80)}%`;
    params.push(like, like, like, like, like);
  }
  if (team) { where.push("u.team = ?"); params.push(String(team)); }
  if (presence) { where.push("u.presence = ?"); params.push(V.oneOf(presence, "presence", PRESENCES)); }
  if (skill) {
    where.push(`EXISTS (SELECT 1 FROM user_skills us JOIN skills s ON s.id = us.skill_id
                         WHERE us.user_id = u.id AND s.name = ?)`);
    params.push(String(skill));
  }

  const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);

  const [rows] = await db.query(
    `SELECT ${SELECT_USER} FROM users u
      WHERE ${where.join(" AND ")}
      ORDER BY u.full_name LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  const total = await db.one(
    `SELECT COUNT(*) AS n FROM users u WHERE ${where.join(" AND ")}`, params
  );

  const map = await skillsFor(rows.map(r => r.id));
  rows.forEach(r => { decorate(r); r.skills = map.get(r.id) || []; });

  return { users: rows, total: total.n, limit: lim, offset: off };
}

async function teams() {
  const [rows] = await db.query(
    `SELECT team, COUNT(*) AS members FROM users
      WHERE team IS NOT NULL AND deleted_at IS NULL AND is_active = 1
      GROUP BY team ORDER BY team`
  );
  return rows;
}

async function allSkills() {
  const [rows] = await db.query(
    `SELECT s.name, s.category, COUNT(us.user_id) AS people
       FROM skills s LEFT JOIN user_skills us ON us.skill_id = s.id
      GROUP BY s.id ORDER BY s.category, s.name`
  );
  return rows;
}

async function setSkills(userId, names) {
  if (!Array.isArray(names)) throw new V.ValidationError("skills must be a list.", "skills");
  if (names.length > 20) throw new V.ValidationError("A maximum of 20 skills.", "skills");
  const clean = names.map(n => V.str(n, "skill", { max: 80 }));

  await db.transaction(async (conn) => {
    await conn.query(`DELETE FROM user_skills WHERE user_id = ?`, [userId]);
    for (const name of clean) {
      await conn.query(`INSERT IGNORE INTO skills (name) VALUES (?)`, [name]);
      await conn.query(
        `INSERT IGNORE INTO user_skills (user_id, skill_id)
         SELECT ?, id FROM skills WHERE name = ?`, [userId, name]
      );
    }
  });
  const map = await skillsFor([userId]);
  return { skills: map.get(userId) || [] };
}

/* ---------------- quick links ---------------- */

async function listQuickLinks(userId) {
  const [rows] = await db.query(
    `SELECT id, user_id AS userId, label, url, position
       FROM quick_links WHERE user_id IS NULL OR user_id = ?
      ORDER BY (user_id IS NOT NULL), position, id`,
    [userId]
  );
  return rows.map(r => ({ ...r, isDefault: r.userId === null }));
}

async function addQuickLink(userId, body) {
  const label = V.str(body.label, "label", { min: 1, max: 160 });
  const url = V.url(body.url, "url", { allowNull: false });
  const position = V.int(body.position ?? 0, "position", { min: 0, max: 999 });
  const [res] = await db.query(
    `INSERT INTO quick_links (user_id, label, url, position) VALUES (?,?,?,?)`,
    [userId, label, url, position]
  );
  return db.one(`SELECT id, label, url, position FROM quick_links WHERE id = ?`, [res.insertId]);
}

/** Ownership is part of the WHERE clause, so one user cannot delete another's link. */
async function deleteQuickLink(userId, linkId) {
  const [res] = await db.query(
    `DELETE FROM quick_links WHERE id = ? AND user_id = ?`, [linkId, userId]
  );
  return { deleted: res.affectedRows > 0 };
}

/* ---------------- admin ---------------- */

async function adminListUsers({ includeInactive = false, limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const [rows] = await db.query(
    `SELECT ${SELECT_USER},
            (SELECT GROUP_CONCAT(r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id) AS roleCodes
       FROM users u
      WHERE u.deleted_at IS NULL ${includeInactive ? "" : "AND u.is_active = 1"}
      ORDER BY u.id LIMIT ? OFFSET ?`,
    [lim, off]
  );
  rows.forEach(r => { decorate(r); r.roles = r.roleCodes ? r.roleCodes.split(",") : []; delete r.roleCodes; });
  return { users: rows, limit: lim, offset: off };
}

async function adminSetRoles(actorId, targetUserId, roleCodes, ctx = {}) {
  if (!Array.isArray(roleCodes) || roleCodes.length === 0) {
    throw new V.ValidationError("At least one role is required.", "roles");
  }
  const [valid] = await db.query(`SELECT id, code FROM roles WHERE code IN (?)`, [roleCodes]);
  if (valid.length !== roleCodes.length) {
    throw new V.ValidationError("One or more roles do not exist.", "roles");
  }
  await db.transaction(async (conn) => {
    await conn.query(`DELETE FROM user_roles WHERE user_id = ?`, [targetUserId]);
    for (const r of valid) {
      await conn.query(
        `INSERT INTO user_roles (user_id, role_id, granted_by) VALUES (?,?,?)`,
        [targetUserId, r.id, actorId]
      );
    }
  });
  await audit(null, {
    actorId, action: "user.roles_changed", entityType: "user", entityId: targetUserId,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { roles: roleCodes },
  });
  return { roles: valid.map(r => r.code) };
}

/**
 * Deactivating revokes every live session, so access stops immediately
 * rather than when the access token happens to expire.
 */
async function adminSetActive(actorId, targetUserId, active, ctx = {}) {
  if (Number(actorId) === Number(targetUserId) && !active) {
    throw new V.ValidationError("You cannot deactivate your own account.");
  }
  const flag = active ? 1 : 0;
  await db.query(`UPDATE users SET is_active = ? WHERE id = ?`, [flag, targetUserId]);
  if (!active) {
    await db.query(
      `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'user_deactivated'
        WHERE user_id = ? AND revoked_at IS NULL`, [targetUserId]
    );
  }
  await audit(null, {
    actorId, action: active ? "user.activated" : "user.deactivated",
    entityType: "user", entityId: targetUserId, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { isActive: !!active };
}

module.exports = {
  PRESENCES, getUser, updateProfile, setPresence, setStatus,
  getSettings, updateSettings, directory, teams, allSkills, setSkills,
  listQuickLinks, addQuickLink, deleteQuickLink,
  adminListUsers, adminSetRoles, adminSetActive,
  decorate, localTimeFor,
};
