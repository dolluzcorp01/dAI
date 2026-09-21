-- =====================================================================
-- 008_knowledge_versioning.sql
--
-- Two things module 9 needs that 003 did not have.
--
-- 1. A version chain on knowledge documents. Editing a published document
--    must not rewrite history: an answer given in March cited the March
--    wording, and `kody_citations` points at that row. So an edit creates a
--    new row and retires the old one, and `supersedes_id` links them.
--
-- 2. Provenance on code imports. When a code changes you need to know which
--    file it came from and when, or you cannot answer "why does Kody think
--    this code means that".
-- =====================================================================

ALTER TABLE knowledge_docs
  ADD COLUMN supersedes_id BIGINT UNSIGNED NULL AFTER vector_ref,
  ADD COLUMN version SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER supersedes_id,
  ADD CONSTRAINT fk_knowledge_supersedes
      FOREIGN KEY (supersedes_id) REFERENCES knowledge_docs(id) ON DELETE SET NULL;

CREATE INDEX ix_knowledge_supersedes ON knowledge_docs (supersedes_id);

-- Every import run, so a code can be traced back to its source file.
CREATE TABLE code_imports (
  id            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  code_set_id   SMALLINT UNSIGNED NOT NULL,
  source_name   VARCHAR(400)      NOT NULL,   -- file name or URL
  source_sha256 CHAR(64)          NULL,
  effective_from DATE             NOT NULL,
  rows_added    INT UNSIGNED      NOT NULL DEFAULT 0,
  rows_updated  INT UNSIGNED      NOT NULL DEFAULT 0,
  rows_retired  INT UNSIGNED      NOT NULL DEFAULT 0,
  rows_skipped  INT UNSIGNED      NOT NULL DEFAULT 0,
  dry_run       TINYINT(1)        NOT NULL DEFAULT 0,
  imported_by   BIGINT UNSIGNED   NULL,
  notes         VARCHAR(1000)     NULL,
  created_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_code_imports_set (code_set_id, created_at),
  CONSTRAINT fk_code_imports_set  FOREIGN KEY (code_set_id) REFERENCES code_sets(id) ON DELETE CASCADE,
  CONSTRAINT fk_code_imports_user FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE code_entries
  ADD COLUMN import_id BIGINT UNSIGNED NULL AFTER guidance,
  ADD CONSTRAINT fk_code_entries_import
      FOREIGN KEY (import_id) REFERENCES code_imports(id) ON DELETE SET NULL;

-- A licensed code set must not be imported until someone records that Dolluz
-- holds the licence. CPT is AMA, CDT is ADA, and both are royalty bearing.
INSERT INTO org_settings (setting_key, setting_value) VALUES
  ('codes.licence.CPT', 'false'),
  ('codes.licence.CDT', 'false')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
