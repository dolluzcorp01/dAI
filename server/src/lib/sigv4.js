"use strict";
const crypto = require("crypto");

/**
 * SigV4 signing for S3-compatible storage.
 *
 * Written by hand rather than pulling in the AWS SDK, for two reasons. The SDK
 * is tens of megabytes for four operations, and this file can be verified
 * against AWS's own published test vectors, which is a stronger guarantee than
 * "the dependency presumably works".
 *
 * Reference: AWS Signature Version 4 signing process.
 */

const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

const EMPTY_SHA256 = sha256hex("");

/**
 * Percent-encode for a URI path or a query value.
 *
 * S3 requires the unreserved set to stay literal and everything else to be
 * encoded, including characters encodeURIComponent leaves alone.
 */
function uriEncode(input, encodeSlash = true) {
  let out = "";
  for (const ch of String(input)) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch;
    } else if (ch === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      for (const byte of Buffer.from(ch, "utf8")) {
        out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

const amzDate = (date) => date.toISOString().replace(/[:-]|\.\d{3}/g, "");
const dateStamp = (date) => amzDate(date).slice(0, 8);

/**
 * Build the canonical request, the string to sign, and the signature.
 *
 * Returned in full rather than just the header, so the intermediate values can
 * be compared against AWS's test vectors.
 */
function signRequest({
  method, host, path: rawPath, query = {}, headers = {}, payloadHash = EMPTY_SHA256,
  accessKey, secretKey, region, service = "s3", date = new Date(),
  // S3 requires x-amz-content-sha256 on every request. Other services do not
  // send it, and AWS's published test vectors are for those, so this is a flag
  // rather than a constant: it lets the signer be checked against the vectors.
  includeContentSha256 = true,
}) {
  const stamp = dateStamp(date);
  const timestamp = amzDate(date);

  // The path is already the storage key, which we generated, so it contains
  // only safe characters. Encoding it anyway costs nothing and protects
  // against a future key format.
  const canonicalPath = "/" + String(rawPath).replace(/^\/+/, "")
    .split("/").map(seg => uriEncode(seg, true)).join("/");

  const canonicalQuery = Object.keys(query).sort()
    .map(k => `${uriEncode(k)}=${uriEncode(query[k] === undefined ? "" : query[k])}`)
    .join("&");

  const allHeaders = {
    host,
    ...(includeContentSha256 ? { "x-amz-content-sha256": payloadHash } : {}),
    "x-amz-date": timestamp,
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  };

  const signedHeaderNames = Object.keys(allHeaders).sort();
  const canonicalHeaders = signedHeaderNames
    .map(k => `${k}:${String(allHeaders[k]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method.toUpperCase(), canonicalPath, canonicalQuery,
    canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");

  const scope = `${stamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", timestamp, scope, sha256hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${secretKey}`, stamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    canonicalRequest, stringToSign, signature, authorization,
    headers: { ...allHeaders, authorization },
    canonicalPath, canonicalQuery, signedHeaders, scope, timestamp,
  };
}

module.exports = { signRequest, uriEncode, sha256hex, amzDate, dateStamp, EMPTY_SHA256 };
