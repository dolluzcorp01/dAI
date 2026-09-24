"use strict";
/**
 * Chat REST API. Conversations, membership, message mutations, and the
 * broadcasts that keep HTTP and socket clients in step.
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
let server, ioServer, base;
let shoban, pavithran, vignesh;
let channelId, dmId;

const api = async (method, path, body, token) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
};

const login = async (email) => {
  const r = await api("POST", "/api/auth/login", { email, password: PASSWORD });
  assert.ok(r.body.accessToken, `login failed for ${email}`);
  return r.body.accessToken;
};

const connect = (token) => new Promise((resolve, reject) => {
  const sock = ioClient(base, { auth: { token }, transports: ["websocket"], reconnection: false });
  const t = setTimeout(() => { sock.close(); reject(new Error("connect timeout")); }, 4000);
  sock.on("status", (s) => { if (s.state === "connected") { clearTimeout(t); resolve(sock); } });
  sock.on("connect_error", (e) => { clearTimeout(t); reject(e); });
});

const waitFor = (sock, event, ms = 2000) => new Promise((resolve) => {
  const t = setTimeout(() => { sock.off(event, h); resolve(null); }, ms);
  const h = (p) => { clearTimeout(t); sock.off(event, h); resolve(p); };
  sock.on(event, h);
});

const uid = () => "c-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);

before(async () => {
  server = http.createServer(createApp());
  ioServer = attachRealtime(server);
  server.listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

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
});

after(async () => {
  try { ioServer.close(); } catch (_) {}
  server.close();
  await db.pool.end();
});

describe("creating spaces", () => {
  test("creates a channel with the creator as owner", async () => {
    const r = await api("POST", "/api/conversations", {
      kind: "channel", name: "AR Rework " + Date.now(), topic: "Rework queue",
    }, shoban.token);
    assert.equal(r.status, 201);
    channelId = r.body.conversation.id;
    assert.equal(r.body.conversation.me.memberRole, "owner");
    assert.ok(r.body.conversation.slug.startsWith("ar-rework-"), "name slugified");
  });

  test("refuses a duplicate channel name", async () => {
    const name = "Duplicate Check " + Date.now();
    const first = await api("POST", "/api/conversations", { kind: "channel", name }, shoban.token);
    assert.equal(first.status, 201);
    const second = await api("POST", "/api/conversations", { kind: "channel", name }, shoban.token);
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "slug_taken");
  });

  test("creates a group with members", async () => {
    const r = await api("POST", "/api/conversations", {
      kind: "group", name: "Escalation huddle", memberIds: [pavithran.id, vignesh.id],
    }, shoban.token);
    assert.equal(r.status, 201);
    assert.equal(r.body.conversation.members.length, 3);
  });

  test("refuses a kind that is not group or channel", async () => {
    const r = await api("POST", "/api/conversations", { kind: "dm", name: "nope" }, shoban.token);
    assert.equal(r.status, 400);
  });

  test("opening a DM twice returns the same conversation", async () => {
    const a = await api("POST", "/api/conversations/dm", { userId: pavithran.id }, shoban.token);
    const b = await api("POST", "/api/conversations/dm", { userId: pavithran.id }, shoban.token);
    assert.equal(a.status, 200);
    assert.equal(a.body.conversation.id, b.body.conversation.id, "no duplicate DM created");
    dmId = a.body.conversation.id;
  });

  test("the other person sees the same DM from their side", async () => {
    const theirs = await api("POST", "/api/conversations/dm", { userId: shoban.id }, pavithran.token);
    assert.equal(theirs.body.conversation.id, dmId);
  });

  test("cannot open a DM with yourself", async () => {
    const r = await api("POST", "/api/conversations/dm", { userId: shoban.id }, shoban.token);
    assert.equal(r.status, 400);
  });
});

describe("visibility", () => {
  test("a private channel is invisible to a non-member", async () => {
    const priv = await db.one("SELECT id FROM conversations WHERE slug = 'leadership'");
    const r = await api("GET", `/api/conversations/${priv.id}`, null, vignesh.token);
    assert.equal(r.status, 404, "404 rather than 403, so its existence is not confirmed");
  });

  test("the browse directory excludes private channels", async () => {
    const r = await api("GET", "/api/conversations/directory", null, vignesh.token);
    assert.equal(r.status, 200);
    assert.ok(!r.body.channels.some(c => c.slug === "leadership"), "private channel not listed");
    assert.ok(r.body.channels.some(c => c.slug === "denials-help"), "public channel listed");
  });

  test("my list only contains conversations I am in", async () => {
    const r = await api("GET", "/api/conversations", null, vignesh.token);
    assert.equal(r.status, 200);
    assert.ok(!r.body.conversations.some(c => Number(c.id) === Number(dmId)), "someone else's DM is not listed");
  });

  test("a DM shows the other person's name", async () => {
    const r = await api("GET", "/api/conversations", null, shoban.token);
    const dm = r.body.conversations.find(c => Number(c.id) === Number(dmId));
    assert.ok(dm);
    assert.equal(dm.name, "Pavithran R");
  });
});

describe("space settings", () => {
  test("an owner can rename and set the topic", async () => {
    const r = await api("PATCH", `/api/conversations/${channelId}`, {
      topic: "Rework and resubmission", purpose: "Everything that bounced",
    }, shoban.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.conversation.topic, "Rework and resubmission");
  });

  test("a non-owner cannot change settings", async () => {
    await api("POST", `/api/conversations/${channelId}/members`, { userId: pavithran.id }, shoban.token);
    const r = await api("PATCH", `/api/conversations/${channelId}`, { topic: "hijacked" }, pavithran.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "owner_only");
  });

  test("rejects a retention value that is not offered", async () => {
    const r = await api("PATCH", `/api/conversations/${channelId}`, { retention: "10y" }, shoban.token);
    assert.equal(r.status, 400);
  });

  test("archiving blocks new messages, unarchiving restores them", async () => {
    await api("PATCH", `/api/conversations/${channelId}`, { isArchived: true }, shoban.token);
    const blocked = await api("POST", `/api/conversations/${channelId}/messages`,
      { body: "while archived", clientMsgId: uid() }, shoban.token);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, "archived");

    await api("PATCH", `/api/conversations/${channelId}`, { isArchived: false }, shoban.token);
    const ok = await api("POST", `/api/conversations/${channelId}/messages`,
      { body: "after unarchive", clientMsgId: uid() }, shoban.token);
    assert.equal(ok.status, 201);
  });

  test("announcement mode blocks a non-owner", async () => {
    await api("PATCH", `/api/conversations/${channelId}`, { isAnnouncement: true }, shoban.token);
    const r = await api("POST", `/api/conversations/${channelId}/messages`,
      { body: "can I speak", clientMsgId: uid() }, pavithran.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "announcement_only");
    await api("PATCH", `/api/conversations/${channelId}`, { isAnnouncement: false }, shoban.token);
  });

  test("my own mute and favourite are not owner-gated", async () => {
    const r = await api("PATCH", `/api/conversations/${channelId}/membership`, {
      isMuted: true, isFavourite: true, notifLevel: "mentions",
    }, pavithran.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.conversation.me.isMuted, true);
    assert.equal(r.body.conversation.me.notifLevel, "mentions");
  });

  test("favourites sort to the top of my list", async () => {
    const r = await api("GET", "/api/conversations", null, pavithran.token);
    assert.equal(Number(r.body.conversations[0].id), Number(channelId));
  });
});

describe("membership", () => {
  test("an owner can add and remove members", async () => {
    const add = await api("POST", `/api/conversations/${channelId}/members`, { userId: vignesh.id }, shoban.token);
    assert.equal(add.status, 200);
    assert.ok(add.body.members.some(m => Number(m.userId) === vignesh.id));

    const del = await api("DELETE", `/api/conversations/${channelId}/members/${vignesh.id}`, null, shoban.token);
    assert.equal(del.status, 200);
    assert.ok(!del.body.members.some(m => Number(m.userId) === vignesh.id));
  });

  test("a member cannot add people", async () => {
    const r = await api("POST", `/api/conversations/${channelId}/members`, { userId: vignesh.id }, pavithran.token);
    assert.equal(r.status, 403);
  });

  test("the last owner cannot be demoted or removed", async () => {
    const demote = await api("PUT", `/api/conversations/${channelId}/members/${shoban.id}/role`,
      { memberRole: "member" }, shoban.token);
    assert.equal(demote.status, 400);
    assert.equal(demote.body.error, "last_owner");

    const remove = await api("DELETE", `/api/conversations/${channelId}/members/${shoban.id}`, null, shoban.token);
    assert.equal(remove.status, 400);
  });

  test("promoting a second owner then demoting the first is allowed", async () => {
    const promote = await api("PUT", `/api/conversations/${channelId}/members/${pavithran.id}/role`,
      { memberRole: "owner" }, shoban.token);
    assert.equal(promote.status, 200);
    const demote = await api("PUT", `/api/conversations/${channelId}/members/${shoban.id}/role`,
      { memberRole: "member" }, shoban.token);
    assert.equal(demote.status, 200);
    await api("PUT", `/api/conversations/${channelId}/members/${shoban.id}/role`,
      { memberRole: "owner" }, pavithran.token);
  });

  test("anyone can join a public channel, nobody can join a private one", async () => {
    const pub = await db.one("SELECT id FROM conversations WHERE slug = 'coding-queries'");
    const priv = await db.one("SELECT id FROM conversations WHERE slug = 'leadership'");

    const ok = await api("POST", `/api/conversations/${pub.id}/join`, null, vignesh.token);
    assert.equal(ok.status, 200);

    const no = await api("POST", `/api/conversations/${priv.id}/join`, null, vignesh.token);
    assert.equal(no.status, 403);
    assert.equal(no.body.error, "private_channel");
  });

  test("leaving removes it from my list", async () => {
    const pub = await db.one("SELECT id FROM conversations WHERE slug = 'coding-queries'");
    const left = await api("POST", `/api/conversations/${pub.id}/leave`, null, vignesh.token);
    assert.equal(left.status, 200);
    const list = await api("GET", "/api/conversations", null, vignesh.token);
    assert.ok(!list.body.conversations.some(c => Number(c.id) === Number(pub.id)));
  });

  test("you cannot leave a direct message", async () => {
    const r = await api("POST", `/api/conversations/${dmId}/leave`, null, shoban.token);
    assert.equal(r.status, 400);
  });
});

describe("message mutations", () => {
  let msgId;

  test("posts a message over HTTP", async () => {
    const r = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "Original text", clientMsgId: uid() }, shoban.token);
    assert.equal(r.status, 201);
    msgId = r.body.message.id;
    assert.ok(r.body.message.seq > 0);
  });

  test("resending the same clientMsgId returns the original", async () => {
    const cid = uid();
    const a = await api("POST", `/api/conversations/${dmId}/messages`, { body: "Once only", clientMsgId: cid }, shoban.token);
    const b = await api("POST", `/api/conversations/${dmId}/messages`, { body: "Once only", clientMsgId: cid }, shoban.token);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.duplicate, true);
    assert.equal(b.body.message.id, a.body.message.id);
  });

  test("the author can edit, and it is marked edited", async () => {
    const r = await api("PATCH", `/api/messages/${msgId}`, { body: "Corrected text" }, shoban.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.message.body, "Corrected text");
    assert.ok(r.body.message.editedAt, "editedAt set");
  });

  test("nobody else can edit it", async () => {
    const r = await api("PATCH", `/api/messages/${msgId}`, { body: "not mine" }, pavithran.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "not_author");
  });

  test("reactions add and remove", async () => {
    const on = await api("POST", `/api/messages/${msgId}/reactions`, { emoji: "\u{1F44D}" }, pavithran.token);
    assert.equal(on.status, 200);
    assert.ok(on.body.message.reactions["\u{1F44D}"].includes(pavithran.id));

    const off = await api("DELETE", `/api/messages/${msgId}/reactions?emoji=${encodeURIComponent("\u{1F44D}")}`,
      null, pavithran.token);
    assert.equal(off.status, 200);
    assert.ok(!(off.body.message.reactions["\u{1F44D}"] || []).includes(pavithran.id));
  });

  test("reacting twice with the same emoji counts once", async () => {
    await api("POST", `/api/messages/${msgId}/reactions`, { emoji: "\u2705" }, pavithran.token);
    await api("POST", `/api/messages/${msgId}/reactions`, { emoji: "\u2705" }, pavithran.token);
    const row = await db.one(
      "SELECT COUNT(*) AS n FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
      [msgId, pavithran.id, "\u2705"]
    );
    assert.equal(row.n, 1);
  });

  test("pinning and listing pins", async () => {
    const pin = await api("PUT", `/api/messages/${msgId}/pin`, null, shoban.token);
    assert.equal(pin.status, 200);
    const list = await api("GET", `/api/conversations/${dmId}/pins`, null, pavithran.token);
    assert.ok(list.body.messages.some(m => Number(m.id) === Number(msgId)));

    await api("DELETE", `/api/messages/${msgId}/pin`, null, shoban.token);
    const after = await api("GET", `/api/conversations/${dmId}/pins`, null, pavithran.token);
    assert.ok(!after.body.messages.some(m => Number(m.id) === Number(msgId)));
  });

  test("a non-member cannot react, pin or read", async () => {
    for (const call of [
      api("POST", `/api/messages/${msgId}/reactions`, { emoji: "\u{1F525}" }, vignesh.token),
      api("PUT", `/api/messages/${msgId}/pin`, null, vignesh.token),
      api("GET", `/api/conversations/${dmId}/messages`, null, vignesh.token),
    ]) {
      const r = await call;
      assert.equal(r.status, 403, "outsider blocked");
    }
  });

  test("delete for me hides it only for me", async () => {
    const posted = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "Hide from me only", clientMsgId: uid() }, shoban.token);
    const target = posted.body.message.id;

    const del = await api("DELETE", `/api/messages/${target}?scope=me`, null, pavithran.token);
    assert.equal(del.status, 200);

    // dAI: read the tail, not the first 500. This DM grows every run, and once
    // it passed 500 messages a window from seq 0 no longer contained the message
    // the test had just posted.
    const from = Number(posted.body.message.seq) - 1;
    const mine = await api("GET", `/api/conversations/${dmId}/messages?afterSeq=${from}&limit=5`, null, pavithran.token);
    assert.ok(!mine.body.messages.some(m => Number(m.id) === Number(target)), "hidden for me");

    const theirs = await api("GET", `/api/conversations/${dmId}/messages?afterSeq=${from}&limit=5`, null, shoban.token);
    assert.ok(theirs.body.messages.some(m => Number(m.id) === Number(target)), "still visible to the author");
  });

  test("delete for everyone clears the body but keeps the slot", async () => {
    const posted = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "Delete me everywhere", clientMsgId: uid() }, shoban.token);
    const target = posted.body.message.id;
    const seq = posted.body.message.seq;

    const del = await api("DELETE", `/api/messages/${target}?scope=all`, null, shoban.token);
    assert.equal(del.status, 200);

    const row = await db.one("SELECT seq, body, deleted_for_all_at FROM messages WHERE id = ?", [target]);
    assert.equal(Number(row.seq), seq, "seq preserved so ordering is not broken");
    assert.equal(row.body, null, "body cleared");
    assert.ok(row.deleted_for_all_at);

    const edit = await api("PATCH", `/api/messages/${target}`, { body: "undelete" }, shoban.token);
    assert.equal(edit.status, 400, "cannot edit a deleted message");
  });

  test("a non-author member cannot delete for everyone, an owner can", async () => {
    const posted = await api("POST", `/api/conversations/${channelId}/messages`,
      { body: "owner will remove this", clientMsgId: uid() }, pavithran.token);
    const target = posted.body.message.id;

    await api("POST", `/api/conversations/${channelId}/members`, { userId: vignesh.id }, shoban.token);
    const nope = await api("DELETE", `/api/messages/${target}?scope=all`, null, vignesh.token);
    assert.equal(nope.status, 403);

    const yes = await api("DELETE", `/api/messages/${target}?scope=all`, null, shoban.token);
    assert.equal(yes.status, 200, "an owner can remove it");
  });
});

describe("threads and forwarding", () => {
  test("replies hang off a root message", async () => {
    const root = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "Thread root", clientMsgId: uid() }, shoban.token);
    const rootId = root.body.message.id;

    for (let i = 0; i < 2; i++) {
      await api("POST", `/api/conversations/${dmId}/messages`,
        { body: `reply ${i}`, threadParentId: rootId, clientMsgId: uid() }, pavithran.token);
    }
    const thread = await api("GET", `/api/messages/${rootId}/thread`, null, shoban.token);
    assert.equal(thread.status, 200);
    assert.equal(thread.body.replies.length, 2);
    assert.equal(Number(thread.body.root.id), Number(rootId));
  });

  test("forwarding copies into another conversation the sender belongs to", async () => {
    const src = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "Forward this one", clientMsgId: uid() }, shoban.token);
    const r = await api("POST", `/api/messages/${src.body.message.id}/forward`,
      { conversationId: channelId }, shoban.token);
    assert.equal(r.status, 201);
    assert.equal(r.body.message.body, "Forward this one");
    assert.equal(Number(r.body.message.conversationId), Number(channelId));
    assert.ok(r.body.message.forwardedFromId, "provenance recorded");
  });

  test("cannot forward into a conversation you are not in", async () => {
    const priv = await db.one("SELECT id FROM conversations WHERE slug = 'leadership'");
    const src = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "should not travel", clientMsgId: uid() }, shoban.token);
    const r = await api("POST", `/api/messages/${src.body.message.id}/forward`,
      { conversationId: priv.id }, shoban.token);
    assert.equal(r.status, 403);
  });
});

describe("drafts", () => {
  test("saves, lists and clears a draft", async () => {
    const save = await api("PUT", `/api/conversations/${dmId}/draft`, { body: "half written" }, shoban.token);
    assert.equal(save.status, 200);

    const list = await api("GET", "/api/conversations/drafts", null, shoban.token);
    assert.ok(list.body.drafts.some(d => Number(d.conversationId) === Number(dmId) && d.body === "half written"));

    await api("PUT", `/api/conversations/${dmId}/draft`, { body: "  " }, shoban.token);
    const after = await api("GET", "/api/conversations/drafts", null, shoban.token);
    assert.ok(!after.body.drafts.some(d => Number(d.conversationId) === Number(dmId)));
  });
});

describe("HTTP changes reach open sockets", () => {
  test("a message posted over HTTP arrives as message:new", async () => {
    const watcher = await connect(pavithran.token);
    const incoming = waitFor(watcher, "message:new", 3000);
    await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "posted over http", clientMsgId: uid() }, shoban.token);
    const got = await incoming;
    assert.ok(got, "socket client received it");
    assert.equal(got.message.body, "posted over http");
    watcher.close();
  });

  test("an edit over HTTP arrives as message:updated", async () => {
    const posted = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "will be edited", clientMsgId: uid() }, shoban.token);
    const watcher = await connect(pavithran.token);
    const incoming = waitFor(watcher, "message:updated", 3000);
    await api("PATCH", `/api/messages/${posted.body.message.id}`, { body: "edited over http" }, shoban.token);
    const got = await incoming;
    assert.ok(got);
    assert.equal(got.message.body, "edited over http");
    watcher.close();
  });

  test("a reaction over HTTP arrives as message:reaction", async () => {
    const posted = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "react to me", clientMsgId: uid() }, shoban.token);
    const watcher = await connect(pavithran.token);
    const incoming = waitFor(watcher, "message:reaction", 3000);
    await api("POST", `/api/messages/${posted.body.message.id}/reactions`, { emoji: "\u{1F389}" }, shoban.token);
    const got = await incoming;
    assert.ok(got);
    assert.equal(got.emoji, "\u{1F389}");
    watcher.close();
  });

  test("being added to a channel over HTTP starts delivering its messages", async () => {
    const sock = await connect(vignesh.token);
    const fresh = await api("POST", "/api/conversations",
      { kind: "channel", name: "Live join " + Date.now() }, shoban.token);
    const cid = fresh.body.conversation.id;

    const added = waitFor(sock, "conversation:added", 3000);
    await api("POST", `/api/conversations/${cid}/members`, { userId: vignesh.id }, shoban.token);
    assert.ok(await added, "told about the new channel");

    const incoming = waitFor(sock, "message:new", 3000);
    await api("POST", `/api/conversations/${cid}/messages`, { body: "welcome", clientMsgId: uid() }, shoban.token);
    const got = await incoming;
    assert.ok(got, "receives messages without reconnecting");
    sock.close();
  });
});

describe("input handling", () => {
  test("a non-numeric id is rejected rather than reaching SQL", async () => {
    const r = await api("GET", "/api/conversations/not-a-number", null, shoban.token);
    assert.equal(r.status, 400);
  });

  test("a conversation that does not exist is a 404", async () => {
    const r = await api("GET", "/api/conversations/999999", null, shoban.token);
    assert.equal(r.status, 404);
  });

  test("every chat route requires a token", async () => {
    for (const p of ["/api/conversations", "/api/conversations/directory", `/api/conversations/${dmId}/messages`]) {
      const r = await api("GET", p);
      assert.equal(r.status, 401, `${p} must require auth`);
    }
  });
});
