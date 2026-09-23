"use strict";
const express = require("express");
const config = require("./config");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const authRoutes = require("./routes/auth.routes");
const usersRoutes = require("./routes/users.routes");
const { conversationRoutes, messageRoutes } = require("./routes/chat.routes");
const filesRoutes = require("./routes/files.routes");
const kodyRoutes = require("./routes/kody.routes");
const knowledgeRoutes = require("./routes/knowledge.routes");
const searchRoutes = require("./routes/search.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const adminRoutes = require("./routes/admin.routes");
const { redisHealthy } = require("./realtime/redis");
const { dadminServiceMiddleware } = require("./middleware/dadmin-service");   // dAI: docs/PHASES.md 1.2

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // Security headers. Helmet can replace this in module 15.
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  // CORS. The extension origin is chrome-extension://<id>, which is why the
  // allowlist is explicit rather than a wildcard.
  const origins = new Set([config.webUrl, config.publicUrl]);
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && (origins.has(origin) || /^chrome-extension:\/\//.test(origin) || /^moz-extension:\/\//.test(origin))) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Credentials", "true");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/health", (req, res) => res.json({ ok: true, service: "kody-api", env: config.env }));

  // Readiness: database, Redis and migrations. 503 when any fails, so a box
  // that cannot serve leaves rotation (docs/15-deployment.md).
  app.get("/health/ready", async (req, res) => {
    const out = { ok: true, db: { ok: false }, redis: null, migrations: { ok: false } };
    try {
      await db.query("SELECT 1");
      out.db.ok = true;
      const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql"));
      const [rows] = await db.query("SELECT filename FROM schema_migrations");
      const applied = new Set(rows.map(r => r.filename));
      const pending = files.filter(f => !applied.has(f));
      out.migrations = { ok: pending.length === 0, pending };
    } catch (err) {
      out.db.error = err.code || "db_error";
    }
    out.redis = await redisHealthy().catch(e => ({ configured: true, ok: false, note: e.message }));
    out.ok = out.db.ok && out.migrations.ok && out.redis.ok;
    res.status(out.ok ? 200 : 503).json(out);
  });

  // dAI: the dAdmin console calls these five, and only these five, with a short
  // lived service token (docs/PHASES.md 1.2). The whitelist is explicit and sits
  // before the routers, so a route added later is NOT reachable by a service
  // token unless someone adds it here on purpose. Every other route keeps user
  // tokens only. A request without a service token passes straight through.
  app.use("/api/admin", dadminServiceMiddleware);
  app.use("/api/knowledge", dadminServiceMiddleware);
  app.use("/api/kody/sme", dadminServiceMiddleware);
  app.use("/api/users/admin", dadminServiceMiddleware);
  app.post("/api/notifications/announce", dadminServiceMiddleware);

  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/conversations", conversationRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api", filesRoutes);            // /conversations/:id/files, /messages/:id/attachments, /files/:id
  app.use("/api/kody", kodyRoutes);
  app.use("/api/knowledge", knowledgeRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/admin", adminRoutes);

  app.use((req, res) => res.status(404).json({ error: "not_found", message: "No such endpoint." }));
  app.use((err, req, res, _next) => {
    console.error("unhandled:", err);
    res.status(500).json({ error: "server_error", message: "Something went wrong." });
  });

  return app;
}
module.exports = { createApp };
