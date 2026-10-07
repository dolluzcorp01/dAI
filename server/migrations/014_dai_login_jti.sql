-- =====================================================================
-- 014_dai_login_jti.sql
--
-- Replay protection for the dAdmin handoff (docs/17-portal-sso.md section 7).
--
-- dAdmin mints a 60 second JWT with aud 'dai-login' and a jti, and says plainly
-- that single use is dAI's to enforce: it cannot do it itself without a second
-- round trip. This table is that enforcement, and it is a table rather than a
-- set in memory for two reasons, neither of which announces itself when it goes
-- wrong:
--
--   1. Two pm2 instances would each keep their own set, so a replay against the
--      other instance succeeds. Production requires REDIS_URL exactly because a
--      second instance is expected, and deploy.sh supports it.
--   2. A pm2 restart empties a set in memory, so a replay inside the remaining
--      seconds succeeds. A restart is a routine thing, not an incident.
--
-- Neither failure logs anything or breaks a test. A unique key in InnoDB does.
--
-- The mechanism is the unique key and nothing else: the insert IS the check, so
-- there is no window between looking and writing. auth_codes already works this
-- way (migration 001).
--
-- WHAT IS NOT HERE: the emp_id, the token, or anything about the person. The
-- row exists to answer "has this exact token been spent", and audit_log already
-- records who signed in and how. A replay guard does not need to know whose
-- replay it refused.
--
-- expires_at is the token's own exp. A row is dead weight after that, and
-- scripts/retention.js sweeps them.
-- =====================================================================

CREATE TABLE dai_login_jti (
  jti         VARCHAR(64)  NOT NULL,            -- dAdmin sends a uuid; 64 leaves room
  expires_at  DATETIME     NOT NULL,            -- the token's exp, in UTC
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (jti),
  KEY ix_dai_login_jti_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
