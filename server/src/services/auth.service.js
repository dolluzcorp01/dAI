"use strict";
const db = require("../db");
const config = require("../config");
const { hashPassword, verifyPassword, fakeVerify } = require("../lib/password");
const T = require("../lib/tokens");
const dadmin = require("./dadmin.service");   // dAI: the dAdmin link (docs/PHASES.md 1.1)

class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SURFACES = ["web", "extension", "desktop", "android", "ios"];

function ipToBuffer(ip) {
  if (!ip) return null;
  const v4 = String(ip).replace(/^::ffff:/, "");
  const parts = v4.split(".");
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p) && Number(p) < 256)) {
    return Buffer.from(parts.map(Number));
  }
  return null; // IPv6 stored as null rather than mangled
}

async function audit(conn, { actorId, action, entityType, entityId, ip, userAgent, meta }) {
  const run = conn || db;
  await run.query(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, ip_address, user_agent, meta)
     VALUES (?,?,?,?,?,?,?)`,
    [actorId || null, action, entityType || null, entityId || null,
     ipToBuffer(ip), userAgent ? String(userAgent).slice(0, 400) : null,
     meta ? JSON.stringify(meta) : null]
  );
}

async function rolesFor(userId) {
  const [rows] = await db.query(
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    [userId]
  );
  return rows.map(r => r.code);
}

/**
 * Verify email and password. Throws on bad credentials, locked or inactive
 * accounts. Always burns comparable time so timing cannot enumerate emails.
 */
async function authenticate(email, password, ctx = {}) {
  const user = await db.one(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.deleted_at,
            c.password_hash, c.failed_attempts, c.locked_until
       FROM users u LEFT JOIN user_credentials c ON c.user_id = u.id
      WHERE u.email = ?`,
    [String(email || "").trim().toLowerCase()]
  );

  if (!user || !user.password_hash) {
    await fakeVerify();
    throw new AuthError(401, "invalid_credentials", "Email or password is incorrect.");
  }
  if (!user.is_active || user.deleted_at) {
    await fakeVerify();
    throw new AuthError(403, "account_disabled", "This account is not active.");
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await fakeVerify();
    throw new AuthError(429, "account_locked", "Too many failed attempts. Try again later.");
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const attempts = (user.failed_attempts || 0) + 1;
    const lock = attempts >= config.auth.maxFailedAttempts;
    await db.query(
      `UPDATE user_credentials
          SET failed_attempts = ?, locked_until = ${lock ? "DATE_ADD(NOW(), INTERVAL ? MINUTE)" : "NULL"}
        WHERE user_id = ?`,
      lock ? [attempts, config.auth.lockoutMinutes, user.id] : [attempts, user.id]
    );
    await audit(null, {
      actorId: user.id, action: "auth.login_failed", entityType: "user", entityId: user.id,
      ip: ctx.ip, userAgent: ctx.userAgent, meta: { attempts, locked: lock },
    });
    throw new AuthError(401, "invalid_credentials", "Email or password is incorrect.");
  }

  await db.query(
    `UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?`,
    [user.id]
  );
  return { id: user.id, email: user.email, fullName: user.full_name };
}

/** Create a session row and return the token pair. */
async function issueSession(userId, surface, ctx = {}) {
  if (!SURFACES.includes(surface)) {
    throw new AuthError(400, "bad_surface", "Unknown surface.");
  }
  const refresh = T.newRefreshToken();
  const expiresAt = T.refreshExpiry();

  const [res] = await db.query(
    `INSERT INTO sessions (user_id, surface, refresh_token_hash, user_agent, ip_address, expires_at, last_used_at)
     VALUES (?,?,?,?,?,?,NOW())`,
    [userId, surface, refresh.hash,
     ctx.userAgent ? String(ctx.userAgent).slice(0, 400) : null,
     ipToBuffer(ctx.ip), expiresAt]
  );

  const roles = await rolesFor(userId);
  const accessToken = T.signAccessToken({ userId, sessionId: res.insertId, roles, surface });

  await audit(null, {
    actorId: userId, action: "auth.session_issued", entityType: "session", entityId: res.insertId,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { surface },
  });

  return {
    accessToken,
    refreshToken: refresh.token,
    expiresIn: config.auth.accessMinutes * 60,
    sessionId: res.insertId,
    roles,
  };
}

