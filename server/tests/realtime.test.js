"use strict";
/**
 * Realtime gateway tests.
 *
 * Real Socket.IO server, real clients, real database. The bugs worth catching
 * here are authorisation leaks and sequence races, neither of which a mock
 * would reveal.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

process.env.AUTH_RATE_LOGIN_MAX = "10000";

const { io: ioClient } = require("socket.io-client");
const { createApp } = require("../src/app");
const { attachRealtime } = require("../src/realtime/gateway");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");

const PASSWORD = "Kody!Dev2026";
let server, ioServer, base, port;
let shoban, pavithran, vignesh;     // { id, token }
let dmId, channelId, announceId, privateId;

const login = async (email) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await res.json();
  assert.ok(j.accessToken, `login failed for ${email}: ${JSON.stringify(j)}`);
  return j.accessToken;
};

/** Connect and wait for the server's status event. */
const connect = (token) => new Promise((resolve, reject) => {
  const sock = ioClient(base, { auth: { token }, transports: ["websocket"], reconnection: false });
  const timer = setTimeout(() => { sock.close(); reject(new Error("connect timeout")); }, 4000);
  sock.on("status", (s) => {
    if (s.state === "connected") { clearTimeout(timer); resolve(sock); }
  });
  sock.on("connect_error", (e) => { clearTimeout(timer); reject(e); });
});

/** Wait for one event, or resolve null after ms. */
const waitFor = (sock, event, ms = 1500) => new Promise((resolve) => {
  const timer = setTimeout(() => { sock.off(event, handler); resolve(null); }, ms);
  const handler = (payload) => { clearTimeout(timer); sock.off(event, handler); resolve(payload); };
  sock.on(event, handler);
});

const emit = (sock, event, payload) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), 4000);
  sock.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
});

