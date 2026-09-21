"use strict";
/**
 * Kody AI: tier routing, the code lookup gate, retrieval and citations,
 * degraded paths, feedback, points and the SME loop.
 *
 * Runs against the mock provider so the pipeline is deterministic and needs no
 * API key. Every layer except the vendor HTTP call is the real one.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.KODY_RATE_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";
process.env.MODEL_FALLBACK_PROVIDER = "";

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");
const gateway = require("../src/ai/gateway");
const prompts = require("../src/ai/prompts");
const codes = require("../src/services/codes.service");

const PASSWORD = "Kody!Dev2026";
let server, base, shoban, pavithran, dmId;

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

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  const ids = {};
  for (const email of ["shoban@dolluzcorp.com", "pavithran@dolluzcorp.com"]) {
    const u = await db.one("SELECT id FROM users WHERE email = ?", [email]);
    ids[email] = u.id;
    await authSvc.setPassword(u.id, PASSWORD);
    await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [u.id]);
  }
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");
  shoban = { id: ids["shoban@dolluzcorp.com"], token: await login("shoban@dolluzcorp.com") };
  pavithran = { id: ids["pavithran@dolluzcorp.com"], token: await login("pavithran@dolluzcorp.com") };

  const dm = await api("POST", "/api/conversations/dm", { userId: pavithran.id }, shoban.token);
  dmId = dm.body.conversation.id;
});

after(async () => {
  process.env.MOCK_MODEL_BEHAVIOUR = "ok";
  server.close();
  await db.pool.end();
});

describe("tier 0, codes are looked up and never generated", () => {
  test("an exact code is answered from the database with no model call", async () => {
    const r = await api("POST", "/api/kody/ask", { question: "CO-97" }, shoban.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.message.tier, 0, "tier 0");
    assert.equal(r.body.message.modelName, null, "no model was called");
    assert.equal(r.body.message.lookupCode, "CO-97");
    assert.equal(r.body.message.lookupSet, "CARC");
    assert.equal(r.body.message.confidence, "high");
    assert.match(r.body.message.body, /bundled/i);
  });

  test("tier 0 is fast because nothing leaves the process", async () => {
    const r = await api("POST", "/api/kody/ask", { question: "PR-1" }, shoban.token);
    assert.equal(r.body.message.tier, 0);
    assert.ok(r.body.message.latencyMs < 500, `expected a local lookup, took ${r.body.message.latencyMs}ms`);
  });

  test("a code that does not exist falls through to the model rather than inventing one", async () => {
    const r = await api("POST", "/api/kody/ask", { question: "ZZ-999" }, shoban.token);
    assert.notEqual(r.body.message.tier, 0, "no false lookup");
    assert.equal(r.body.message.lookupCode, null);
  });

  test("the code detector does not fire on ordinary prose", () => {
    assert.equal(codes.looksLikeCode("what is the retro format we use"), null);
    assert.equal(codes.looksLikeCode("CO-97"), "CO-97");
    assert.equal(codes.looksLikeCode("what does CO-97 mean"), "CO-97");
    assert.equal(codes.looksLikeCode("M54.50"), "M54.50");
  });

  test("lookup respects effective dates", async () => {
    const [set] = await db.query("SELECT id FROM code_sets WHERE code = 'CARC'");
    await db.query(
      `INSERT IGNORE INTO code_entries (code_set_id, code, description, guidance, effective_from, effective_to)
       VALUES (?, 'OLD-1', 'Retired code', 'Do not use', '2020-01-01', '2021-01-01')`,
      [set[0].id]
    );
    const hits = await codes.lookupCode("OLD-1");
    assert.equal(hits.length, 0, "a superseded entry is not returned");
  });

  test("an ICD-10 code keeps its decimal point and resolves", async () => {
    const hits = await codes.lookupCode("M54.50");
    assert.equal(hits.length, 1, "M54.50 is seeded and must be found");
    assert.equal(hits[0].codeSet, "ICD-10-CM");

    const r = await api("POST", "/api/kody/ask", { question: "M54.50" }, shoban.token);
    assert.equal(r.body.message.tier, 0, "answered by lookup, not by a model");
    assert.equal(r.body.message.lookupCode, "M54.50");
  });

  test("the direct lookup endpoint works for the recent-codes strip", async () => {
    const r = await api("GET", "/api/kody/codes/D0140", null, shoban.token);
    assert.equal(r.status, 404, "D0140 is CDT, which is licensed and not seeded");

    const carc = await api("GET", "/api/kody/codes/CO-45", null, shoban.token);
    assert.equal(carc.status, 200);
    assert.equal(carc.body.entries[0].codeSet, "CARC");
  });
});

describe("tier routing", () => {
  test("short simple questions go to the fast tier", () => {
    assert.equal(gateway.chooseTier("what is scrum"), 1);
  });
  test("domain questions go to standard", () => {
    assert.equal(gateway.chooseTier("how do I handle a HIPAA breach notification"), 2);
  });
  test("drafting and analysis go to deep", () => {
    assert.equal(gateway.chooseTier("draft an appeal letter for a CO-97 denial"), 3);
    assert.equal(gateway.chooseTier("compare our two payer policies"), 3);
  });
  test("a short question about a domain keyword is not demoted to fast", () => {
    assert.equal(gateway.chooseTier("hipaa rules"), 2);
  });
  test("each tier maps to its configured model", () => {
    assert.notEqual(gateway.modelFor(1), gateway.modelFor(3));
  });
});

describe("the answer pipeline", () => {
  test("an ordinary question is answered and fully attributed", async () => {
    const r = await api("POST", "/api/kody/ask",
      { question: "How should we handle an inclusive denial from the payer" }, shoban.token);
    assert.equal(r.status, 200);
    const m = r.body.message;
    assert.equal(m.domain, "rcm");
    assert.ok(m.body.length > 0);
    assert.ok(m.modelName, "model recorded");
    assert.equal(m.promptVersion, prompts.PROMPT_VERSION, "prompt version recorded");
    assert.ok(m.latencyMs >= 0);
    assert.ok(m.tier >= 1);
    assert.ok(m.sourceName);
  });

  test("a follow-up keeps the thread and its history", async () => {
    const first = await api("POST", "/api/kody/ask", { question: "What is a CARC code" }, shoban.token);
    const tid = first.body.threadId;
    const second = await api("POST", "/api/kody/ask",
      { question: "And a RARC?", threadId: tid }, shoban.token);
    assert.equal(second.body.threadId, tid);

    const thread = await api("GET", `/api/kody/threads/${tid}`, null, shoban.token);
    assert.equal(thread.status, 200);
    assert.equal(thread.body.messages.length, 4, "two questions and two answers");
    assert.equal(thread.body.messages[0].role, "user");
  });

  test("another user cannot open my thread", async () => {
    const mine = await api("POST", "/api/kody/ask", { question: "private question" }, shoban.token);
    const r = await api("GET", `/api/kody/threads/${mine.body.threadId}`, null, pavithran.token);
    assert.equal(r.status, 404, "404 rather than 403, so its existence is not confirmed");
  });

  test("links come back structured, never inside the prose", async () => {
    const r = await api("POST", "/api/kody/ask",
      { question: "give me a link to the ICD resource" }, shoban.token);
    assert.ok(Array.isArray(r.body.message.links));
    assert.ok(r.body.message.links.length > 0);
    assert.ok(!/https?:\/\//.test(r.body.message.body), "no raw URLs in the text");
  });

  test("asking requires a token", async () => {
    const r = await api("POST", "/api/kody/ask", { question: "hello" });
    assert.equal(r.status, 401);
  });

  test("an empty question is rejected", async () => {
    const r = await api("POST", "/api/kody/ask", { question: "   " }, shoban.token);
    assert.equal(r.status, 400);
  });
});

describe("retrieval and citations", () => {
  let docId;

  test("a published document is retrieved and cited", async () => {
    // Remove copies from earlier runs so retrieval ranking is deterministic.
    await db.query("DELETE FROM knowledge_docs WHERE title = 'Dolluz bundling policy'");
    const [res] = await db.query(
      `INSERT INTO knowledge_docs (title, domain, source_kind, body, status, effective_from)
       VALUES ('Dolluz bundling policy', 'rcm', 'sop',
               'When a payer reports an inclusive denial for bundling, check the primary procedure on the remittance before adjusting the account.',
               'published', CURDATE())`
    );
    docId = res.insertId;

    const found = await codes.retrieve("inclusive denial bundling remittance", { limit: 4 });
    assert.ok(found.some(d => Number(d.id) === Number(docId)), "document retrieved");

    const r = await api("POST", "/api/kody/ask",
      { question: "inclusive denial bundling remittance" }, shoban.token);
    assert.equal(r.body.message.usedRetrieval, true, "retrieval ran");
    assert.ok(r.body.message.citations.length > 0, "the answer carries a citation");
    // Whatever was cited must be one of the documents actually retrieved.
    const retrievedIds = found.map(d => Number(d.id));
    assert.ok(r.body.message.citations.every(c => retrievedIds.includes(Number(c.docId))),
      "never cites a document that was not supplied");
  });

  test("a retired document is not retrieved", async () => {
    await db.query(
      `INSERT INTO knowledge_docs (title, domain, source_kind, body, status, effective_from, effective_to)
       VALUES ('Superseded timely filing rule', 'rcm', 'sop',
               'Timely filing zzunique was ninety days under the old contract.',
               'published', '2020-01-01', '2021-01-01')`
    );
    const found = await codes.retrieve("zzunique", { limit: 5 });
    assert.equal(found.length, 0, "expired guidance is never returned");
  });

  test("a draft document is not retrieved", async () => {
    await db.query(
      `INSERT INTO knowledge_docs (title, domain, source_kind, body, status)
       VALUES ('Unfinished note', 'rcm', 'sop', 'draftonlyzz content', 'draft')`
    );
    const found = await codes.retrieve("draftonlyzz", { limit: 5 });
    assert.equal(found.length, 0, "unpublished content is never used");
  });

  test("a model cannot cite a document it was never shown", async () => {
    // A REAL published document that this question will not retrieve. A
    // foreign key cannot catch this one, so only the application filter can.
    await db.query("DELETE FROM knowledge_docs WHERE title = 'Unrelated cyber runbook'");
    const [ins] = await db.query(
      `INSERT INTO knowledge_docs (title, domain, source_kind, body, status, effective_from)
       VALUES ('Unrelated cyber runbook', 'cyber', 'sop',
               'Privileged account review procedure for the SOC team.', 'published', CURDATE())`
    );
    const unrelatedId = ins.insertId;

    process.env.MOCK_CITE_DOC_ID = String(unrelatedId);
    process.env.MOCK_MODEL_BEHAVIOUR = "citeghost";
    const r = await api("POST", "/api/kody/ask",
      { question: "inclusive denial bundling remittance" }, shoban.token);
    process.env.MOCK_MODEL_BEHAVIOUR = "ok";
    delete process.env.MOCK_CITE_DOC_ID;

    assert.equal(r.status, 200);
    assert.ok(!r.body.message.citations.some(c => Number(c.docId) === Number(unrelatedId)),
      "a document that exists but was never supplied is not cited");

    const stored = await db.one(
      "SELECT COUNT(*) AS n FROM kody_citations WHERE kody_message_id = ? AND doc_id = ?",
      [r.body.message.id, unrelatedId]
    );
    assert.equal(Number(stored.n), 0, "nothing written for the unsupplied document");
  });
});

describe("degraded paths", () => {
  test("a provider failure produces a visible degraded answer, not silence", async () => {
    process.env.MOCK_MODEL_BEHAVIOUR = "error";
    const r = await api("POST", "/api/kody/ask", { question: "will this fail" }, shoban.token);
    process.env.MOCK_MODEL_BEHAVIOUR = "ok";

    assert.equal(r.status, 200);
    assert.equal(r.body.degraded, true);
    assert.equal(r.body.message.confidence, "low");
    assert.match(r.body.message.disclaimer, /degraded/i);
    assert.match(r.body.message.body, /could not reach/i);
  });

  test("a malformed reply is flagged rather than guessed at", async () => {
    process.env.MOCK_MODEL_BEHAVIOUR = "malformed";
    const r = await api("POST", "/api/kody/ask", { question: "return me prose" }, shoban.token);
    process.env.MOCK_MODEL_BEHAVIOUR = "ok";

    assert.equal(r.body.degraded, true);
    assert.match(r.body.message.body, /could not read/i);

    const audit = await db.one(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'kody.malformed_response'"
    );
    assert.ok(Number(audit.n) > 0, "malformed replies are audited");
  });

  test("an empty reply is also treated as malformed", async () => {
    process.env.MOCK_MODEL_BEHAVIOUR = "empty";
    const r = await api("POST", "/api/kody/ask", { question: "say nothing" }, shoban.token);
    process.env.MOCK_MODEL_BEHAVIOUR = "ok";
    assert.equal(r.body.degraded, true);
  });

  test("the parser rejects prose, fences and missing text", () => {
    assert.equal(prompts.parseAnswer("just prose").ok, false);
    assert.equal(prompts.parseAnswer('{"domain":"rcm"}').ok, false);
    const fenced = prompts.parseAnswer('```json\n{"domain":"rcm","text":"hello","confidence":"high"}\n```');
    assert.equal(fenced.ok, true);
    assert.equal(fenced.answer.text, "hello");
  });

  test("the parser strips em dashes and drops non-http links", () => {
    const out = prompts.parseAnswer(JSON.stringify({
      domain: "rcm", text: "a \u2014 b", confidence: "high",
      links: [{ title: "bad", url: "javascript:alert(1)" }, { title: "good", url: "https://ok.example" }],
    }));
    assert.equal(out.answer.text, "a - b");
    assert.equal(out.answer.links.length, 1);
    assert.equal(out.answer.links[0].url, "https://ok.example");
  });
});

describe("@kody inside a conversation", () => {
  test("the answer is posted into the room for everyone", async () => {
    const before = await db.one("SELECT last_seq FROM conversations WHERE id = ?", [dmId]);
    const r = await api("POST", `/api/kody/conversations/${dmId}/ask`,
      { question: "what is an inclusive denial" }, shoban.token);

    assert.equal(r.status, 200);
    assert.equal(r.body.chatMessage.kind, "kody");
    assert.equal(Number(r.body.chatMessage.seq), Number(before.last_seq) + 1, "takes the next seq");
    assert.ok(r.body.chatMessage.kody.domain);
    assert.ok(r.body.chatMessage.kody.kodyMessageId);

    const list = await api("GET", `/api/conversations/${dmId}/messages?afterSeq=${before.last_seq}`,
      null, pavithran.token);
    assert.ok(list.body.messages.some(m => m.kind === "kody"), "the other member sees it");
  });

  test("a non-member cannot ask into that conversation", async () => {
    const other = await db.one("SELECT id FROM conversations WHERE slug = 'leadership'");
    const r = await api("POST", `/api/kody/conversations/${other.id}/ask`,
      { question: "let me in" }, shoban.token);
    assert.equal(r.status, 403);
  });
});

describe("feedback, points and the SME loop", () => {
  let answerId;

  test("thumbs up credits points exactly once", async () => {
    const asked = await api("POST", "/api/kody/ask", { question: "how do we run retros" }, shoban.token);
    answerId = asked.body.message.id;

    const first = await api("POST", `/api/kody/messages/${answerId}/feedback`, { vote: "up" }, shoban.token);
    assert.equal(first.status, 200);
    assert.equal(first.body.points.credited, 25);

    const second = await api("POST", `/api/kody/messages/${answerId}/feedback`, { vote: "up" }, shoban.token);
    assert.equal(second.body.points.credited, 0);
    assert.equal(second.body.points.reason, "already_credited");

    const rows = await db.one(
      "SELECT COUNT(*) AS n FROM point_events WHERE ref_type = 'kody_message' AND ref_id = ?", [answerId]
    );
    assert.equal(Number(rows.n), 1, "one ledger row only");
  });

  test("the balance is a sum of the ledger, not a stored counter", async () => {
    const r = await api("GET", "/api/kody/points", null, shoban.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.balance >= 25);
    assert.equal(r.body.pointsPerCent, 1000);
    assert.equal(r.body.cents, r.body.balance / 1000);
    assert.ok(Array.isArray(r.body.ledger));
  });

  test("the daily cap stops a one-click money button", async () => {
    await db.query("UPDATE point_rules SET daily_cap = 50 WHERE event_code = 'helpful'");
    await db.query("DELETE FROM point_events WHERE user_id = ? AND event_code = 'helpful'", [pavithran.id]);

    const results = [];
    for (let i = 0; i < 5; i++) {
      const asked = await api("POST", "/api/kody/ask", { question: `cap test ${i}` }, pavithran.token);
      const fb = await api("POST", `/api/kody/messages/${asked.body.message.id}/feedback`,
        { vote: "up" }, pavithran.token);
      results.push(fb.body.points);
    }
    const credited = results.filter(p => p.credited > 0).length;
    assert.equal(credited, 2, "50 point cap at 25 each allows exactly two");
    assert.ok(results.some(p => p.reason === "daily_cap_reached"));

    await db.query("UPDATE point_rules SET daily_cap = 500 WHERE event_code = 'helpful'");
  });

  test("thumbs down opens an SME review, and twice does not open two", async () => {
    const asked = await api("POST", "/api/kody/ask", { question: "something wrong" }, shoban.token);
    const mid = asked.body.message.id;

    const a = await api("POST", `/api/kody/messages/${mid}/feedback`,
      { vote: "down", comment: "This is not how we handle it" }, shoban.token);
    assert.ok(a.body.smeQueueId);

    const b = await api("POST", `/api/kody/messages/${mid}/feedback`, { vote: "down" }, shoban.token);
    assert.equal(b.body.smeQueueId, a.body.smeQueueId, "same queue item");

    const rows = await db.one("SELECT COUNT(*) AS n FROM sme_queue WHERE kody_message_id = ?", [mid]);
    assert.equal(Number(rows.n), 1);
  });

  test("a member cannot see the SME queue", async () => {
    await db.query(
      `DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ? AND r.code IN ('admin','super_admin','coordinator')`, [pavithran.id]
    );
    const token = await login("pavithran@dolluzcorp.com");
    const r = await api("GET", "/api/kody/sme", null, token);
    assert.equal(r.status, 403);
  });

  test("an SME resolves an item, which becomes a published document", async () => {
    const queue = await api("GET", "/api/kody/sme", null, shoban.token);
    assert.equal(queue.status, 200);
    assert.ok(queue.body.items.length > 0);
    const item = queue.body.items[0];
    assert.ok(item.question, "the original question is shown");
    assert.ok(item.modelName !== undefined, "the model is shown for reproducibility");

    const resolved = await api("POST", `/api/kody/sme/${item.id}/resolve`, {
      title: "Correct handling of an inclusive denial",
      resolution: "Check the primary procedure on the remittance. Only write off once the bundling is confirmed correct against the payer policy.",
      domain: "rcm", publish: true,
    }, shoban.token);

    assert.equal(resolved.status, 200);
    assert.ok(resolved.body.docId);

    const doc = await db.one("SELECT status, source_kind FROM knowledge_docs WHERE id = ?", [resolved.body.docId]);
    assert.equal(doc.status, "published");
    assert.equal(doc.source_kind, "sme_answer");

    const again = await api("POST", `/api/kody/sme/${item.id}/resolve`, {
      title: "Second attempt", resolution: "should not be allowed at all here",
    }, shoban.token);
    assert.equal(again.status, 400);
  });

  test("the resolved document is then retrievable by future answers", async () => {
    const found = await codes.retrieve("inclusive denial primary procedure remittance", { limit: 5 });
    assert.ok(found.some(d => d.sourceKind === "sme_answer"), "the corpus grew from the correction");
  });
});