/**
 * Web login. Returns tokens directly.
 *
 * dAI: real people sign in with their dadmin.employee credentials, and the Kody
 * user is created or linked on the way through (docs/PHASES.md 1.1). A local
 * Kody password is only a development and test convenience, so production
 * refuses it: there, dadmin is the only way in.
 */
async function login({ email, password, surface = "web" }, ctx = {}) {
  let user = null;
  try {
    user = await dadmin.signIn(email, password);
  } catch (err) {
    if (err instanceof dadmin.DadminError) {
      await audit(null, {
        actorId: null, action: "auth.dadmin_login_refused", entityType: "user", entityId: null,
        ip: ctx.ip, userAgent: ctx.userAgent, meta: { reason: err.code },
      });
      throw new AuthError(err.status, err.code, err.message);
    }
    throw err;
  }

  if (!user) {
    if (config.isProd()) {
      // No such employee. Burn comparable time so timing cannot enumerate, and
      // give the same answer as a wrong password.
      await fakeVerify();
      throw new AuthError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    user = await authenticate(email, password, ctx);
  }

  const tokens = await issueSession(user.id, surface, ctx);
  return { user: { id: user.id, email: user.email, fullName: user.fullName }, ...tokens };
}

/**
 * Extension handoff, step 1. The site authenticates the user and mints a
 * one-time code bound to the extension's state value and redirect URI.
 * No tokens are returned here, because this response travels through a
 * browser redirect.
 */
async function authorize({ email, password, state, redirectUri, surface = "extension" }, ctx = {}) {
  if (!state || String(state).length < 8) {
    throw new AuthError(400, "bad_state", "A state value is required.");
  }
  if (!T.isAllowedRedirect(redirectUri)) {
    throw new AuthError(400, "bad_redirect_uri", "This redirect URI is not allowed.");
  }
  const user = await authenticate(email, password, ctx);
  const code = T.newAuthCode();

  await db.query(
    `INSERT INTO auth_codes (code_hash, user_id, surface, state, redirect_uri, expires_at)
     VALUES (?,?,?,?,?,?)`,
    [code.hash, user.id, surface, String(state), redirectUri, T.codeExpiry()]
  );
  await audit(null, {
    actorId: user.id, action: "auth.code_issued", entityType: "user", entityId: user.id,
    ip: ctx.ip, userAgent: ctx.userAgent, meta: { surface, redirectUri },
  });

  return { code: code.code, state: String(state), expiresIn: config.auth.codeTtlSeconds };
}

/**
 * Extension handoff, step 2. Swap the code for tokens. Single use, and the
 * state must match what the extension generated, which is what stops a code
 * injected by another page from being redeemed.
 */
async function exchangeCode({ code, state, redirectUri }, ctx = {}) {
  const hash = T.sha256(String(code || ""));

  const result = await db.transaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT * FROM auth_codes WHERE code_hash = ? FOR UPDATE`, [hash]
    );
    const row = rows[0];
    if (!row) throw new AuthError(400, "invalid_code", "This code is not valid.");
    if (row.consumed_at) throw new AuthError(400, "code_used", "This code has already been used.");
    if (new Date(row.expires_at) < new Date()) throw new AuthError(400, "code_expired", "This code has expired.");
    if (String(row.state) !== String(state || "")) throw new AuthError(400, "state_mismatch", "State does not match.");
    if (redirectUri !== undefined && row.redirect_uri !== redirectUri) {
      throw new AuthError(400, "redirect_mismatch", "Redirect URI does not match.");
    }
    await conn.query(`UPDATE auth_codes SET consumed_at = NOW() WHERE id = ?`, [row.id]);
    return { userId: row.user_id, surface: row.surface };
  });

  const tokens = await issueSession(result.userId, result.surface, ctx);
  const user = await db.one(
    `SELECT id, email, full_name AS fullName, initials, job_title AS jobTitle, team, timezone
       FROM users WHERE id = ?`, [result.userId]
  );
  return { user, ...tokens };
}

/**
 * Refresh rotation with reuse detection.
 *
 * Every refresh mints a new token and revokes the old one. If a token that
 * was already revoked is presented, it has been stolen and replayed, so every
 * session for that user is killed rather than just that one.
 */
async function refresh({ refreshToken }, ctx = {}) {
  const hash = T.sha256(String(refreshToken || ""));

  const session = await db.one(`SELECT * FROM sessions WHERE refresh_token_hash = ?`, [hash]);
  if (!session) throw new AuthError(401, "invalid_refresh", "Session not recognised.");

  if (session.revoked_at) {
    await db.query(
      `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'refresh_reuse'
        WHERE user_id = ? AND revoked_at IS NULL`,
      [session.user_id]
    );
    await audit(null, {
      actorId: session.user_id, action: "auth.refresh_reuse_detected",
      entityType: "session", entityId: session.id, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    throw new AuthError(401, "refresh_reused", "This session has been revoked. Sign in again.");
  }

  if (new Date(session.expires_at) < new Date()) {
    throw new AuthError(401, "refresh_expired", "Session expired. Sign in again.");
  }

  // dAI: re-check dadmin on every refresh, so deactivating someone or turning
  // off app_dAI in dAdmin ends their access within an access token's lifetime
  // rather than after a 30 day refresh token expires (docs/PHASES.md 1.1).
  const owner = await db.one(`SELECT emp_id AS empId FROM users WHERE id = ?`, [session.user_id]);
  if (owner && owner.empId) {
    const revoked = await dadmin.accessRevoked(owner.empId);
    if (revoked) {
      await db.query(
        `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'dadmin_access_revoked'
          WHERE user_id = ? AND revoked_at IS NULL`,
        [session.user_id]
      );
      await audit(null, {
        actorId: session.user_id, action: "auth.dadmin_access_revoked", entityType: "user",
        entityId: session.user_id, ip: ctx.ip, userAgent: ctx.userAgent, meta: { reason: revoked },
      });
      throw new AuthError(403, "dai_not_enabled",
        "This account no longer has access to dAI. Sign in again once it is enabled in dAdmin.");
    }
  }

  const next = T.newRefreshToken();
  await db.transaction(async (conn) => {
    await conn.query(
      `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'rotated' WHERE id = ?`,
      [session.id]
    );
    await conn.query(
      `INSERT INTO sessions (user_id, surface, refresh_token_hash, user_agent, ip_address, expires_at, last_used_at)
       VALUES (?,?,?,?,?,?,NOW())`,
      [session.user_id, session.surface, next.hash,
       ctx.userAgent ? String(ctx.userAgent).slice(0, 400) : null,
       ipToBuffer(ctx.ip), T.refreshExpiry()]
    );
  });

  const created = await db.one(`SELECT id FROM sessions WHERE refresh_token_hash = ?`, [next.hash]);
  const roles = await rolesFor(session.user_id);

  return {
    accessToken: T.signAccessToken({
      userId: session.user_id, sessionId: created.id, roles, surface: session.surface,
    }),
    refreshToken: next.token,
    expiresIn: config.auth.accessMinutes * 60,
    roles,
  };
}

async function logout({ refreshToken, sessionId }, ctx = {}) {
  if (refreshToken) {
    await db.query(
      `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'logout'
        WHERE refresh_token_hash = ? AND revoked_at IS NULL`,
      [T.sha256(String(refreshToken))]
    );
  } else if (sessionId) {
    await db.query(
      `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'logout'
        WHERE id = ? AND revoked_at IS NULL`,
      [sessionId]
    );
  }
  await audit(null, {
    actorId: ctx.userId, action: "auth.logout", entityType: "session",
    entityId: sessionId || null, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { ok: true };
}

async function listSessions(userId) {
  const [rows] = await db.query(
    `SELECT id, surface, user_agent, issued_at, last_used_at, expires_at, revoked_at
       FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY issued_at DESC`,
    [userId]
  );
  return rows;
}

async function revokeSession(userId, sessionId, ctx = {}) {
  const [res] = await db.query(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'revoked_by_user'
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [sessionId, userId]
  );
  await audit(null, {
    actorId: userId, action: "auth.session_revoked", entityType: "session",
    entityId: sessionId, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { revoked: res.affectedRows > 0 };
}

async function setPassword(userId, plain) {
  const hash = await hashPassword(plain);
  await db.query(
    `INSERT INTO user_credentials (user_id, password_hash)
     VALUES (?,?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash),
                             password_changed_at = NOW(),
                             failed_attempts = 0, locked_until = NULL`,
    [userId, hash]
  );
  return { ok: true };
}

module.exports = {
  AuthError, audit, rolesFor,
  login, authorize, exchangeCode, refresh, logout,
  listSessions, revokeSession, setPassword, issueSession, authenticate,
};
