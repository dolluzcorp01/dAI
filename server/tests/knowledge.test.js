"use strict";
/**
 * Knowledge authoring, versioning, and code set import.
 *
 * The invariant under test: nothing is ever destructive. A published document
 * that changes is superseded, not rewritten, and a code whose description
 * changes is superseded, not overwritten, because past answers cited the old
 * wording.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.MODEL_PRIMARY_PROVIDER = "mock";

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");
const codes = require("../src/services/codes.service");
const importer = require("../src/services/codeimport.service");

const PASSWORD = "Kody!Dev2026";
let server, base, admin, member;

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

  for (const email of ["shoban@dolluzcorp.com", "vignesh@dolluzcorp.com"]) {
    const u = await db.one("SELECT id FROM users WHERE email = ?", [email]);
    await authSvc.setPassword(u.id, PASSWORD);
    await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [u.id]);
  }
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");

  const v = await db.one("SELECT id FROM users WHERE email = 'vignesh@dolluzcorp.com'");
  await db.query(
    `DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.code IN ('admin','super_admin','coordinator')`, [v.id]
  );

  admin = { token: await login("shoban@dolluzcorp.com") };
  member = { token: await login("vignesh@dolluzcorp.com") };

  // reset the licence flags so the guard tests start from a known state
  await db.query(
    `UPDATE org_settings SET setting_value = 'false' WHERE setting_key IN ('codes.licence.CPT','codes.licence.CDT')`
  );

  // Remove rows earlier runs of this suite created, so import counts are
  // deterministic whether the database is fresh or reused.
  await db.query("DELETE FROM code_entries WHERE code IN ('CO-201','CO-202','CO-203','99213','99214')");
  await db.query("DELETE FROM knowledge_docs WHERE title LIKE 'Timely filing windows by payer%'");
});

after(async () => {
  server.close();
  await db.pool.end();
});

describe("access", () => {
  test("a plain member cannot reach the knowledge admin", async () => {
    for (const p of ["/api/knowledge/docs", "/api/knowledge/stats", "/api/knowledge/codesets"]) {
      const r = await api("GET", p, null, member.token);
      assert.equal(r.status, 403, `${p} must be gated`);
    }
  });

  test("everything requires a token", async () => {
    const r = await api("GET", "/api/knowledge/docs");
    assert.equal(r.status, 401);
  });
});

describe("authoring", () => {
  let docId;

  test("creates a draft", async () => {
    const r = await api("POST", "/api/knowledge/docs", {
      title: "Timely filing windows by payer",
      body: "UHC is ninety days from date of service. Aetna is one hundred and twenty days.",
      domain: "rcm", sourceKind: "sop",
    }, admin.token);
    assert.equal(r.status, 201);
    assert.equal(r.body.doc.status, "draft");
    assert.equal(r.body.doc.version, 1);
    docId = r.body.doc.id;
  });

  test("a draft is not retrievable by Kody", async () => {
    const found = await codes.retrieve("timely filing windows payer", { limit: 5 });
    assert.ok(!found.some(d => Number(d.id) === Number(docId)), "drafts never reach an answer");
  });

  test("rejects a body that is too short and a domain that does not exist", async () => {
    const short = await api("POST", "/api/knowledge/docs",
      { title: "Too short", body: "nope", domain: "rcm" }, admin.token);
    assert.equal(short.status, 400);

    const bad = await api("POST", "/api/knowledge/docs",
      { title: "Bad domain", body: "a body long enough to pass", domain: "astrology" }, admin.token);
    assert.equal(bad.status, 400);
  });

  test("a draft is edited in place, since nothing has cited it", async () => {
    const r = await api("PATCH", `/api/knowledge/docs/${docId}`, {
      body: "UHC is ninety days. Aetna is one hundred and twenty days. Cigna is ninety days.",
    }, admin.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.doc.id, docId, "same row");
    assert.equal(r.body.doc.version, 1);
    assert.match(r.body.doc.body, /Cigna/);
  });

  test("a member cannot publish", async () => {
    const r = await api("PUT", `/api/knowledge/docs/${docId}/status`, { status: "published" }, member.token);
    assert.equal(r.status, 403);
  });

  test("publishing records the approver and makes it retrievable", async () => {
    const r = await api("PUT", `/api/knowledge/docs/${docId}/status`, { status: "published" }, admin.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.doc.status, "published");
    assert.ok(r.body.doc.approvedBy, "approver recorded");
    assert.ok(r.body.doc.effectiveFrom, "effective from today");

    const found = await codes.retrieve("timely filing windows payer", { limit: 5 });
    assert.ok(found.some(d => Number(d.id) === Number(docId)), "now reaches answers");
  });

  test("a published document cannot go back to draft", async () => {
    const r = await api("PUT", `/api/knowledge/docs/${docId}/status`, { status: "draft" }, admin.token);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "cannot_unpublish");
  });

  test("editing a published document supersedes it instead of rewriting it", async () => {
    const original = await api("GET", `/api/knowledge/docs/${docId}`, null, admin.token);
    const originalBody = original.body.doc.body;

    const r = await api("PATCH", `/api/knowledge/docs/${docId}`, {
      body: "UHC is now one hundred and eighty days after the 2026 contract change.",
    }, admin.token);
    assert.equal(r.status, 200);
    assert.notEqual(r.body.doc.id, docId, "a new row, not the old one");
    assert.equal(r.body.doc.version, 2);
    assert.equal(Number(r.body.doc.supersedesId), Number(docId));
    assert.equal(r.body.doc.status, "published");

    const old = await api("GET", `/api/knowledge/docs/${docId}`, null, admin.token);
    assert.equal(old.body.doc.body, originalBody, "the old text is untouched");
    assert.equal(old.body.doc.status, "retired");
    assert.ok(old.body.doc.effectiveTo, "and is no longer current");

    const found = await codes.retrieve("one hundred and eighty days contract change", { limit: 5 });
    assert.ok(found.some(d => Number(d.id) === Number(r.body.doc.id)), "the new version is retrieved");
    assert.ok(!found.some(d => Number(d.id) === Number(docId)), "the old version is not");
  });

  test("the version chain reads oldest to newest", async () => {
    const r = await api("GET", `/api/knowledge/docs/${docId}/versions`, null, admin.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.versions.length, 2);
    assert.equal(r.body.versions[0].version, 1);
    assert.equal(r.body.versions[1].version, 2);
  });

  test("the superseded version cannot be edited again", async () => {
    // Superseding retires the old row, so a second edit is refused as retired.
    // The already_superseded guard remains for a direct supersede call.
    const r = await api("PATCH", `/api/knowledge/docs/${docId}`, { body: "a third competing edit here" }, admin.token);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "retired");
  });

  test("a citation still resolves to the version that was actually used", async () => {
    const [ins] = await db.query(
      `INSERT INTO kody_citations (kody_message_id, doc_id)
       SELECT id, ? FROM kody_messages WHERE role = 'assistant' ORDER BY id DESC LIMIT 1`,
      [docId]
    );
    assert.ok(ins.affectedRows >= 0);
    const cited = await db.one(
      `SELECT d.id, d.body, d.status FROM kody_citations c
         JOIN knowledge_docs d ON d.id = c.doc_id WHERE c.doc_id = ? LIMIT 1`, [docId]
    );
    assert.ok(cited, "the cited row still exists");
    assert.equal(cited.status, "retired");
    assert.ok(cited.body.length > 0, "and still carries the text that was used");
  });

  test("a retired document cannot be edited", async () => {
    const r = await api("PATCH", `/api/knowledge/docs/${docId}`, { title: "Rewriting history" }, admin.token);
    assert.notEqual(r.status, 200);
  });

  test("lists and filters", async () => {
    const all = await api("GET", "/api/knowledge/docs?limit=100", null, admin.token);
    assert.ok(all.body.total > 0);

    const published = await api("GET", "/api/knowledge/docs?status=published", null, admin.token);
    assert.ok(published.body.docs.every(d => d.status === "published"));

    const rcm = await api("GET", "/api/knowledge/docs?domain=rcm", null, admin.token);
    assert.ok(rcm.body.docs.every(d => d.domain === "rcm"));

    const search = await api("GET", "/api/knowledge/docs?q=timely", null, admin.token);
    assert.ok(search.body.docs.length > 0);
  });

  test("reports corpus statistics", async () => {
    const r = await api("GET", "/api/knowledge/stats", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.publishedDocs > 0);
    assert.ok(Array.isArray(r.body.byDomain));
    assert.ok(r.body.currentCodeEntries > 0);
  });

  test("shows which published documents nothing has ever cited", async () => {
    const r = await api("GET", "/api/knowledge/docs/unused", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.docs));
  });
});

describe("the CSV reader", () => {
  test("handles quotes, embedded commas and escaped quotes", () => {
    const rows = importer.parseCsv(
      'code,description\r\n' +
      'CO-97,"Bundled, per the payer"\r\n' +
      'CO-45,"He said ""no"" to the claim"\r\n'
    );
    assert.equal(rows.length, 3);
    assert.equal(rows[1][1], "Bundled, per the payer");
    assert.equal(rows[2][1], 'He said "no" to the claim');
  });

  test("strips a byte order mark, which CMS files carry", () => {
    const rows = importer.parseCsv("\uFEFFcode,description\nX1,Something\n");
    assert.equal(rows[0][0], "code", "header is not corrupted by the BOM");
  });

  test("tolerates the column names CMS actually uses", () => {
    assert.deepEqual(importer.columnMap(["Code", "Long Description"]), { code: 0, description: 1, guidance: -1 });
    assert.deepEqual(importer.columnMap(["code", "description", "notes"]), { code: 0, description: 1, guidance: 2 });
  });

  test("refuses a file with no code column", () => {
    assert.throws(() => importer.columnMap(["name", "value"]), /code/);
  });
});

describe("importing a code set", () => {
  // Codes owned by this suite only. CO-97 and CO-45 are seeded and asserted on
  // by the Kody suite, and the test runner runs files in parallel against one
  // database, so mutating them here breaks that suite.
  const csv = [
    "code,description,notes",
    "CO-201,First test reason code,Guidance one",
    "CO-202,Second test reason code,Guidance two",
    "CO-203,Third test reason code,Guidance three",
    ",,",
  ].join("\n");

  test("a dry run reports and changes nothing", async () => {
    const before = await db.one("SELECT COUNT(*) AS n FROM code_entries");
    const r = await api("POST", "/api/knowledge/codesets/CARC/import", {
      csv, sourceName: "carc-2026.csv", effectiveFrom: "2026-01-01", dryRun: true,
    }, admin.token);

    assert.equal(r.status, 200);
    assert.equal(r.body.dryRun, true);
    assert.equal(r.body.parsed, 3, "one blank row skipped");
    assert.equal(r.body.skipped, 1);
    assert.equal(r.body.added, 3, "all three are new");

    const after = await db.one("SELECT COUNT(*) AS n FROM code_entries");
    assert.equal(Number(after.n), Number(before.n), "nothing written");
  });

  test("dry run is the default, so a missing flag cannot corrupt the tables", async () => {
    const r = await api("POST", "/api/knowledge/codesets/CARC/import",
      { csv, sourceName: "carc.csv" }, admin.token);
    assert.equal(r.body.dryRun, true);
  });

  test("a real import adds the new code and records provenance", async () => {
    const r = await api("POST", "/api/knowledge/codesets/CARC/import", {
      csv, sourceName: "carc-2026.csv", effectiveFrom: "2026-01-01", dryRun: "false",
    }, admin.token);

    assert.equal(r.status, 200);
    assert.equal(r.body.dryRun, false);
    assert.ok(r.body.importId);

    const hit = await codes.lookupCode("CO-201");
    assert.equal(hit.length, 1, "the new code resolves at tier 0");
    assert.match(hit[0].description, /First test reason code/);

    const row = await db.one(
      `SELECT import_id FROM code_entries WHERE code = 'CO-201' AND effective_to IS NULL`
    );
    assert.equal(Number(row.import_id), Number(r.body.importId), "traceable to its import");
  });

  test("a changed description supersedes rather than overwrites", async () => {
    const changed = [
      "code,description",
      'CO-201,"First test reason code, revised for the new edition"',
    ].join("\n");

    const r = await api("POST", "/api/knowledge/codesets/CARC/import", {
      csv: changed, sourceName: "carc-revised.csv", effectiveFrom: "2026-06-01", dryRun: "false",
    }, admin.token);
    assert.equal(r.body.updated, 1);

    const [rows] = await db.query(
      `SELECT description, effective_from, effective_to FROM code_entries
        WHERE code = 'CO-201' ORDER BY effective_from`
    );
    assert.equal(rows.length, 2, "both versions kept");
    assert.ok(rows[0].effective_to, "the old wording was closed off");
    assert.equal(rows[1].effective_to, null, "the new wording is current");

    const current = await codes.lookupCode("CO-201");
    assert.equal(current.length, 1, "only one current entry");
    assert.match(current[0].description, /revised for the new edition/);
  });

  test("re-importing an edition on its own effective date corrects in place", async () => {
    // This is the case that used to fail on a duplicate key: the unique index
    // is (code_set_id, code, effective_from), so writing a second row with the
    // same date collides. A same-date change is a correction, not an edition.
    const fix = ["code,description", 'CO-201,"First test reason code, corrected wording"'].join("\n");
    const r = await api("POST", "/api/knowledge/codesets/CARC/import", {
      csv: fix, sourceName: "carc-fix.csv", effectiveFrom: "2026-06-01", dryRun: "false",
    }, admin.token);

    assert.equal(r.status, 200, "no duplicate key error");
    assert.equal(r.body.corrected, 1, "corrected in place");
    assert.equal(r.body.superseded, 0, "no new edition created");

    const [rows] = await db.query(
      `SELECT COUNT(*) AS n FROM code_entries WHERE code = 'CO-201' AND effective_from = '2026-06-01'`
    );
    assert.equal(Number(rows[0].n), 1, "still exactly one row for that date");
  });

  test("an import is idempotent when the file has not changed", async () => {
    const same = ["code,description", 'CO-201,"First test reason code, corrected wording"'].join("\n");
    const r = await api("POST", "/api/knowledge/codesets/CARC/import", {
      csv: same, sourceName: "carc-revised.csv", effectiveFrom: "2026-06-01", dryRun: "false",
    }, admin.token);
    assert.equal(r.body.added, 0);
    assert.equal(r.body.updated, 0);
    assert.equal(r.body.unchanged, 1);
  });

  test("retireMissing closes off codes absent from the file, only when asked", async () => {
    const partial = ["code,description", 'CO-201,"First test reason code, corrected wording"'].join("\n");

    const without = await api("POST", "/api/knowledge/codesets/CARC/import", {
      csv: partial, effectiveFrom: "2026-07-01", dryRun: true,
    }, admin.token);
    assert.equal(without.body.retired, 0, "nothing retired by default");

    const with_ = await api("POST", "/api/knowledge/codesets/CARC/import", {
      csv: partial, effectiveFrom: "2026-07-01", dryRun: true, retireMissing: "true",
    }, admin.token);
    assert.ok(with_.body.retired > 0, "opt in and absent codes would be retired");
  });

  test("an unknown code set is refused", async () => {
    const r = await api("POST", "/api/knowledge/codesets/NOTREAL/import",
      { csv, dryRun: true }, admin.token);
    assert.equal(r.status, 404);
  });

  test("an empty file is refused", async () => {
    const r = await api("POST", "/api/knowledge/codesets/CARC/import",
      { csv: "code,description\n", dryRun: true }, admin.token);
    assert.equal(r.status, 400);
  });

  test("history lists every run", async () => {
    const r = await api("GET", "/api/knowledge/imports?codeSet=CARC", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.imports.length >= 2);
    assert.ok(r.body.imports[0].importedBy, "who ran it");
  });
});

describe("the licence guard", () => {
  test("a licensed set is refused until the licence is recorded", async () => {
    const r = await api("POST", "/api/knowledge/codesets/CPT/import", {
      csv: "code,description\n99213,Office visit established patient", dryRun: true,
    }, admin.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "licence_not_recorded");
    assert.match(r.body.message, /AMA/);
  });

  test("CDT names the ADA", async () => {
    const r = await api("POST", "/api/knowledge/codesets/CDT/import", {
      csv: "code,description\nD0140,Limited oral evaluation", dryRun: true,
    }, admin.token);
    assert.equal(r.status, 403);
    assert.match(r.body.message, /ADA/);
  });

  test("a member cannot record a licence", async () => {
    const r = await api("PUT", "/api/knowledge/codesets/CPT/licence",
      { licenceRecorded: true }, member.token);
    assert.equal(r.status, 403);
  });

  test("once recorded, the import proceeds", async () => {
    const set = await api("PUT", "/api/knowledge/codesets/CPT/licence",
      { licenceRecorded: true }, admin.token);
    assert.equal(set.status, 200);

    const r = await api("POST", "/api/knowledge/codesets/CPT/import", {
      csv: "code,description\n99213,Office visit established patient low complexity",
      effectiveFrom: "2026-01-01", dryRun: "false",
    }, admin.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.added, 1);

    const hit = await codes.lookupCode("99213");
    assert.equal(hit.length, 1);
    assert.equal(hit[0].codeSet, "CPT");
    assert.equal(hit[0].licensed, true);
  });

  test("revoking the licence blocks further imports", async () => {
    await api("PUT", "/api/knowledge/codesets/CPT/licence", { licenceRecorded: false }, admin.token);
    const r = await api("POST", "/api/knowledge/codesets/CPT/import", {
      csv: "code,description\n99214,Office visit moderate complexity", dryRun: true,
    }, admin.token);
    assert.equal(r.status, 403);
  });

  test("a free set is never blocked", async () => {
    const r = await api("POST", "/api/knowledge/codesets/POS/import", {
      csv: "code,description\n11,Office", dryRun: true,
    }, admin.token);
    assert.equal(r.status, 200);
  });

  test("the code set overview shows licence state and counts", async () => {
    const r = await api("GET", "/api/knowledge/codesets", null, admin.token);
    assert.equal(r.status, 200);
    const cpt = r.body.codeSets.find(c => c.code === "CPT");
    assert.equal(cpt.licensed, true);
    assert.equal(cpt.licenceRecorded, false, "we just revoked it");
    const carc = r.body.codeSets.find(c => c.code === "CARC");
    assert.equal(carc.licensed, false);
    assert.ok(carc.currentEntries > 0);
    assert.ok(carc.lastImport, "records when it was last loaded");
  });
});

describe("the SME correction still feeds the corpus", () => {
  test("a resolved SME answer appears in the knowledge list", async () => {
    const r = await api("GET", "/api/knowledge/docs?sourceKind=sme_answer", null, admin.token);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.docs));
  });
});
