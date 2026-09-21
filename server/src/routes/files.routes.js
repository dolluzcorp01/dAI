"use strict";
const express = require("express");
const multer = require("multer");
const config = require("../config");
const files = require("../services/files.service");
const { ValidationError } = require("../lib/validate");
const { authenticate, rateLimit } = require("../middleware/auth");

/**
 * Files are buffered in memory so they can be scanned before anything is
 * written where it could be served. The multer limit is a hard stop at the
 * transport layer; the service checks again, because the two can drift.
 */
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.files.maxMb * 1024 * 1024,
    files: 1,
    fields: 5,
  },
}).single("file");

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
  console.error("files error:", err);
  return res.status(500).json({ error: "server_error", message: "Something went wrong." });
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { handle(res, err); }
};

function id(req, name = "id") {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${name} must be a number.`, name);
  return n;
}

/** Translate multer's own errors into the same shape as everything else. */
function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === "LIMIT_FILE_SIZE") {
        return reject(new files.FileError(413, "too_large",
          `Files must be ${config.files.maxMb} MB or smaller.`));
      }
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return reject(new files.FileError(400, "one_file_only",
          "Upload one file per request, in a field named file."));
      }
      reject(new files.FileError(400, "upload_failed", "Could not read the upload."));
    });
  });
}

const uploadLimiter = rateLimit({
  windowMs: 60000,
  max: Number(process.env.FILE_RATE_MAX || 30),
  keyFn: (req) => `upload:${req.auth ? req.auth.userId : req.ip}`,
});

/* POST /api/conversations/:id/files */
router.post("/conversations/:id/files", uploadLimiter, wrap(async (req, res) => {
  const conversationId = id(req);
  await runUpload(req, res);
  const out = await files.upload(req.auth.userId, conversationId, req.file, {
    versionOfId: req.body ? req.body.versionOfId : undefined,
  });
  res.status(201).json({ file: out });
}));

/* GET /api/conversations/:id/files */
router.get("/conversations/:id/files", wrap(async (req, res) => {
  res.json(await files.listForConversation(req.auth.userId, id(req), {
    kind: req.query.kind, limit: req.query.limit, offset: req.query.offset,
  }));
}));

/* POST /api/messages/:id/attachments */
router.post("/messages/:id/attachments", wrap(async (req, res) => {
  res.json(await files.attachToMessage(req.auth.userId, id(req), (req.body || {}).attachmentIds));
}));

/* GET /api/files/:id */
router.get("/files/:id", wrap(async (req, res) => {
  res.json({ file: await files.getOne(id(req)) });
}));

/* GET /api/files/:id/download */
router.get("/files/:id/download", wrap(async (req, res) => {
  const out = await files.openForDownload(req.auth.userId, id(req));

  // Always an attachment, never rendered inline, so an uploaded document can
  // never execute in the origin of whoever opens it.
  res.set("Content-Type", out.contentType);
  res.set("Content-Length", String(out.sizeBytes));
  res.set("Content-Disposition",
    `attachment; filename="${out.fileName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'; sandbox");
  res.set("Cache-Control", "private, no-store");

  out.stream.on("error", () => {
    if (!res.headersSent) res.status(500).json({ error: "read_failed", message: "Could not read the file." });
    else res.destroy();
  });
  out.stream.pipe(res);
}));

/* GET /api/files/:id/versions */
router.get("/files/:id/versions", wrap(async (req, res) => {
  res.json(await files.versionsOf(req.auth.userId, id(req)));
}));

/* DELETE /api/files/:id */
router.delete("/files/:id", wrap(async (req, res) => {
  res.json(await files.remove(req.auth.userId, id(req), ctxOf(req)));
}));

module.exports = router;
