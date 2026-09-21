"use strict";
/**
 * Storage drivers.
 *
 * The database row is the record; this is only the bytes. Swapping local disk
 * for DigitalOcean Spaces is a driver change, not an application change.
 *
 * The storage key NEVER contains anything the user supplied. A caller who
 * uploads "../../etc/passwd" gets a key like 2026/09/<uuid>.txt, and their
 * original name is kept in the database column only, for display.
 */
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const { signRequest, sha256hex } = require("./sigv4");

/** Extension derived from the declared type, never from the supplied name. */
const EXT_FOR_MIME = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "audio/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg",
  "application/pdf": "pdf",
  "text/plain": "txt", "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/msword": "doc", "application/vnd.ms-excel": "xls",
  "application/zip": "zip",
};

function keyFor(mimeType) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = EXT_FOR_MIME[mimeType] || "bin";
  return `${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
}

class LocalStorage {
  constructor(root) {
    this.root = path.resolve(root);
  }

  /** Resolve and then verify the path is still inside the root. */
  _resolve(key) {
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error("storage key escapes the root directory");
    }
    return full;
  }

  async put(key, buffer) {
    const full = this._resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer, { mode: 0o640 });
    return { key, bytes: buffer.length };
  }

  async get(key) {
    return fs.readFile(this._resolve(key));
  }

  createReadStream(key) {
    return fsSync.createReadStream(this._resolve(key));
  }

  async exists(key) {
    try { await fs.access(this._resolve(key)); return true; } catch (_) { return false; }
  }

  async remove(key) {
    try { await fs.unlink(this._resolve(key)); return true; } catch (_) { return false; }
  }
}

/**
 * DigitalOcean Spaces, and any other S3-compatible store.
 *
 * Signed with our own SigV4 implementation rather than the AWS SDK: the SDK is
 * tens of megabytes for four operations, and `sigv4.js` is checked against
 * AWS's published test vectors.
 *
 * The bucket is PRIVATE. Nothing here ever makes an object public, because an
 * uploaded remittance is PHI and a public URL is a permanent leak. Downloads
 * are streamed through the API, which checks membership and scan status first.
 */
class SpacesStorage {
  constructor(config) {
    const { endpoint, bucket, region, accessKey, secretKey } = config.files.spaces;
    for (const [name, value] of Object.entries({ endpoint, bucket, region, accessKey, secretKey })) {
      if (!value) {
        throw new Error(`STORAGE_DRIVER=spaces needs SPACES_${name.toUpperCase()} to be set.`);
      }
    }
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.bucket = bucket;
    this.region = region;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.host = new URL(this.endpoint).host;
    this.timeoutMs = Number(process.env.SPACES_TIMEOUT_MS || 20000);
  }

  _objectPath(key) {
    const clean = String(key).replace(/^\/+/, "");
    if (clean.includes("..")) throw new Error("storage key must not contain ..");
    return `/${this.bucket}/${clean}`;
  }

  async _send(method, key, { body = null, headers = {} } = {}) {
    const path = this._objectPath(key);
    const payload = body === null ? Buffer.alloc(0) : body;
    const payloadHash = sha256hex(payload);

    const signed = signRequest({
      method, host: this.host, path, headers,
      payloadHash, accessKey: this.accessKey, secretKey: this.secretKey,
      region: this.region, service: "s3",
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.endpoint}${path}`, {
        method,
        headers: signed.headers,
        body: method === "GET" || method === "HEAD" ? undefined : payload,
        signal: controller.signal,
      });
      return res;
    } catch (err) {
      if (err.name === "AbortError") throw new Error(`Spaces timed out after ${this.timeoutMs}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async put(key, buffer) {
    const res = await this._send("PUT", key, {
      body: buffer,
      headers: {
        "content-length": String(buffer.length),
        "content-type": "application/octet-stream",
        // Explicitly private. Never public-read.
        "x-amz-acl": "private",
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Spaces PUT failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    return { key, bytes: buffer.length };
  }

  async get(key) {
    const res = await this._send("GET", key);
    if (!res.ok) throw new Error(`Spaces GET failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * A stream, so a large attachment is not buffered in the API process.
   * Callers get a Node readable, matching the local driver.
   */
  createReadStream(key) {
    const { Readable, PassThrough } = require("stream");
    const out = new PassThrough();
    this._send("GET", key)
      .then(res => {
        if (!res.ok || !res.body) {
          out.destroy(new Error(`Spaces GET failed: ${res.status}`));
          return;
        }
        Readable.fromWeb(res.body).pipe(out);
      })
      .catch(err => out.destroy(err));
    return out;
  }

  async exists(key) {
    try {
      const res = await this._send("HEAD", key);
      return res.status === 200;
    } catch (_) {
      return false;
    }
  }

  async remove(key) {
    const res = await this._send("DELETE", key);
    // S3 returns 204 for a delete, and also for a key that was never there.
    return res.status === 204 || res.status === 200;
  }
}

function createStorage(config) {
  switch (config.files.driver) {
    case "local": return new LocalStorage(config.files.localPath);
    case "spaces": return new SpacesStorage(config);
    default: throw new Error(`Unknown STORAGE_DRIVER: ${config.files.driver}`);
  }
}

module.exports = { createStorage, LocalStorage, keyFor, EXT_FOR_MIME };
