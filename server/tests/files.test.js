"use strict";
/**
 * Files: upload, the scan gate, download safety, the browser, versioning.
 * Real database, real HTTP, real bytes on disk.
 */
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs/promises");
const path = require("path");

process.env.AUTH_RATE_LOGIN_MAX = "10000";
process.env.FILE_RATE_MAX = "10000";
process.env.STORAGE_LOCAL_PATH = path.join(__dirname, "..", "var", "test-uploads");

const { createApp } = require("../src/app");
const db = require("../src/db");
const authSvc = require("../src/services/auth.service");
const scanner = require("../src/lib/scanner");
const filesSvc = require("../src/services/files.service");

const PASSWORD = "Kody!Dev2026";
let server, base, shoban, pavithran, vignesh, dmId;

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

/** Multipart upload using the runtime's own FormData. */
const uploadFile = async (conversationId, { name, type, content }, token, extra = {}) => {
  const form = new FormData();
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  form.append("file", new Blob([bytes], { type }), name);
  for (const [k, v] of Object.entries(extra)) form.append(k, String(v));

  const res = await fetch(`${base}/api/conversations/${conversationId}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
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
  await fs.rm(process.env.STORAGE_LOCAL_PATH, { recursive: true, force: true });
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

  const dm = await api("POST", "/api/conversations/dm", { userId: pavithran.id }, shoban.token);
  dmId = dm.body.conversation.id;
});

after(async () => {
  server.close();
  await db.pool.end();
  await fs.rm(process.env.STORAGE_LOCAL_PATH, { recursive: true, force: true });
});

describe("upload", () => {
  test("accepts an allowed type and marks it clean", async () => {
    const r = await uploadFile(dmId, {
      name: "remittance.csv", type: "text/csv", content: "claim,amount\n88213-A,148.00\n",
    }, shoban.token);
    assert.equal(r.status, 201);
    assert.equal(r.body.file.scanStatus, "clean");
    assert.equal(r.body.file.mediaKind, "file");
    assert.equal(r.body.file.fileName, "remittance.csv");
  });

  test("writes the bytes to storage under a generated key", async () => {
    const r = await uploadFile(dmId, { name: "note.txt", type: "text/plain", content: "hello" }, shoban.token);
    const row = await db.one("SELECT storage_key FROM attachments WHERE id = ?", [r.body.file.id]);
    assert.match(row.storage_key, /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.txt$/, "key is date plus uuid, not the filename");
    const onDisk = await filesSvc.storage.exists(row.storage_key);
    assert.equal(onDisk, true);
  });

  test("refuses a type that is not on the allowlist", async () => {
    const r = await uploadFile(dmId, {
      name: "payload.html", type: "text/html", content: "<script>alert(1)</script>",
    }, shoban.token);
    assert.equal(r.status, 415);
    assert.equal(r.body.error, "type_not_allowed");
  });

  test("refuses an empty file", async () => {
    const r = await uploadFile(dmId, { name: "nothing.txt", type: "text/plain", content: "" }, shoban.token);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "empty_file");
  });

  test("refuses a file over the size limit", async () => {
    const big = Buffer.alloc(26 * 1024 * 1024, 0x41);
    const r = await uploadFile(dmId, { name: "big.txt", type: "text/plain", content: big }, shoban.token);
    assert.equal(r.status, 413);
    assert.equal(r.body.error, "too_large");
  });

  test("a non-member cannot upload", async () => {
    const r = await uploadFile(dmId, { name: "sneak.txt", type: "text/plain", content: "x" }, vignesh.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "not_a_member");
  });

  test("uploading requires a token", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("x")], { type: "text/plain" }), "a.txt");
    const res = await fetch(`${base}/api/conversations/${dmId}/files`, { method: "POST", body: form });
    assert.equal(res.status, 401);
  });
});

describe("filename safety", () => {
  test("strips path traversal from the stored name", async () => {
    const r = await uploadFile(dmId, {
      name: "../../../etc/passwd", type: "text/plain", content: "root:x:0:0",
    }, shoban.token);
    assert.equal(r.status, 201);
    assert.equal(r.body.file.fileName, "passwd", "path components removed");

    const row = await db.one("SELECT storage_key FROM attachments WHERE id = ?", [r.body.file.id]);
    assert.ok(!row.storage_key.includes(".."), "no traversal in the key");
    assert.ok(!row.storage_key.includes("passwd"), "user name never used in the path");
  });

  test("strips characters that break shells and filesystems", () => {
    assert.equal(filesSvc.safeName('bad:name*with?"chars<>|.txt'), "bad_name_with__chars___.txt");
    assert.equal(filesSvc.safeName("...hidden"), "hidden");
    assert.equal(filesSvc.safeName(""), "file");
    assert.equal(filesSvc.safeName("/etc/shadow"), "shadow");
  });

  test("never serves HTML or SVG with a renderable content type", () => {
    assert.equal(filesSvc.safeContentType("text/html"), "application/octet-stream");
    assert.equal(filesSvc.safeContentType("image/svg+xml"), "application/octet-stream");
    assert.equal(filesSvc.safeContentType("image/png"), "image/png");
  });
});

describe("the scan gate", () => {
  test("the EICAR test file is detected and rejected", async () => {
    const r = await uploadFile(dmId, {
      name: "eicar.txt", type: "text/plain", content: scanner.EICAR,
    }, shoban.token);
    assert.equal(r.status, 422);
    assert.equal(r.body.error, "infected");
  });

  test("an infected upload leaves no downloadable row and no bytes on disk", async () => {
    const row = await db.one(
      `SELECT id, storage_key, scan_status, deleted_at FROM attachments
        WHERE file_name = 'eicar.txt' ORDER BY id DESC LIMIT 1`
    );
    assert.ok(row, "the attempt was recorded");
    assert.equal(row.scan_status, "infected");
    assert.ok(row.deleted_at, "soft deleted");
    assert.equal(await filesSvc.storage.exists(row.storage_key), false, "bytes removed from storage");

    const dl = await api("GET", `/api/files/${row.id}/download`, null, shoban.token);
    assert.equal(dl.status, 404, "not downloadable");
  });

  test("the rejection is written to the audit log", async () => {
    const n = await db.one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'file.infected_rejected'");
    assert.ok(Number(n.n) > 0);
  });

  test("a file still pending cannot be downloaded", async () => {
    const r = await uploadFile(dmId, { name: "pending.txt", type: "text/plain", content: "later" }, shoban.token);
    await db.query("UPDATE attachments SET scan_status = 'pending' WHERE id = ?", [r.body.file.id]);
    const dl = await api("GET", `/api/files/${r.body.file.id}/download`, null, shoban.token);
    assert.equal(dl.status, 409);
    assert.equal(dl.body.error, "scan_pending");
  });

  test("a file marked infected afterwards stops being served", async () => {
    const r = await uploadFile(dmId, { name: "later.txt", type: "text/plain", content: "ok for now" }, shoban.token);
    await db.query("UPDATE attachments SET scan_status = 'infected' WHERE id = ?", [r.body.file.id]);
    const dl = await api("GET", `/api/files/${r.body.file.id}/download`, null, shoban.token);
    assert.equal(dl.status, 403);
    assert.equal(dl.body.error, "not_clean");
  });
});

describe("download", () => {
  let fileId;

  test("returns the exact bytes with safe headers", async () => {
    const content = "claim,amount\n88213-A,148.00\n";
    const up = await uploadFile(dmId, { name: "download me.csv", type: "text/csv", content }, shoban.token);
    fileId = up.body.file.id;

    const res = await fetch(`${base}/api/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${shoban.token}` },
    });
    assert.equal(res.status, 200);
    // Express appends "; charset=utf-8" to text types, which is correct.
    assert.ok(res.headers.get("content-type").startsWith("text/csv"),
      `unexpected content type: ${res.headers.get("content-type")}`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-disposition"), /^attachment;/, "never inline");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(await res.text(), content, "bytes round-trip unchanged");
  });

  test("the other member of the conversation can download it", async () => {
    const res = await fetch(`${base}/api/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${pavithran.token}` },
    });
    assert.equal(res.status, 200);
  });

  test("a non-member cannot download it", async () => {
    const r = await api("GET", `/api/files/${fileId}/download`, null, vignesh.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "not_a_member");
  });

  test("downloading requires a token", async () => {
    const res = await fetch(`${base}/api/files/${fileId}/download`);
    assert.equal(res.status, 401);
  });

  test("a missing file is a 404", async () => {
    const r = await api("GET", "/api/files/999999/download", null, shoban.token);
    assert.equal(r.status, 404);
  });

  test("a row whose bytes vanished reports gone rather than a broken stream", async () => {
    const up = await uploadFile(dmId, { name: "vanishing.txt", type: "text/plain", content: "poof" }, shoban.token);
    const row = await db.one("SELECT storage_key FROM attachments WHERE id = ?", [up.body.file.id]);
    await filesSvc.storage.remove(row.storage_key);
    const r = await api("GET", `/api/files/${up.body.file.id}/download`, null, shoban.token);
    assert.equal(r.status, 410);
    assert.equal(r.body.error, "gone");
  });
});

describe("attaching to messages", () => {
  test("an uploaded file attaches and appears on the message", async () => {
    const up = await uploadFile(dmId, { name: "evidence.pdf", type: "application/pdf", content: "%PDF-1.4 fake" }, shoban.token);
    const msg = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "See attached", clientMsgId: "f-" + Date.now() }, shoban.token);

    const attach = await api("POST", `/api/messages/${msg.body.message.id}/attachments`,
      { attachmentIds: [up.body.file.id] }, shoban.token);
    assert.equal(attach.body.attached, 1);

    const list = await api("GET", `/api/conversations/${dmId}/messages?afterSeq=${msg.body.message.seq - 1}&limit=5`,
      null, shoban.token);
    const found = list.body.messages.find(m => Number(m.id) === Number(msg.body.message.id));
    assert.ok(found.files.some(f => f.fileName === "evidence.pdf"), "file listed on the message");
  });

  test("you cannot attach to someone else's message", async () => {
    const up = await uploadFile(dmId, { name: "mine.txt", type: "text/plain", content: "x" }, pavithran.token);
    const msg = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "not yours", clientMsgId: "g-" + Date.now() }, shoban.token);
    const r = await api("POST", `/api/messages/${msg.body.message.id}/attachments`,
      { attachmentIds: [up.body.file.id] }, pavithran.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "not_author");
  });

  test("you cannot attach a file from another conversation", async () => {
    const other = await api("POST", "/api/conversations",
      { kind: "channel", name: "Files elsewhere " + Date.now() }, shoban.token);
    const up = await uploadFile(other.body.conversation.id,
      { name: "elsewhere.txt", type: "text/plain", content: "x" }, shoban.token);

    const msg = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "cross convo", clientMsgId: "h-" + Date.now() }, shoban.token);
    const r = await api("POST", `/api/messages/${msg.body.message.id}/attachments`,
      { attachmentIds: [up.body.file.id] }, shoban.token);
    assert.equal(r.body.attached, 0, "silently attaches nothing");
  });

  test("refuses more than ten files on one message", async () => {
    const msg = await api("POST", `/api/conversations/${dmId}/messages`,
      { body: "too many", clientMsgId: "i-" + Date.now() }, shoban.token);
    const r = await api("POST", `/api/messages/${msg.body.message.id}/attachments`,
      { attachmentIds: Array.from({ length: 11 }, (_, i) => i + 1) }, shoban.token);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "too_many");
  });
});

describe("the file browser", () => {
  test("lists clean files for the conversation, newest first", async () => {
    const r = await api("GET", `/api/conversations/${dmId}/files`, null, pavithran.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.files.length > 0);
    assert.ok(r.body.files.every(f => f.fileName !== "eicar.txt"), "infected files excluded");
    assert.ok(r.body.files[0].uploaderName, "uploader named");
  });

  test("filters by kind", async () => {
    await uploadFile(dmId, { name: "shot.png", type: "image/png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }, shoban.token);
    const media = await api("GET", `/api/conversations/${dmId}/files?kind=media`, null, shoban.token);
    assert.ok(media.body.files.every(f => ["image", "video"].includes(f.mediaKind)));
    assert.ok(media.body.files.some(f => f.fileName === "shot.png"));

    const docs = await api("GET", `/api/conversations/${dmId}/files?kind=file`, null, shoban.token);
    assert.ok(docs.body.files.every(f => f.mediaKind === "file"));
  });

  test("paginates and caps the limit", async () => {
    const r = await api("GET", `/api/conversations/${dmId}/files?limit=2`, null, shoban.token);
    assert.equal(r.body.files.length, 2);
    assert.ok(r.body.total >= 2);
    const capped = await api("GET", `/api/conversations/${dmId}/files?limit=99999`, null, shoban.token);
    assert.equal(capped.body.limit, 200);
  });

  test("a non-member cannot browse", async () => {
    const r = await api("GET", `/api/conversations/${dmId}/files`, null, vignesh.token);
    assert.equal(r.status, 403);
  });
});

describe("versions and deletion", () => {
  test("a new version links back to the previous one", async () => {
    const v1 = await uploadFile(dmId, { name: "policy.txt", type: "text/plain", content: "version one" }, shoban.token);
    const v2 = await uploadFile(dmId,
      { name: "policy.txt", type: "text/plain", content: "version two" },
      shoban.token, { versionOfId: v1.body.file.id });

    assert.equal(v2.status, 201);
    assert.equal(Number(v2.body.file.versionOfId), Number(v1.body.file.id));

    const chain = await api("GET", `/api/files/${v2.body.file.id}/versions`, null, shoban.token);
    assert.equal(chain.body.versions.length, 2);
    assert.equal(Number(chain.body.versions[0].id), Number(v2.body.file.id), "newest first");
  });

  test("the uploader can delete, and the bytes go too", async () => {
    const up = await uploadFile(dmId, { name: "temp.txt", type: "text/plain", content: "remove me" }, shoban.token);
    const row = await db.one("SELECT storage_key FROM attachments WHERE id = ?", [up.body.file.id]);

    const del = await api("DELETE", `/api/files/${up.body.file.id}`, null, shoban.token);
    assert.equal(del.status, 200);
    assert.equal(await filesSvc.storage.exists(row.storage_key), false, "bytes removed");

    const dl = await api("GET", `/api/files/${up.body.file.id}/download`, null, shoban.token);
    assert.equal(dl.status, 404);
  });

  test("another member who is not an owner cannot delete someone else's file", async () => {
    const up = await uploadFile(dmId, { name: "protected.txt", type: "text/plain", content: "mine" }, shoban.token);
    const r = await api("DELETE", `/api/files/${up.body.file.id}`, null, pavithran.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "not_allowed");
  });
});

describe("scanner driver", () => {
  test("detects EICAR and passes ordinary content", () => {
    assert.equal(scanner.scanLocally(Buffer.from(scanner.EICAR)).verdict, "infected");
    assert.equal(scanner.scanLocally(Buffer.from("an ordinary file")).verdict, "clean");
  });

  test("detects EICAR even when it is not at the very start", () => {
    const buf = Buffer.from("padding padding " + scanner.EICAR);
    assert.equal(scanner.scanLocally(buf).verdict, "infected");
  });
});
