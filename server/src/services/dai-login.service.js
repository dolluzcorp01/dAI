"use strict";
const jwt = require("jsonwebtoken");
const db = require("../db");
const config = require("../config");

/**
 * dAI: the dAdmin handoff, which is the interim form of single sign-on
 * (docs/17-portal-sso.md section 7).
 *
 * How it works, and who does what:
 *
 *   1. The extension's SERVICE WORKER calls dAdmin with the portal cookie. Not
 *      this server: the cookie belongs to the browser and dAI's backend has no
 *      way to present it. Not the sign in page either, which would need CORS on
 *      dAdmin and would open a window nobody asked for.
 *   2. dAdmin verifies its own cookie, checks the employee row, and answers with
 *      a 60 second JWT: { emp_id, aud: "dai-login", jti, iat, exp }, signed with
 *      DAI_LOGIN_JWT_SECRET.
 *   3. The worker posts that token here. This file verifies it, spends the jti,
 *      and hands the emp_id to the ordinary sign-in path.
 *
 * What this file does NOT decide: whether the person may use Kody. It produces
 * an emp_id, and auth.service's resolveUser sends that through dadmin's
 * accessProblem() exactly as a password goes through it. app_dAI is enforced on
 * this path because it is enforced in one place for every path.
 *
 * Two audiences, no overlap. This verifies "dai-login" and nothing else, and
 * middleware/dadmin-service.js verifies "dai-admin" and nothing else. A token
 * for one is refused by the other, which matters because they may be signed with
 * the same secret if dAdmin ever reuses one: the audience is then the whole of
 * the separation between "sign this person in" and "act on the admin surface".
 */

class DaiLoginError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const AUDIENCE = "dai-login";

/**
 * dAdmin issues these with exp = iat + 60. maxAge is a second, independent bound
 * measured from iat, so a bug on the dAdmin side that issued a long-lived token
 * still cannot produce a key to dAI that works for hours. Same reasoning, and
 * same number, as the service token in middleware/dadmin-service.js.
 */
const MAX_AGE_SECONDS = 120;

/**
 * Both apps run on the same droplet, so clock skew between them is nil. A few
 * seconds of tolerance costs nothing and stops a 60 second window being tight
 * if either is ever moved.
 */
const CLOCK_TOLERANCE_SECONDS = 5;

const enabled = () => !!config.daiLogin.secret && !!config.daiLogin.handoffUrl;

/**
 * What the extension needs in order to make the call. The URL is configuration
 * rather than a constant in the extension, so moving dAdmin's endpoint does not
 * need a new extension release. Nothing secret: the secret verifies what comes
 * back and never leaves this server.
 */
function clientConfig() {
  if (!enabled()) return { enabled: false, reason: "not_configured" };
  return { enabled: true, handoffUrl: config.daiLogin.handoffUrl };
}

/**
 * emp_id is VARCHAR(20) holding codes like DZIND148, and it is never a number
 * (CLAUDE.md rule 4). Checked here even though it only ever reaches a bound
 * parameter, because it arrived from another service.
 */
function cleanEmpId(value) {
  const empId = String(value == null ? "" : value).trim();
  if (!empId || empId.length > 20 || !/^[A-Za-z0-9_-]+$/.test(empId)) return null;
  return empId;
}

/** A uuid from dAdmin. Anything that would not fit the column is refused. */
function cleanJti(value) {
  const jti = String(value == null ? "" : value).trim();
  if (!jti || jti.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(jti)) return null;
  return jti;
}

/**
 * Verify a dAdmin handoff token. Returns { empId, jti, expiresAt }.
 *
 * Everything here is a refusal with the same outward shape, because the caller
 * is a service worker and not a person: there is nothing to be gained by
 * explaining which part of a token was wrong.
 */
function verify(token) {
  if (!enabled()) {
    throw new DaiLoginError(503, "dai_login_disabled", "The dAdmin handoff is not configured.");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new DaiLoginError(400, "missing_handoff_token", "No handoff token was supplied.");
  }

  let payload;
  try {
    payload = jwt.verify(token, config.daiLogin.secret, {
      audience: AUDIENCE,              // refuses a dai-admin token outright
      maxAge: MAX_AGE_SECONDS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
  } catch (err) {
    const code = err.name === "TokenExpiredError" ? "handoff_expired" : "handoff_invalid";
    throw new DaiLoginError(401, code, "This sign-in handoff is not valid.");
  }

  const empId = cleanEmpId(payload.emp_id);
  if (!empId) {
    throw new DaiLoginError(401, "handoff_invalid", "This sign-in handoff is not valid.");
  }

  // No jti means single use cannot be enforced. Refuse rather than accept a
  // token that could be replayed for the rest of its minute: accepting it and
  // not enforcing would be the same as having no guard, while looking like one.
  const jti = cleanJti(payload.jti);
  if (!jti) {
    throw new DaiLoginError(401, "handoff_no_jti",
      "This sign-in handoff carries no single-use id.");
  }

  // exp is present because jwt.verify demands it with maxAge set, but the row
  // needs a concrete time and a token without one would otherwise be stored
  // with an invalid date.
  const expSeconds = Number(payload.exp);
  if (!Number.isFinite(expSeconds)) {
    throw new DaiLoginError(401, "handoff_invalid", "This sign-in handoff is not valid.");
  }

  return { empId, jti, expiresAt: new Date(expSeconds * 1000) };
}

/**
 * Spend the jti, exactly once.
 *
 * The INSERT is the check. A SELECT then INSERT would leave a window between
 * looking and writing that two simultaneous requests fit through, and two
 * simultaneous requests is precisely what a replay looks like.
 */
async function spendJti(jti, expiresAt) {
  try {
    await db.query(
      `INSERT INTO dai_login_jti (jti, expires_at) VALUES (?, ?)`,
      [jti, expiresAt]
    );
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      throw new DaiLoginError(401, "handoff_used",
        "This sign-in handoff has already been used.");
    }
    throw err;
  }
}

/** Verify and spend, in that order. Returns { empId }. */
async function redeem(token) {
  const { empId, jti, expiresAt } = verify(token);
  await spendJti(jti, expiresAt);
  return { empId };
}

module.exports = {
  DaiLoginError, AUDIENCE, MAX_AGE_SECONDS, CLOCK_TOLERANCE_SECONDS,
  enabled, clientConfig, verify, spendJti, redeem, cleanEmpId, cleanJti,
};
