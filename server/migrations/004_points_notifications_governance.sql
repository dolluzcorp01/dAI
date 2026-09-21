-- =====================================================================
-- 004_points_notifications_governance.sql
-- Cheer points, notification preferences, quick links, audit trail and
-- the org settings the admin console edits.
-- =====================================================================

-- Append-only ledger. Balance is the SUM, never a column you edit.
-- A daily cap and a unique event key are what stop thumbs-up farming.
CREATE TABLE point_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  event_code  VARCHAR(48)     NOT NULL,   -- helpful | adopted | sme_accepted
  points      INT             NOT NULL,
  ref_type    VARCHAR(48)     NULL,
  ref_id      BIGINT UNSIGNED NULL,
  idempotency_key VARCHAR(120) NULL,      -- e.g. helpful:kody_message:1234
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_point_idem (idempotency_key),
  KEY ix_point_user_time (user_id, created_at),
  CONSTRAINT fk_point_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The admin console's points calculator writes here. Nothing is hardcoded.
CREATE TABLE point_rules (
  event_code  VARCHAR(48)  NOT NULL,
  label       VARCHAR(160) NOT NULL,
  points      INT          NOT NULL,
  daily_cap   INT          NOT NULL DEFAULT 0,   -- 0 means no cap
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (event_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_prefs (
  user_id      BIGINT UNSIGNED NOT NULL,
  desktop      TINYINT(1) NOT NULL DEFAULT 0,
  push         TINYINT(1) NOT NULL DEFAULT 0,
  email_digest TINYINT(1) NOT NULL DEFAULT 1,
  quiet_hours  TINYINT(1) NOT NULL DEFAULT 0,
  quiet_start  TIME       NULL,
  quiet_end    TIME       NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_notif_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_keywords (
  user_id BIGINT UNSIGNED NOT NULL,
  keyword VARCHAR(80)     NOT NULL,
  PRIMARY KEY (user_id, keyword),
  CONSTRAINT fk_notif_kw_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  kind       ENUM('feature','update','highlight','mention','keyword','sme','system') NOT NULL,
  title      VARCHAR(200)    NULL,
  body       VARCHAR(600)    NOT NULL,
  ref_type   VARCHAR(48)     NULL,
  ref_id     BIGINT UNSIGNED NULL,
  read_at    DATETIME        NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_notifications_user (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- user_id null means a Kody-team default link shown to everyone.
CREATE TABLE quick_links (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NULL,
  label      VARCHAR(160)    NOT NULL,
  url        VARCHAR(1000)   NOT NULL,
  position   SMALLINT        NOT NULL DEFAULT 0,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_quick_links_user (user_id, position),
  CONSTRAINT fk_quick_links_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-user client preferences: theme, wallpaper, avatar, predictive toggle.
CREATE TABLE user_settings (
  user_id          BIGINT UNSIGNED NOT NULL,
  accent           VARCHAR(24) NOT NULL DEFAULT 'gold',
  wallpaper        VARCHAR(24) NOT NULL DEFAULT 'none',
  kody_avatar      VARCHAR(24) NOT NULL DEFAULT 'mark',
  kody_avatar_url  VARCHAR(512) NULL,
  predictive       TINYINT(1)  NOT NULL DEFAULT 1,
  font_scale       DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  locale           VARCHAR(12) NOT NULL DEFAULT 'en',
  updated_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only. Never updated, never deleted by the application.
CREATE TABLE audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    BIGINT UNSIGNED NULL,
  action      VARCHAR(80)     NOT NULL,   -- auth.login, message.delete_all, space.archive
  entity_type VARCHAR(60)     NULL,
  entity_id   BIGINT UNSIGNED NULL,
  ip_address  VARBINARY(16)   NULL,
  user_agent  VARCHAR(400)    NULL,
  meta        TEXT            NULL,       -- JSON payload
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_actor (actor_id, created_at),
  KEY ix_audit_action (action, created_at),
  KEY ix_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Keyword blocking / DLP. Checked before a message is persisted.
CREATE TABLE dlp_rules (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label       VARCHAR(160) NOT NULL,
  pattern     VARCHAR(400) NOT NULL,      -- regex
  action      ENUM('warn','block','redact') NOT NULL DEFAULT 'warn',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE org_settings (
  setting_key   VARCHAR(80)  NOT NULL,
  setting_value VARCHAR(1000) NULL,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_org_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO point_rules (event_code, label, points, daily_cap) VALUES
  ('helpful','Marked an answer helpful',25,500),
  ('adopted','Answer adopted by a colleague',50,0),
  ('sme_accepted','SME correction accepted',100,0);

INSERT INTO org_settings (setting_key, setting_value) VALUES
  ('points.per_cent','1000'),
  ('points.show_cash','false'),
  ('files.max_mb','25'),
  ('auth.access_token_minutes','15'),
  ('auth.refresh_token_days','30'),
  ('auth.code_ttl_seconds','60');
