"use strict";
const path = require("path");
const crypto = require("crypto");
const db = require("../db");
const config = require("../config");
const V = require("../lib/validate");
const { createStorage, keyFor } = require("../lib/storage");
const scanner = require("../lib/scanner");
const msgs = require("./messages.service");
const bus = require("../realtime/bus");
const { audit } = require("./auth.service");

class FileError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const storage = createStorage(config);

/**
 * Allowlist, not a blocklist. A blocklist is always one new extension behind.
 * Anything not listed here is refused.
 */
const ALLOWED = new Map([
  ["image/png", "image"], ["image/jpeg", "image"], ["image/gif", "image"], ["image/webp", "image"],
  ["video/mp4", "video"], ["video/webm", "video"], ["video/quicktime", "video"],
  ["audio/webm", "audio"], ["audio/mpeg", "audio"], ["audio/wav", "audio"], ["audio/ogg", "audio"],
  ["application/pdf", "file"],
  ["text/plain", "file"], ["text/csv", "file"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "file"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "file"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "file"],
  ["application/msword", "file"], ["application/vnd.ms-excel", "file"],
  ["application/zip", "file"],
]);

/**
 * Strip every path component and anything that could be interpreted by a
 * shell, a browser or a filesystem. This name is only ever displayed and used
 * in Content-Disposition, never to build a path.
 */
