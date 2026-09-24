"use strict";
const express = require("express");
const multer = require("multer");
const knowledge = require("../services/knowledge.service");
const codeimport = require("../services/codeimport.service");
const { ValidationError } = require("../lib/validate");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// Code files are text and can be large; 20 MB covers a full ICD-10-CM edition.
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
}).single("file");

const ctxOf = (req) => ({ ip: req.ip, userAgent: req.get("user-agent"), userId: req.auth.userId });

function handle(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.code, message: err.message, field: err.field });
  }
  if (err && err.status && err.code) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error("knowledge error:", err);
  return res.status(500).json({ error: "server_error", message: "Something went wrong." });
}
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { handle(res, e); } };

function id(req) {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError("id must be a number.", "id");
  return n;
}

// Authoring is open to SMEs and above. Publishing and importing are not.
// dAI: sub_admin authors too (docs/PHASES.md 1.1). Publishing decides what Kody
// tells people, and a licence record is a contractual claim about CPT and CDT,
// so both stay with admin.
const author = requireRole("admin", "super_admin", "coordinator", "sub_admin");
const publisher = requireRole("admin", "super_admin");

/* ---- documents ---- */

router.get("/docs", author, wrap(async (req, res) => {
  res.json(await knowledge.list(req.query));
}));

router.get("/docs/unused", author, wrap(async (req, res) => {
  res.json(await knowledge.unusedDocs({ limit: req.query.limit }));
}));

router.get("/stats", author, wrap(async (req, res) => {
  res.json(await knowledge.stats());
}));

router.post("/docs", author, wrap(async (req, res) => {
  res.status(201).json({ doc: await knowledge.create(req.auth.userId, req.body || {}, ctxOf(req)) });
}));

router.get("/docs/:id", author, wrap(async (req, res) => {
  res.json({ doc: await knowledge.get(id(req)) });
}));

router.get("/docs/:id/versions", author, wrap(async (req, res) => {
  res.json(await knowledge.versions(id(req)));
}));

router.patch("/docs/:id", author, wrap(async (req, res) => {
  res.json({ doc: await knowledge.update(req.auth.userId, id(req), req.body || {}, ctxOf(req)) });
}));

router.put("/docs/:id/status", publisher, wrap(async (req, res) => {
  res.json({ doc: await knowledge.setStatus(req.auth.userId, id(req), (req.body || {}).status, ctxOf(req)) });
}));

/* ---- code sets ---- */

router.get("/codesets", author, wrap(async (req, res) => {
  res.json({ codeSets: await codeimport.codeSetStatus() });
}));

router.get("/imports", author, wrap(async (req, res) => {
  res.json({ imports: await codeimport.importHistory(req.query.codeSet) });
}));

router.put("/codesets/:code/licence", publisher, wrap(async (req, res) => {
  const held = (req.body || {}).licenceRecorded;
  if (typeof held !== "boolean") {
    return res.status(400).json({ error: "validation_failed", message: "licenceRecorded must be true or false." });
  }
  res.json(await codeimport.setLicence(req.auth.userId, req.params.code, held));
}));

/**
 * Import. Defaults to a dry run: you must pass dryRun=false explicitly, because
 * a bad import silently corrupts every future tier 0 answer.
 */
router.post("/codesets/:code/import", publisher, (req, res) => {
  csvUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        return res.status(400).json({ error: "upload_failed", message: "Could not read the file." });
      }
      const body = req.body || {};
      const csv = req.file ? req.file.buffer.toString("utf8") : body.csv;
      if (!csv) return res.status(400).json({ error: "no_file", message: "Send a CSV file or a csv field." });

      const out = await codeimport.importCodes(req.auth.userId, {
        codeSet: req.params.code,
        csv,
        sourceName: req.file ? req.file.originalname : (body.sourceName || "inline"),
        effectiveFrom: body.effectiveFrom,
        dryRun: String(body.dryRun) !== "false",
        retireMissing: String(body.retireMissing) === "true",
      });
      res.json(out);
    } catch (err) { handle(res, err); }
  });
});

module.exports = router;
