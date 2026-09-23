"use strict";
const jwt = require("jsonwebtoken");
const db = require("../db");
const config = require("../config");
const dadmin = require("../services/dadmin.service");

/**
 * Service tokens from the dAdmin console (docs/PHASES.md 1.2).
 *
 * The dAI admin pages live in dAdmin, not here. dAdmin authenticates its own
 * user, checks its own page access, and then calls dAI with a token it signs
 * itself: a 60 second JWT carrying { emp_id, aud: "dai-admin" }.
 *
 * Three properties matter.
 *
 * 1. The secret is dedicated. DADMIN_SHARED_JWT_SECRET pairs with dAdmin's
 *    DAI_SHARED_JWT_SECRET and is never dAdmin's own JWT_SECRET, so a dAdmin
 *    user session token cannot be replayed here, and either side can rotate
 *    the secret without signing anyone out.
 *
 * 2. It is accepted on an explicit whitelist of paths, mounted in app.js.
 *    Every other route keeps user tokens only, so a service token cannot read
 *    someone's messages or files.
 *
 * 3. It grants no more than the person would have. emp_id is mapped to the
 *    Kody user and that user's roles, and the routers' own requireRole checks
 *    then apply unchanged.
 */

const AUDIENCE = "dai-admin";

/**
 * dAdmin issues these with expiresIn 60. maxAge is a second, independent bound
 * measured from iat, so a bug on the dAdmin side that issued a long-lived token
 * still cannot produce a key to dAI that works for hours.
 */
const MAX_AGE_SECONDS = 120;

function bearerToken(req) {
  const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/** Does this look like a dAdmin service token, whatever its signature says? */
function claimsToBeService(token) {
  try {
    const decoded = jwt.decode(token);
    return !!decoded && decoded.aud === AUDIENCE;
  } catch (_) {
    return false;
  }
}

const refuse = (res, code, message) => res.status(401).json({ error: code, message });

async function rolesFor(userId) {
  const [rows] = await db.query(
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    [userId]
  );
  return rows.map(r => r.code);
}

/**
 * Runs before `authenticate` on the whitelisted paths. A request that is not a
 * service token is passed straight through, so ordinary user tokens still work
 * on these routes exactly as before.
 */
async function dadminService(req, res, next) {
  const token = bearerToken(req);
  if (!token || !claimsToBeService(token)) return next();

  if (!config.dadmin.sharedJwtSecret) {
    return refuse(res, "service_auth_disabled",
      "This deployment has no dAdmin shared secret configured.");
  }

  let payload;
  try {
    payload = jwt.verify(token, config.dadmin.sharedJwtSecret, {
      audience: AUDIENCE,
      maxAge: MAX_AGE_SECONDS,
    });
  } catch (err) {
    const code = err.name === "TokenExpiredError" ? "service_token_expired" : "service_token_invalid";
    return refuse(res, code, "This dAdmin service token is not valid.");
  }

  // emp_id is a code like DZIND148. Never Number() it (CLAUDE.md rule 4).
  const empId = typeof payload.emp_id === "string" ? payload.emp_id.trim() : "";
  if (!empId || empId.length > 20) {
    return refuse(res, "service_token_invalid", "This dAdmin service token carries no usable emp_id.");
  }

  const employee = await dadmin.findEmployeeByEmpId(empId);
  if (!employee) {
    return refuse(res, "unknown_employee", "That employee is not in dAdmin.");
  }
  if (dadmin.accessProblem(employee)) {
    return res.status(403).json({
      error: "dai_not_enabled",
      message: "That employee does not have access to dAI.",
    });
  }

  // The same create-or-link path a sign-in uses, so an administrator who
  // has never opened dAI still acts as themselves here rather than as nobody.
  const synced = await dadmin.syncUser(employee);
  const user = await db.one(
    `SELECT id, email, full_name AS fullName, initials, job_title AS jobTitle,
            team, timezone, presence, is_active, deleted_at
       FROM users WHERE id = ?`,
    [synced.userId]
  );
  if (!user || !user.is_active || user.deleted_at) {
    return res.status(403).json({ error: "account_disabled", message: "This account is not active." });
  }

  req.auth = {
    userId: user.id,
    sessionId: null,          // a service call holds no session: nothing to revoke
    surface: "dadmin",
    roles: await rolesFor(user.id),
    service: true,
    empId,
  };
  req.user = user;
  next();
}

/** Express swallows a rejected promise, so wrap it and answer with a 500 instead. */
function dadminServiceMiddleware(req, res, next) {
  dadminService(req, res, next).catch((err) => {
    console.error("dAdmin service auth failed:", err);
    res.status(500).json({ error: "server_error", message: "Something went wrong." });
  });
}

module.exports = { dadminServiceMiddleware, AUDIENCE, MAX_AGE_SECONDS, claimsToBeService };
