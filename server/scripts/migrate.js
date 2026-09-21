#!/usr/bin/env node
/**
 * Kody migration runner.
 *
 *   node scripts/migrate.js            apply everything pending
 *   node scripts/migrate.js --status   list applied and pending
 *   node scripts/migrate.js --fresh    DROP and rebuild (dev only)
 *
 * Migrations are applied in filename order and recorded in
 * schema_migrations, so applying twice is a no-op. Each file runs
 * inside a transaction where the statements allow it.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const DIR = path.join(__dirname, "..", "migrations");

function env(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback === undefined) {
      console.error(`Missing required env var ${key}. Copy .env.example to .env first.`);
      process.exit(1);
    }
    return fallback;
  }
  return v;
}

async function connect() {
  const cfg = {
    host: env("DB_HOST", "127.0.0.1"),
    port: Number(env("DB_PORT", "3306")),
    user: env("DB_USER", "kody"),
    password: env("DB_PASSWORD", ""),
    database: env("DB_NAME", "kody"),
    multipleStatements: true,
    charset: "utf8mb4",
  };
  if (process.env.DB_SOCKET) cfg.socketPath = process.env.DB_SOCKET;
  return mysql.createConnection(cfg);
}

async function ensureTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(190) NOT NULL,
      checksum    CHAR(64)     NOT NULL,
      applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

function files() {
  return fs.readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function main() {
  const mode = process.argv[2] || "";
  const db = await connect();

  if (mode === "--fresh") {
    if (env("NODE_ENV", "development") === "production") {
      console.error("Refusing to run --fresh with NODE_ENV=production.");
      process.exit(1);
    }
    const name = env("DB_NAME", "kody");
    await db.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await db.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.query(`USE \`${name}\``);
    console.log(`Dropped and recreated ${name}`);
  }

  await ensureTable(db);
  const [rows] = await db.query("SELECT filename, checksum FROM schema_migrations");
  const applied = new Map(rows.map(r => [r.filename, r.checksum]));

  if (mode === "--status") {
    for (const f of files()) {
      const body = fs.readFileSync(path.join(DIR, f), "utf8");
      if (!applied.has(f)) console.log(`pending  ${f}`);
      else if (applied.get(f) !== sha(body)) console.log(`CHANGED  ${f}  <-- already applied but the file was edited`);
      else console.log(`applied  ${f}`);
    }
    await db.end();
    return;
  }

  let count = 0;
  for (const f of files()) {
    const body = fs.readFileSync(path.join(DIR, f), "utf8");
    const sum = sha(body);

    if (applied.has(f)) {
      if (applied.get(f) !== sum) {
        console.error(`\n${f} was already applied but its contents changed.`);
        console.error("Never edit an applied migration. Add a new one instead.");
        process.exit(1);
      }
      continue;
    }

    process.stdout.write(`applying ${f} ... `);
    const t0 = Date.now();
    try {
      await db.query(body);
      const ms = Date.now() - t0;
      await db.query(
        "INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES (?,?,?)",
        [f, sum, ms]
      );
      console.log(`ok (${ms}ms)`);
      count++;
    } catch (err) {
      console.log("FAILED");
      console.error(`\n${err.sqlMessage || err.message}`);
      console.error(
        `\nWARNING: ${f} was NOT recorded as applied, but MySQL cannot roll back DDL,\n` +
        `so statements before the failure may already have taken effect.\n` +
        `Inspect the database and undo them before retrying, or this file will\n` +
        `fail again on the statement that already succeeded.`
      );
      await db.end();
      process.exit(1);
    }
  }

  console.log(count === 0 ? "Nothing to apply, schema is current." : `Applied ${count} migration(s).`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
