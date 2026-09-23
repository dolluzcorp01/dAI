"use strict";
const express = require("express");
const config = require("../config");
const svc = require("../services/auth.service");
const { authenticate, rateLimit } = require("../middleware/auth");

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
  console.error("auth error:", err);
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

/* POST /api/auth/forgot-password
   dAI: the password belongs to dAdmin, so dAI never resets one (docs/PHASES.md 1.1).
   The same answer is given whatever the email, so this cannot enumerate accounts. */
router.post("/forgot-password", loginLimiter, (req, res) => {
  const resetUrl = config.dadmin.resetUrl || null;
  res.json({
    ok: true,
    resetUrl,
    message: resetUrl
      ? "Your Kody password is your Dolluz sign-in password. Reset it in dAdmin, then sign in here again."
      : "Your Kody password is your Dolluz sign-in password. Ask your administrator to reset it in dAdmin.",
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