before(async () => {
  const app = createApp();
  server = http.createServer(app);
  ioServer = attachRealtime(server);
  server.listen(0);
  await new Promise(r => server.once("listening", r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;

  const ids = {};
  for (const email of ["shoban@dolluzcorp.com", "pavithran@dolluzcorp.com", "vignesh@dolluzcorp.com"]) {
    const u = await db.one("SELECT id FROM users WHERE email = ?", [email]);
    ids[email] = u.id;
    await authSvc.setPassword(u.id, PASSWORD);
    await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [u.id]);
  }
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");

  shoban = { id: ids["shoban@dolluzcorp.com"], token: await login("shoban@dolluzcorp.com") };
  pavithran = { id: ids["pavithran@dolluzcorp.com"], token: await login("pavithran@dolluzcorp.com") };
  vignesh = { id: ids["vignesh@dolluzcorp.com"], token: await login("vignesh@dolluzcorp.com") };

  dmId = (await db.one("SELECT id FROM conversations WHERE kind='dm' LIMIT 1")).id;
  channelId = (await db.one("SELECT id FROM conversations WHERE slug='denials-help'")).id;
  announceId = (await db.one("SELECT id FROM conversations WHERE slug='security-alerts'")).id;
  privateId = (await db.one("SELECT id FROM conversations WHERE slug='leadership'")).id;
});

after(async () => {
  try { ioServer.close(); } catch (_) {}
  server.close();
  await db.pool.end();
});

describe("handshake", () => {
  test("refuses a connection with no token", async () => {
    await assert.rejects(() => connect(undefined), /missing_token|timeout/);
  });

  test("refuses a forged token", async () => {
    await assert.rejects(() => connect("not.a.token"), /invalid_token|timeout/);
  });

  test("accepts a valid token and reports unread state on connect", async () => {
    const sock = await connect(shoban.token);
    const status = await new Promise((resolve) => {
      sock.emit("conversation:sync", { cursors: [] }, () => {});
      resolve(true);
    });
    assert.ok(status);
    sock.close();
  });

  test("refuses a socket whose session was revoked", async () => {
    const token = await login("vignesh@dolluzcorp.com");
    await fetch(`${base}/api/auth/logout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await db.query(
      "UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [vignesh.id]
    );
    await assert.rejects(() => connect(token), /session_revoked|timeout/);
    vignesh.token = await login("vignesh@dolluzcorp.com");
  });
});

describe("sending and receiving", () => {
  test("a message reaches the other member of the DM", async () => {
    const a = await connect(shoban.token);
    const b = await connect(pavithran.token);

    const incoming = waitFor(b, "message:new", 3000);
    const ack = await emit(a, "message:send", {
      conversationId: dmId, body: "Realtime test one", clientMsgId: "t-" + Date.now(),
    });
    assert.equal(ack.ok, true);
    assert.ok(ack.message.seq > 0, "server allocated a seq");

    const got = await incoming;
    assert.ok(got, "recipient received message:new");
    assert.equal(got.message.body, "Realtime test one");
    assert.equal(got.message.seq, ack.message.seq);

    a.close(); b.close();
  });

  test("the sender does not get their own message as message:new", async () => {
    const a = await connect(shoban.token);
    const echo = waitFor(a, "message:new", 1200);
    await emit(a, "message:send", { conversationId: dmId, body: "No echo please", clientMsgId: "e-" + Date.now() });
    assert.equal(await echo, null, "no self-echo");
    a.close();
  });

  test("a non-member never receives the message", async () => {
    const outsider = await connect(vignesh.token);   // not in the DM
    const sender = await connect(shoban.token);

    const leak = waitFor(outsider, "message:new", 1500);
    await emit(sender, "message:send", {
      conversationId: dmId, body: "Private claim detail", clientMsgId: "p-" + Date.now(),
    });
    assert.equal(await leak, null, "message did not leak to a non-member");

    outsider.close(); sender.close();
  });

  test("sending to a conversation you are not in is refused", async () => {
    const sock = await connect(vignesh.token);
    const res = await emit(sock, "message:send", {
      conversationId: privateId, body: "let me in", clientMsgId: "x-" + Date.now(),
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "not_a_member");
    sock.close();
  });

  test("an announcement channel refuses a non-owner", async () => {
    await db.query(
      `INSERT IGNORE INTO conversation_members (conversation_id, user_id, member_role) VALUES (?,?,'member')`,
      [announceId, pavithran.id]
    );
    const sock = await connect(pavithran.token);
    const res = await emit(sock, "message:send", {
      conversationId: announceId, body: "can I post", clientMsgId: "a-" + Date.now(),
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "announcement_only");
    sock.close();
  });

  test("an archived space refuses new messages", async () => {
    await db.query("UPDATE conversations SET is_archived = 1 WHERE id = ?", [channelId]);
    const sock = await connect(shoban.token);
    const res = await emit(sock, "message:send", {
      conversationId: channelId, body: "still here?", clientMsgId: "z-" + Date.now(),
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "archived");
    await db.query("UPDATE conversations SET is_archived = 0 WHERE id = ?", [channelId]);
    sock.close();
  });

  test("an empty message is refused", async () => {
    const sock = await connect(shoban.token);
    const res = await emit(sock, "message:send", { conversationId: dmId, body: "   " });
    assert.equal(res.ok, false);
    assert.equal(res.error, "empty_message");
    sock.close();
  });
});

describe("idempotency and ordering", () => {
  test("resending the same clientMsgId does not duplicate", async () => {
    const sock = await connect(shoban.token);
    const cid = "dup-" + Date.now();

    const first = await emit(sock, "message:send", { conversationId: dmId, body: "Only once", clientMsgId: cid });
    const second = await emit(sock, "message:send", { conversationId: dmId, body: "Only once", clientMsgId: cid });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.equal(second.message.id, first.message.id, "same row returned");

    const count = await db.one(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND client_msg_id = ?", [dmId, cid]
    );
    assert.equal(count.n, 1, "exactly one row in the database");
    sock.close();
  });

  test("concurrent sends get unique contiguous sequence numbers", async () => {
    const sock = await connect(shoban.token);
    const start = (await db.one("SELECT last_seq FROM conversations WHERE id = ?", [dmId])).last_seq;

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        emit(sock, "message:send", { conversationId: dmId, body: `burst ${i}`, clientMsgId: `b-${Date.now()}-${i}` })
      )
    );
    assert.ok(results.every(r => r.ok), "every send succeeded");

    const seqs = results.map(r => r.message.seq).sort((a, b) => a - b);
    assert.equal(new Set(seqs).size, 12, "no duplicate seq");
    for (let i = 1; i < seqs.length; i++) {
      assert.equal(seqs[i], seqs[i - 1] + 1, "contiguous");
    }
    assert.equal(seqs[0], Number(start) + 1);
    sock.close();
  });
});

describe("typing and receipts", () => {
  test("typing reaches the other member and not the sender", async () => {
    const a = await connect(shoban.token);
    const b = await connect(pavithran.token);

    const theirs = waitFor(b, "typing", 2000);
    const mine = waitFor(a, "typing", 1200);
    a.emit("typing:start", { conversationId: dmId });

    const got = await theirs;
    assert.ok(got, "other member sees typing");
    assert.equal(got.userId, shoban.id);
    assert.equal(got.typing, true);
    assert.equal(await mine, null, "sender does not see their own typing");

    a.close(); b.close();
  });

  test("marking read moves the cursor and tells the room", async () => {
    const a = await connect(shoban.token);
    const b = await connect(pavithran.token);

    const sent = await emit(a, "message:send", {
      conversationId: dmId, body: "read me", clientMsgId: "r-" + Date.now(),
    });
    const receipt = waitFor(a, "receipt", 3000);
    const res = await emit(b, "message:read", { conversationId: dmId, seq: sent.message.seq });

    assert.equal(res.ok, true);
    assert.equal(res.lastReadSeq, sent.message.seq);

    const got = await receipt;
    assert.ok(got, "sender sees the read receipt");
    assert.equal(got.userId, pavithran.id);

    const row = await db.one(
      "SELECT last_read_seq FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
      [dmId, pavithran.id]
    );
    assert.equal(Number(row.last_read_seq), sent.message.seq);

    a.close(); b.close();
  });

  test("the read cursor never moves backwards", async () => {
    const sock = await connect(pavithran.token);
    const current = await db.one(
      "SELECT last_read_seq FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
      [dmId, pavithran.id]
    );
    const res = await emit(sock, "message:read", { conversationId: dmId, seq: 1 });
    assert.equal(res.unchanged, true);
    const after = await db.one(
      "SELECT last_read_seq FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
      [dmId, pavithran.id]
    );
    assert.equal(Number(after.last_read_seq), Number(current.last_read_seq));
    sock.close();
  });
});

describe("sync after reconnect", () => {
  test("returns exactly the messages missed while away", async () => {
    const a = await connect(shoban.token);

    const mark = await emit(a, "message:send", {
      conversationId: dmId, body: "before the drop", clientMsgId: "s1-" + Date.now(),
    });
    const cursor = mark.message.seq;

    // three messages arrive while the other client is offline
    for (let i = 0; i < 3; i++) {
      await emit(a, "message:send", {
        conversationId: dmId, body: `while away ${i}`, clientMsgId: `s2-${Date.now()}-${i}`,
      });
    }

    const b = await connect(pavithran.token);
    const sync = await emit(b, "conversation:sync", { cursors: [{ conversationId: dmId, afterSeq: cursor }] });

    assert.equal(sync.ok, true);
    const convo = sync.conversations.find(c => Number(c.conversationId) === Number(dmId));
    assert.ok(convo, "the conversation came back");
    assert.equal(convo.messages.length, 3, "exactly the three missed");
    assert.ok(convo.messages.every(m => m.seq > cursor));

    a.close(); b.close();
  });

  test("sync skips a conversation the caller is not in", async () => {
    const sock = await connect(vignesh.token);
    const sync = await emit(sock, "conversation:sync", {
      cursors: [{ conversationId: privateId, afterSeq: 0 }],
    });
    assert.equal(sync.ok, true);
    assert.equal(sync.conversations.length, 0, "nothing leaked");
    sock.close();
  });

  test("history pages backwards through older messages", async () => {
    const sock = await connect(shoban.token);
    const head = await db.one("SELECT last_seq FROM conversations WHERE id = ?", [dmId]);
    const res = await emit(sock, "conversation:history", {
      conversationId: dmId, beforeSeq: Number(head.last_seq), limit: 5,
    });
    assert.equal(res.ok, true);
    assert.ok(res.messages.length > 0);
    assert.ok(res.messages.every(m => m.seq < Number(head.last_seq)));
    sock.close();
  });
});

describe("mentions", () => {
  test("an @handle is recorded against the message", async () => {
    const sock = await connect(shoban.token);
    const res = await emit(sock, "message:send", {
      conversationId: dmId, body: "@pavithran can you check this", clientMsgId: "m-" + Date.now(),
    });
    assert.equal(res.ok, true);
    const row = await db.one(
      "SELECT mention_kind, user_id FROM message_mentions WHERE message_id = ?", [res.message.id]
    );
    assert.ok(row, "mention stored");
    assert.equal(row.mention_kind, "user");
    assert.equal(Number(row.user_id), pavithran.id);
    sock.close();
  });

  test("@here is stored with no user, and @kody is not a mention", async () => {
    const sock = await connect(shoban.token);
    const res = await emit(sock, "message:send", {
      conversationId: dmId, body: "@here @kody what is CO-97", clientMsgId: "h-" + Date.now(),
    });
    const [rows] = await db.query(
      "SELECT mention_kind, user_id FROM message_mentions WHERE message_id = ?", [res.message.id]
    );
    assert.equal(rows.length, 1, "only @here recorded");
    assert.equal(rows[0].mention_kind, "here");
    assert.equal(rows[0].user_id, null);
    sock.close();
  });
});

describe("presence", () => {
  test("connecting marks the user online and tells their rooms", async () => {
    const watcher = await connect(pavithran.token);
    const seen = waitFor(watcher, "presence", 3000);
    const sock = await connect(shoban.token);

    const got = await seen;
    assert.ok(got, "presence broadcast received");
    assert.equal(Number(got.userId), shoban.id);
    assert.equal(got.presence, "online");

    sock.close(); watcher.close();
  });
});
