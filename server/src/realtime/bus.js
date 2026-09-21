"use strict";
/**
 * A single place that holds the Socket.IO instance.
 *
 * REST handlers need to broadcast too: editing a message over HTTP must reach
 * everyone's open socket. Without this, a change made through the API would
 * only appear after a refresh, and the two paths would drift apart.
 *
 * Emitting is deliberately best effort. A broadcast failure must never roll
 * back a write that already succeeded.
 */

let io = null;

function setIo(instance) {
  io = instance;
}

function getIo() {
  return io;
}

const roomOf = (conversationId) => `conversation:${conversationId}`;
const userRoom = (userId) => `user:${userId}`;

/** Broadcast to everyone in a conversation. */
function toConversation(conversationId, event, payload) {
  if (!io) return false;
  try {
    io.to(roomOf(conversationId)).emit(event, payload);
    return true;
  } catch (err) {
    console.error("broadcast failed:", event, err.message);
    return false;
  }
}

/** Broadcast to every socket a single user has open. */
function toUser(userId, event, payload) {
  if (!io) return false;
  try {
    io.to(userRoom(userId)).emit(event, payload);
    return true;
  } catch (err) {
    console.error("user broadcast failed:", event, err.message);
    return false;
  }
}

/**
 * Move every socket a user has open into or out of a conversation room, so a
 * member added over HTTP starts receiving messages immediately.
 */
async function joinUserToConversation(userId, conversationId) {
  if (!io) return;
  try {
    const sockets = await io.in(userRoom(userId)).fetchSockets();
    sockets.forEach(s => s.join(roomOf(conversationId)));
  } catch (err) {
    console.error("join failed:", err.message);
  }
}

async function leaveUserFromConversation(userId, conversationId) {
  if (!io) return;
  try {
    const sockets = await io.in(userRoom(userId)).fetchSockets();
    sockets.forEach(s => s.leave(roomOf(conversationId)));
  } catch (err) {
    console.error("leave failed:", err.message);
  }
}

module.exports = {
  setIo, getIo, toConversation, toUser,
  joinUserToConversation, leaveUserFromConversation, roomOf, userRoom,
};
