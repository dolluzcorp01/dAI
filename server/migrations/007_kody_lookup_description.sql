-- =====================================================================
-- 007_kody_lookup_description.sql
--
-- Found during frontend integration, not by the backend tests.
--
-- A tier 0 answer returned lookupCode, lookupSet and lookupDescription when
-- it was first created, because the description was attached in memory. On
-- reload only the code and set came back, so the answer card in the client
-- rendered a code with an empty description line.
--
-- The description is denormalised onto the answer on purpose. Joining back to
-- code_entries would show today's wording against an answer given months ago,
-- and a compliance answer has to read the way it read when it was given.
-- =====================================================================

ALTER TABLE kody_messages
  ADD COLUMN lookup_description VARCHAR(600) NULL AFTER lookup_set;

-- Backfill existing tier 0 answers from the current code tables. Answers
-- created before this migration get today's wording, which is the best that
-- can be recovered.
UPDATE kody_messages m
  JOIN code_entries ce ON UPPER(ce.code) = UPPER(m.lookup_code)
  JOIN code_sets  cs ON cs.id = ce.code_set_id AND cs.code = m.lookup_set
   SET m.lookup_description = ce.description
 WHERE m.lookup_code IS NOT NULL
   AND m.lookup_description IS NULL;
