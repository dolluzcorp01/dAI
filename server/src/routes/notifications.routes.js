"use strict";
/**
 * Notification routes. Mounted at /api/notifications.
 *
 * Written for dAI: the bundle shipped notifications.service.js and the
 * endpoint table in docs/11-notifications.md but no router. Thin wrappers only.
 */
const express = require("express");
const notify = require("../services/notifications.service");
const { ValidationError } = require("../lib/validate");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

function handle(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.code, message: err.message, field: err.field });
  }
  if (err && err.status && err.code) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error("notifications error:", err);
  return res.status(500).json({ error: "server_error", message: "Something went wrong." });
}
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { handle(res, e); } };
const admin = requireRole("admin", "super_admin");

router.get("/", wrap(async (req, res) => {
  const { unreadOnly, limit, offset } = req.query;
  res.json(await notify.list(req.auth.userId, {
    unreadOnly: unreadOnly === "true" || unreadOnly === "1", limit, offset,
  }));
}));

router.put("/read", wrap(async (req, res) => {
  res.json(await notify.markRead(req.auth.userId, (req.body || {}).ids));
}));

router.put("/read-all", wrap(async (req, res) => {
  res.json(await notify.markAllRead(req.auth.userId));
}));

router.get("/digest/preview", wrap(async (req, res) => {
  const d = await notify.buildDigest(req.auth.userId);
  if (!d) return res.status(404).json({ error: "not_found", message: "No such user." });
  if (d.skipped) return res.json({ skipped: d.skipped });
  // The recipient address is not echoed back; the preview is about content.
  res.json({ count: d.count, subject: d.subject, text: d.text, includesMessageText: d.includesText });
}));

router.post("/announce", admin, wrap(async (req, res) => {
  res.json(await notify.announce(req.auth.userId, req.body || {}));
}));

router.post("/digest/run", admin, wrap(async (req, res) => {
  res.json(await notify.sendAllDigests());
}));

module.exports = router;
