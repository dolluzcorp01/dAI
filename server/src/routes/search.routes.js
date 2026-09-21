"use strict";
const express = require("express");
const search = require("../services/search.service");
const { ValidationError } = require("../lib/validate");
const { authenticate, rateLimit } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

function handle(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.code, message: err.message, field: err.field });
  }
  if (err && err.status && err.code) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error("search error:", err);
  return res.status(500).json({ error: "server_error", message: "Something went wrong." });
}
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { handle(res, e); } };

// Search runs several queries per call, so it is limited per user.
const limiter = rateLimit({
  windowMs: 60000,
  max: Number(process.env.SEARCH_RATE_MAX || 120),
  keyFn: (req) => `search:${req.auth ? req.auth.userId : req.ip}`,
});

/* GET /api/search?q=... */
router.get("/", limiter, wrap(async (req, res) => {
  res.json(await search.global(req.auth.userId, req.query.q || "", { limit: req.query.limit }));
}));

/* GET /api/search/messages?q=&limit=&offset= */
router.get("/messages", limiter, wrap(async (req, res) => {
  res.json(await search.searchMessages(req.auth.userId, req.query.q || "", {
    limit: req.query.limit, offset: req.query.offset,
  }));
}));

router.get("/files", limiter, wrap(async (req, res) => {
  res.json(await search.searchFiles(req.auth.userId, req.query.q || "", { limit: req.query.limit }));
}));

router.get("/people", limiter, wrap(async (req, res) => {
  res.json(await search.searchPeople(req.query.q || "", { limit: req.query.limit }));
}));

router.get("/channels", limiter, wrap(async (req, res) => {
  res.json(await search.searchChannels(req.auth.userId, req.query.q || "", { limit: req.query.limit }));
}));

router.get("/answers", limiter, wrap(async (req, res) => {
  res.json(await search.searchKodyAnswers(req.auth.userId, req.query.q || "", { limit: req.query.limit }));
}));

/* GET /api/search/switch?q= - the Ctrl+K quick switcher */
router.get("/switch", limiter, wrap(async (req, res) => {
  res.json(await search.quickSwitch(req.auth.userId, req.query.q || "", { limit: req.query.limit }));
}));

/* saved searches */
router.get("/saved", wrap(async (req, res) => {
  res.json({ saved: await search.listSaved(req.auth.userId) });
}));

router.post("/saved", wrap(async (req, res) => {
  const { query, label } = req.body || {};
  res.status(201).json({ saved: await search.saveSearch(req.auth.userId, query, label) });
}));

router.delete("/saved/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "validation_failed", message: "id must be a number." });
  }
  const out = await search.deleteSaved(req.auth.userId, id);
  if (!out.deleted) return res.status(404).json({ error: "not_found", message: "Saved search not found." });
  res.json(out);
}));

module.exports = router;
