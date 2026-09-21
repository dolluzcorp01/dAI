"use strict";
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

/**
 * Access token. Short lived, carries identity and roles, never stored server
 * side. `sid` ties it to the session row so a revoked session can be rejected.
 */
function signAccessToken({ userId, sessionId, roles, surface }) {
  return jwt.sign(
    { sub: String(userId), sid: String(sessionId), roles: roles || [], surface },
    config.auth.accessSecret,
    { expiresIn: `${config.auth.accessMinutes}m`, issuer: "kody", audience: "kody-api" }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.auth.accessSecret, { issuer: "kody", audience: "kody-api" });
}

/**
 * Refresh token. Opaque random string, never a JWT, because it must be
 * revocable. Only its SHA-256 is stored, so a database leak does not hand
 * anyone a working session.
 */
function newRefreshToken() {
  const token = randomToken(48);
  return { token, hash: sha256(token) };
}

/** One-time code for the extension handoff. Same rule: only the hash is stored. */
function newAuthCode() {
  const code = randomToken(32);
  return { code, hash: sha256(code) };
}

const expiryFromNow = (ms) => new Date(Date.now() + ms);

const refreshExpiry = () => expiryFromNow(config.auth.refreshDays * 24 * 60 * 60 * 1000);
const codeExpiry = () => expiryFromNow(config.auth.codeTtlSeconds * 1000);

/**
 * Redirect URIs must match the allowlist exactly. Prefix matching here would
 * let an attacker append a path and steal the code.
 */
function isAllowedRedirect(uri) {
  if (typeof uri !== "string" || uri.length === 0) return false;
  if (config.auth.allowedRedirectUris.includes(uri)) return true;
  // Extension callback: https://<id>.chromiumapp.org/<path>, accepted only for
  // an id listed in EXTENSION_IDS. Never a wildcard. See docs/14-extension.md.
  const m = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/[A-Za-z0-9_\-\/]*$/.exec(uri);
  return !!m && config.extensionIds.includes(m[1]);
}

module.exports = {
  sha256, randomToken,
  signAccessToken, verifyAccessToken,
  newRefreshToken, newAuthCode,
  refreshExpiry, codeExpiry,
  isAllowedRedirect,
};
