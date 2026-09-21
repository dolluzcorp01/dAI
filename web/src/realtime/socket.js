/**
 * Kody realtime client.
 *
 * THIS REPLACES `createKodySocket` IN kody_prototype_v10.jsx.
 *
 * The prototype's SEAM returned an object with `on`, `send`, `setConnected`
 * and `nextSeq`. This exposes the same surface plus the extra events the real
 * server sends, so the React code above the SEAM does not change.
 *
 * What it adds over the mock:
 *   - reconnect with backoff
 *   - a real offline queue that survives a drop and flushes on reconnect
 *   - resync from the last seq per conversation, so nothing is missed
 *   - optimistic sends reconciled by clientMsgId
 */
import { io } from "socket.io-client";
import { toUiMessage } from "../api/adapters.js";

export function createKodySocket({ baseUrl, getToken, onEvent, ctx = {} }) {
  const listeners = {};
  const queue = [];                 // sends made while offline
  const cursors = new Map();        // conversationId -> last seq we hold
  let socket = null;
  let connected = false;
  let disposed = false;

  const emit = (event, payload) => {
    (listeners[event] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
    if (onEvent) onEvent(event, payload);
  };

  const noteSeq = (conversationId, seq) => {
    const cur = cursors.get(conversationId) || 0;
    if (seq > cur) cursors.set(conversationId, seq);
  };

  async function connect() {
    if (disposed) return;
    const token = await getToken();
    if (!token) { emit("status", { state: "unauthenticated" }); return; }

    socket = io(baseUrl, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 8000,
      randomizationFactor: 0.4,
    });

    socket.on("connect", () => { connected = true; });

    socket.on("connect_error", (err) => {
      connected = false;
      // An expired token must not retry forever with the same credential.
      if (/invalid_token|session_revoked|missing_token|account_disabled/.test(err.message || "")) {
        socket.disconnect();
        emit("status", { state: "unauthenticated", reason: err.message });
        return;
      }
      emit("status", { state: "disconnected", reason: err.message });
    });

    socket.on("disconnect", (reason) => {
      connected = false;
      emit("status", { state: "disconnected", reason });
    });

    socket.on("status", async (payload) => {
      if (payload && payload.state === "connected") {
        connected = true;
        (payload.conversations || []).forEach(c => noteSeq(c.conversationId, Number(c.lastSeq)));
        emit("status", payload);
        await resync();
        await flushQueue();
      } else {
        emit("status", payload);
      }
    });

    socket.on("message:new", (p) => {
      if (p && p.message) noteSeq(p.message.conversationId, p.message.seq);
      emit("message:new", { message: toUiMessage(p.message, ctx), raw: p.message });
    });

    socket.on("message:ack", (p) => {
      if (p && p.message) noteSeq(p.message.conversationId, p.message.seq);
      emit("message:ack", { clientMsgId: p.clientMsgId, message: toUiMessage(p.message, ctx), raw: p.message });
    });

    socket.on("message:updated", (p) =>
      emit("message:updated", { message: toUiMessage(p.message, ctx), raw: p.message }));
    socket.on("message:deleted", (p) => emit("message:deleted", p));
    socket.on("message:reaction", (p) => emit("message:reaction", p));
    socket.on("message:pin", (p) => emit("message:pin", p));
    socket.on("receipt", (p) => emit("receipt", p));
    socket.on("typing", (p) => emit("typing", p));
    socket.on("presence", (p) => emit("presence", p));
    socket.on("conversation:added", (p) => emit("conversation:added", p));
    socket.on("conversation:removed", (p) => emit("conversation:removed", p));
    socket.on("conversation:updated", (p) => emit("conversation:updated", p));
    socket.on("conversation:deleted", (p) => emit("conversation:deleted", p));
    socket.on("member:added", (p) => emit("member:added", p));
    socket.on("member:removed", (p) => emit("member:removed", p));
    socket.on("file:deleted", (p) => emit("file:deleted", p));
  }

  /** Ask for everything that happened while we were away. */
  function resync() {
    return new Promise((resolve) => {
      if (!socket || cursors.size === 0) return resolve();
      const payload = {
        cursors: [...cursors.entries()].map(([conversationId, afterSeq]) => ({ conversationId, afterSeq })),
      };
      socket.emit("conversation:sync", payload, (res) => {
        if (res && res.ok) {
          for (const c of res.conversations || []) {
            for (const m of c.messages || []) {
              noteSeq(c.conversationId, m.seq);
              emit("message:new", { message: toUiMessage(m, ctx), raw: m, replayed: true });
            }
          }
        }
        resolve();
      });
    });
  }

  /**
   * Flush queued sends. Safe to retry because each carries its clientMsgId, so
   * the server returns the original rather than creating a duplicate.
   */
  async function flushQueue() {
    if (queue.length === 0) return;
    const pending = queue.splice(0, queue.length);
    for (const item of pending) {
      await new Promise((resolve) => {
        socket.emit("message:send", item.payload, (res) => {
          if (res && res.ok) {
            emit("message:ack", {
              clientMsgId: item.payload.clientMsgId,
              message: toUiMessage(res.message, ctx), raw: res.message, flushed: true,
            });
          } else {
            emit("message:failed", { clientMsgId: item.payload.clientMsgId, error: res && res.error });
          }
          resolve();
        });
      });
    }
    emit("queue:flushed", { count: pending.length });
  }

  return {
    connect,
    isConnected: () => connected,
    queueLength: () => queue.length,

    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return () => { listeners[event] = (listeners[event] || []).filter(f => f !== fn); };
    },

    /** Send, or queue it if we are offline. */
    send(payload, cb) {
      if (!connected || !socket) {
        queue.push({ payload });
        if (cb) cb({ ok: false, queued: true });
        emit("message:queued", { clientMsgId: payload.clientMsgId, queueLength: queue.length });
        return false;
      }
      socket.emit("message:send", payload, (res) => {
        if (res && res.ok) noteSeq(payload.conversationId, res.message.seq);
        if (cb) cb(res);
      });
      return true;
    },

    markRead(conversationId, seq, cb) {
      if (socket && connected) socket.emit("message:read", { conversationId, seq }, cb);
    },
    typing(conversationId, on) {
      if (socket && connected) socket.emit(on ? "typing:start" : "typing:stop", { conversationId });
    },
    setPresence(presence) {
      if (socket && connected) socket.emit("presence:set", { presence });
    },
    history(conversationId, beforeSeq, limit, cb) {
      if (socket && connected) socket.emit("conversation:history", { conversationId, beforeSeq, limit }, cb);
    },
    noteSeq,
    cursors: () => new Map(cursors),

    dispose() {
      disposed = true;
      if (socket) { socket.removeAllListeners(); socket.disconnect(); }
      socket = null; connected = false;
    },
  };
}
