#!/usr/bin/env node
"use strict";
/**
 * DEV ONLY. Gives every seeded user the development password so a fresh
 * database can be signed into. Refuses to run in production.
 *
 * Written for dAI: CI (.github/workflows/ci.yml) calls this script but the
 * module bundle never shipped it. In Phase 1 real users sign in with their
 * dadmin.employee credentials instead (see docs/PHASES.md).
 */
const config = require("../src/config");
if (config.isProd()) {
  console.error("seed-passwords is development only. Refusing to run in production.");
  process.exit(1);
}
const db = require("../src/db");
const auth = require("../src/services/auth.service");

const DEV_PASSWORD = process.env.DEV_SEED_PASSWORD || "Kody!Dev2026";

(async () => {
  const [users] = await db.query("SELECT id, email FROM users WHERE deleted_at IS NULL");
  for (const u of users) {
    await auth.setPassword(u.id, DEV_PASSWORD);
    await db.query("UPDATE users SET is_active = 1 WHERE id = ?", [u.id]);
  }
  await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL");
  console.log(`Set the development password for ${users.length} user(s).`);
  await db.end();
})().catch(async (err) => { console.error(err); await db.end().catch(() => {}); process.exit(1); });
