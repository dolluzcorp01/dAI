-- =====================================================================
-- 010_admin.sql
--
-- What the admin console needs that nothing else did.
--
-- `report_runs` exists because an export containing message content is an
-- export of PHI. Who ran it, over what range, and how many rows left the
-- system has to be answerable months later.
-- =====================================================================

CREATE TABLE app_versions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  surface      ENUM('server','web','extension','desktop','android','ios') NOT NULL,
  version      VARCHAR(40)     NOT NULL,
  released_on  DATE            NULL,
  release_note TEXT            NULL,
  is_current   TINYINT(1)      NOT NULL DEFAULT 1,
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_app_versions_surface (surface, is_current),
  CONSTRAINT fk_app_versions_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE report_runs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_code   VARCHAR(60)     NOT NULL,
  format        ENUM('xlsx','pdf','csv') NOT NULL,
  requested_by  BIGINT UNSIGNED NULL,
  range_from    DATE            NULL,
  range_to      DATE            NULL,
  row_count     INT UNSIGNED    NOT NULL DEFAULT 0,
  contains_content TINYINT(1)   NOT NULL DEFAULT 0,  -- did message text leave
  ip_address    VARBINARY(16)   NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_report_runs_who (requested_by, created_at),
  KEY ix_report_runs_code (report_code, created_at),
  CONSTRAINT fk_report_runs_user FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_versions (surface, version, released_on, release_note, is_current) VALUES
  ('server', '0.9.0', CURDATE(), 'Backend through module 12.', 1),
  ('web',    '0.9.0', CURDATE(), 'Client SDK and login screen.', 1);

-- Settings the admin console edits. Values are strings; the service casts and
-- validates them, so a bad value is rejected rather than stored.
INSERT INTO org_settings (setting_key, setting_value) VALUES
  ('org.name', 'Dolluz Corporation'),
  ('spaces.default_retention', '1y'),
  ('auth.require_mfa', 'false'),
  ('reports.allow_content_export', 'false')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
