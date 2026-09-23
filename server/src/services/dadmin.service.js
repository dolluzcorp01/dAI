"use strict";
const bcrypt = require("bcryptjs");
const db = require("../db");
const config = require("../config");

/**
 * The dAdmin link.
 *
 * dAdmin owns the employee record and the password. dAI reads dadmin and never
 * writes to it: the database user holds SELECT on nine columns of
 * dadmin.employee and nothing else, so a query for anything wider, including
 * account_pass_text, the bank columns, aadhar_number or pan_number, is refused
 * by MySQL rather than by this code remembering to avoid it.
 *
 * What is copied into Kody is deliberately small: emp_id, name, work email, and
 * a role on first sign-in. The password is never copied, in any form.
 */

class DadminError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* The nine columns the grant allows. Written once, used by every query here. */
const EMPLOYEE_COLUMNS = `
  emp_id AS empId, emp_mail_id AS email, account_pass AS passwordHash,
  emp_first_name AS firstName, emp_last_name AS lastName,
  emp_access_level AS accessLevel, active, deleted_time AS deletedTime, app_dAI AS appDai
`;

/**
 * The database name is configuration, not user input, and an identifier cannot
 * be a bound parameter. Refuse anything that is not a plain identifier rather
 * than interpolating it and hoping.
 */
function dadminDb() {
  const name = config.dadmin.dbName;
  if (!/^[A-Za-z0-9_$]+$/.test(String(name || ""))) {
    throw new DadminError(500, "bad_dadmin_db", "DADMIN_DB_NAME is not a plain identifier.");
  }
  return `\`${name}\``;
}

async function findEmployeeByEmail(email) {
  const clean = String(email || "").trim();
  if (!clean) return null;
  return db.one(
    `SELECT ${EMPLOYEE_COLUMNS} FROM ${dadminDb()}.employee
      WHERE emp_mail_id = ? AND deleted_time IS NULL LIMIT 1`,
    [clean]
  );
}

async function findEmployeeByEmpId(empId) {
  const clean = String(empId || "").trim();
  if (!clean) return null;
  return db.one(
    `SELECT ${EMPLOYEE_COLUMNS} FROM ${dadminDb()}.employee
      WHERE emp_id = ? LIMIT 1`,
    [clean]
  );
}

/** bcryptjs reads the $2a, $2b and $2y hashes dAdmin writes. */
async function verifyEmployeePassword(plain, hash) {
  if (typeof hash !== "string" || !/^\$2[aby]\$\d{2}\$/.test(hash)) return false;
  try {
    return await bcrypt.compare(String(plain == null ? "" : plain), hash);
  } catch (_) {
    return false;
  }
}

/**
 * May this employee use dAI at all? Kept separate from the password check so
 * the answer is only ever given to someone who already proved the password.
 */
function accessProblem(employee) {
  if (!employee) return "not_found";
  if (employee.deletedTime) return "deleted";
  if (!employee.active) return "inactive";
  if (!employee.appDai) return "not_enabled";
  return null;
}

/**
 * Role on FIRST creation only. dAdmin's access level decides where someone
 * starts; after that the role belongs to dAI, and a role edited here is never
 * overwritten by a later sign-in.
 */
function roleForAccessLevel(accessLevel) {
  const level = String(accessLevel || "").trim().toLowerCase();
  if (level === "admin") return "admin";
  if (level === "sub admin" || level === "sub-admin" || level === "subadmin") return "sub_admin";
  return "member";
}

function initialsFor(firstName, lastName) {
  const letters = `${firstName || ""} ${lastName || ""}`
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join("");
  return (letters || "??").slice(0, 4);
}

const fullNameOf = (employee) =>
  `${employee.firstName || ""} ${employee.lastName || ""}`.trim().slice(0, 160) || employee.empId;

