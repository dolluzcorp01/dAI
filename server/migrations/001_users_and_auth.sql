-- =====================================================================
-- 001_users_and_auth.sql
-- Users, credentials, sessions, and the extension authorisation handoff.
-- Engine: InnoDB, utf8mb4. Runs on MySQL 8 and MariaDB 10.6+.
-- =====================================================================

CREATE TABLE users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email             VARCHAR(190)    NOT NULL,
  full_name         VARCHAR(160)    NOT NULL,
  initials          VARCHAR(4)      NOT NULL DEFAULT '',
  job_title         VARCHAR(160)    NULL,
  team              VARCHAR(80)     NULL,
  timezone          VARCHAR(64)     NOT NULL DEFAULT 'Asia/Kolkata',
  avatar_url        VARCHAR(512)    NULL,

  -- presence
  presence          ENUM('online','away','busy','dnd','offline') NOT NULL DEFAULT 'offline',
  status_emoji      VARCHAR(16)     NULL,
  status_text       VARCHAR(160)    NULL,
  status_expires_at DATETIME        NULL,
  work_start        TIME            NULL,
  work_end          TIME            NULL,
  ooo               TINYINT(1)      NOT NULL DEFAULT 0,
  ooo_message       VARCHAR(500)    NULL,
  dnd_schedule      TINYINT(1)      NOT NULL DEFAULT 0,
  dnd_start         TIME            NULL,
  dnd_end           TIME            NULL,
  last_seen_at      DATETIME        NULL,

  is_active         TINYINT(1)      NOT NULL DEFAULT 1,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at        DATETIME        NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_team (team),
  KEY ix_users_presence (presence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Roles are org-wide. Space-level roles live on conversation_members.
CREATE TABLE roles (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(40)  NOT NULL,
  label       VARCHAR(80)  NOT NULL,
  rank_order  SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_roles (
  user_id     BIGINT UNSIGNED   NOT NULL,
  role_id     SMALLINT UNSIGNED NOT NULL,
  granted_by  BIGINT UNSIGNED   NULL,
  granted_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  KEY ix_user_roles_role (role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_granter FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Password hash kept out of `users` so the common SELECT never carries it.
CREATE TABLE user_credentials (
  user_id             BIGINT UNSIGNED NOT NULL,
  password_hash       VARCHAR(255)    NOT NULL,   -- argon2id
  password_changed_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  must_change         TINYINT(1)      NOT NULL DEFAULT 0,
  failed_attempts     SMALLINT        NOT NULL DEFAULT 0,
  locked_until        DATETIME        NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_credentials_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per signed-in surface. Revoking a row kills that surface only.
-- Only the SHA-256 of the refresh token is stored, never the token.
CREATE TABLE sessions (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            BIGINT UNSIGNED NOT NULL,
  surface            ENUM('web','extension','desktop','android','ios') NOT NULL,
  refresh_token_hash CHAR(64)        NOT NULL,
  user_agent         VARCHAR(400)    NULL,
  ip_address         VARBINARY(16)   NULL,
  issued_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at       DATETIME        NULL,
  expires_at         DATETIME        NOT NULL,
  revoked_at         DATETIME        NULL,
  revoked_reason     VARCHAR(120)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (refresh_token_hash),
  KEY ix_sessions_user_active (user_id, revoked_at, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The extension handoff from v11: the site writes one row, the extension
-- redeems it once, within 60 seconds, and it is dead thereafter.
CREATE TABLE auth_codes (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code_hash     CHAR(64)        NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  surface       ENUM('web','extension','desktop','android','ios') NOT NULL DEFAULT 'extension',
  state         VARCHAR(128)    NOT NULL,   -- CSRF value the extension generated
  redirect_uri  VARCHAR(512)    NOT NULL,
  expires_at    DATETIME        NOT NULL,
  consumed_at   DATETIME        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_codes_hash (code_hash),
  KEY ix_auth_codes_expiry (expires_at, consumed_at),
  CONSTRAINT fk_auth_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Push registration per installed surface. Populated by the mobile apps.
CREATE TABLE devices (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  platform     ENUM('web','extension','desktop','android','ios') NOT NULL,
  push_token   VARCHAR(400)    NULL,
  device_label VARCHAR(160)    NULL,
  last_seen_at DATETIME        NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_push (push_token),
  KEY ix_devices_user (user_id),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (code, label, rank_order) VALUES
  ('super_admin','Super admin',100),
  ('admin','Admin',80),
  ('sub_admin','Sub-admin',60),
  ('coordinator','Coordinator',40),
  ('member','Member',20),
  ('guest','Guest',10);
