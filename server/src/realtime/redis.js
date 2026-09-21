"use strict";
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");
const config = require("../config");

/**
 * Multi-instance realtime.
 *
 * Socket.IO keeps its rooms in the memory of one process. With two API
 * instances behind a load balancer, a message sent by someone connected to
 * instance A never reaches someone connected to instance B. The symptom is
 * ugly and intermittent: messages arrive for some people and not others,
 * depending on which box their socket happened to land on.
 *
 * The Redis adapter fixes that by publishing room events over pub/sub. Both
 * instances then deliver to their own sockets.
 *
 * This is optional on purpose. A single instance does not need Redis, and
 * requiring it would make local development heavier for no benefit. But
 * production runs more than one instance, so `config.isProd()` refuses to
 * start without it.
 */

let pubClient = null;
let subClient = null;

async function createRedisAdapter() {
  if (!config.redis.url) return null;

  pubClient = createClient({
    url: config.redis.url,
    socket: {
      // Give up eventually rather than reconnecting forever in silence.
      reconnectStrategy: (retries) => (retries > 20 ? new Error("redis unreachable") : Math.min(retries * 200, 5000)),
    },
  });
  subClient = pubClient.duplicate();

  // A Redis outage must not take the API down. Realtime degrades to
  // single-instance behaviour, which is bad but not fatal, and it is loud.
  pubClient.on("error", (err) => console.error("redis pub error:", err.message));
  subClient.on("error", (err) => console.error("redis sub error:", err.message));

  await Promise.all([pubClient.connect(), subClient.connect()]);
  return createAdapter(pubClient, subClient);
}

async function closeRedis() {
  // Stop reconnecting before quitting, or the strategy fights the shutdown.
  for (const client of [pubClient, subClient]) {
    if (client) client.removeAllListeners("error");
  }
  const closing = [];
  if (pubClient && pubClient.isOpen) closing.push(pubClient.quit().catch(() => {}));
  if (subClient && subClient.isOpen) closing.push(subClient.quit().catch(() => {}));
  await Promise.all(closing);
  pubClient = null;
  subClient = null;
}

/** For the readiness probe: is the shared bus actually usable? */
async function redisHealthy() {
  if (!config.redis.url) return { configured: false, ok: true, note: "single instance" };
  if (!pubClient || !pubClient.isOpen) return { configured: true, ok: false, note: "not connected" };
  try {
    const started = Date.now();
    await pubClient.ping();
    return { configured: true, ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { configured: true, ok: false, note: err.message };
  }
}

module.exports = { createRedisAdapter, closeRedis, redisHealthy };
