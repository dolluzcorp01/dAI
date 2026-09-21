"use strict";
/**
 * Small validation helpers.
 *
 * The important one is `pick`. Every PATCH must whitelist the fields it
 * accepts, otherwise a caller can set columns you never intended, such as
 * is_active or a role. Never spread a request body into a SQL update.
 */

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.code = "validation_failed";
    this.field = field;
  }
}

/** Return only the allowed keys that are actually present in the body. */
function pick(body, allowed) {
  const out = {};
  if (!body || typeof body !== "object") return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  }
  return out;
}

function str(value, field, { max = 255, min = 0, allowNull = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new ValidationError(`${field} is required.`, field);
  }
  if (typeof value !== "string") throw new ValidationError(`${field} must be text.`, field);
  const v = value.trim();
  if (v.length < min) throw new ValidationError(`${field} must be at least ${min} characters.`, field);
  if (v.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer.`, field);
  return v;
}

function oneOf(value, field, allowed, { allowNull = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new ValidationError(`${field} is required.`, field);
  }
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}.`, field);
  }
  return value;
}

function bool(value, field) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === 1 || value === 0) return value;
  if (value === "true") return 1;
  if (value === "false") return 0;
  throw new ValidationError(`${field} must be true or false.`, field);
}

/** HH:MM or HH:MM:SS, normalised to HH:MM:SS. */
function time(value, field, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw new ValidationError(`${field} is required.`, field);
  }
  const m = String(value).match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) throw new ValidationError(`${field} must be a time like 09:30.`, field);
  return `${m[1]}:${m[2]}:${m[3] || "00"}`;
}

function int(value, field, { min = -Infinity, max = Infinity, allowNull = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw new ValidationError(`${field} is required.`, field);
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ValidationError(`${field} must be a whole number.`, field);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}.`, field);
  return n;
}

/**
 * IANA timezone. Validated by asking the runtime rather than keeping a list
 * that goes stale.
 */
function timezone(value, field) {
  const v = str(value, field, { max: 64 });
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return v;
  } catch (_) {
    throw new ValidationError(`${field} is not a recognised timezone.`, field);
  }
}

function url(value, field, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw new ValidationError(`${field} is required.`, field);
  }
  const v = str(value, field, { max: 1000 });
  if (!/^https?:\/\//i.test(v)) throw new ValidationError(`${field} must start with http or https.`, field);
  return v;
}

module.exports = { ValidationError, pick, str, oneOf, bool, time, int, timezone, url };
