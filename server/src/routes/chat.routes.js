"use strict";
const express = require("express");
const convos = require("../services/conversations.service");
const msgs = require("../services/messages.service");
const { ValidationError } = require("../lib/validate");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

const ctxOf = (req) => ({ ip: req.ip, userAgent: req.get("user-agent"), userId: req.auth.userId });

function handle(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.code, message: err.message, field: err.field });
  }
  if (err && err.status && err.code) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error("chat error:", err);
  return res.status(500).json({ error: "server_error", message: "Something went wrong." });
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { handle(res, err); }
};

/** Route params are numeric; reject anything else before it reaches SQL. */
function id(req, name = "id") {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) {
    const e = new ValidationError(`${name} must be a number.`, name);
    throw e;
  }
  return n;
}

/* ---------------- conversations ---------------- */

router.get("/", wrap(async (req, res) => {
  res.json({ conversations: await convos.listMine(req.auth.userId, {
    includeArchived: req.query.includeArchived === "true",
  })});
}));

router.get("/directory", wrap(async (req, res) => {
  res.json({ channels: await convos.directory(req.auth.userId, { q: req.query.q }) });
}));

router.get("/drafts", wrap(async (req, res) => {
  res.json({ drafts: await msgs.listDrafts(req.auth.userId) });
}));

router.post("/", wrap(async (req, res) => {
  res.status(201).json({ conversation: await convos.create(req.auth.userId, req.body || {}, ctxOf(req)) });
}));

router.post("/dm", wrap(async (req, res) => {
  const other = (req.body || {}).userId;
  res.json({ conversation: await convos.openDm(req.auth.userId, other, ctxOf(req)) });
}));

router.get("/:id", wrap(async (req, res) => {
  res.json({ conversation: await convos.get(id(req), req.auth.userId) });
}));

router.patch("/:id", wrap(async (req, res) => {
  res.json({ conversation: await convos.update(id(req), req.auth.userId, req.body || {}, ctxOf(req)) });
}));

router.delete("/:id", wrap(async (req, res) => {
  res.json(await convos.remove(id(req), req.auth.userId, ctxOf(req)));
}));

router.patch("/:id/membership", wrap(async (req, res) => {
  res.json({ conversation: await convos.updateMyMembership(id(req), req.auth.userId, req.body || {}) });
}));

router.post("/:id/join", wrap(async (req, res) => {
  res.json({ conversation: await convos.join(id(req), req.auth.userId) });
}));

router.post("/:id/leave", wrap(async (req, res) => {
  res.json(await convos.leave(id(req), req.auth.userId));
}));

/* ---------------- members ---------------- */

router.get("/:id/members", wrap(async (req, res) => {
  await convos.requireMember(id(req), req.auth.userId);
  res.json({ members: await convos.membersOf(id(req)) });
}));

router.post("/:id/members", wrap(async (req, res) => {
  const target = (req.body || {}).userId;
  res.json(await convos.addMember(id(req), req.auth.userId, target, ctxOf(req)));
}));

router.delete("/:id/members/:userId", wrap(async (req, res) => {
  res.json(await convos.removeMember(id(req), req.auth.userId, id(req, "userId"), ctxOf(req)));
}));

router.put("/:id/members/:userId/role", wrap(async (req, res) => {
  res.json(await convos.setMemberRole(
    id(req), req.auth.userId, id(req, "userId"), (req.body || {}).memberRole, ctxOf(req)
  ));
}));

/* ---------------- messages ---------------- */

router.get("/:id/messages", wrap(async (req, res) => {
  const cid = id(req);
  const { afterSeq, beforeSeq, limit } = req.query;
  if (beforeSeq !== undefined) {
    return res.json(await msgs.before(req.auth.userId, cid, beforeSeq, limit));
  }
  res.json(await msgs.since(req.auth.userId, cid, afterSeq || 0, limit));
}));

router.post("/:id/messages", wrap(async (req, res) => {
  const cid = id(req);
  const { body, clientMsgId, replyToId, threadParentId } = req.body || {};
  const out = await msgs.send(req.auth.userId, {
    conversationId: cid, body, clientMsgId, replyToId, threadParentId,
  });
  // The socket path emits message:new for its own sends; do the same here so
  // a message posted over HTTP reaches every open client.
  if (!out.duplicate) {
    require("../realtime/bus").toConversation(cid, "message:new", { message: out.message });
    require("../realtime/fanout").afterSend(out);   // dAI: notifications
  }
  res.status(out.duplicate ? 200 : 201).json(out);
}));

router.put("/:id/read", wrap(async (req, res) => {
  res.json(await msgs.markRead(req.auth.userId, id(req), (req.body || {}).seq));
}));

router.get("/:id/pins", wrap(async (req, res) => {
  res.json(await msgs.listPins(req.auth.userId, id(req)));
}));

router.put("/:id/draft", wrap(async (req, res) => {
  res.json(await msgs.saveDraft(req.auth.userId, id(req), (req.body || {}).body));
}));

/* ---------------- single message ---------------- */

const m = express.Router();
m.use(authenticate);

m.patch("/:id", wrap(async (req, res) => {
  res.json({ message: await msgs.edit(req.auth.userId, id(req), (req.body || {}).body) });
}));

m.delete("/:id", wrap(async (req, res) => {
  const scope = req.query.scope === "all" ? "all" : "me";
  res.json(scope === "all"
    ? await msgs.deleteForAll(req.auth.userId, id(req), ctxOf(req))
    : await msgs.deleteForMe(req.auth.userId, id(req)));
}));

m.post("/:id/reactions", wrap(async (req, res) => {
  res.json({ message: await msgs.react(req.auth.userId, id(req), (req.body || {}).emoji, true) });
}));

m.delete("/:id/reactions", wrap(async (req, res) => {
  const emoji = req.query.emoji || (req.body || {}).emoji;
  res.json({ message: await msgs.react(req.auth.userId, id(req), emoji, false) });
}));

m.put("/:id/pin", wrap(async (req, res) => {
  res.json(await msgs.pin(req.auth.userId, id(req), true));
}));

m.delete("/:id/pin", wrap(async (req, res) => {
  res.json(await msgs.pin(req.auth.userId, id(req), false));
}));

m.post("/:id/forward", wrap(async (req, res) => {
  const target = (req.body || {}).conversationId;
  res.status(201).json({ message: await msgs.forward(req.auth.userId, id(req), target) });
}));

m.get("/:id/thread", wrap(async (req, res) => {
  res.json(await msgs.threadOf(req.auth.userId, id(req)));
}));

module.exports = { conversationRoutes: router, messageRoutes: m };
