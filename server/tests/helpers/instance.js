"use strict";
/**
 * Second API instance for tests/deploy.test.js. Runs in its own process, as a
 * second box would, and prints one JSON line: { port, adapter }.
 */
const http = require("http");
const { createApp } = require("../../src/app");
const { attachRealtime } = require("../../src/realtime/gateway");
const { createRedisAdapter } = require("../../src/realtime/redis");

(async () => {
  let adapter = null;
  try { adapter = await createRedisAdapter(); } catch (err) { console.error("redis:", err.message); }
  const server = http.createServer(createApp());
  attachRealtime(server, { adapter });
  server.listen(0, () => {
    process.stdout.write(JSON.stringify({ port: server.address().port, adapter: !!adapter }) + "\n");
  });
})();
