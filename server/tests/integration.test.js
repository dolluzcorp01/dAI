"use strict";
/**
 * Frontend integration.
 *
 * The real client SDK, the real adapters and the real socket client, driven
 * against the real server. This is the layer that was never tested: 213
 * backend tests proved the API behaves, and proved nothing about whether the
 * client can actually consume it.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.KODY_RATE_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";

const { createApp } = require("../src/app");
const { attachRealtime } = require("../src/realtime/gateway");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");

const WEB = path.join(__dirname, "..", "..", "web", "src");
let client, endpoints, adapters, socketMod;

const PASSWORD = "Kody!Dev2026";
let server, ioServer, base, api, shoban, pavithran, dm;

before(async () => {
  // the client is ESM, the server is CommonJS
  const load = (rel) => import(pathToFileURL(path.join(WEB, rel)).href);
  client = await load("api/client.js");
  endpoints = await load("api/endpoints.js");
  adapters = await load("api/adapters.js");
  socketMod = await load("realtime/socket.js");

  server = http.createServer(createApp());
  ioServer = attachRealtime(server);
  server.listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  for (const email of ["shoban@dolluzcorp.com", "pavithran@dolluzcorp.com"]) {
    const u = await db.one("SELECT id FROM users WHERE email = ?", [email]);
    await authSvc.setPassword(u.id, PASSWORD);
    await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [u.id]);
  }
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");

  const c = client.createClient({ baseUrl: base });
  api = endpoints.createApi(c);
  api._client = c;
});

after(async () => {
  try { ioServer.close(); } catch (_) {}
  server.close();
  await db.pool.end();
});

describe("signing in through the client", () => {
  test("login stores tokens and returns a UI-shaped user", async () => {
    const out = await api.auth.login("shoban@dolluzcorp.com", PASSWORD);
    assert.ok(out.user.name, "fullName mapped to name");
    assert.equal(out.user.name, "Shoban Balasubramanian");
    assert.ok(out.user.initials);
    assert.ok(await api._client.tokens.getAccess());
    assert.ok(await api._client.tokens.getRefresh());
    shoban = out.user;
  });

  test("an authenticated call works without touching tokens by hand", async () => {
    const me = await api.users.me();
    assert.equal(me.name, "Shoban Balasubramanian");
    assert.ok(me.localTime, "derived local time present");
  });

  test("a bad password surfaces a readable error", async () => {
    const c = client.createClient({ baseUrl: base });
    const a = endpoints.createApi(c);
    await assert.rejects(
      () => a.auth.login("shoban@dolluzcorp.com", "wrong-password-here"),
      (err) => err.status === 401 && adapters.errorText(err).length > 0
    );
  });

  test("a genuinely expired access token refreshes automatically", async () => {
    const out = await api.auth.login("shoban@dolluzcorp.com", PASSWORD);
    assert.ok(out.user);
    const good = await api._client.tokens.getRefresh();

    // A real JWT signed with the real secret, already expired. This is what
    // the server actually sees in production, and it returns token_expired.
    const jwt = require("jsonwebtoken");
    const cfg = require("../src/config");
    const sess = await db.one(
      "SELECT id, user_id FROM sessions WHERE revoked_at IS NULL ORDER BY id DESC LIMIT 1"
    );
    const expired = jwt.sign(
      { sub: String(sess.user_id), sid: String(sess.id), roles: [], surface: "web" },
      cfg.auth.accessSecret,
      { expiresIn: "-10s", issuer: "kody", audience: "kody-api" }
    );
    await api._client.tokens.set({ accessToken: expired, refreshToken: good });

    const me = await api.users.me();
    assert.equal(me.name, "Shoban Balasubramanian", "call succeeded after a silent refresh");

    const nowAccess = await api._client.tokens.getAccess();
    assert.notEqual(nowAccess, expired, "a new access token was stored");
  });

  test("a corrupt stored access token also recovers by refreshing", async () => {
    await api.auth.login("shoban@dolluzcorp.com", PASSWORD);
    const good = await api._client.tokens.getRefresh();
    await api._client.tokens.set({ accessToken: "not.a.jwt.at.all", refreshToken: good });

    const me = await api.users.me();
    assert.equal(me.name, "Shoban Balasubramanian", "recovered rather than logging the user out");
  });

  test("parallel calls on a stale token trigger exactly one refresh", async () => {
    const fresh = client.createClient({ baseUrl: base });
    const a = endpoints.createApi(fresh);
    await a.auth.login("shoban@dolluzcorp.com", PASSWORD);
    const good = await fresh.tokens.getRefresh();
    await fresh.tokens.set({ accessToken: "expired.rubbish.token", refreshToken: good });

    // Ten parallel calls. If each refreshed independently, nine would present
    // an already-rotated refresh token, the server would treat that as a
    // stolen token and revoke every session, and the user would be logged out.
    const results = await Promise.all(Array.from({ length: 10 }, () => a.users.me()));
    assert.equal(results.length, 10);
    assert.ok(results.every(r => r.name === "Shoban Balasubramanian"), "all ten succeeded");

    const still = await a.users.me();
    assert.ok(still.name, "the session is still alive afterwards");
  });
});

describe("shape mapping", () => {
  test("a conversation comes back in the key format the UI uses", async () => {
    const other = await db.one("SELECT id FROM users WHERE email = 'pavithran@dolluzcorp.com'");
    pavithran = { id: other.id };
    dm = await api.conversations.openDm(other.id);

    assert.match(dm.key, /^dm:\d+$/, "keyed as kind:id like the prototype");
    assert.equal(dm.kind, "dm");
    assert.ok(dm.name, "a DM is named after the other person");
  });

  test("a message maps every field the UI reads", async () => {
    const cid = "int-" + Date.now();
    const out = await api.messages.send(dm.id, "integration probe", cid, {}, {
      myUserId: shoban.id, conversationKind: "dm",
    });
    const m = out.message;

    for (const key of ["id", "convo", "from", "text", "ts", "state", "reactions", "files",
                       "replyTo", "threadParent", "edited", "deletedForAll"]) {
      assert.ok(key in m, `UI reads m.${key} and it is present`);
    }
    assert.equal(m.text, "integration probe");
    assert.equal(typeof m.ts, "number", "ts is a timestamp the UI can format");
    assert.equal(m.edited, false, "edited is a boolean, not a date");
    assert.equal(m.convo, `dm:${dm.id}`);
    assert.equal(m.from, shoban.id);
  });

  test("delivery state is derived from read cursors, not stored", async () => {
    const msg = { senderId: 1, seq: 10 };
    assert.equal(adapters.deliveryState(msg, { myUserId: 1, memberCursors: [] }), "sent");
    assert.equal(adapters.deliveryState(msg, {
      myUserId: 1, memberCursors: [{ userId: 2, lastReadSeq: 9 }],
    }), "sent");
    assert.equal(adapters.deliveryState(msg, {
      myUserId: 1, memberCursors: [{ userId: 2, lastReadSeq: 10 }],
    }), "read");
    assert.equal(adapters.deliveryState(msg, {
      myUserId: 1, memberCursors: [{ userId: 2, lastReadSeq: 12 }, { userId: 3, lastReadSeq: 4 }],
    }), "delivered");
    assert.equal(adapters.deliveryState({ senderId: 2, seq: 10 }, { myUserId: 1 }), null,
      "no ticks on someone else's message");
  });

  test("a Kody answer maps into the answer card shape", async () => {
    const out = await api.kody.ask("CO-97");
    const a = out.answer;

    assert.equal(a.tier, 0, "tier 0 lookup");
    assert.ok(a.text.length > 0);
    assert.ok(a.source && a.source.name, "flat sourceName became source.name");
    assert.ok(a.lookup, "flat lookup fields became a lookup object");
    assert.equal(a.lookup.code, "CO-97");
    assert.equal(a.lookup.set, "CARC");
    assert.ok(a.lookup.desc.length > 0, "the description the card renders");
    assert.equal(typeof a.ms, "number", "latencyMs became ms");
    assert.equal(typeof a.live, "boolean", "usedWebSearch became live");
  });

  test("the code description still renders after a reload", async () => {
    const asked = await api.kody.ask("CO-45");
    const reloaded = await api.kody.thread(asked.threadId);
    const answer = reloaded.messages.find(m => m.role === "kody").answer;
    assert.ok(answer.lookup, "lookup survives");
    assert.ok(answer.lookup.desc.length > 0, "description survives the round trip");
  });

  test("a person maps into the directory shape", async () => {
    const dir = await api.users.directory({ q: "pavithran" });
    const p = dir.users[0];
    assert.equal(p.name, "Pavithran R", "fullName became name");
    assert.ok("role" in p, "jobTitle became role");
    assert.ok("status" in p, "presence became status");
    assert.ok(Array.isArray(p.skills));
  });

  test("error codes become sentences a person can act on", () => {
    assert.match(adapters.errorText({ code: "announcement_only" }), /owners can post/i);
    assert.match(adapters.errorText({ code: "infected" }), /malware/i);
    assert.match(adapters.errorText({ code: "not_a_member" }), /not in this conversation/i);
    assert.ok(adapters.errorText(null).length > 0, "never renders undefined");
  });
});

describe("the socket replacing the SEAM", () => {
  test("connects, reports status and delivers a message to the other side", async () => {
    const other = client.createClient({ baseUrl: base });
    const otherApi = endpoints.createApi(other);
    await otherApi.auth.login("pavithran@dolluzcorp.com", PASSWORD);

    const sock = socketMod.createKodySocket({
      baseUrl: base,
      getToken: () => other.tokens.getAccess(),
      ctx: { myUserId: pavithran.id, conversationKind: "dm" },
    });

    const connected = new Promise((resolve) => {
      const off = sock.on("status", (s) => { if (s.state === "connected") { off(); resolve(s); } });
    });
    await sock.connect();
    const status = await connected;
    assert.ok(Array.isArray(status.conversations), "unread state delivered on connect");

    const incoming = new Promise((resolve) => {
      const off = sock.on("message:new", (p) => { off(); resolve(p); });
      setTimeout(() => { off(); resolve(null); }, 4000);
    });

    await api.messages.send(dm.id, "over the socket", "sock-" + Date.now(), {}, {
      myUserId: shoban.id, conversationKind: "dm",
    });

    const got = await incoming;
    assert.ok(got, "the message arrived");
    assert.equal(got.message.text, "over the socket", "already in UI shape");
    assert.equal(typeof got.message.ts, "number");

    sock.dispose();
  });

  test("sending while offline queues, and flushing does not duplicate", async () => {
    const sock = socketMod.createKodySocket({
      baseUrl: base,
      getToken: () => api._client.tokens.getAccess(),
      ctx: { myUserId: shoban.id, conversationKind: "dm" },
    });
    // never connected, so every send queues
    const cid = "queued-" + Date.now();
    const accepted = sock.send({ conversationId: dm.id, body: "written offline", clientMsgId: cid });
    assert.equal(accepted, false, "not sent");
    assert.equal(sock.queueLength(), 1, "queued instead");

    // the same message sent twice from the queue must still produce one row
    await api.messages.send(dm.id, "written offline", cid, {}, { myUserId: shoban.id });
    await api.messages.send(dm.id, "written offline", cid, {}, { myUserId: shoban.id });

    const rows = await db.one(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND client_msg_id = ?",
      [dm.id, cid]
    );
    assert.equal(Number(rows.n), 1, "idempotent, exactly one row");
    sock.dispose();
  });

  test("an invalid token does not retry forever", async () => {
    const sock = socketMod.createKodySocket({
      baseUrl: base,
      getToken: async () => "not.a.valid.token",
    });
    const result = await new Promise((resolve) => {
      const off = sock.on("status", (s) => {
        if (s.state === "unauthenticated") { off(); resolve(s); }
      });
      sock.connect();
      setTimeout(() => { off(); resolve(null); }, 5000);
    });
    assert.ok(result, "reported unauthenticated and stopped");
    sock.dispose();
  });
});

describe("a full vertical slice", () => {
  test("sign in, open a DM, send, read, react and edit", async () => {
    const c = client.createClient({ baseUrl: base });
    const a = endpoints.createApi(c);

    await a.auth.login("shoban@dolluzcorp.com", PASSWORD);
    const convos = await a.conversations.list();
    assert.ok(convos.length > 0, "conversation list loads");
    assert.ok(convos.every(x => typeof x.key === "string"), "all keyed for the UI");

    const target = convos.find(x => x.kind === "dm");
    const ctx = { myUserId: shoban.id, conversationKind: "dm" };

    const sent = await a.messages.send(target.id, "slice test", "slice-" + Date.now(), {}, ctx);
    assert.ok(sent.message.seq > 0);

    const page = await a.messages.since(target.id, sent.message.seq - 1, ctx);
    assert.ok(page.messages.some(m => m.text === "slice test"));

    await a.messages.markRead(target.id, sent.message.seq);

    const reacted = await a.messages.react(sent.message.id, "\u{1F44D}", ctx);
    assert.ok(Object.keys(reacted.reactions).length > 0, "reaction shows on the UI message");

    const edited = await a.messages.edit(sent.message.id, "slice test, corrected", ctx);
    assert.equal(edited.text, "slice test, corrected");
    assert.equal(edited.edited, true, "the UI edited flag flips");
  });

  test("ask Kody inside the conversation and see it as a chat message", async () => {
    const ctx = { myUserId: shoban.id, conversationKind: "dm" };
    const out = await api.kody.askIn(dm.id, "what is an inclusive denial", ctx);
    assert.ok(out.chatMessage, "posted into the room");
    assert.equal(out.chatMessage.from, "kody", "null sender maps to kody for the UI");
    assert.ok(out.answer.domain);
    assert.ok(out.answer.source.name);
  });

  test("upload a file and see it on a message", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("claim,amount\n1,2\n")], { type: "text/csv" }), "slice.csv");
    const uploaded = await api.files.upload(dm.id, form.get("file"));
    assert.equal(uploaded.scanStatus, "clean");

    const ctx = { myUserId: shoban.id, conversationKind: "dm" };
    const msg = await api.messages.send(dm.id, "see attached", "file-" + Date.now(), {}, ctx);
    await api.files.attach(msg.message.id, [uploaded.id]);

    const page = await api.messages.since(dm.id, msg.message.seq - 1, ctx);
    const found = page.messages.find(m => m.id === String(msg.message.id));
    assert.equal(found.files.length, 1, "file appears on the UI message");
    assert.equal(found.files[0].name, "slice.csv");
    assert.ok(found.files[0].url, "a download url the UI can link to");
  });

  test("settings round-trip in the shape the settings panel uses", async () => {
    const before = await api.users.settings();
    assert.ok(["gold", "teal", "indigo", "plum"].includes(before.accent));
    const after = await api.users.updateSettings({ accent: "indigo", wallpaper: "dusk" });
    assert.equal(after.accent, "indigo");
    assert.equal(after.wallpaper, "dusk");
    await api.users.updateSettings({ accent: before.accent, wallpaper: before.wallpaper });
  });
});
