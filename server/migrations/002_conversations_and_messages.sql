-- =====================================================================
-- 002_conversations_and_messages.sql
-- The messaging core. This is the table set roughly forty client
-- features sit on, so read the notes before changing anything.
--
-- KEY DECISION: every message carries `seq`, a per-conversation counter
-- issued by the server. Clients sync by asking for everything after the
-- last seq they hold. Timestamps are not reliable for ordering across
-- machines; seq is. Allocate it inside the same transaction as the
-- INSERT (see docs/02-data-model.md for the exact statement).
-- =====================================================================

CREATE TABLE conversations (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind             ENUM('dm','group','channel') NOT NULL,
  slug             VARCHAR(80)     NULL,        -- channels only, url safe
  name             VARCHAR(160)    NULL,        -- null for dm, derived from members
  topic            VARCHAR(300)    NULL,
  purpose          VARCHAR(1000)   NULL,
  is_private       TINYINT(1)      NOT NULL DEFAULT 0,
  is_announcement  TINYINT(1)      NOT NULL DEFAULT 0,
  is_default       TINYINT(1)      NOT NULL DEFAULT 0,  -- auto-join new staff
  is_archived      TINYINT(1)      NOT NULL DEFAULT 0,
  retention        ENUM('forever','1y','90d','30d') NOT NULL DEFAULT 'forever',
  created_by       BIGINT UNSIGNED NULL,
  last_seq         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_message_at  DATETIME        NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at       DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversations_slug (slug),
  KEY ix_conversations_kind (kind, is_archived),
  KEY ix_conversations_recent (last_message_at),
  CONSTRAINT fk_conversations_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Membership plus every per-user, per-space preference.
-- last_read_seq is what powers unread counts, the NEW divider and receipts.
CREATE TABLE conversation_members (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  member_role     ENUM('owner','member','guest') NOT NULL DEFAULT 'member',
  notif_level     ENUM('all','mentions','none') NOT NULL DEFAULT 'all',
  is_muted        TINYINT(1)      NOT NULL DEFAULT 0,
  is_favourite    TINYINT(1)      NOT NULL DEFAULT 0,
  last_read_seq   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_read_at    DATETIME        NULL,
  joined_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at         DATETIME        NULL,
  PRIMARY KEY (conversation_id, user_id),
  KEY ix_members_user (user_id, left_at),
  KEY ix_members_unread (user_id, conversation_id, last_read_seq),
  CONSTRAINT fk_members_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE messages (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id   BIGINT UNSIGNED NOT NULL,
  seq               BIGINT UNSIGNED NOT NULL,
  sender_id         BIGINT UNSIGNED NULL,      -- null for system messages
  kind              ENUM('text','system','kody') NOT NULL DEFAULT 'text',
  body              MEDIUMTEXT      NULL,      -- markdown-lite as typed
  reply_to_id       BIGINT UNSIGNED NULL,      -- quoted message
  thread_parent_id  BIGINT UNSIGNED NULL,      -- thread root
  client_msg_id     CHAR(36)        NULL,      -- client uuid, makes send idempotent
  forwarded_from_id BIGINT UNSIGNED NULL,
  scheduled_for     DATETIME        NULL,      -- unsent until this time
  edited_at         DATETIME        NULL,
  deleted_for_all_at DATETIME       NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_messages_seq (conversation_id, seq),
  UNIQUE KEY uq_messages_client (conversation_id, client_msg_id),
  KEY ix_messages_convo_time (conversation_id, created_at),
  KEY ix_messages_thread (thread_parent_id),
  KEY ix_messages_sender (sender_id),
  KEY ix_messages_scheduled (scheduled_for),
  FULLTEXT KEY ft_messages_body (body),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_messages_reply FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL,
  CONSTRAINT fk_messages_thread FOREIGN KEY (thread_parent_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Delivered and read, per recipient. Drives the tick states.
-- In a DM this is one row per message; in a channel it is one per member
-- who has seen it, so write it lazily from last_read_seq rather than eagerly.
CREATE TABLE message_receipts (
  message_id   BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  delivered_at DATETIME(3)     NULL,
  read_at      DATETIME(3)     NULL,
  PRIMARY KEY (message_id, user_id),
  KEY ix_receipts_user (user_id),
  CONSTRAINT fk_receipts_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Delete for me. Delete for everyone sets messages.deleted_for_all_at instead.
CREATE TABLE message_hides (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  hidden_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT fk_hides_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_hides_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message_reactions (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  emoji      VARCHAR(32)     NOT NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id, emoji),
  KEY ix_reactions_message (message_id),
  CONSTRAINT fk_reactions_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_reactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- user_id is NULL for @here and @channel, and a NULL can never sit in a
-- PRIMARY KEY, so this uses a surrogate key with a unique index instead.
-- Note: MySQL allows repeated NULLs in a unique index, so the API must
-- refuse to write a second @here row for the same message.
CREATE TABLE message_mentions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id   BIGINT UNSIGNED NOT NULL,
  mention_kind ENUM('user','here','channel') NOT NULL,
  user_id      BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mentions (message_id, mention_kind, user_id),
  KEY ix_mentions_user (user_id),
  CONSTRAINT fk_mentions_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_mentions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message_pins (
  conversation_id BIGINT UNSIGNED NOT NULL,
  message_id      BIGINT UNSIGNED NOT NULL,
  pinned_by       BIGINT UNSIGNED NULL,
  pinned_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, message_id),
  CONSTRAINT fk_pins_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_pins_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_pins_user FOREIGN KEY (pinned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Files live in object storage. The row is the record, storage_key is the pointer.
-- scan_status stays 'pending' until the malware scanner clears it; the API must
-- refuse to serve anything not 'clean'.
CREATE TABLE attachments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  message_id      BIGINT UNSIGNED NULL,   -- null while still a draft upload
  uploader_id     BIGINT UNSIGNED NULL,
  file_name       VARCHAR(400)    NOT NULL,
  mime_type       VARCHAR(160)    NOT NULL,
  media_kind      ENUM('image','video','audio','file') NOT NULL DEFAULT 'file',
  size_bytes      BIGINT UNSIGNED NOT NULL,
  storage_key     VARCHAR(512)    NOT NULL,
  checksum_sha256 CHAR(64)        NULL,
  scan_status     ENUM('pending','clean','infected','skipped') NOT NULL DEFAULT 'pending',
  version_of_id   BIGINT UNSIGNED NULL,   -- previous version of the same file
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      DATETIME        NULL,
  PRIMARY KEY (id),
  KEY ix_attachments_conversation (conversation_id, created_at),
  KEY ix_attachments_message (message_id),
  KEY ix_attachments_scan (scan_status),
  CONSTRAINT fk_attachments_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_uploader FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_attachments_version FOREIGN KEY (version_of_id) REFERENCES attachments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One draft per user per conversation. Survives switching conversations.
CREATE TABLE drafts (
  user_id         BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  body            MEDIUMTEXT      NULL,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, conversation_id),
  CONSTRAINT fk_drafts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_drafts_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saved_searches (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  label      VARCHAR(160)    NULL,
  query      VARCHAR(500)    NOT NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_saved_searches_user (user_id),
  CONSTRAINT fk_saved_searches_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
