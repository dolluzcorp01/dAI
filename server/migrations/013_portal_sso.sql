-- =====================================================================
-- 013_portal_sso.sql
--
-- Single sign-on from Inside D (docs/17-portal-sso.md).
--
-- Nothing here stores anything about the portal: no portal token, no portal
-- session id, no handoff code. Inside D hands dAI an emp_id and dAI decides
-- the rest for itself, which is the whole point of the design.
--
-- What is stored is one word per session: HOW the person proved who they are.
--
--   password  they typed their dadmin.employee password into Kody's own page
--   portal    Inside D vouched for them, because they already had a portal
--             session open
--
-- It is needed for two reasons, and only one of them is reporting:
--
--   1. A session obtained from a portal session must not outlive it by a
--      month. A portal sign-in gets a working day (PORTAL_SESSION_HOURS,
--      8 by default) instead of REFRESH_TOKEN_DAYS.
--   2. Refresh rotation INSERTs a new session row every fifteen minutes. If
--      that row did not carry the word forward it would be issued with the
--      30 day expiry, and the shorter life would last exactly one refresh.
--      That is the bug this column exists to make impossible.
--
-- Existing rows are 'password', which is what every session in the database
-- today actually is: there was no other way in before this migration.
-- =====================================================================

ALTER TABLE auth_codes
  ADD COLUMN origin VARCHAR(16) NOT NULL DEFAULT 'password' AFTER surface;

ALTER TABLE sessions
  ADD COLUMN origin VARCHAR(16) NOT NULL DEFAULT 'password' AFTER surface;
