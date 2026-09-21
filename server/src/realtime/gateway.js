"use strict";
/**
 * Realtime gateway.
 *
 * This replaces `createKodySocket` in the v10 prototype. The client events and
 * payloads below are the contract the React code already expects, so the
 * prototype's SEAM function can be swapped for a socket.io-client that emits
 * and listens to exactly these names.
 *
 * Client to server            Server to client
 * -----------------------     ------------------------------
 * message:send                message:ack      (your own, with seq)
 * message:read                message:new      (someone else's)
 * typing:start                typing
 * typing:stop                 receipt          (read cursor moved)
 * conversation:sync           presence
 * conversation:history        status           (connected, error)
 *                             conversation:synced
 */
const { Server } = require("socket.io");
const db = require("../db");
const T = require("../lib/tokens");
const msgs = require("../services/messages.service");
const config = require("../config");
const bus = require("./bus");
const { afterSend } = require("./fanout");

const roomOf = (conversationId) => `conversation:${conversationId}`;
const userRoom = (userId) => `user:${userId}`;

/**
 * Handshake auth. Same rule as the HTTP middleware: verify the JWT AND check
 * the session is still live, so a revoked session cannot hold a socket open.
 */
async function authenticateSocket(socket, next) {
  try {
    const token =
      (socket.handshake.auth && socket.handshake.auth.token) ||
      (socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");

    if (!token) return next(new Error("missing_token"));

    let payload;
    try {
      payload = T.verifyAccessToken(token);
    } catch (_) {
      return next(new Error("invalid_token"));
    }

    const session = await db.one(
      `SELECT id, user_id, revoked_at, expires_at FROM sessions WHERE id = ?`, [payload.sid]
    );
    if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
      return next(new Error("session_revoked"));
    }

    const user = await db.one(
      `SELECT id, full_name AS fullName, is_active, deleted_at FROM users WHERE id = ?`,
      [payload.sub]
    );
    if (!user || !user.is_active || user.deleted_at) return next(new Error("account_disabled"));

    socket.data.userId = user.id;
    socket.data.sessionId = session.id;
    socket.data.roles = payload.roles || [];
    next();
  } catch (err) {
    next(new Error("auth_error"));
  }
}

