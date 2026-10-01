"use strict";
/**
 * dAI: what an error is allowed to put in a log (docs/11-notifications.md rule 17,
 * and the same reasoning).
 *
 * A mysql2 error carries `sql`: the statement with the values filled in. A Kody
 * question can carry patient detail, so `console.error("...", err)` writes that
 * detail to disk, where it is kept, shipped and backed up. Proven, not assumed:
 * a failing insert of "Why was the claim for Jane Doe, DOB 1974-03-02, MRN 55012
 * denied?" put the whole sentence in err.sql.
 *
 * So nothing logs an error object. Everything logs this, which is the kind, the
 * driver's code and the message, and one frame to find it by.
 *
 * Known residue: a few MySQL messages echo one offending value, ER_DUP_ENTRY
 * being the obvious one. Our unique keys are ids and email addresses rather
 * than message bodies, so a question cannot arrive that way, and the message is
 * capped so nothing arrives at length.
 */
const MAX_MESSAGE = 300;

/** The first frame inside our own source, which is the one worth having. */
function firstAppFrame(stack) {
  const lines = String(stack || "").split("\n").slice(1);
  const mine = lines.find(l => /[\\/]src[\\/]/.test(l) && !/node_modules/.test(l));
  if (!mine) return null;
  const at = mine.trim().replace(/^at\s+/, "");
  return at.length > 160 ? at.slice(0, 160) : at;
}

/** A single line that is safe to write down. Never includes sql or parameters. */
function describeError(err) {
  if (err === null || err === undefined) return "no error given";
  if (typeof err !== "object") return String(err).slice(0, MAX_MESSAGE);

  const bits = [];
  if (err.name && err.name !== "Error") bits.push(err.name);
  if (err.code) bits.push(String(err.code));
  if (err.errno !== undefined && err.errno !== null) bits.push(`errno ${err.errno}`);
  if (err.sqlState) bits.push(`sqlState ${err.sqlState}`);

  const message = String(err.message === undefined ? "" : err.message).slice(0, MAX_MESSAGE);
  if (message) bits.push(message);

  const frame = firstAppFrame(err.stack);
  if (frame) bits.push(`at ${frame}`);

  return bits.length > 0 ? bits.join(" | ") : "error with nothing safe to report";
}

/** Use this everywhere instead of console.error(label, err). */
function logError(label, err) {
  console.error(label, describeError(err));
}

module.exports = { describeError, logError, MAX_MESSAGE };
