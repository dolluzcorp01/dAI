"use strict";
/**
 * Module 15. The parts that only matter once there is more than one server.
 *
 * The centrepiece is a real two-instance test: two separate HTTP servers, two
 * Socket.IO gateways, one Redis. A message sent through instance A must reach
 * a socket connected to instance B. That is the failure the adapter exists to
 * prevent, and it is exercised rather than assumed.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";
// Set before any require, because config reads the environment at load time.
process.env.REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379";

const { io: ioClient } = require("socket.io-client");
const { createApp } = require("../src/app");
const { attachRealtime } = require("../src/realtime/gateway");
const { createRedisAdapter, closeRedis, redisHealthy } = require("../src/realtime/redis");
const { signRequest, uriEncode } = require("../src/lib/sigv4");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");

const REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379";
const PASSWORD = "Kody!Dev2026";

let instanceA, ioA, baseA, baseB, child, childUsesAdapter = false;
let shoban, pavithran, dmId;
let redisAvailable = false;

const api = async (base, method, p, body, token) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
};

const connect = (base, token) => new Promise((resolve, reject) => {
  const sock = ioClient(base, { auth: { token }, transports: ["websocket"], reconnection: false });
  const t = setTimeout(() => { sock.close(); reject(new Error("connect timeout")); }, 5000);
  sock.on("status", (s) => { if (s.state === "connected") { clearTimeout(t); resolve(sock); } });
  sock.on("connect_error", (e) => { clearTimeout(t); reject(e); });
});

const waitFor = (sock, event, ms = 4000) => new Promise((resolve) => {
  const t = setTimeout(() => { sock.off(event, h); resolve(null); }, ms);
  const h = (p) => { clearTimeout(t); sock.off(event, h); resolve(p); };
  sock.on(event, h);
});

const uid = () => "d-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);

before(async () => {
  // Instance A lives in this process.
  let adapterA = null;
  try {
    adapterA = await createRedisAdapter();
    redisAvailable = !!adapterA;
  } catch (err) {
    console.error("Redis not available:", err.message);
    redisAvailable = false;
  }

  instanceA = http.createServer(createApp());
  ioA = attachRealtime(instanceA, { adapter: adapterA });
  instanceA.listen(0);
  await new Promise(r => instanceA.once("listening", r));
  baseA = `http://127.0.0.1:${instanceA.address().port}`;

  // Instance B is a separate process, as a second box would be. In one process
  // the realtime bus singleton would make instance B replace instance A, and
  // the test would pass for the wrong reason.
  child = spawn(process.execPath, [path.join(__dirname, "helpers", "instance.js")], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const line = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("second instance did not start")), 15000);
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf("\n");
      if (nl !== -1) { clearTimeout(t); resolve(JSON.parse(buffer.slice(0, nl))); }
    });
    child.stderr.on("data", (c) => process.stderr.write(`[instance B] ${c}`));
    child.on("exit", (code) => { clearTimeout(t); reject(new Error(`instance B exited ${code}`)); });
  });
  assert.ok(line.port, "instance B reported a port");
  childUsesAdapter = !!line.adapter;
  baseB = `http://127.0.0.1:${line.port}`;

  for (const email of ["shoban@dolluzcorp.com", "pavithran@dolluzcorp.com"]) {
    const u = await db.one("SELECT id FROM users WHERE email = ?", [email]);
    await authSvc.setPassword(u.id, PASSWORD);
    await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [u.id]);
  }
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");

  const a = await api(baseA, "POST", "/api/auth/login",
    { email: "shoban@dolluzcorp.com", password: PASSWORD });
  const b = await api(baseB, "POST", "/api/auth/login",
    { email: "pavithran@dolluzcorp.com", password: PASSWORD });
  shoban = { token: a.body.accessToken, id: a.body.user.id };
  pavithran = { token: b.body.accessToken, id: b.body.user.id };

  const dm = await api(baseA, "POST", "/api/conversations/dm", { userId: pavithran.id }, shoban.token);
  dmId = dm.body.conversation.id;
});

after(async () => {
  // Order matters. Socket.IO's Redis adapter unsubscribes when the server
  // closes, so closing the clients first produces "the client is closed" from
  // activity that outlives the test.
  try { ioA.close(); } catch (_) {}
  instanceA.close();
  if (child) child.kill("SIGKILL");
  await new Promise(r => setTimeout(r, 300));
  await closeRedis().catch(() => {});
  await db.pool.end();
});

describe("two instances behind one Redis", () => {
  test("Redis is actually reachable for this run", async () => {
    assert.equal(redisAvailable, true,
      "these tests are meaningless without Redis; start one before running them");
    assert.equal(childUsesAdapter, true, "the second instance also joined the shared bus");
    const health = await redisHealthy();
    assert.equal(health.ok, true);
    assert.equal(health.configured, true);
  });

  test("a message sent on instance A reaches a socket on instance B", async () => {
    const listener = await connect(baseB, pavithran.token);
    const incoming = waitFor(listener, "message:new", 5000);

    const sent = await api(baseA, "POST", `/api/conversations/${dmId}/messages`,
      { body: "crossing between instances", clientMsgId: uid() }, shoban.token);
    assert.equal(sent.status, 201);

    const got = await incoming;
    assert.ok(got, "without the adapter this is exactly what silently fails");
    assert.equal(got.message.body, "crossing between instances");
    assert.equal(Number(got.message.seq), Number(sent.body.message.seq));

    listener.close();
  });

  test("and the other way round", async () => {
    const listener = await connect(baseA, shoban.token);
    const incoming = waitFor(listener, "message:new", 5000);

    await api(baseB, "POST", `/api/conversations/${dmId}/messages`,
      { body: "and back again", clientMsgId: uid() }, pavithran.token);

    const got = await incoming;
    assert.ok(got);
    assert.equal(got.message.body, "and back again");
    listener.close();
  });

  test("typing crosses instances too", async () => {
    const a = await connect(baseA, shoban.token);
    const b = await connect(baseB, pavithran.token);

    const seen = waitFor(b, "typing", 4000);
    a.emit("typing:start", { conversationId: dmId });

    const got = await seen;
    assert.ok(got, "typing is a room broadcast, so it needs the adapter as well");
    assert.equal(Number(got.userId), Number(shoban.id));

    a.close(); b.close();
  });

  test("a read receipt crosses instances", async () => {
    const a = await connect(baseA, shoban.token);
    const b = await connect(baseB, pavithran.token);

    const sent = await api(baseA, "POST", `/api/conversations/${dmId}/messages`,
      { body: "read me across boxes", clientMsgId: uid() }, shoban.token);

    const receipt = waitFor(a, "receipt", 5000);
    await new Promise((resolve) => b.emit("message:read",
      { conversationId: dmId, seq: sent.body.message.seq }, resolve));

    const got = await receipt;
    assert.ok(got, "the sender on A learns that B read it");
    assert.equal(Number(got.userId), Number(pavithran.id));

    a.close(); b.close();
  });

  test("a message still does not leak to a non-member on the other instance", async () => {
    const v = await db.one("SELECT id FROM users WHERE email = 'vignesh@dolluzcorp.com'");
    await authSvc.setPassword(v.id, PASSWORD);
    await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [v.id]);
    const login = await api(baseB, "POST", "/api/auth/login",
      { email: "vignesh@dolluzcorp.com", password: PASSWORD });

    const outsider = await connect(baseB, login.body.accessToken);
    const leak = waitFor(outsider, "message:new", 2500);

    await api(baseA, "POST", `/api/conversations/${dmId}/messages`,
      { body: "private across instances", clientMsgId: uid() }, shoban.token);

    assert.equal(await leak, null, "the adapter spreads rooms, not permissions");
    outsider.close();
  });
});

describe("SigV4 signing", () => {
  const vectorOpts = {
    accessKey: "AKIDEXAMPLE",
    secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "service",
    date: new Date(Date.UTC(2015, 7, 30, 12, 36, 0)),
    includeContentSha256: false,
  };

  test("matches the AWS get-vanilla test vector exactly", () => {
    const out = signRequest({ ...vectorOpts, method: "GET", host: "example.amazonaws.com", path: "/" });
    assert.equal(out.signature, "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    assert.equal(out.canonicalRequest,
      "GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\n" +
      "host;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("sorts query parameters as AWS requires", () => {
    const out = signRequest({
      ...vectorOpts, method: "GET", host: "example.amazonaws.com", path: "/",
      query: { Param2: "value2", Param1: "value1" },
    });
    assert.equal(out.canonicalQuery, "Param1=value1&Param2=value2");
    assert.equal(out.signature, "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500");
  });

  test("encodes the characters encodeURIComponent leaves alone", () => {
    assert.equal(uriEncode("a b"), "a%20b");
    assert.equal(uriEncode("a+b"), "a%2Bb");
    assert.equal(uriEncode("a/b"), "a%2Fb");
    assert.equal(uriEncode("a/b", false), "a/b");
    assert.equal(uriEncode("a~b-c.d_e"), "a~b-c.d_e", "the unreserved set stays literal");
    assert.equal(uriEncode("\u00e9"), "%C3%A9", "utf8 encoded byte by byte");
  });

  test("a different payload produces a different signature", () => {
    const empty = signRequest({ ...vectorOpts, method: "PUT", host: "h", path: "/k",
      payloadHash: crypto.createHash("sha256").update("").digest("hex") });
    const filled = signRequest({ ...vectorOpts, method: "PUT", host: "h", path: "/k",
      payloadHash: crypto.createHash("sha256").update("content").digest("hex") });
    assert.notEqual(empty.signature, filled.signature,
      "the body is part of what is signed, so it cannot be swapped in transit");
  });

  test("a different date produces a different signature", () => {
    const a = signRequest({ ...vectorOpts, method: "GET", host: "h", path: "/" });
    const b = signRequest({ ...vectorOpts, method: "GET", host: "h", path: "/",
      date: new Date(Date.UTC(2015, 7, 31, 12, 36, 0)) });
    assert.notEqual(a.signature, b.signature, "an old signature cannot be replayed");
  });
});

describe("the Spaces storage driver", () => {
  const withEnv = (fn) => {
    const saved = { ...process.env };
    try { return fn(); } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  };

  const loadStorage = (env) => {
    Object.assign(process.env, env);
    delete require.cache[require.resolve("../src/config")];
    delete require.cache[require.resolve("../src/lib/storage")];
    const storage = require("../src/lib/storage");
    const config = require("../src/config");
    return { storage, config };
  };

  test("refuses to construct without credentials, rather than failing at upload time", () => {
    withEnv(() => {
      const { storage, config } = loadStorage({
        STORAGE_DRIVER: "spaces", SPACES_ENDPOINT: "", SPACES_BUCKET: "",
        SPACES_REGION: "", SPACES_ACCESS_KEY: "", SPACES_SECRET_KEY: "",
      });
      assert.throws(() => storage.createStorage(config), /SPACES_/);
    });
  });

  test("constructs with credentials and builds the right object path", () => {
    withEnv(() => {
      const { storage, config } = loadStorage({
        STORAGE_DRIVER: "spaces",
        SPACES_ENDPOINT: "https://blr1.digitaloceanspaces.com",
        SPACES_BUCKET: "kody-files", SPACES_REGION: "blr1",
        SPACES_ACCESS_KEY: "AKIDEXAMPLE", SPACES_SECRET_KEY: "secret",
      });
      const s = storage.createStorage(config);
      assert.equal(s.host, "blr1.digitaloceanspaces.com");
      assert.equal(s._objectPath("2026/09/abc.pdf"), "/kody-files/2026/09/abc.pdf");
    });
  });

  test("refuses a key containing a traversal", () => {
    withEnv(() => {
      const { storage, config } = loadStorage({
        STORAGE_DRIVER: "spaces",
        SPACES_ENDPOINT: "https://blr1.digitaloceanspaces.com",
        SPACES_BUCKET: "kody-files", SPACES_REGION: "blr1",
        SPACES_ACCESS_KEY: "AKIDEXAMPLE", SPACES_SECRET_KEY: "secret",
      });
      const s = storage.createStorage(config);
      assert.throws(() => s._objectPath("../../etc/passwd"), /\.\./);
    });
  });

  test("never marks an object public", () => {
    const raw = require("node:fs").readFileSync(require.resolve("../src/lib/storage"), "utf8");
    // Strip comments first. A comment saying "never public-read" would
    // otherwise fail this test, which is the test catching its own notes.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
    assert.match(src, /"x-amz-acl": "private"/);
    assert.ok(!/public-read|public_read/.test(src),
      "an uploaded remittance is PHI and a public URL is a permanent leak");
  });
});

describe("production configuration guards", () => {
  const checkProd = (env) => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { NODE_ENV: "production", ...env });
      delete require.cache[require.resolve("../src/config")];
      require("../src/config");
      return null;
    } catch (err) {
      return err.message;
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      delete require.cache[require.resolve("../src/config")];
      require("../src/config");
    }
  };

  const goodEnough = {
    JWT_ACCESS_SECRET: "x".repeat(40), JWT_REFRESH_SECRET: "y".repeat(40),
    REDIS_URL: "redis://cache:6379", STORAGE_DRIVER: "spaces",
    SPACES_ENDPOINT: "https://blr1.digitaloceanspaces.com", SPACES_BUCKET: "b",
    SPACES_REGION: "blr1", SPACES_ACCESS_KEY: "k", SPACES_SECRET_KEY: "s",
    FILE_SCANNER: "clamav", CLAMAV_HOST: "clamav",
    MODEL_PRIMARY_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test",
    MAIL_DRIVER: "sendgrid", PUSH_DRIVER: "fcm",
  };

  test("refuses development JWT secrets", () => {
    const err = checkProd({ ...goodEnough, JWT_ACCESS_SECRET: "dev_access_secret_change_me" });
    assert.match(err || "", /development JWT secrets/);
  });

  test("refuses to run without Redis, which would silently drop messages", () => {
    const err = checkProd({ ...goodEnough, REDIS_URL: "" });
    assert.match(err || "", /REDIS_URL/);
  });

  test("refuses local disk storage, which is not shared and does not survive a redeploy", () => {
    const err = checkProd({ ...goodEnough, STORAGE_DRIVER: "local" });
    assert.match(err || "", /STORAGE_DRIVER=local/);
  });

  test("refuses the local file scanner, which is not antivirus", () => {
    const err = checkProd({ ...goodEnough, FILE_SCANNER: "local" });
    assert.match(err || "", /FILE_SCANNER=local/);
  });

  test("refuses the mock model provider", () => {
    const err = checkProd({ ...goodEnough, MODEL_PRIMARY_PROVIDER: "mock" });
    assert.match(err || "", /mock/);
  });

  test("refuses a memory mail or push transport", () => {
    assert.match(checkProd({ ...goodEnough, MAIL_DRIVER: "memory" }) || "", /memory transport/);
    assert.match(checkProd({ ...goodEnough, PUSH_DRIVER: "memory" }) || "", /memory transport/);
  });

  test("a properly configured production environment starts", () => {
    assert.equal(checkProd(goodEnough), null, "all guards pass with real settings");
  });
});
