"use strict";
/**
 * After a chat message is persisted: notify the members.
 *
 * Written for dAI: notifications.service.notifyMessage existed but nothing
 * called it. Both send paths (REST and socket) call afterSend. Best effort by
 * design (docs/11-notifications.md): a notification failure never fails a send,
 * so the caller does not await this.
 */
const db = require("../db");

function afterSend(out) {
  if (!out || out.duplicate || !out.message) return;
  (async () => {
    const notify = require("../services/notifications.service");
    const conversation = await db.one(
      "SELECT id, kind, slug, name FROM conversations WHERE id = ?", [out.message.conversationId]
    );
    if (!conversation) return;
    await notify.notifyMessage({ message: out.message, conversation, mentions: out.mentions || {} });
  })().catch((err) => console.error("notification fan-out failed:", err.message));
}

module.exports = { afterSend };
