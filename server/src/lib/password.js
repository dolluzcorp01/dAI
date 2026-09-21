"use strict";
/**
 * Password hashing.
 *
 * scrypt from node's crypto, which needs no native build step. If you later
 * move to argon2id, keep the stored format prefixed so both can coexist and
 * rehash on next successful login.
 *
 * Stored format:  scrypt$N$r$p$<salt base64>$<hash base64>
 */
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const N = 16384;   // CPU/memory cost
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

async function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(plain, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let key;
  try {
    key = await scrypt(String(plain), salt, expected.length, { N: n, r, p, maxmem: 64 * 1024 * 1024 });
  } catch (_) {
    return false;
  }
  if (key.length !== expected.length) return false;
  return crypto.timingSafeEqual(key, expected);
}

/**
 * Burn roughly the same time as a real verification when the account does not
 * exist, so response timing cannot be used to enumerate valid emails.
 */
async function fakeVerify() {
  const salt = crypto.randomBytes(SALT_BYTES);
  await scrypt("timing-equaliser", salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return false;
}

module.exports = { hashPassword, verifyPassword, fakeVerify };
