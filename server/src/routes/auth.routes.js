"use strict";
const express = require("express");
const config = require("../config");
const svc = require("../services/auth.service");
const { authenticate, rateLimit } = require("../middleware/auth");
const { logError } = require("../lib/safe-error");   // dAI: never log an error object (PHI in err.sql)
const { hasPortalCookie } = require("../lib/portal-cookie");   // dAI: yes or no, never the value

const router = express.Router();

const ctxOf = (req) => ({
  ip: req.ip,
  userAgent: req.get("user-agent"),
  userId: req.auth ? req.auth.userId : undefined,
});

/** Turns an AuthError into its status, anything else into a 500. */
function handle(res, err) {
  if (err instanceof svc.AuthError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  logError("auth error:", err);
  return res.status(500).json({ error: "server_error", message: "Something went wrong." });
}

const loginLimiter = rateLimit({
  windowMs: 60000, max: config.auth.rateLoginMax,
  keyFn: (req) => `${req.ip}:${(req.body && req.body.email) || "anon"}`,
});

/* POST /api/auth/login - web and desktop. Returns tokens directly. */
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password, surface } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "missing_fields", message: "Email and password are required." });
    }
    const out = await svc.login({ email, password, surface: surface || "web" }, ctxOf(req));
    res.json(out);
  } catch (err) { handle(res, err); }
});

/* POST /api/auth/authorize - extension handoff step 1. Returns a one-time code. */
router.post("/authorize", loginLimiter, async (req, res) => {
  try {
    const { email, password, state, redirect_uri: redirectUri, surface } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "missing_fields", message: "Email and password are required." });
    }
    const out = await svc.authorize(
      { email, password, state, redirectUri, surface: surface || "extension" }, ctxOf(req)
    );
    res.json(out);
  } catch (err) { handle(res, err); }
});

/* POST /api/auth/token - extension handoff step 2. Swaps the code for tokens. */
router.post("/token", rateLimit({ windowMs: 60000, max: config.auth.rateTokenMax }), async (req, res) => {
  try {
    const { code, state, redirect_uri: redirectUri } = req.body || {};
    if (!code) return res.status(400).json({ error: "missing_code", message: "Code is required." });
    const out = await svc.exchangeCode({ code, state, redirectUri }, ctxOf(req));
    res.json(out);
  } catch (err) { handle(res, err); }
});

/* POST /api/auth/refresh - rotates the refresh token. */
router.post("/refresh", rateLimit({ windowMs: 60000, max: config.auth.rateRefreshMax }), async (req, res) => {
  try {
    const { refresh_token: refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ error: "missing_refresh", message: "Refresh token is required." });
    }
    const out = await svc.refresh({ refreshToken }, ctxOf(req));
    res.json(out);
  } catch (err) { handle(res, err); }
});

/* POST /api/auth/logout */
router.post("/logout", async (req, res) => {
  try {
    const { refresh_token: refreshToken } = req.body || {};
    await svc.logout({ refreshToken }, ctxOf(req));
    res.json({ ok: true });
  } catch (err) { handle(res, err); }
});

/* ---------------- single sign-on from Inside D (docs/17-portal-sso.md) ----------------
 *
 * Two endpoints, and between them the portal token never appears. The sign in
 * page asks /portal/config where to send somebody, Inside D answers on its own
 * origin from its own cookie, and /portal/callback swaps the one-time code it
 * sends back for an emp_id, server to server.
 *
 * Both are INERT until PORTAL_* is configured. Until then /portal/config says
 * enabled:false, the page never leaves this origin, and the password form is
 * the only way in: which is how Phase 1 works today and must keep working while
 * the Inside D half is built in another repository.
 */

/* GET /api/auth/portal/config
   Where to send somebody, and nothing secret. No authentication, because the
   sign in page has nobody signed in yet by definition.

   The answer is NOT the same for everybody: a browser carrying no Dolluz portal
   cookie is told the handoff is off, so it never makes a round trip that could
   only come back login_required. hasPortalCookie reads cookie NAMES and the
   length of one value, and is the only thing in dAI that looks at the portal
   cookie at all (server/src/lib/portal-cookie.js). */
router.get("/portal/config", (req, res) => {
  res.json(svc.portal.pageConfig({ portalCookiePresent: hasPortalCookie(req) }));
});

/* POST /api/auth/portal/callback
   The return leg. Body: the one-time code Inside D redirected back with, plus
   the state and callback the EXTENSION originally asked for, because the code
   this mints has to be bound to those exactly as the password path binds them.

   The portal state, which guards against somebody else's code being pushed
   through this page, is checked by the page against its own sessionStorage
   before it ever posts here. It cannot be checked a second time on the server
   without the server storing pending requests, and what it protects against is
   a code being swapped for one belonging to the attacker's own portal session,
   which wins them a Kody session as themselves. docs/17-portal-sso.md
   "What the portal state does and does not cover". */
