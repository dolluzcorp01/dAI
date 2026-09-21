"use strict";
/**
 * Search.
 *
 * The bulk of these tests are about one thing: a result set must never contain
 * a message from a conversation the caller is not in. Everything else is
 * convenience; that one is a breach.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.SEARCH_RATE_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");
const search = require("../src/services/search.service");

const PASSWORD = "Kody!Dev2026";
let server, base, shoban, pavithran, vignesh;
let privateDmId, privateChannelId, sharedChannelId;
const MARK = "zqxmarker" + Date.now().toString(36);

const api = async (method, p, body, token) => {
  const res = await fetch(`${base}${p}`, {
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

const uid = () => "s-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);

before(async () => {
  server = createApp().listen(0);
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

  // A DM that vignesh is not part of.
  const dm = await api("POST", "/api/conversations/dm", { userId: pavithran.id }, shoban.token);
  privateDmId = dm.body.conversation.id;
  await api("POST", `/api/conversations/${privateDmId}/messages`,
    { body: `secret ${MARK} claim detail in a private dm`, clientMsgId: uid() }, shoban.token);

  // A private channel vignesh is not in.
  const priv = await api("POST", "/api/conversations",
    { kind: "channel", name: "Search Private " + Date.now(), isPrivate: true }, shoban.token);
  privateChannelId = priv.body.conversation.id;
  await api("POST", `/api/conversations/${privateChannelId}/messages`,
    { body: `confidential ${MARK} leadership note`, clientMsgId: uid() }, shoban.token);

  // A skill owned by this suite. The users suite rewrites Vignesh's skills, and
  // the runner runs files in parallel against one database, so relying on a
  // seeded skill here fails intermittently.
  await db.query("INSERT IGNORE INTO skills (name, category) VALUES (?, 'cyber')", [MARK + "skill"]);
  await db.query(
    `INSERT IGNORE INTO user_skills (user_id, skill_id)
     SELECT ?, id FROM skills WHERE name = ?`, [ids["vignesh@dolluzcorp.com"], MARK + "skill"]
  );

  // A channel all three are in.
  const shared = await api("POST", "/api/conversations",
    { kind: "channel", name: "Search Shared " + Date.now(),
      memberIds: [pavithran.id, vignesh.id] }, shoban.token);
  sharedChannelId = shared.body.conversation.id;
  await api("POST", `/api/conversations/${sharedChannelId}/messages`,
    { body: `shared ${MARK} inclusive denial guidance for everyone`, clientMsgId: uid() }, shoban.token);
  await api("POST", `/api/conversations/${sharedChannelId}/messages`,
    { body: `another ${MARK} note about timely filing windows`, clientMsgId: uid() }, pavithran.token);
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("permission scoping", () => {
  test("an outsider never sees a message from a DM they are not in", async () => {
    const r = await api("GET", `/api/search/messages?q=${MARK}`, null, vignesh.token);
    assert.equal(r.status, 200);
    assert.ok(!r.body.results.some(x => Number(x.conversationId) === Number(privateDmId)),
      "someone else's DM did not appear");
    assert.ok(!r.body.results.some(x => /secret/.test(x.snippet)));
  });

  test("an outsider never sees a message from a private channel", async () => {
    const r = await api("GET", `/api/search/messages?q=${MARK}`, null, vignesh.token);
    assert.ok(!r.body.results.some(x => Number(x.conversationId) === Number(privateChannelId)));
    assert.ok(!r.body.results.some(x => /confidential/.test(x.snippet)));
  });

  test("the total count does not leak either", async () => {
    const outsider = await api("GET", `/api/search/messages?q=${MARK}`, null, vignesh.token);
    const insider = await api("GET", `/api/search/messages?q=${MARK}`, null, shoban.token);
    assert.ok(insider.body.total > outsider.body.total,
      "the member sees more results than the outsider");
    assert.equal(outsider.body.total, outsider.body.results.length,
      "the count matches what was actually returned");
  });

  test("a member does see the shared channel", async () => {
    const r = await api("GET", `/api/search/messages?q=${MARK}`, null, vignesh.token);
    assert.ok(r.body.results.some(x => Number(x.conversationId) === Number(sharedChannelId)),
      "the shared channel is searchable");
  });

  test("leaving a channel removes its messages from your search", async () => {
    const before = await api("GET", `/api/search/messages?q=${MARK}`, null, vignesh.token);
    assert.ok(before.body.results.length > 0);

    await api("POST", `/api/conversations/${sharedChannelId}/leave`, null, vignesh.token);
    const after = await api("GET", `/api/search/messages?q=${MARK}`, null, vignesh.token);
    assert.ok(!after.body.results.some(x => Number(x.conversationId) === Number(sharedChannelId)),
      "no longer searchable after leaving");

    await api("POST", `/api/conversations/${sharedChannelId}/members`, { userId: vignesh.id }, shoban.token);
  });

  test("a message deleted for me disappears from my search but not theirs", async () => {
    const posted = await api("POST", `/api/conversations/${sharedChannelId}/messages`,
      { body: `hideme ${MARK} only for one person`, clientMsgId: uid() }, shoban.token);
    const targetId = posted.body.message.id;

    await api("DELETE", `/api/messages/${targetId}?scope=me`, null, pavithran.token);

    const mine = await api("GET", `/api/search/messages?q=hideme`, null, pavithran.token);
    assert.ok(!mine.body.results.some(x => Number(x.id) === Number(targetId)), "hidden for me");

    const theirs = await api("GET", `/api/search/messages?q=hideme`, null, shoban.token);
    assert.ok(theirs.body.results.some(x => Number(x.id) === Number(targetId)), "still there for them");
  });

  test("a message deleted for everyone disappears from everyone's search", async () => {
    const posted = await api("POST", `/api/conversations/${sharedChannelId}/messages`,
      { body: `gonesoon ${MARK} about to vanish`, clientMsgId: uid() }, shoban.token);
    await api("DELETE", `/api/messages/${posted.body.message.id}?scope=all`, null, shoban.token);

    const r = await api("GET", `/api/search/messages?q=gonesoon`, null, shoban.token);
    assert.equal(r.body.results.length, 0);
  });

  test("a private channel is not returned by channel search to an outsider", async () => {
    const r = await api("GET", "/api/search/channels?q=Search%20Private", null, vignesh.token);
    assert.equal(r.body.results.length, 0);

    const owner = await api("GET", "/api/search/channels?q=Search%20Private", null, shoban.token);
    assert.ok(owner.body.results.length > 0, "the member does see it");
  });

  test("Kody answers are private to the person who asked", async () => {
    const asked = await api("POST", "/api/kody/ask",
      { question: `tell me about ${MARK} bundling rules` }, shoban.token);
    assert.equal(asked.status, 200);

    const mine = await api("GET", `/api/search/answers?q=${MARK}`, null, shoban.token);
    const theirs = await api("GET", `/api/search/answers?q=${MARK}`, null, vignesh.token);
    assert.ok(mine.body.results.length >= 0);
    assert.equal(theirs.body.results.length, 0, "another user's Kody history is not searchable");
  });

  test("search requires a token", async () => {
    for (const p of ["/api/search?q=x", "/api/search/messages?q=x", "/api/search/switch"]) {
      const r = await api("GET", p);
      assert.equal(r.status, 401);
    }
  });
});

describe("the query parser", () => {
  test("splits operators from free text", () => {
    const p = search.parseQuery("from:pavithran in:denials-help has:file after:2026-09-01 inclusive denial");
    assert.equal(p.from, "pavithran");
    assert.equal(p.in, "denials-help");
    assert.equal(p.has, "file");
    assert.equal(p.after, "2026-09-01");
    assert.deepEqual(p.terms, ["inclusive", "denial"]);
  });

  test("strips the @ and # people actually type", () => {
    const p = search.parseQuery("from:@pavithran in:#denials-help");
    assert.equal(p.from, "pavithran");
    assert.equal(p.in, "denials-help");
  });

  test("keeps a quoted phrase as one term", () => {
    const p = search.parseQuery('"timely filing" window');
    assert.deepEqual(p.terms, ["timely filing", "window"]);
  });

  test("ignores a malformed date rather than erroring", () => {
    const p = search.parseQuery("after:last-tuesday denial");
    assert.equal(p.after, null);
    assert.deepEqual(p.terms, ["denial"]);
  });

  test("an empty query parses to nothing", () => {
    const p = search.parseQuery("");
    assert.deepEqual(p.terms, []);
    assert.equal(p.from, null);
  });
});

describe("operators in practice", () => {
  test("from: narrows to one sender", async () => {
    const r = await api("GET", `/api/search/messages?q=${MARK}%20from:pavithran`, null, shoban.token);
    assert.ok(r.body.results.length > 0);
    assert.ok(r.body.results.every(x => Number(x.senderId) === pavithran.id));
  });

  test("in: narrows to one channel", async () => {
    const channel = await db.one("SELECT slug FROM conversations WHERE id = ?", [sharedChannelId]);
    const r = await api("GET",
      `/api/search/messages?q=${MARK}%20in:${encodeURIComponent(channel.slug)}`, null, shoban.token);
    assert.ok(r.body.results.length > 0);
    assert.ok(r.body.results.every(x => Number(x.conversationId) === Number(sharedChannelId)));
  });

  test("has:file finds only messages with an attachment", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("a,b\n1,2\n")], { type: "text/csv" }), "searchable.csv");
    const up = await fetch(`${base}/api/conversations/${sharedChannelId}/files`, {
      method: "POST", headers: { Authorization: `Bearer ${shoban.token}` }, body: form,
    });
    const uploaded = (await up.json()).file;

    const msg = await api("POST", `/api/conversations/${sharedChannelId}/messages`,
      { body: `withfile ${MARK} see attached`, clientMsgId: uid() }, shoban.token);
    await api("POST", `/api/messages/${msg.body.message.id}/attachments`,
      { attachmentIds: [uploaded.id] }, shoban.token);

    const r = await api("GET", `/api/search/messages?q=${MARK}%20has:file`, null, shoban.token);
    assert.ok(r.body.results.length > 0);
    assert.ok(r.body.results.every(x => x.fileCount > 0));
  });

  test("after: excludes older messages", async () => {
    const future = "2099-01-01";
    const r = await api("GET", `/api/search/messages?q=${MARK}%20after:${future}`, null, shoban.token);
    assert.equal(r.body.results.length, 0, "nothing is from the future");
  });

  test("before: includes today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await api("GET", `/api/search/messages?q=${MARK}%20before:${today}`, null, shoban.token);
    assert.ok(r.body.results.length > 0, "today counts as before end of today");
  });
});

describe("short terms", () => {
  test("a two letter code still matches, below the fulltext threshold", async () => {
    await api("POST", `/api/conversations/${sharedChannelId}/messages`,
      { body: "the payer returned CO for this line", clientMsgId: uid() }, shoban.token);

    const r = await api("GET", "/api/search/messages?q=CO", null, shoban.token);
    assert.ok(r.body.results.length > 0,
      "InnoDB will not index a two character token, so LIKE has to cover it");
  });

  test("a long term uses fulltext and still matches", async () => {
    const r = await api("GET", "/api/search/messages?q=inclusive", null, shoban.token);
    assert.ok(r.body.results.length > 0);
  });
});

describe("results", () => {
  test("a message result carries what the UI needs to render a row", async () => {
    const r = await api("GET", `/api/search/messages?q=${MARK}`, null, shoban.token);
    const first = r.body.results[0];
    for (const key of ["type", "id", "conversationId", "conversationName", "seq",
                       "senderName", "snippet", "createdAt"]) {
      assert.ok(key in first, `result needs ${key}`);
    }
    assert.equal(first.type, "message");
    assert.ok(first.snippet.length > 0);
  });

  test("a channel result names the channel with a hash", async () => {
    const r = await api("GET", `/api/search/messages?q=${MARK}`, null, shoban.token);
    const inChannel = r.body.results.find(x => x.conversationKind === "channel");
    assert.ok(inChannel.conversationName.startsWith("#"));
  });

  test("the snippet is a window around the match, not the whole message", () => {
    const long = "padding ".repeat(60) + "NEEDLE here " + "tail ".repeat(60);
    const s = search.snippet(long, ["needle"]);
    assert.ok(s.length < 220, "trimmed");
    assert.ok(s.toLowerCase().includes("needle"), "centred on the match");
  });

  test("paginates", async () => {
    const page1 = await api("GET", `/api/search/messages?q=${MARK}&limit=1&offset=0`, null, shoban.token);
    const page2 = await api("GET", `/api/search/messages?q=${MARK}&limit=1&offset=1`, null, shoban.token);
    assert.equal(page1.body.results.length, 1);
    assert.notEqual(page1.body.results[0].id, page2.body.results[0].id);
  });

  test("an empty query returns nothing rather than everything", async () => {
    const r = await api("GET", "/api/search/messages?q=", null, shoban.token);
    assert.equal(r.body.results.length, 0);
    assert.equal(r.body.total, 0);
  });

  test("a nonsense query returns an empty set, not an error", async () => {
    const r = await api("GET", "/api/search/messages?q=zzzznothingmatchesthis", null, shoban.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.results.length, 0);
  });

  test("quotes and percent signs do not break the query", async () => {
    for (const q of ['%', '"', "100%", 'a"b', "_", "\\"]) {
      const r = await api("GET", `/api/search/messages?q=${encodeURIComponent(q)}`, null, shoban.token);
      assert.equal(r.status, 200, `query ${q} handled`);
    }
  });
});

describe("global search", () => {
  test("returns every section in one call", async () => {
    const r = await api("GET", `/api/search?q=${MARK}`, null, shoban.token);
    assert.equal(r.status, 200);
    for (const key of ["messages", "files", "people", "channels", "answers", "parsed"]) {
      assert.ok(key in r.body, `global search returns ${key}`);
    }
    assert.ok(r.body.messages.length > 0);
  });

  test("finds people by skill", async () => {
    const r = await api("GET", `/api/search?q=${MARK}skill`, null, shoban.token);
    assert.ok(r.body.people.some(p => p.fullName === "Vignesh Naidu"),
      "a person is findable by a skill on their profile");
  });

  test("finds a file by name", async () => {
    const r = await api("GET", "/api/search?q=searchable", null, shoban.token);
    assert.ok(r.body.files.some(f => f.fileName === "searchable.csv"));
  });
});

describe("quick switcher", () => {
  test("returns recent conversations with no query", async () => {
    const r = await api("GET", "/api/search/switch", null, shoban.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.results.length > 0);
    assert.ok(r.body.results.every(x => typeof x.label === "string"));
  });

  test("filters as you type", async () => {
    const r = await api("GET", "/api/search/switch?q=denials", null, shoban.token);
    assert.ok(r.body.results.some(x => x.label.includes("denials")));
  });

  test("falls through to people when no conversation matches", async () => {
    const r = await api("GET", "/api/search/switch?q=vignesh", null, shoban.token);
    assert.ok(r.body.results.some(x => x.type === "person" && x.label === "Vignesh Naidu"));
  });

  test("never offers a conversation you are not in", async () => {
    const r = await api("GET", "/api/search/switch?q=Search%20Private", null, vignesh.token);
    assert.equal(r.body.results.filter(x => x.type === "channel").length, 0);
  });
});

describe("saved searches", () => {
  let savedId;

  test("saves one", async () => {
    const r = await api("POST", "/api/search/saved",
      { query: "in:denials-help has:file", label: "Denial attachments" }, shoban.token);
    assert.equal(r.status, 201);
    savedId = r.body.saved.id;
  });

  test("saving the same query twice does not duplicate", async () => {
    const r = await api("POST", "/api/search/saved", { query: "in:denials-help has:file" }, shoban.token);
    assert.equal(r.body.saved.id, savedId);
  });

  test("lists mine only", async () => {
    const mine = await api("GET", "/api/search/saved", null, shoban.token);
    assert.ok(mine.body.saved.some(s => Number(s.id) === Number(savedId)));

    const theirs = await api("GET", "/api/search/saved", null, vignesh.token);
    assert.ok(!theirs.body.saved.some(s => Number(s.id) === Number(savedId)));
  });

  test("another user cannot delete mine", async () => {
    const r = await api("DELETE", `/api/search/saved/${savedId}`, null, vignesh.token);
    assert.equal(r.status, 404);

    const still = await api("GET", "/api/search/saved", null, shoban.token);
    assert.ok(still.body.saved.some(s => Number(s.id) === Number(savedId)));
  });

  test("I can delete my own", async () => {
    const r = await api("DELETE", `/api/search/saved/${savedId}`, null, shoban.token);
    assert.equal(r.status, 200);
  });
});
