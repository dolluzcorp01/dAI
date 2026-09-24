-- =====================================================================
-- 012_unanswered_dismissals.sql
--
-- The unanswered questions panel is a GROUP BY over kody_messages, so a row
-- there has no id to act on. Dismissing one therefore needs a key that can be
-- recomputed from the question itself: the SHA-256 of the normalised question
-- text and the domain, which the aggregate returns with every row.
--
-- NOTE WHAT IS NOT HERE: the question text. The hash is enough to exclude the
-- row, and a question an associate typed can carry claim detail, so this table
-- holds no content at all. That also means a dismissal cannot be read back into
-- a question, which is the point.
--
-- Dismissing is reversible: DELETE the row and the question returns to the
-- panel. Both directions are written to audit_log.
-- =====================================================================

CREATE TABLE unanswered_dismissals (
  question_key  CHAR(64)        NOT NULL,   -- sha256(normalised question + '|' + domain)
  domain        VARCHAR(16)     NULL,       -- kept for filtering the list, never the text
  note          VARCHAR(200)    NULL,       -- why it was dismissed, optional, written by an admin
  dismissed_by  BIGINT UNSIGNED NULL,
  dismissed_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (question_key),
  KEY ix_unanswered_dismissals_when (dismissed_at),
  CONSTRAINT fk_unanswered_dismissals_user
    FOREIGN KEY (dismissed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
