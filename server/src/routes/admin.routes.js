"use strict";
const express = require("express");
const analytics = require("../services/analytics.service");
const reports = require("../services/reports.service");
const admin = require("../services/admin.service");
const { ValidationError } = require("../lib/validate");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// Everything in the console is admin only. Analytics included: question text
// and per-person usage are not things a member should be able to read.
//
// dAI: a dAdmin Sub Admin maps to Kody sub_admin (docs/PHASES.md 1.1), and gets
// the read-only panels of the console, named one by one below. Everything else
// stays admin only, so a route added to this router later is out of reach until
// someone adds it here on purpose. That is the property the single gate at the
// top exists to give, and it is kept: this is still one gate, with an allowlist.
const SUB_ADMIN_READ_ONLY = new Set([
  "GET /overview",
  "GET /analytics/fields",
  "GET /analytics/domains",
  "GET /analytics/tiers",
  "GET /analytics/models",
  "GET /analytics/unanswered",
  "GET /analytics/people",
  "GET /spaces",
  "GET /audit",
  "GET /audit/actions",
]);

function consoleAccess(req, res, next) {
  const roles = (req.auth && req.auth.roles) || [];
  if (roles.includes("admin") || roles.includes("super_admin")) return next();
  if (roles.includes("sub_admin") && SUB_ADMIN_READ_ONLY.has(`${req.method} ${req.path}`)) return next();
  return res.status(403).json({ error: "forbidden", message: "You do not have access to this." });
}
router.use(consoleAccess);

const ctxOf = (req) => ({ ip: req.ip, userAgent: req.get("user-agent"), userId: req.auth.userId });

function handle(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.code, message: err.message, field: err.field });
  }
  if (err && err.status && err.code) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error("admin error:", err);
  return res.status(500).json({ error: "server_error", message: "Something went wrong." });
}
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { handle(res, e); } };

function id(req, name = "id") {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${name} must be a number.`, name);
  return n;
}

/* ---- analytics ---- */

router.get("/overview", wrap(async (req, res) => {
  res.json(await analytics.overview());
}));

/* dAI: what every headline number means, so a dashboard cannot label one wrong
   without contradicting the API it came from. */
router.get("/analytics/fields", wrap(async (req, res) => {
  res.json({ fields: analytics.FIELD_GUIDE });
}));

router.get("/analytics/domains", wrap(async (req, res) => {
  res.json({ domains: await analytics.byDomain() });
}));

router.get("/analytics/tiers", wrap(async (req, res) => {
  res.json({ tiers: await analytics.byTier() });
}));

router.get("/analytics/models", wrap(async (req, res) => {
  res.json({ models: await analytics.byModel() });
}));

router.get("/analytics/unanswered", wrap(async (req, res) => {
  res.json({ unanswered: await analytics.unanswered({ limit: req.query.limit }) });
}));

router.get("/analytics/people", wrap(async (req, res) => {
  res.json({ people: await analytics.byPerson({ from: req.query.from, to: req.query.to }) });
}));

/* ---- reports ---- */

router.get("/reports", wrap(async (req, res) => {
  res.json({ reports: reports.catalogue(), contentExportAllowed: await reports.contentExportAllowed() });
}));

router.get("/reports/history", wrap(async (req, res) => {
  res.json({ runs: await reports.history({ limit: req.query.limit }) });
}));

/* The file itself. Streams as a download, and the run is audited. */
router.get("/reports/:code", wrap(async (req, res) => {
  const out = await reports.generate(req.auth.userId, {
    code: req.params.code,
    format: req.query.format || "xlsx",
    from: req.query.from,
    to: req.query.to,
  }, ctxOf(req));

  res.set("Content-Type", out.contentType);
  res.set("Content-Length", String(out.buffer.length));
  res.set("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "private, no-store");
  res.set("X-Kody-Rows", String(out.rowCount));
  res.send(out.buffer);
}));

/* ---- settings ---- */

router.get("/settings", wrap(async (req, res) => {
  res.json({ settings: await admin.listSettings() });
}));

router.patch("/settings", wrap(async (req, res) => {
  res.json(await admin.updateSettings(req.auth.userId, req.body, ctxOf(req)));
}));

/* ---- points ---- */

router.get("/points/rules", wrap(async (req, res) => {
  res.json(await admin.listPointRules());
}));

router.patch("/points/rules/:code", wrap(async (req, res) => {
  res.json(await admin.updatePointRule(req.auth.userId, req.params.code, req.body || {}, ctxOf(req)));
}));

/* ---- spaces ---- */

router.get("/spaces", wrap(async (req, res) => {
  res.json(await admin.allSpaces({
    includeArchived: req.query.includeArchived === "true",
    q: req.query.q, limit: req.query.limit, offset: req.query.offset,
  }));
}));

/* ---- sessions ---- */

router.get("/sessions", wrap(async (req, res) => {
  res.json({ sessions: await admin.allSessions({ limit: req.query.limit }) });
}));

router.delete("/sessions/:id", wrap(async (req, res) => {
  res.json(await admin.revokeSession(req.auth.userId, id(req), ctxOf(req)));
}));

/* ---- versions ---- */

router.get("/versions", wrap(async (req, res) => {
  res.json({ versions: await admin.listVersions() });
}));

router.post("/versions", wrap(async (req, res) => {
  res.status(201).json({ versions: await admin.publishVersion(req.auth.userId, req.body || {}, ctxOf(req)) });
}));

/* ---- default quick links ---- */

router.get("/quick-links", wrap(async (req, res) => {
  res.json({ links: await admin.listDefaultLinks() });
}));

router.post("/quick-links", wrap(async (req, res) => {
  res.status(201).json({ links: await admin.addDefaultLink(req.auth.userId, req.body || {}, ctxOf(req)) });
}));

router.delete("/quick-links/:id", wrap(async (req, res) => {
  res.json({ links: await admin.removeDefaultLink(req.auth.userId, id(req), ctxOf(req)) });
}));

/* ---- audit ---- */

router.get("/audit", wrap(async (req, res) => {
  res.json(await admin.auditLog(req.query));
}));

router.get("/audit/actions", wrap(async (req, res) => {
  res.json({ actions: await admin.auditActions() });
}));

module.exports = router;