function attachRealtime(httpServer, { adapter = null } = {}) {
  const io = new Server(httpServer, {
    path: config.socketPath || "/socket.io",
    serveClient: false,
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const ok = origin === config.webUrl || origin === config.publicUrl ||
          /^chrome-extension:\/\//.test(origin) || /^moz-extension:\/\//.test(origin);
        cb(null, ok);
      },
      credentials: true,
    },
    pingInterval: 20000,
    pingTimeout: 25000,
  });

  // dAI: multi-instance fan-out (docs/15-deployment.md) and REST broadcasts
  // through the shared bus (docs/06-chat-api.md).
  if (adapter) io.adapter(adapter);
  bus.setIo(io);

  io.use(authenticateSocket);

  io.on("connection", async (socket) => {
    const userId = socket.data.userId;

    try {
      // Own room for direct pushes, plus every conversation the user belongs to.
      socket.join(userRoom(userId));
      const ids = await msgs.conversationIdsFor(userId);
      ids.forEach(id => socket.join(roomOf(id)));

      await db.query(`UPDATE users SET presence = 'online', last_seen_at = NOW() WHERE id = ?`, [userId]);
      socket.to([...ids.map(roomOf)]).emit("presence", { userId, presence: "online" });

      socket.emit("status", {
        state: "connected",
        userId,
        conversations: await msgs.unreadSummary(userId),
      });
    } catch (err) {
      socket.emit("status", { state: "error", message: "Could not load your conversations." });
    }

    /* ---- send ---- */
    socket.on("message:send", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const { conversationId, body, clientMsgId, replyToId, threadParentId } = payload || {};
        const out = await msgs.send(userId, { conversationId, body, clientMsgId, replyToId, threadParentId });

        // The sender gets the acknowledgement, everyone else gets the message.
        reply({ ok: true, message: out.message, duplicate: out.duplicate });
        socket.emit("message:ack", { clientMsgId: clientMsgId || null, message: out.message });

        if (!out.duplicate) {
          socket.to(roomOf(conversationId)).emit("message:new", { message: out.message });
          afterSend(out);   // dAI: notifications
        }
      } catch (err) {
        const e = err && err.code
          ? { error: err.code, message: err.message }
          : { error: "send_failed", message: "Could not send that message." };
        reply({ ok: false, ...e });
        socket.emit("status", { state: "error", ...e });
      }
    });

    /* ---- read cursor ---- */
    socket.on("message:read", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const { conversationId, seq } = payload || {};
        const out = await msgs.markRead(userId, conversationId, seq);
        reply({ ok: true, ...out });
        if (!out.unchanged) {
          socket.to(roomOf(conversationId)).emit("receipt", {
            conversationId, userId, lastReadSeq: out.lastReadSeq,
          });
        }
      } catch (err) {
        reply({ ok: false, error: err.code || "read_failed", message: err.message });
      }
    });

    /* ---- typing ---- */
    const typingGuard = new Map();
    const typing = (on) => async (payload) => {
      const conversationId = payload && payload.conversationId;
      if (!conversationId) return;
      // Cheap throttle so a fast typist does not flood the room.
      const key = `${conversationId}:${on}`;
      const now = Date.now();
      if (typingGuard.get(key) && now - typingGuard.get(key) < 1500) return;
      typingGuard.set(key, now);

      const mem = await msgs.membership(conversationId, userId);
      if (!mem) return;
      socket.to(roomOf(conversationId)).emit("typing", { conversationId, userId, typing: on });
    };
    socket.on("typing:start", typing(true));
    socket.on("typing:stop", typing(false));

    /* ---- sync after a reconnect ---- */
    socket.on("conversation:sync", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const cursors = (payload && payload.cursors) || [];
        const out = [];
        for (const c of cursors.slice(0, 100)) {
          try {
            out.push(await msgs.since(userId, c.conversationId, c.afterSeq || 0));
          } catch (_) { /* skip conversations the user has left */ }
        }
        reply({ ok: true, conversations: out });
        socket.emit("conversation:synced", { conversations: out });
      } catch (err) {
        reply({ ok: false, error: "sync_failed", message: "Could not sync." });
      }
    });

    /* ---- older messages ---- */
    socket.on("conversation:history", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const { conversationId, beforeSeq, limit } = payload || {};
        reply({ ok: true, ...(await msgs.before(userId, conversationId, beforeSeq, limit)) });
      } catch (err) {
        reply({ ok: false, error: err.code || "history_failed", message: err.message });
      }
    });

    /* ---- presence ---- */
    socket.on("presence:set", async (payload) => {
      const allowed = ["online", "away", "busy", "dnd"];
      const presence = payload && payload.presence;
      if (!allowed.includes(presence)) return;
      await db.query(`UPDATE users SET presence = ?, last_seen_at = NOW() WHERE id = ?`, [presence, userId]);
      const ids = await msgs.conversationIdsFor(userId);
      socket.to(ids.map(roomOf)).emit("presence", { userId, presence });
    });

    socket.on("disconnect", async () => {
      try {
        // Only mark offline when this was the user's last open socket.
        const others = await io.in(userRoom(userId)).fetchSockets();
        if (others.length === 0) {
          await db.query(
            `UPDATE users SET presence = 'offline', last_seen_at = NOW() WHERE id = ?`, [userId]
          );
          const ids = await msgs.conversationIdsFor(userId);
          io.to(ids.map(roomOf)).emit("presence", { userId, presence: "offline" });
        }
      } catch (_) { /* shutting down */ }
    });
  });

  return io;
}

module.exports = { attachRealtime, authenticateSocket, roomOf, userRoom };