function safeName(original) {
  const base = path.basename(String(original || "file"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return (base || "file").slice(0, 200);
}

/**
 * Content-Type to send on download.
 *
 * HTML and SVG are served as octet-stream, because a browser renders them in
 * the origin of whoever opens the link, which turns an upload into stored XSS
 * against your own users.
 */
function safeContentType(mime) {
  if (/^text\/html/i.test(mime) || /svg/i.test(mime)) return "application/octet-stream";
  return ALLOWED.has(mime) ? mime : "application/octet-stream";
}

const humanSize = (bytes) => {
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb.toFixed(1)} MB`;
};

/**
 * Upload.
 *
 * Order matters: the row is written as `pending`, then scanned, then the
 * verdict is recorded. An infected file never becomes downloadable, because
 * the download handler checks the column rather than trusting the upload.
 */
async function upload(userId, conversationId, file, { versionOfId } = {}) {
  if (!file || !file.buffer) throw new FileError(400, "no_file", "No file was uploaded.");

  await msgs.membership(conversationId, userId).then(m => {
    if (!m) throw new FileError(403, "not_a_member", "You are not in this conversation.");
  });

  const mime = String(file.mimetype || "").split(";")[0].toLowerCase();
  if (!ALLOWED.has(mime)) {
    throw new FileError(415, "type_not_allowed", `Files of type ${mime || "unknown"} are not accepted.`);
  }
  const maxBytes = config.files.maxMb * 1024 * 1024;
  if (file.buffer.length > maxBytes) {
    throw new FileError(413, "too_large", `Files must be ${config.files.maxMb} MB or smaller.`);
  }
  if (file.buffer.length === 0) {
    throw new FileError(400, "empty_file", "That file is empty.");
  }

  const mediaKind = ALLOWED.get(mime);
  const fileName = safeName(file.originalname);
  const key = keyFor(mime);
  const checksum = crypto.createHash("sha256").update(file.buffer).digest("hex");

  if (versionOfId) {
    const prev = await db.one(
      `SELECT id FROM attachments WHERE id = ? AND conversation_id = ?`, [versionOfId, conversationId]
    );
    if (!prev) throw new FileError(400, "bad_version", "The previous version is not in this conversation.");
  }

  await storage.put(key, file.buffer);

  const [res] = await db.query(
    `INSERT INTO attachments
       (conversation_id, uploader_id, file_name, mime_type, media_kind,
        size_bytes, storage_key, checksum_sha256, scan_status, version_of_id)
     VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`,
    [conversationId, userId, fileName, mime, mediaKind,
     file.buffer.length, key, checksum, versionOfId || null]
  );
  const id = res.insertId;

  const { verdict, detail } = await scanner.scan(file.buffer, config);
  await db.query(`UPDATE attachments SET scan_status = ? WHERE id = ?`, [verdict, id]);

  if (verdict === scanner.VERDICT.INFECTED) {
    await storage.remove(key);          // do not keep the bytes around
    await db.query(`UPDATE attachments SET deleted_at = NOW() WHERE id = ?`, [id]);
    await audit(null, {
      actorId: userId, action: "file.infected_rejected", entityType: "attachment", entityId: id,
      meta: { fileName, detail },
    });
    throw new FileError(422, "infected", "That file was rejected by the malware scanner.");
  }

  return getOne(id);
}

async function getOne(id) {
  const row = await db.one(
    `SELECT id, conversation_id AS conversationId, message_id AS messageId,
            uploader_id AS uploaderId, file_name AS fileName, mime_type AS mimeType,
            media_kind AS mediaKind, size_bytes AS sizeBytes, scan_status AS scanStatus,
            version_of_id AS versionOfId, created_at AS createdAt
       FROM attachments WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  if (!row) return null;
  return { ...row, sizeBytes: Number(row.sizeBytes), size: humanSize(Number(row.sizeBytes)) };
}

/** Attach uploaded files to a message, inside the conversation they belong to. */
async function attachToMessage(userId, messageId, attachmentIds) {
  const ids = (Array.isArray(attachmentIds) ? attachmentIds : []).map(Number).filter(Number.isInteger);
  if (ids.length === 0) return { attached: 0 };
  if (ids.length > 10) throw new FileError(400, "too_many", "A maximum of 10 files per message.");

  const msg = await db.one(
    `SELECT id, conversation_id AS conversationId, sender_id AS senderId FROM messages WHERE id = ?`,
    [messageId]
  );
  if (!msg) throw new FileError(404, "not_found", "Message not found.");
  if (Number(msg.senderId) !== Number(userId)) {
    throw new FileError(403, "not_author", "You can only attach to your own message.");
  }

  const [res] = await db.query(
    `UPDATE attachments SET message_id = ?
      WHERE id IN (?) AND conversation_id = ? AND uploader_id = ?
            AND message_id IS NULL AND deleted_at IS NULL AND scan_status = 'clean'`,
    [messageId, ids, msg.conversationId, userId]
  );
  return { attached: res.affectedRows };
}

/**
 * Download. This is the gate: membership, then scan status. The schema cannot
 * enforce either, so both live here.
 */
async function openForDownload(userId, attachmentId) {
  const row = await db.one(
    `SELECT id, conversation_id AS conversationId, file_name AS fileName,
            mime_type AS mimeType, size_bytes AS sizeBytes,
            storage_key AS storageKey, scan_status AS scanStatus
       FROM attachments WHERE id = ? AND deleted_at IS NULL`,
    [attachmentId]
  );
  if (!row) throw new FileError(404, "not_found", "File not found.");

  const mem = await msgs.membership(row.conversationId, userId);
  if (!mem) throw new FileError(403, "not_a_member", "You are not in this conversation.");

  if (row.scanStatus === "pending") {
    throw new FileError(409, "scan_pending", "This file is still being scanned.");
  }
  if (row.scanStatus !== "clean") {
    throw new FileError(403, "not_clean", "This file is not available.");
  }
  if (!(await storage.exists(row.storageKey))) {
    throw new FileError(410, "gone", "The stored file is missing.");
  }

  return {
    stream: storage.createReadStream(row.storageKey),
    fileName: row.fileName,
    contentType: safeContentType(row.mimeType),
    sizeBytes: Number(row.sizeBytes),
  };
}

/** Per-space file browser. */
async function listForConversation(userId, conversationId, { kind, limit = 50, offset = 0 } = {}) {
  const mem = await msgs.membership(conversationId, userId);
  if (!mem) throw new FileError(403, "not_a_member", "You are not in this conversation.");

  const where = [`a.conversation_id = ?`, `a.deleted_at IS NULL`, `a.scan_status = 'clean'`];
  const params = [conversationId];

  if (kind && kind !== "all") {
    if (kind === "media") where.push(`a.media_kind IN ('image','video')`);
    else {
      where.push(`a.media_kind = ?`);
      params.push(V.oneOf(kind, "kind", ["image", "video", "audio", "file"]));
    }
  }

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);

  const [rows] = await db.query(
    `SELECT a.id, a.message_id AS messageId, a.file_name AS fileName, a.mime_type AS mimeType,
            a.media_kind AS mediaKind, a.size_bytes AS sizeBytes, a.created_at AS createdAt,
            a.version_of_id AS versionOfId,
            u.id AS uploaderId, u.full_name AS uploaderName
       FROM attachments a LEFT JOIN users u ON u.id = a.uploader_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  const total = await db.one(
    `SELECT COUNT(*) AS n FROM attachments a WHERE ${where.join(" AND ")}`, params
  );

  return {
    conversationId: Number(conversationId),
    files: rows.map(r => ({ ...r, sizeBytes: Number(r.sizeBytes), size: humanSize(Number(r.sizeBytes)) })),
    total: Number(total.n), limit: lim, offset: off,
  };
}

/** Version history for one file, newest first. */
async function versionsOf(userId, attachmentId) {
  const row = await db.one(
    `SELECT id, conversation_id AS conversationId FROM attachments WHERE id = ?`, [attachmentId]
  );
  if (!row) throw new FileError(404, "not_found", "File not found.");
  const mem = await msgs.membership(row.conversationId, userId);
  if (!mem) throw new FileError(403, "not_a_member", "You are not in this conversation.");

  const chain = [];
  let cursor = await db.one(
    `SELECT id, version_of_id AS versionOfId FROM attachments WHERE id = ?`, [attachmentId]
  );
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(await getOne(cursor.id));
    cursor = cursor.versionOfId
      ? await db.one(`SELECT id, version_of_id AS versionOfId FROM attachments WHERE id = ?`, [cursor.versionOfId])
      : null;
  }
  return { versions: chain.filter(Boolean) };
}

/** Soft delete. The uploader or a space owner. */
async function remove(userId, attachmentId, ctx = {}) {
  const row = await db.one(
    `SELECT id, conversation_id AS conversationId, uploader_id AS uploaderId, storage_key AS storageKey
       FROM attachments WHERE id = ? AND deleted_at IS NULL`,
    [attachmentId]
  );
  if (!row) throw new FileError(404, "not_found", "File not found.");
  const mem = await msgs.membership(row.conversationId, userId);
  if (!mem) throw new FileError(403, "not_a_member", "You are not in this conversation.");
  if (Number(row.uploaderId) !== Number(userId) && mem.memberRole !== "owner") {
    throw new FileError(403, "not_allowed", "Only the uploader or an owner can remove this.");
  }

  await db.query(`UPDATE attachments SET deleted_at = NOW() WHERE id = ?`, [attachmentId]);
  await storage.remove(row.storageKey);
  bus.toConversation(row.conversationId, "file:deleted", {
    conversationId: row.conversationId, attachmentId: Number(attachmentId),
  });
  await audit(null, {
    actorId: userId, action: "file.deleted", entityType: "attachment", entityId: attachmentId,
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { deleted: true };
}

module.exports = {
  FileError, upload, getOne, attachToMessage, openForDownload,
  listForConversation, versionsOf, remove, safeName, safeContentType, ALLOWED, storage,
};
