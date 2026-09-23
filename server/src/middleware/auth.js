"use strict";
const db = require("../db");
const T = require("../lib/tokens");

/**
 * Verifies the access token AND checks the session is still live.
 *
 * The JWT alone is not enough: an access token stays cryptographically valid
 * until it expires, so a revoked session would keep working for up to 15
 * minutes. The session lookup closes that window.
 */
async function authenticate(req, res, next) {
  // dAI: a dAdmin service token was already verified and mapped to a user by
  // middleware/dadmin-service.js on the whitelisted paths (docs/PHASES.md 1.2).
  // It holds no session, so there is nothing here for it to look up.
  if (req.auth && req.auth.service) return next();

  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: "missing_token", message: "Authorization header required." });
  }

  let payload;
  try {
    payload = T.verifyAccessToken(match[1]);
  } catch (err) {
    const code = err.name === "TokenExpiredError" ? "token_expired" : "invalid_token";
    return res.status(401).json({ error: code, message: "Access token is not valid." });
  }

  const session = await db.one(
    `SELECT id, user_id, surface, revoked_at, expires_at FROM sessions WHERE id = ?`,
    [payload.sid]
  );
  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
    return res.status(401).json({ error: "session_revoked", message: "Session is no longer valid." });
  }

  const user = await db.one(
    `SELECT id, email, full_name AS fullName, initials, job_title AS jobTitle,
            team, timezone, presence, is_active, deleted_at
       FROM users WHERE id = ?`,
    [payload.sub]
  );
  if (!user || !user.is_active || user.deleted_at) {
    return res.status(403).json({ error: "account_disabled", message: "This account is not active." });
  }

  db.query(`UPDATE sessions SET last_used_at = NOW() WHERE id = ?`, [session.id]).catch(() => {});

  req.auth = {
    userId: user.id,
    sessionId: session.id,
    surface: session.surface,
    roles: payload.roles || [],
  };
  req.user = user;
  next();
}

/** Route guard. requireRole("admin","super_admin") */
function requireRole(...allowed) {
  return (req, res, next) => {
    const roles = (req.auth && req.auth.roles) || [];
    if (!roles.some(r => allowed.includes(r))) {
      return res.status(403).json({ error: "forbidden", message: "You do not have access to this." });
    }
    next();
  };
}

/**
 * In-memory fixed window limiter. Adequate for a single process; module 15
 * swaps the store for Redis when the API runs more than one instance.
 */
function rateLimit({ windowMs = 60000, max = 20, keyFn } = {}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: "rate_limited", message: "Too many requests. Slow down." });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, rateLimit };
