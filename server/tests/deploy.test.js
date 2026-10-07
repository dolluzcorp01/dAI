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
const fs = require("node:fs");
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
    assert.match(err || "", /ALLOW_MOCK_MODEL=1/, "and says what to do if it is deliberate");
  });

  test("allows the mock provider when somebody says so on purpose", () => {
    // The pilot's first deploy proves nginx, pm2, MySQL, Redis, sign in and the
    // extension before a real key and a real bill are involved. The alternative
    // was NODE_ENV=development, which switches off every other guard in this
    // list, including the one that lets a local Kody password stand in for a
    // dAdmin one. Working around one guard by disabling six is a bad trade.
    const err = checkProd({ ...goodEnough, MODEL_PRIMARY_PROVIDER: "mock", ALLOW_MOCK_MODEL: "1" });
    assert.equal(err, null, "a deliberate plumbing deploy has to be possible");
  });

  test("the opt-in only covers the model, not the rest", () => {
    // It must not become a general "ignore the production guards" switch.
    const err = checkProd({
      ...goodEnough, MODEL_PRIMARY_PROVIDER: "mock", ALLOW_MOCK_MODEL: "1", REDIS_URL: "",
    });
    assert.match(err || "", /REDIS_URL/, "every other guard still applies");
  });

  test("refuses a memory mail or push transport", () => {
    assert.match(checkProd({ ...goodEnough, MAIL_DRIVER: "memory" }) || "", /memory transport/);
    assert.match(checkProd({ ...goodEnough, PUSH_DRIVER: "memory" }) || "", /memory transport/);
  });

  test("a properly configured production environment starts", () => {
    assert.equal(checkProd(goodEnough), null, "all guards pass with real settings");
  });

  /* dAI: the pilot runs with file sharing off (docs/16-pilot-runbook.md). */

  test("a pilot with file sharing off starts, with no Spaces and no ClamAV", () => {
    const pilot = {
      ...goodEnough,
      STORAGE_DRIVER: "none", FILE_SCANNER: "none",
      SPACES_ENDPOINT: "", SPACES_BUCKET: "", SPACES_ACCESS_KEY: "", SPACES_SECRET_KEY: "",
      CLAMAV_HOST: "",
      MAIL_DRIVER: "none", PUSH_DRIVER: "none",
    };
    assert.equal(checkProd(pilot), null,
      "a pilot without object storage, antivirus, mail or push has to be able to start");
  });

  test("file sharing on with no scanner is refused, which is the pair that matters", () => {
    // Turning storage back on and forgetting the scanner is one line, and it
    // would accept uploads with no antivirus at all.
    const err = checkProd({ ...goodEnough, STORAGE_DRIVER: "spaces", FILE_SCANNER: "none" });
    assert.match(err || "", /file sharing on and FILE_SCANNER=none/);
  });

  test("a scanner value nobody recognises is refused, not quietly treated as local", () => {
    // The old check refused the exact string "local", so FILE_SCANNER=off
    // passed it and then fell through to the local EICAR stub: the failure the
    // check existed to prevent, reached by a typo.
    for (const scanner of ["off", "disabled", "clam", ""]) {
      const err = checkProd({ ...goodEnough, FILE_SCANNER: scanner });
      assert.match(err || "", /FILE_SCANNER/, `FILE_SCANNER=${scanner} was accepted`);
    }
  });

  test("a storage driver nobody recognises is refused too", () => {
    for (const driver of ["off", "disabled", "s3", ""]) {
      const err = checkProd({ ...goodEnough, STORAGE_DRIVER: driver });
      assert.match(err || "", /STORAGE_DRIVER/, `STORAGE_DRIVER=${driver} was accepted`);
    }
  });

  /* dAI: single sign-on from Inside D (docs/17-portal-sso.md). */

  const PORTAL = {
    PORTAL_CLIENT_ID: "dai",
    PORTAL_CLIENT_SECRET: "portal-secret-" + "z".repeat(40),
    PORTAL_AUTHORIZE_URL: "https://inside.dolluzcorp.com/authorize",
    PORTAL_TOKEN_URL: "https://inside.dolluzcorp.com/oauth/token",
    PORTAL_REDIRECT_URI: "https://dai.dolluzcorp.com/extension/authorize",
  };

  test("portal sign-on all set starts, and none set starts, which is how it ships", () => {
    assert.equal(checkProd({ ...goodEnough, ...PORTAL }), null,
      "a fully configured portal handoff has to be able to start");
    assert.equal(checkProd(goodEnough), null,
      "and so does a box with no portal handoff at all, which is today");
  });

  test("portal sign-on half configured is refused, and says which half", () => {
    // Half is worse than none: the person is sent to Inside D and comes back to
    // an exchange that cannot work, after the redirect has already happened.
    for (const missing of Object.keys(PORTAL)) {
      const err = checkProd({ ...goodEnough, ...PORTAL, [missing]: "" });
      assert.match(err || "", /half configured/, `${missing} missing was accepted`);
      assert.match(err || "", new RegExp(missing), `the error did not name ${missing}`);
    }
  });

  test("the portal client secret may not be a signing secret", () => {
    // The reason dAI is outside dAdmin's shared-secret scheme at all: holding a
    // signing secret would let dAI mint a session as any employee in any dApp,
    // and a compromise of dAI would become a compromise of all of them. This
    // secret authenticates dAI to one endpoint and signs nothing.
    const cases = {
      JWT_ACCESS_SECRET: goodEnough.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: goodEnough.JWT_REFRESH_SECRET,
      DADMIN_SHARED_JWT_SECRET: "shared-with-dadmin-" + "q".repeat(30),
    };
    for (const [name, value] of Object.entries(cases)) {
      const err = checkProd({
        ...goodEnough, ...PORTAL,
        DADMIN_SHARED_JWT_SECRET: cases.DADMIN_SHARED_JWT_SECRET,
        PORTAL_CLIENT_SECRET: value,
      });
      assert.match(err || "", new RegExp(`same value as ${name}`),
        `PORTAL_CLIENT_SECRET = ${name} was accepted`);
    }
  });

  test("a short portal client secret is refused, with the command to make one", () => {
    const err = checkProd({ ...goodEnough, ...PORTAL, PORTAL_CLIENT_SECRET: "short" });
    assert.match(err || "", /PORTAL_CLIENT_SECRET is shorter/);
    assert.match(err || "", /openssl rand/, "and says how to generate one");
  });

  test("the two guards that are not about production fire in development too", () => {
    // They were production-only at first, which says it to the wrong person:
    // the place somebody wires portal sign-on up for the first time is a laptop.
    // https stays production-only, because a local Inside D over http is fine.
    const checkDev = (env) => {
      const saved = { ...process.env };
      try {
        delete process.env.NODE_ENV;
        Object.assign(process.env, { NODE_ENV: "development", ...env });
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

    assert.match(checkDev({ ...PORTAL, PORTAL_REDIRECT_URI: "" }) || "", /half configured/,
      "half configured passed in development");
    assert.match(
      checkDev({ ...PORTAL, JWT_ACCESS_SECRET: "E".repeat(44), PORTAL_CLIENT_SECRET: "E".repeat(44) }) || "",
      /same value as JWT_ACCESS_SECRET/, "a signing secret as the client secret passed in development");
    assert.equal(
      checkDev({ ...PORTAL, PORTAL_TOKEN_URL: "http://127.0.0.1:4999/oauth/token" }), null,
      "a local Inside D over http has to be usable on a laptop");
  });

  test("portal URLs must be https in production", () => {
    for (const key of ["PORTAL_AUTHORIZE_URL", "PORTAL_TOKEN_URL", "PORTAL_REDIRECT_URI"]) {
      const err = checkProd({
        ...goodEnough, ...PORTAL, [key]: PORTAL[key].replace("https://", "http://"),
      });
      assert.match(err || "", new RegExp(`non-https ${key}`), `http ${key} was accepted`);
    }
  });
});

