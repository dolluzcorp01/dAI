"use strict";
/**
 * Kody AI routes. Mounted at /api/kody.
 *
 * Written for dAI: the module bundle shipped kody.service.js and a docs table
 * (docs/08-kody-ai.md "Endpoints") but no router. Every handler is a thin
 * wrapper over kody.service / codes.service; no logic lives here.
 */
const express = require("express");
const config = require("../config");
const kody = require("../services/kody.service");
const codes = require("../services/codes.service");
const { ValidationError } = require("../lib/validate");
const { authenticate, requireRole, rateLimit } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

function handle(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.code, message: err.message, field: err.field });
  }
  if (err && err.status && err.code) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error("kody error:", err);
  return res.status(500).json({ error: "server_error", message: "Something went wrong." });
}
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { handle(res, e); } };

function id(req, name = "id") {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${name} must be a number.`, name);
  return n;
}

// Every ask can reach a paid model, so it is rate limited per user.
const askLimiter = rateLimit({
  windowMs: 60000,
  max: Number(process.env.KODY_RATE_MAX || config.ai.rateMax || 30),
  keyFn: (req) => `kody:${req.auth.userId}`,
});

// SME review is open to coordinators (subject experts) and above.
const sme = requireRole("admin", "super_admin", "coordinator");

/* POST /api/kody/ask */
router.post("/ask", askLimiter, wrap(async (req, res) => {
  const { question, threadId } = req.body || {};
  res.json(await kody.ask(req.auth.userId, { question, threadId: threadId ? Number(threadId) : null }));
}));

/* POST /api/kody/conversations/:id/ask  (the @kody path) */
router.post("/conversations/:id/ask", askLimiter, wrap(async (req, res) => {
  res.json(await kody.askInConversation(req.auth.userId, id(req), (req.body || {}).question));
}));

/* GET /api/kody/threads */
router.get("/threads", wrap(async (req, res) => {
  const { limit, offset } = req.query;
  res.json({ threads: await kody.listThreads(req.auth.userId, { limit, offset }) });
}));

/* GET /api/kody/threads/:id */
router.get("/threads/:id", wrap(async (req, res) => {
  res.json(await kody.getThread(id(req), req.auth.userId));
}));

/* POST /api/kody/messages/:id/feedback */
router.post("/messages/:id/feedback", wrap(async (req, res) => {
  const { vote, comment } = req.body || {};
  res.json(await kody.feedback(req.auth.userId, id(req), vote, comment));
}));

/* GET /api/kody/points */
router.get("/points", wrap(async (req, res) => {
  res.json(await kody.pointsBalance(req.auth.userId));
}));

/* GET /api/kody/codes?q=&set= */
router.get("/codes", wrap(async (req, res) => {
  const { q, set, limit } = req.query;
  res.json({ results: await codes.searchCodes(q, { codeSet: set || null, limit }) });
}));

/* GET /api/kody/codes/:code */
router.get("/codes/:code", wrap(async (req, res) => {
  const entries = await codes.lookupCode(String(req.params.code || "").slice(0, 20));
  if (entries.length === 0) {
    return res.status(404).json({ error: "not_found", message: "No current entry for that code." });
  }
  res.json({ entries });
}));

/* GET /api/kody/sme?status=open */
router.get("/sme", sme, wrap(async (req, res) => {
  const status = ["open", "resolved"].includes(req.query.status) ? req.query.status : "open";
  res.json({ items: await kody.smeQueue({ status, limit: req.query.limit }) });
}));

/* POST /api/kody/sme/:id/resolve */
router.post("/sme/:id/resolve", sme, wrap(async (req, res) => {
  const { resolution, title, domain, publish } = req.body || {};
  res.json(await kody.resolveSme(req.auth.userId, id(req), {
    resolution, title, domain, publish: publish === undefined ? true : !!publish,
  }));
}));

module.exports = router;
