"use strict";
/**
 * dAI: the ONLY place in dAI that looks at the Dolluz portal cookie, and it only
 * ever answers a yes or no question (docs/17-portal-sso.md).
 *
 * Why this file exists at all. Inside D sets dolluzcorp_token on
 * `.dolluzcorp.com` with SameSite=None, Secure and HttpOnly in production
 * (dApps/dolluzcorp, src/backend_routes/Login_server.js, cookieOptions). So the
 * browser sends it to dai.dolluzcorp.com on every request, and HttpOnly keeps it
 * away from the page's JavaScript but not from this process. The one credential
 * the whole single sign-on design exists to avoid holding is already in dAI's
 * request headers, whether dAI wants it or not.
 *
 * The protection is therefore not that it cannot arrive. It is that nothing
 * reads it. This file is the single exception, it is deliberately tiny so it can
 * be read in full in one sitting, and what it reads is the NAME of each cookie
 * plus the LENGTH of one value. It never captures a value, never returns one and
 * never logs one. tests/portal-sso.test.js asserts that no other file under
 * server/src touches a cookie, and that this one returns a boolean.
 *
 * What the answer is for. An AR caller who has never opened the portal has no
 * portal cookie, so sending them to Inside D with prompt=none can only come back
 * login_required. That is one wasted redirect on every sign in, for people who
 * will never benefit from single sign-on. Asking this first skips it.
 *
 * Presence is a HINT, not proof. The cookie may be expired, or revoked for a
 * particular app: Inside D deliberately does not clear it on a per-app revoke,
 * precisely so that revoking one app does not sign somebody out of all of them.
 * So a true answer here means "it is worth asking", never "this person is signed
 * in". The cost of being wrong is the same wasted redirect, and the decision this
 * feeds is an optimisation rather than a security control: nothing is authorised
 * on the strength of it.
 */

/**
 * Inside D's cookie name. Hardcoded rather than configured: it is a fact about
 * another application, not a choice about this deployment, and a knob here would
 * only create a way to set it wrongly. If it ever changes, this stops matching,
 * the answer is false, and everybody gets the password form, which is what they
 * get today.
 */
const PORTAL_COOKIE_NAME = "dolluzcorp_token";

/**
 * Is a non-empty Dolluz portal cookie on this request?
 *
 * Names are compared whole. A substring test over the header would be a real
 * bug: `other=dolluzcorp_token` and `not_dolluzcorp_token=x` both contain the
 * name and neither is it.
 */
function hasPortalCookie(req) {
  const header = req && req.headers ? req.headers.cookie : null;
  if (typeof header !== "string" || header.length === 0) return false;

  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;                      // a bare token, not a name=value
    if (pair.slice(0, eq).trim() !== PORTAL_COOKIE_NAME) continue;

    // The only thing read from the value is whether there is one. Express's
    // clearCookie expires it, so a signed out browser usually sends no cookie at
    // all, but an empty value is the same situation and is treated the same way.
    return pair.slice(eq + 1).trim().length > 0;
  }
  return false;
}

module.exports = { hasPortalCookie, PORTAL_COOKIE_NAME };