describe("the deploy pins Node 22, because the box is not on it", () => {
  // The server runs Node 18 for twelve other dApps and 22 only for dAI. nvm's
  // default is deliberately the system Node, so nothing reaches 22 by accident.
  // That means dAI has to reach it on purpose, in both places that start it.
  const REPO = path.join(__dirname, "..", "..");
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

  test("pm2 is told which interpreter to use", () => {
    const eco = read("ecosystem.config.js");
    assert.match(eco, /interpreter:/,
      "without this pm2 launches dAI on whatever node means in its shell, which is 18");
    assert.match(eco, /DAI_NODE/, "the path should be overridable when nvm moves");
    assert.match(eco, /v22\./, "the default should name a Node 22 binary");
  });

  test("deploy.sh pins the path and refuses an older node", () => {
    const sh = read("deploy/deploy.sh");
    assert.match(sh, /DAI_NODE_BIN/, "deploy.sh does not pin a node");
    assert.match(sh, /PATH="\$DAI_NODE_BIN:\$PATH"/, "the pinned node is not put first");

    // The refusal matters more than the pin: Node 18 has no
    // --env-file-if-exists, so migrations would run with no environment and
    // fail in a way that reads like a database fault.
    // Asserting that a variable called NODE_VERSION exists would pass against a
    // script that assigns it a constant. What matters is that the version is
    // read from the node that is about to be used.
    const gate = sh.indexOf("node -v");
    const migrate = sh.indexOf("scripts/migrate.js");
    assert.ok(gate > 0, "deploy.sh never asks node what version it is");
    assert.ok(gate < migrate, "it checks the version after migrating, which is too late");
    assert.match(sh, /needs 22 or newer/);
    assert.match(sh, /v2\[2-9\]|v2[2-9]/, "there is no version comparison, only a message");
  });

  test("the engine requirement the pin exists to satisfy is still declared", () => {
    const pkg = JSON.parse(read("server/package.json"));
    assert.match(pkg.engines.node, /22/, "if this drops, the pin is guarding nothing");
  });
});

