-- =====================================================================
-- 006_skills.sql
-- The v10 directory searches people by skill, which 001 did not cover.
--
-- Added as a new migration rather than editing 001, because 001 is already
-- applied and the runner checksums applied files.
-- =====================================================================

CREATE TABLE skills (
  id         SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(80)  NOT NULL,
  category   VARCHAR(60)  NULL,      -- rcm, cyber, dev, agile
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_skills_name (name),
  KEY ix_skills_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_skills (
  user_id  BIGINT UNSIGNED   NOT NULL,
  skill_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, skill_id),
  KEY ix_user_skills_skill (skill_id),
  CONSTRAINT fk_user_skills_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_user_skills_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO skills (name, category) VALUES
  ('React','dev'),('Node','dev'),('MySQL','dev'),('TypeScript','dev'),
  ('SOC','cyber'),('SIEM','cyber'),('Incident response','cyber'),
  ('Active Directory','cyber'),('Database audit','cyber'),('IAM','cyber'),
  ('Agile','agile'),('Scrum','agile'),('Delivery','agile'),
  ('AR calling','rcm'),('Denials','rcm'),('Appeals','rcm'),
  ('Payment posting','rcm'),('Audit','rcm'),('Reconciliation','rcm'),
  ('Medical coding','rcm'),('Payer policy','rcm');

-- seed users get the skills shown in the v10 directory
INSERT INTO user_skills (user_id, skill_id)
SELECT u.id, s.id
FROM (
            SELECT 'pavithran@dolluzcorp.com' AS email, 'React' AS skill
  UNION ALL SELECT 'pavithran@dolluzcorp.com','Node'
  UNION ALL SELECT 'pavithran@dolluzcorp.com','MySQL'
  UNION ALL SELECT 'vignesh@dolluzcorp.com','SOC'
  UNION ALL SELECT 'vignesh@dolluzcorp.com','SIEM'
  UNION ALL SELECT 'vignesh@dolluzcorp.com','Incident response'
  UNION ALL SELECT 'diksha@dolluzcorp.com','Active Directory'
  UNION ALL SELECT 'diksha@dolluzcorp.com','Database audit'
  UNION ALL SELECT 'diksha@dolluzcorp.com','IAM'
  UNION ALL SELECT 'anil@dolluzcorp.com','Agile'
  UNION ALL SELECT 'anil@dolluzcorp.com','Scrum'
  UNION ALL SELECT 'anil@dolluzcorp.com','Delivery'
  UNION ALL SELECT 'manasi@dolluzcorp.com','AR calling'
  UNION ALL SELECT 'manasi@dolluzcorp.com','Denials'
  UNION ALL SELECT 'manasi@dolluzcorp.com','Appeals'
  UNION ALL SELECT 'gopi@dolluzcorp.com','Payment posting'
  UNION ALL SELECT 'gopi@dolluzcorp.com','Audit'
  UNION ALL SELECT 'gopi@dolluzcorp.com','Reconciliation'
) v
JOIN users  u ON u.email = v.email
JOIN skills s ON s.name  = v.skill;

-- working hours so the directory has something to show
UPDATE users SET work_start = '09:30:00', work_end = '18:30:00' WHERE work_start IS NULL;
