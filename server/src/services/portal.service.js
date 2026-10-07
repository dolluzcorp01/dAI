"use strict";
const config = require("../config");
const { logError } = require("../lib/safe-error");

/**
 * dAI: the Inside D link for single sign-on (docs/17-portal-sso.md).
 *
 * Inside D is the portal every employee signs in to. When somebody already has
 * a portal session open, Kody should not ask for the password again. The shape
 * is a short-lived handoff code, not an introspection of the portal cookie:
 *
 *   1. Kody's sign in page sends the person to Inside D's /authorize, in the
 *      same tab, with prompt=none.
 *   2. Inside D reads its OWN cookie, on its OWN origin, and comes straight
 *      back with a one-time code, or with error=login_required.
 *   3. This service swaps that code for an emp_id, server to server.
 *
 * The thing that is deliberately absent: dolluzcorp_token. It is the key to
 * every dApp in the suite, and if it passed through this page or this process
 * then an XSS here, or one stray error object carrying a request body, would
 * turn a dAI incident into a suite-wide one. It never arrives, so it cannot
 * leak. The handoff code is worth nothing anywhere but this endpoint, is good
 * for sixty seconds, and dies when it is used.
 *
 * What comes back is an emp_id and nothing else. Inside D is not asked for a
 * name, an email or an access level, and if a later version of it sends them
 * anyway they are ignored here: those belong to dadmin.employee, and reading
 * them from a token response would make Inside D able to change who somebody
 * is in Kody.
 */

class PortalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Inside D is not reachable forever. Five seconds, then the password form. */
const TIMEOUT_MS = 5000;

const enabled = () => config.portalEnabled();

/**
 * What the sign in page needs to send somebody to Inside D. A client id is
 * public by definition. The secret is not here and never leaves the server.
 *
 * Two ways to answer "no, show the password form":
 *
 *   not_configured    the five PORTAL_* values are not all set, so there is
 *                     nowhere to send anybody. This is how the repository ships.
 *   no_portal_cookie  this browser is carrying no Dolluz portal cookie, so a
 *                     trip to Inside D could only come back login_required.
 *                     An AR caller who never opens the portal is in this state
 *                     every time, and used to pay a redirect for it.
 *
 * `reason` is for whoever curls this endpoint and wonders why. The page does not
 * read it: for the page, enabled:false means one thing, which is ask for a
 * password, and it says nothing to the person in either case because neither is
 * a fault.
 *
 * portalCookiePresent defaults to TRUE, deliberately. A caller that forgets to
 * pass it gets the old behaviour, which is to ask Inside D and find out. The
 * gate is an optimisation, so the safe default is the one that costs a redirect
 * rather than the one that silently switches single sign-on off.
 */
function pageConfig({ portalCookiePresent = true } = {}) {
  if (!enabled()) return { enabled: false, reason: "not_configured" };
  if (!portalCookiePresent) return { enabled: false, reason: "no_portal_cookie" };
  return {
    enabled: true,
    authorizeUrl: config.portal.authorizeUrl,
    clientId: config.portal.clientId,
    redirectUri: config.portal.redirectUri,
    sessionHours: config.portal.sessionHours,
  };
}

/**
 * emp_id is VARCHAR(20) holding codes like DZIND148. It is never a number, and
 * it is about to be interpolated into nothing but a bound parameter, but a
 * value from another service gets looked at before it is used regardless.
 */
function cleanEmpId(value) {
  const empId = String(value == null ? "" : value).trim();
  if (!empId || empId.length > 20 || !/^[A-Za-z0-9_-]+$/.test(empId)) return null;
  return empId;
}

/**
 * Swap Inside D's one-time code for an emp_id.
 *
 * Returns { empId }. Throws a PortalError with a code the page can tell apart:
 * portal_unreachable means nobody answered and the password form is the way
 * forward, portal_refused means Inside D said no.
 */
async function exchange(code) {
  if (!enabled()) {
    throw new PortalError(503, "portal_disabled", "Portal sign-on is not configured.");
  }
  const clean = String(code || "").trim();
  if (!clean) {
    throw new PortalError(400, "missing_portal_code", "No portal code was supplied.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(config.portal.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: clean,
        client_id: config.portal.clientId,
        client_secret: config.portal.clientSecret,
        redirect_uri: config.portal.redirectUri,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    // No answer is not the same thing as an answer that says no, and the page
    // says different words for each. The detail goes to the log through
    // logError, never into the response: describeError's line carries a stack
    // frame, and a stack frame is for us, not for a sign in page.
    logError("portal token exchange did not answer:", err);
    const timedOut = err && (err.name === "AbortError" || err.name === "TimeoutError");
    throw new PortalError(502, "portal_unreachable", timedOut
      ? `The Dolluz portal did not answer within ${TIMEOUT_MS / 1000} seconds.`
      : "The Dolluz portal could not be reached.");
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }

  if (!res.ok) {
    throw new PortalError(401, "portal_refused",
      `The Dolluz portal would not confirm this sign in (${res.status}).`);
  }

  const empId = cleanEmpId(body && body.emp_id);
  if (!empId) {
    throw new PortalError(502, "portal_bad_response",
      "The Dolluz portal answered without an employee id.");
  }
  // Only this. Anything else the response happened to contain is dropped here.
  return { empId };
}

module.exports = { PortalError, enabled, pageConfig, exchange, cleanEmpId, TIMEOUT_MS };
