"use strict";
/**
 * MySQL pool and helpers.
 *
 * Written for dAI because the module bundle required "./db" in 31 places but
 * never shipped the file. The contract below is what those call sites use:
 *
 *   db.query(sql, params)   -> [rows, fields]    (mysql2 pool.query)
 *   db.one(sql, params)     -> first row or null
 *   db.transaction(fn)      -> runs fn(conn) inside BEGIN / COMMIT, ROLLBACK on throw
 *   db.pool                 -> the underlying pool (tests call db.pool.end())
 *   db.end()                -> closes the pool
 */
const mysql = require("mysql2/promise");
const config = require("./config");

const poolOptions = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
  waitForConnections: true,
  charset: "utf8mb4",
  timezone: "Z",
  supportBigNumbers: true,
  bigNumberStrings: false,
  decimalNumbers: true,
};
if (config.db.socketPath) poolOptions.socketPath = config.db.socketPath;

const pool = mysql.createPool(poolOptions);

// Every connection speaks UTC, so NOW() and JS Dates agree.
pool.on("connection", (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

function query(sql, params) {
  return pool.query(sql, params);
}

async function one(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows && rows.length ? rows[0] : null;
}

async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* connection already broken */ }
    throw err;
  } finally {
    conn.release();
  }
}

function end() {
  return pool.end();
}

module.exports = { pool, query, one, transaction, end };
