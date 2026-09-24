"use strict";
const express = require("express");
const svc = require("../services/users.service");
const { ValidationError } = require("../lib/validate");
const { AuthError } = require("../services/auth.service");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

const ctxOf = (req) => ({ ip: req.ip, userAgent: req.get("user-agent"), userId: req.auth.userId });

function handle(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.code, message: err.message, field: err.field });
  }
  if (err instanceof AuthError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error("users error:", err);
  return res.status(500).json({ error: "server_error", message: "Something went wrong." });
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { handle(res, err); }
};

/* ---------------- me ---------------- */

router.get("/me", wrap(async (req, res) => {
  res.json({ user: await svc.getUser(req.auth.userId), roles: req.auth.roles });
}));

router.patch("/me", wrap(async (req, res) => {
  res.json({ user: await svc.updateProfile(req.auth.userId, req.body, ctxOf(req)) });
}));

router.put("/me/presence", wrap(async (req, res) => {
  res.json({ user: await svc.setPresence(req.auth.userId, req.body || {}) });
}));

router.put("/me/status", wrap(async (req, res) => {
  res.json({ user: await svc.setStatus(req.auth.userId, req.body || {}) });
}));

router.get("/me/settings", wrap(async (req, res) => {
  res.json({ settings: await svc.getSettings(req.auth.userId) });
}));

router.patch("/me/settings", wrap(async (req, res) => {
  res.json({ settings: await svc.updateSettings(req.auth.userId, req.body) });
}));

router.put("/me/skills", wrap(async (req, res) => {
  res.json(await svc.setSkills(req.auth.userId, (req.body || {}).skills));
}));

/* ---------------- quick links ---------------- */

router.get("/me/quick-links", wrap(async (req, res) => {
  res.json({ links: await svc.listQuickLinks(req.auth.userId) });
}));

router.post("/me/quick-links", wrap(async (req, res) => {
  res.status(201).json({ link: await svc.addQuickLink(req.auth.userId, req.body || {}) });
}));

router.delete("/me/quick-links/:id", wrap(async (req, res) => {
  const out = await svc.deleteQuickLink(req.auth.userId, Number(req.params.id));
  if (!out.deleted) {
    return res.status(404).json({ error: "not_found", message: "Link not found." });
  }
  res.json(out);
}));

/* ---------------- directory ---------------- */

router.get("/", wrap(async (req, res) => {
  const { q, team, skill, presence, limit, offset } = req.query;
  res.json(await svc.directory({ q, team, skill, presence, limit, offset }));
}));

router.get("/teams", wrap(async (req, res) => {
  res.json({ teams: await svc.teams() });
}));

router.get("/skills", wrap(async (req, res) => {
  res.json({ skills: await svc.allSkills() });
}));

/* Express 5 removed inline regex in route params, so `/:id(\d+)` throws at
   startup. The id is validated here instead, and this route is declared after
   /teams and /skills so those literal paths match first. */
router.get("/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ error: "not_found", message: "User not found." });
  }
  const user = await svc.getUser(id);
  if (!user) return res.status(404).json({ error: "not_found", message: "User not found." });
  res.json({ user });
}));

/* ---------------- admin ---------------- */

const adminOnly = requireRole("admin", "super_admin");
// dAI: sub_admin reads the people list (docs/PHASES.md 1.1). Roles and
// activation stay with admin: someone who can grant roles can make themselves
// an admin, which would make the level meaningless.
const listOnly = requireRole("admin", "super_admin", "sub_admin");

router.get("/admin/list", listOnly, wrap(async (req, res) => {
  res.json(await svc.adminListUsers({
    includeInactive: req.query.includeInactive === "true",
    limit: req.query.limit, offset: req.query.offset,
  }));
}));

router.put("/admin/:id/roles", adminOnly, wrap(async (req, res) => {
  res.json(await svc.adminSetRoles(
    req.auth.userId, Number(req.params.id), (req.body || {}).roles, ctxOf(req)
  ));
}));

router.put("/admin/:id/active", adminOnly, wrap(async (req, res) => {
  const active = (req.body || {}).isActive;
  if (typeof active !== "boolean") {
    return res.status(400).json({ error: "validation_failed", message: "isActive must be true or false." });
  }
  res.json(await svc.adminSetActive(req.auth.userId, Number(req.params.id), active, ctxOf(req)));
}));

module.exports = router;
