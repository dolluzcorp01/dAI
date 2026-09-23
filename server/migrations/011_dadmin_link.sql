-- =====================================================================
-- 011_dadmin_link.sql
--
-- Phase 1.1. Real people sign in with their dadmin.employee credentials,
-- so a Kody user has to point back at the employee it was created from.
--
-- emp_id is the dadmin code, VARCHAR(20), such as DZIND148. It is NULL for
-- the development seed users and for anyone created before this migration,
-- which is why the column is nullable. MySQL permits repeated NULLs in a
-- unique index, so the key still guarantees that one employee has at most
-- one Kody user.
--
-- Identity is not duplicated: dadmin owns the employee record and the
-- password. This column is the only copy of anything dadmin owns, and it is
-- an identifier, not a credential.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN emp_id VARCHAR(20) NULL AFTER email,
  ADD UNIQUE KEY uq_users_emp_id (emp_id);