/**
 * Create the Kody user for an employee, or bring the existing one up to date.
 *
 * Three cases, in order:
 *   1. A Kody user already carries this emp_id. Refresh the name and email.
 *   2. A Kody user has the same email but no emp_id, which is how the seed
 *      users and anyone from before Phase 1 look. Adopt it by writing emp_id.
 *      Its roles are left exactly as they are.
 *   3. Nobody matches, so create the user and give it the mapped role.
 */
async function syncUser(employee) {
  const fullName = fullNameOf(employee);
  const email = String(employee.email || "").trim();

  const byEmpId = await db.one(`SELECT id FROM users WHERE emp_id = ?`, [employee.empId]);
  if (byEmpId) {
    await db.query(
      `UPDATE users SET full_name = ?, email = ?, is_active = 1, deleted_at = NULL WHERE id = ?`,
      [fullName, email, byEmpId.id]
    );
    return { userId: byEmpId.id, created: false, adopted: false };
  }

  const byEmail = await db.one(
    `SELECT id, emp_id AS empId FROM users WHERE email = ?`, [email]
  );
  if (byEmail && !byEmail.empId) {
    await db.query(
      `UPDATE users SET emp_id = ?, full_name = ?, is_active = 1, deleted_at = NULL WHERE id = ?`,
      [employee.empId, fullName, byEmail.id]
    );
    return { userId: byEmail.id, created: false, adopted: true };
  }
  if (byEmail && byEmail.empId && byEmail.empId !== employee.empId) {
    // Two employees cannot share a work email. This is a dadmin data problem,
    // and guessing which person is signing in would be worse than refusing.
    throw new DadminError(409, "email_belongs_to_another_employee",
      "That work email is already linked to a different employee in dAI.");
  }

  const role = roleForAccessLevel(employee.accessLevel);
  const userId = await db.transaction(async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO users (emp_id, email, full_name, initials, is_active)
       VALUES (?,?,?,?,1)`,
      [employee.empId, email, fullName, initialsFor(employee.firstName, employee.lastName)]
    );
    const id = res.insertId;
    await conn.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?`,
      [id, role]
    );
    await conn.query(`INSERT IGNORE INTO user_settings (user_id) VALUES (?)`, [id]);
    await conn.query(`INSERT IGNORE INTO notification_prefs (user_id) VALUES (?)`, [id]);
    return id;
  });
  return { userId, created: true, adopted: false, role };
}

/**
 * Sign in with dadmin credentials.
 *
 * Returns null when dadmin has no such employee, so the caller can fall through
 * to a local Kody password in development. Throws when the employee exists but
 * the password is wrong or dAI is not enabled for them.
 *
 * The password is checked BEFORE the access flags, so someone who cannot supply
 * the password learns nothing about whether an account exists or is enabled.
 */
async function signIn(email, password) {
  const employee = await module.exports.findEmployeeByEmail(email);
  if (!employee) return null;

  const ok = await verifyEmployeePassword(password, employee.passwordHash);
  if (!ok) throw new DadminError(401, "invalid_credentials", "Email or password is incorrect.");

  const problem = accessProblem(employee);
  if (problem) {
    throw new DadminError(403, "dai_not_enabled",
      "This account does not have access to dAI. Ask an administrator to enable it in dAdmin.");
  }

  const synced = await module.exports.syncUser(employee);
  return {
    id: synced.userId,
    empId: employee.empId,
    email: String(employee.email || "").trim(),
    fullName: fullNameOf(employee),
    created: synced.created,
  };
}

/**
 * Re-check on refresh, so turning someone off in dAdmin ends their access
 * rather than waiting for a 30 day refresh token to expire.
 * Returns null when the employee still has access, or a reason when not.
 */
async function accessRevoked(empId) {
  if (!empId) return null;
  const employee = await module.exports.findEmployeeByEmpId(empId);
  return accessProblem(employee);
}

module.exports = {
  DadminError, EMPLOYEE_COLUMNS,
  findEmployeeByEmail, findEmployeeByEmpId, verifyEmployeePassword,
  accessProblem, roleForAccessLevel, initialsFor, syncUser, signIn, accessRevoked,
};
