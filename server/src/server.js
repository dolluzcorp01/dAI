"use strict";
const http = require("http");
const { createApp } = require("./app");
const config = require("./config");
const { pool } = require("./db");
const { attachRealtime } = require("./realtime/gateway");
const { createRedisAdapter, closeRedis } = require("./realtime/redis");

async function main() {
  // With REDIS_URL set, every instance shares Socket.IO rooms. Without it the
  // API runs as a single instance (config.js refuses that in production).
  const adapter = await createRedisAdapter();
  const server = http.createServer(createApp());
  const io = attachRealtime(server, { adapter });
  server.listen(config.port, () => {
    console.log(`Kody API listening on ${config.port} (${config.env})`);
    console.log(`Realtime gateway on ${config.socketPath}${adapter ? " with Redis adapter" : ""}`);
  });

  async function shutdown(signal) {
    console.log(`\n${signal} received, closing.`);
    try { io.close(); } catch (_) {}
    server.close(() => {});
    await closeRedis().catch(() => {});
    try { await pool.end(); } catch (_) {}
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => { console.error("failed to start:", err); process.exit(1); });
