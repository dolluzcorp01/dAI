-- =====================================================================
-- 009_notifications.sql
--
-- Three things module 11 needs.
--
-- 1. More notification kinds. 004 only covered product announcements and
--    mentions; a message in a conversation and a direct message are the
--    common cases and had nowhere to go.
--
-- 2. Delivery tracking per channel. "Did we email this?" has to be
--    answerable, both to avoid sending a digest twice and to prove what left
--    the system.
--
-- 3. Out of office replies, recorded so the same person is answered once per
--    conversation per day rather than on every message.
-- =====================================================================

ALTER TABLE notifications
  MODIFY COLUMN kind ENUM(
    'feature','update','highlight','mention','keyword','sme','system',
    'message','dm','reply','reaction'
  ) NOT NULL;

ALTER TABLE notifications
  ADD COLUMN conversation_id BIGINT UNSIGNED NULL AFTER ref_id,
  ADD COLUMN actor_id        BIGINT UNSIGNED NULL AFTER conversation_id,
  ADD COLUMN delivered_inapp   TINYINT(1) NOT NULL DEFAULT 1 AFTER read_at,
  ADD COLUMN delivered_desktop TINYINT(1) NOT NULL DEFAULT 0 AFTER delivered_inapp,
  ADD COLUMN delivered_push    TINYINT(1) NOT NULL DEFAULT 0 AFTER delivered_desktop,
  ADD COLUMN delivered_email   TINYINT(1) NOT NULL DEFAULT 0 AFTER delivered_push,
  ADD COLUMN suppressed_reason VARCHAR(40) NULL AFTER delivered_email,
  ADD CONSTRAINT fk_notifications_conversation
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_notifications_actor
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX ix_notifications_digest
  ON notifications (user_id, delivered_email, read_at, created_at);

-- One auto-reply per sender per conversation per day.
CREATE TABLE ooo_replies (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_user_id    BIGINT UNSIGNED NOT NULL,   -- the person who is away
  to_user_id      BIGINT UNSIGNED NOT NULL,   -- the person who messaged them
  conversation_id BIGINT UNSIGNED NOT NULL,
  sent_on         DATE            NOT NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ooo_once (from_user_id, to_user_id, conversation_id, sent_on),
  CONSTRAINT fk_ooo_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ooo_to   FOREIGN KEY (to_user_id)   REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ooo_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A record of every digest that left the system, for the audit trail.
CREATE TABLE digest_runs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  notifications INT UNSIGNED    NOT NULL DEFAULT 0,
  transport     VARCHAR(40)     NOT NULL,
  status        ENUM('sent','failed','skipped') NOT NULL,
  detail        VARCHAR(400)    NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_digest_user (user_id, created_at),
  CONSTRAINT fk_digest_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Whether message text may leave the system in an email or a push payload.
-- Defaults to false: an RCM message can contain claim detail, and that is PHI
-- the moment it lands in an inbox or a lock screen.
INSERT INTO org_settings (setting_key, setting_value) VALUES
  ('notifications.include_message_text', 'false')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
