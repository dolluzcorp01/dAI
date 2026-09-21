-- =====================================================================
-- 003_kody_ai.sql
-- The companion side: conversations with Kody, how each answer was
-- produced, the tier 0 code tables, and the SME correction loop.
--
-- Every answer records model, prompt version, tier and latency. Without
-- that a wrong answer cannot be reproduced, and compliance content that
-- cannot be reproduced cannot be defended.
-- =====================================================================

CREATE TABLE kody_threads (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  title      VARCHAR(300)    NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME        NULL,
  PRIMARY KEY (id),
  KEY ix_kody_threads_user (user_id, updated_at),
  CONSTRAINT fk_kody_threads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE kody_messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  thread_id       BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NULL,
  role            ENUM('user','assistant') NOT NULL,
  body            MEDIUMTEXT      NULL,

  -- how the answer was produced
  domain          ENUM('rcm','agile','cyber','dev','general') NULL,
  confidence      ENUM('high','medium','low') NULL,
  tier            TINYINT UNSIGNED NULL,       -- 0 lookup, 1 fast, 2 standard, 3 deep
  used_web_search TINYINT(1)      NOT NULL DEFAULT 0,
  used_retrieval  TINYINT(1)      NOT NULL DEFAULT 0,
  model_name      VARCHAR(80)     NULL,
  prompt_version  VARCHAR(40)     NULL,
  latency_ms      INT UNSIGNED    NULL,
  input_tokens    INT UNSIGNED    NULL,
  output_tokens   INT UNSIGNED    NULL,

  -- what the answer card shows
  source_name     VARCHAR(200)    NULL,
  source_as_of    VARCHAR(40)     NULL,
  disclaimer      VARCHAR(600)    NULL,
  lookup_code     VARCHAR(32)     NULL,
  lookup_set      VARCHAR(24)     NULL,

  -- posted into a chat conversation via @kody
  conversation_id BIGINT UNSIGNED NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_kody_messages_thread (thread_id, created_at),
  KEY ix_kody_messages_domain (domain, created_at),
  KEY ix_kody_messages_tier (tier),
  FULLTEXT KEY ft_kody_body (body),
  CONSTRAINT fk_kody_messages_thread FOREIGN KEY (thread_id) REFERENCES kody_threads(id) ON DELETE CASCADE,
  CONSTRAINT fk_kody_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_kody_messages_convo FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE kody_answer_links (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kody_message_id BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(300)    NOT NULL,
  url             VARCHAR(1000)   NOT NULL,
  position        SMALLINT        NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_links_message (kody_message_id),
  CONSTRAINT fk_links_message FOREIGN KEY (kody_message_id) REFERENCES kody_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE kody_bookmarks (
  user_id         BIGINT UNSIGNED NOT NULL,
  kody_message_id BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, kody_message_id),
  CONSTRAINT fk_bookmarks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_bookmarks_message FOREIGN KEY (kody_message_id) REFERENCES kody_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE kody_feedback (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kody_message_id BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  vote            ENUM('up','down') NOT NULL,
  comment         VARCHAR(1000)   NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_feedback_once (kody_message_id, user_id),
  CONSTRAINT fk_feedback_message FOREIGN KEY (kody_message_id) REFERENCES kody_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Thumbs down lands here. An SME resolves it, and the resolution becomes
-- a knowledge document. This loop is how the corpus grows from nothing.
CREATE TABLE sme_queue (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kody_message_id BIGINT UNSIGNED NOT NULL,
  raised_by       BIGINT UNSIGNED NULL,
  status          ENUM('open','in_review','resolved','rejected') NOT NULL DEFAULT 'open',
  assigned_to     BIGINT UNSIGNED NULL,
  resolution      MEDIUMTEXT      NULL,
  resolved_doc_id BIGINT UNSIGNED NULL,
  resolved_at     DATETIME        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sme_status (status, created_at),
  CONSTRAINT fk_sme_message FOREIGN KEY (kody_message_id) REFERENCES kody_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_sme_raiser FOREIGN KEY (raised_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_sme_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TIER 0. Answered from here with no model call. Never let a model
-- invent a code: look it up, or say you do not have it.
CREATE TABLE code_sets (
  id           SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code         VARCHAR(24)  NOT NULL,   -- ICD-10-CM, CPT, CDT, HCPCS, CARC, RARC, POS
  label        VARCHAR(120) NOT NULL,
  licensed     TINYINT(1)   NOT NULL DEFAULT 0,
  licensor     VARCHAR(120) NULL,
  version_year VARCHAR(16)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_code_sets_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE code_entries (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  code_set_id    SMALLINT UNSIGNED NOT NULL,
  code           VARCHAR(32)       NOT NULL,
  description    VARCHAR(600)      NOT NULL,
  guidance       MEDIUMTEXT        NULL,
  effective_from DATE              NULL,
  effective_to   DATE              NULL,   -- null means current
  created_at     DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_code_entries (code_set_id, code, effective_from),
  KEY ix_code_entries_code (code),
  KEY ix_code_entries_current (code_set_id, effective_to),
  FULLTEXT KEY ft_code_entries (description, guidance),
  CONSTRAINT fk_code_entries_set FOREIGN KEY (code_set_id) REFERENCES code_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Retrieval corpus. Chunks live in the vector store (Postgres + pgvector
-- or Qdrant); this table is the system of record and holds the pointer.
CREATE TABLE knowledge_docs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title          VARCHAR(400)    NOT NULL,
  domain         ENUM('rcm','agile','cyber','dev','general') NOT NULL DEFAULT 'rcm',
  source_kind    ENUM('sop','payer_policy','regulation','training','sme_answer','other') NOT NULL,
  body           LONGTEXT        NULL,
  effective_from DATE            NULL,
  effective_to   DATE            NULL,
  status         ENUM('draft','review','published','retired') NOT NULL DEFAULT 'draft',
  owner_id       BIGINT UNSIGNED NULL,
  approved_by    BIGINT UNSIGNED NULL,
  approved_at    DATETIME        NULL,
  vector_ref     VARCHAR(200)    NULL,   -- collection id in the vector store
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_knowledge_domain (domain, status),
  KEY ix_knowledge_effective (effective_to),
  FULLTEXT KEY ft_knowledge (title, body),
  CONSTRAINT fk_knowledge_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_knowledge_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sme_queue
  ADD CONSTRAINT fk_sme_doc FOREIGN KEY (resolved_doc_id) REFERENCES knowledge_docs(id) ON DELETE SET NULL;

-- Which documents an answer actually used. This is what the citation renders from.
CREATE TABLE kody_citations (
  kody_message_id BIGINT UNSIGNED NOT NULL,
  doc_id          BIGINT UNSIGNED NOT NULL,
  chunk_ref       VARCHAR(200)    NULL,
  relevance       DECIMAL(5,4)    NULL,
  PRIMARY KEY (kody_message_id, doc_id),
  CONSTRAINT fk_citations_message FOREIGN KEY (kody_message_id) REFERENCES kody_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_citations_doc FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO code_sets (code, label, licensed, licensor, version_year) VALUES
  ('ICD-10-CM','ICD-10-CM diagnosis codes',0,'CMS','2026'),
  ('HCPCS','HCPCS Level II',0,'CMS','2026'),
  ('CARC','Claim adjustment reason codes',0,'X12','2026'),
  ('RARC','Remittance advice remark codes',0,'X12','2026'),
  ('POS','Place of service codes',0,'CMS','2026'),
  ('CPT','Current Procedural Terminology',1,'American Medical Association','2026'),
  ('CDT','Current Dental Terminology',1,'American Dental Association','2026');