describe("deploying without installing on the box", () => {
  const sh = fs.readFileSync(
    path.join(__dirname, "..", "..", "deploy", "deploy.sh"), "utf8");

  test("there is a way to skip the install, because it peaks at 228 MB", () => {
    // The box is 1 vCPU and 1 GB shared with twelve other dApps. npm ci peaks
    // around 228 MB against 84 MB for the running app, so node_modules is built
    // elsewhere and copied. Nothing in the tree is compiled, which is what makes
    // that safe.
    assert.match(sh, /--skip-install/);
    assert.match(sh, /DAI_SKIP_INSTALL/, "and an environment variable for a deploy script");
  });

  test("skipping the install still checks the tree against the lockfile", () => {
    // Skipping the install must not mean skipping the question of whether the
    // tree is the right one. A copied node_modules that is stale or truncated
    // would otherwise be found at runtime, by an import failing.
    const at = sh.indexOf("SKIP_INSTALL");
    const block = sh.slice(sh.indexOf("if [ -n \"$SKIP_INSTALL\" ]"));
    assert.ok(at > 0);
    // Anchored to the start of a line, so a commented-out npm ls does not
    // satisfy it. The first version of this test matched anywhere, and passed
    // against a mutation that turned the check into a comment.
    assert.match(block.slice(0, 700), /^\s*npm ls --omit=dev/m,
      "a skipped install should still verify the tree satisfies package-lock.json");
    assert.match(block.slice(0, 700), /no node_modules to use/,
      "and say so plainly when there is nothing there at all");
  });

  test("the rollback does not install either", () => {
    // The rollback used to run npm ci regardless. That is the 228 MB spike this
    // arrangement exists to avoid, at the worst moment: a box already in
    // trouble, with a deploy failing. It happened on the box with 234 MB free.
    const rollback = sh.slice(sh.indexOf("Rolling the code back"));
    assert.ok(rollback.length > 0, "there is no rollback path");
    const install = rollback.indexOf("npm ci");
    const guard = rollback.indexOf("SKIP_INSTALL");
    assert.ok(guard > 0, "the rollback never looks at --skip-install");
    assert.ok(guard < install || install === -1,
      "the rollback installs before it checks whether it is allowed to");
  });

  test("it refuses to deploy from a detached HEAD", () => {
    // The worst failure of the set, because it is silent. git pull does nothing
    // on a detached HEAD, so the next deploy runs the OLD code while every step
    // reports success. It happened on the box because this script's own
    // rollback left the repository detached.
    // The CONDITION, not the message. Looking for the words "detached HEAD"
    // passes against a script whose guard has been turned off, because the
    // explanation is still sitting there in the echo lines.
    const guard = sh.search(/^if \[ -z "\$BRANCH" \]; then$/m);
    const backup = sh.indexOf("backup.sh");
    assert.ok(guard > 0, "nothing tests whether the checkout is on a branch");
    assert.ok(guard < backup, "it tests after it has started doing things");
    assert.match(sh, /symbolic-ref --short -q HEAD/, "that is how you ask");
    assert.match(sh, /die "refusing to deploy from a detached HEAD"/);
  });

  test("the rollback returns to the branch rather than detaching", () => {
    const rollback = sh.slice(sh.indexOf("Rolling the code back"));
    assert.match(rollback, /checkout --quiet "\$BRANCH"/,
      "git checkout <sha> is what caused this");
    assert.match(rollback, /reset --hard --quiet "\$PREVIOUS"/);
    assert.ok(!/checkout --quiet "\$PREVIOUS"/.test(rollback),
      "checking out a bare commit leaves the repository detached");
  });

  test("it says which commit it is deploying, at the start and the end", () => {
    // So "it ran the old code and said it worked" is visible in the output
    // rather than something you work out two deploys later.
    assert.match(sh, /say "Deploying \$\{PREVIOUS:0:12\} on \$\{BRANCH\}"/);
    assert.match(sh, /say "Deployed \$\{PREVIOUS:0:12\} on \$\{BRANCH\}/);
  });

  test("an unknown option stops it before anything happens", () => {
    const parse = sh.indexOf("unknown option");
    const backup = sh.indexOf("backup.sh");
    assert.ok(parse > 0, "a typo in a deploy flag should not be ignored");
    assert.ok(parse < backup, "and should be caught before it starts doing things");
  });
});

describe("the nginx site files", () => {
  const REPO = path.join(__dirname, "..", "..");
  const site = fs.readFileSync(path.join(REPO, "deploy/nginx/dai.dolluzcorp.com.conf"), "utf8");
  const stage1 = fs.readFileSync(
    path.join(REPO, "deploy/nginx/dai.dolluzcorp.com.http-only.conf"), "utf8");

  // Both files explain at length what they must not do, so the explanations
  // have to come out before grepping for the things they must not do.
  const directives = (conf) => conf
    .split(/\r?\n/)
    .filter(line => !/^\s*#/.test(line))
    .join(" | ");

  test("the challenge is served over http, ahead of the redirect", () => {
    // Certbot renews with the authenticator it first used. With webroot, every
    // renewal fetches /.well-known/acme-challenge/ over port 80. If the
    // redirect catches it first, Let's Encrypt follows to https, gets the 404,
    // and the renewal fails. Silently, and sixty days later.
    const challenge = site.indexOf(".well-known/acme-challenge");
    const redirect = site.indexOf("return 301 https:");
    assert.ok(challenge > 0, "the full site file does not serve the acme challenge");
    assert.ok(redirect > 0);
    assert.ok(challenge < redirect,
      "the redirect comes first, so renewals will fail when the certificate is 60 days old");
  });

  test("there is a stage that works before any certificate exists", () => {
    // nginx refuses to load an ssl listener with no certificate, so the full
    // file cannot be installed first and certbot --nginx cannot run against a
    // config that will not load.
    assert.ok(!/listen\s+443/.test(directives(stage1)),
      "the first stage must not listen on 443, or it needs a certificate to exist");
    assert.match(stage1, /\.well-known\/acme-challenge/);
    assert.ok(!/return 301 https:/.test(directives(stage1)),
      "redirecting to https before a certificate exists sends people to a dead port");
  });

  test("the full file names its certificate rather than commenting it out", () => {
    const active = site.split("\n").filter(l => /ssl_certificate/.test(l) && !/^\s*#/.test(l));
    assert.equal(active.length, 2, "ssl_certificate and ssl_certificate_key should both be live");
  });

  test("http2 is on the listen directive, for nginx 1.24", () => {
    // http2 on; arrived in 1.25.1 and is an unknown directive on the 1.24 that
    // Ubuntu 24.04 ships, which is what the box runs.
    assert.ok(!/http2\s+on;/.test(directives(site)), "http2 on; fails nginx -t on 1.24");
    assert.match(site, /listen\s+443\s+ssl\s+http2;/);
  });
});

describe("file sharing turned off", () => {
  const { createStorage, NoStorage } = require("../src/lib/storage");

  test("the none driver refuses rather than pretending to store", async () => {
    const storage = createStorage({ files: { driver: "none" } });
    assert.ok(storage instanceof NoStorage);
    await assert.rejects(() => storage.put("k", Buffer.from("x"), "text/plain"),
      (err) => err.status === 503 && err.code === "files_disabled");
    await assert.rejects(() => storage.get("k"),
      (err) => err.code === "files_disabled");
    // Removing something that was never stored is not an error worth raising.
    assert.equal(await storage.remove("k"), false);
  });

  test("an upload is refused before it is validated or scanned", async () => {
    // The refusal has to come first: a file that was scanned, validated and
    // written to a row before being dropped looks like a bug, not a policy.
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "services", "files.service.js"), "utf8");
    const upload = src.slice(src.indexOf("async function upload("));
    const refusal = upload.indexOf("files_disabled");
    const firstScan = upload.indexOf("scanner.scan");
    const firstNoFile = upload.indexOf("no_file");
    assert.ok(refusal > 0, "upload does not check whether file sharing is on");
    assert.ok(refusal < firstNoFile, "it validates the file before refusing");
    assert.ok(firstScan === -1 || refusal < firstScan, "it scans the file before refusing");
  });
});
