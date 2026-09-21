-- =====================================================================
-- 005_seed_dev.sql
-- Development seed only. Never run in production.
-- Password hashes are placeholders; the auth module rewrites them.
-- =====================================================================

INSERT INTO users (id, email, full_name, initials, job_title, team, timezone, presence) VALUES
  (1,'shoban@dolluzcorp.com','Shoban Balasubramanian','SB','Founder and CEO','Delivery','Asia/Kolkata','online'),
  (2,'pavithran@dolluzcorp.com','Pavithran R','PR','Full-stack developer','Engineering','Asia/Kolkata','online'),
  (3,'vignesh@dolluzcorp.com','Vignesh Naidu','VN','SOC analyst','Cybersecurity','Asia/Kolkata','online'),
  (4,'diksha@dolluzcorp.com','Diksha Negi','DN','AD and database audit','Cybersecurity','Asia/Kolkata','busy'),
  (5,'anil@dolluzcorp.com','Anil Kumar','AK','Delivery lead','Delivery','Asia/Muscat','away'),
  (6,'manasi@dolluzcorp.com','Manasi Rao','MR','AR team lead','RCM Operations','America/Chicago','dnd'),
  (7,'gopi@dolluzcorp.com','Gopi Krishnan','GK','Reimbursement audit','RCM Operations','Asia/Kolkata','offline');

INSERT INTO user_roles (user_id, role_id)
  SELECT 1, id FROM roles WHERE code='super_admin';
INSERT INTO user_roles (user_id, role_id)
  SELECT 2, id FROM roles WHERE code='admin';
INSERT INTO user_roles (user_id, role_id)
  SELECT u.id, r.id FROM users u CROSS JOIN roles r
  WHERE r.code='member' AND u.id IN (3,4,5,6,7);

INSERT INTO user_settings (user_id) SELECT id FROM users;
INSERT INTO notification_prefs (user_id) SELECT id FROM users;

INSERT INTO conversations (id, kind, slug, name, topic, is_private, is_announcement, is_default, retention, created_by) VALUES
  (1,'channel','denials-help','denials-help','Ask anything about denials and appeals',0,0,1,'1y',6),
  (2,'channel','coding-queries','coding-queries','CPT, CDT, ICD and HCPCS questions',0,0,0,'1y',7),
  (3,'channel','security-alerts','security-alerts','SOC notices and advisories',0,1,0,'90d',3),
  (4,'channel','leadership','leadership','Private leadership channel',1,0,0,'forever',5),
  (5,'group',NULL,'AR escalations','Anything that needs a supervisor',1,0,0,'1y',1),
  (6,'dm',NULL,NULL,NULL,1,0,0,'forever',1);

INSERT INTO conversation_members (conversation_id, user_id, member_role) VALUES
  (1,1,'member'),(1,2,'member'),(1,3,'member'),(1,4,'member'),(1,5,'member'),(1,6,'owner'),(1,7,'member'),
  (2,1,'member'),(2,6,'member'),(2,7,'owner'),
  (3,3,'owner'),(3,4,'member'),
  (4,5,'owner'),
  (5,1,'owner'),(5,6,'member'),(5,7,'member'),
  (6,1,'member'),(6,2,'member');

-- messages: seq is per conversation and starts at 1
INSERT INTO messages (conversation_id, seq, sender_id, kind, body) VALUES
  (6,1,2,'text','Morning. Did the CO-97 batch get reworked?'),
  (6,2,1,'text','Half of them. The **out of network** ones are still open.'),
  (6,3,2,'text','Send me the list when you can.'),
  (1,1,6,'text','Reminder: use `write-off Estimate correction` for overpayments, not plan interpretation.'),
  (1,2,3,'text','@here the payer portal is slow this morning.'),
  (5,1,5,'text','Standup in 10.');

UPDATE conversations c
  SET last_seq = (SELECT COALESCE(MAX(seq),0) FROM messages m WHERE m.conversation_id = c.id),
      last_message_at = (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id);

INSERT INTO message_reactions (message_id, user_id, emoji)
  SELECT id, 2, '👍' FROM messages WHERE conversation_id=6 AND seq=2;

INSERT INTO message_mentions (message_id, mention_kind, user_id)
  SELECT id, 'here', NULL FROM messages WHERE conversation_id=1 AND seq=2;

-- tier 0 lookup rows, free sources only
INSERT INTO code_entries (code_set_id, code, description, guidance, effective_from)
SELECT cs.id, v.code, v.descr, v.guidance, '2026-01-01' FROM code_sets cs JOIN (
  SELECT 'CARC' AS setcode,'CO-97' AS code,'Benefit included in payment for another service already adjudicated' AS descr,'The payer considers this service bundled. Check the primary procedure on the remittance before adjusting anything.' AS guidance
  UNION ALL SELECT 'CARC','CO-45','Charge exceeds fee schedule or contracted amount','Contractual adjustment. Write off to the fee schedule, do not bill the patient for this portion.'
  UNION ALL SELECT 'CARC','CO-16','Claim lacks information needed for adjudication','Look for the accompanying RARC, which names the missing element. Correct and resubmit.'
  UNION ALL SELECT 'CARC','PR-1','Deductible amount','Patient responsibility. Confirm the deductible was applied correctly before billing.'
  UNION ALL SELECT 'CARC','PR-2','Coinsurance amount','Patient responsibility after the plan pays its share.'
  UNION ALL SELECT 'ICD-10-CM','M54.50','Low back pain, unspecified','M54.5 was expanded in 2022. Use M54.50, M54.51 or M54.59.'
) v ON v.setcode = cs.code;

INSERT INTO quick_links (user_id, label, url, position) VALUES
  (NULL,'CMS ICD-10 lookup','https://www.cms.gov/medicare/coding-billing/icd-10-codes',1),
  (NULL,'X12 denial codes','https://x12.org/codes',2),
  (NULL,'Dolluz SOP library','https://dai.dolluzcorp.com/knowledge',3);

INSERT INTO notification_keywords (user_id, keyword) VALUES (1,'CO-97'),(1,'escalation');