router.post("/portal/callback", loginLimiter, async (req, res) => {
  try {
    if (!svc.portal.enabled()) {
      return res.status(503).json({
        error: "portal_disabled",
        message: "Portal sign-on is not configured. Use your password.",
      });
    }
    const { portal_code: portalCode, state, redirect_uri: redirectUri, surface } = req.body || {};
    if (!portalCode) {
      return res.status(400).json({ error: "missing_portal_code", message: "No portal code was supplied." });
    }

    // Step 1: ask Inside D who this is. The answer is an emp_id and nothing
    // else; see portal.service.js.
    const { empId } = await svc.portal.exchange(portalCode);

    // Step 2: the ordinary authorize path, with the emp_id in place of a
    // password. dadmin still decides whether this person may use Kody, so
    // app_dAI is enforced here exactly as it is for a password.
    const out = await svc.authorize(
      { portalEmpId: empId, state, redirectUri, surface: surface || "extension" },
      ctxOf(req)
    );
    // sessionHours so the page can SAY how long this lasts on the way in, not
    // leave somebody to find out by being signed out (docs/17-portal-sso.md).
    res.json({ ...out, sessionHours: config.portal.sessionHours });
  } catch (err) {
    if (err instanceof svc.portal.PortalError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    handle(res, err);
  }
});

/* ---------------- the dAdmin handoff, the interim (docs/17-portal-sso.md section 7) -------
 *
 * Not the same thing as /portal/* above, and on its own switch. There, the sign
 * in PAGE sends somebody to Inside D and back. Here, the extension's SERVICE
 * WORKER calls dAdmin with the portal cookie and posts the answer straight to
 * dAI, so no window opens at all and there is no redirect to protect with a
 * one-time code.
 *
 * dAI's backend cannot make that call itself: the cookie belongs to the browser.
 */

/* GET /api/auth/dai-login/config
   Where the worker should call, and nothing secret. The URL is configuration so
   that moving dAdmin's endpoint does not need a new extension release. No cookie
   gate here, unlike /portal/config: there is no redirect to save, and the worker
   cannot see the cookie to report on it anyway. */
router.get("/dai-login/config", (req, res) => {
  res.json(svc.daiLogin.clientConfig());
});

/* POST /api/auth/dai-login
   Body: { token }, the 60 second JWT dAdmin minted. Returns a Kody session.

   Rate limited on the IP alone, because there is no email in this request to key
   on. The token itself is single use, so the limit is about noise rather than
   about guessing: a forged token cannot be brute forced through a signature. */
router.post("/dai-login", rateLimit({
  windowMs: 60000, max: config.auth.rateTokenMax, keyFn: (req) => req.ip,
}), async (req, res) => {
  try {
    const { token } = req.body || {};

    // verify, then spend the jti, then sign in. In that order: a token that
    // cannot be verified must not consume anything, and a verified token must be
    // spent before it is acted on.
    const { empId } = await svc.daiLogin.redeem(token);

    // And now the ordinary path. dadmin's accessProblem() decides whether this
    // person may use Kody, exactly as it does for a password, so app_dAI is
    // enforced here because it is enforced in one place for every route.
    const out = await svc.loginWithVouchedEmpId(
      { portalEmpId: empId, surface: "extension" }, ctxOf(req)
    );
    res.json({ ...out, sessionHours: config.portal.sessionHours });
  } catch (err) {
    if (err instanceof svc.daiLogin.DaiLoginError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    handle(res, err);
  }
});

/* POST /api/auth/forgot-password
   dAI: the password belongs to dadmin.employee, so dAI never resets one
   (docs/PHASES.md 1.1). It points at Inside D rather than the dAdmin console,
   because only Admin and Sub Admin can sign in to dAdmin and Kody is for
   everyone. The same answer is given whatever the email, so this cannot be used
   to find out who has an account. */
router.post("/forgot-password", loginLimiter, (req, res) => {
  const resetUrl = config.dadmin.resetUrl || null;
  res.json({
    ok: true,
    resetUrl,
    message: resetUrl
      ? "Your Kody password is your Dolluz sign-in password. Open the Dolluz portal, "
        + "use Forgot password there, then sign in here again."
      : "Your Kody password is your Dolluz sign-in password. Reset it on the Dolluz portal, "
        + "or ask your administrator.",
  });
});

/* GET /api/auth/me */
router.get("/me", authenticate, async (req, res) => {
  res.json({
    user: req.user,
    session: { id: req.auth.sessionId, surface: req.auth.surface },
    roles: req.auth.roles,
  });
});

/* GET /api/auth/sessions - every live sign-in for this user. */
router.get("/sessions", authenticate, async (req, res) => {
  try {
    res.json({ sessions: await svc.listSessions(req.auth.userId) });
  } catch (err) { handle(res, err); }
});

/* DELETE /api/auth/sessions/:id - sign out one surface remotely. */
router.delete("/sessions/:id", authenticate, async (req, res) => {
  try {
    const out = await svc.revokeSession(req.auth.userId, Number(req.params.id), ctxOf(req));
    if (!out.revoked) return res.status(404).json({ error: "not_found", message: "Session not found." });
    res.json(out);
  } catch (err) { handle(res, err); }
});

module.exports = router;
