# Knowledge layer

Module 9. Document authoring and versioning, and importing the code sets that
tier 0 answers from.

39 tests in this module, 272 across the project, passing on a clean database
and on two repeat runs.

---

## Endpoints

Authoring needs `coordinator`, `admin` or `super_admin`. Publishing and
importing need `admin` or `super_admin`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/knowledge/docs` | List, filter by status, domain, source kind, text |
| POST | `/api/knowledge/docs` | Create a draft |
| GET | `/api/knowledge/docs/:id` | One document, with citation count |
| PATCH | `/api/knowledge/docs/:id` | Edit, or supersede if published |
| PUT | `/api/knowledge/docs/:id/status` | draft, review, published, retired |
| GET | `/api/knowledge/docs/:id/versions` | The full chain, oldest first |
| GET | `/api/knowledge/docs/unused` | Published documents nothing has ever cited |
| GET | `/api/knowledge/stats` | Corpus shape, for the admin dashboard |
| GET | `/api/knowledge/codesets` | Code sets, counts, licence state |
| POST | `/api/knowledge/codesets/:code/import` | Import a CSV |
| PUT | `/api/knowledge/codesets/:code/licence` | Record that Dolluz holds a licence |
| GET | `/api/knowledge/imports` | Import history |

Plus a CLI: `node scripts/import-codes.js CARC ./file.csv --from 2026-01-01 --apply`

---

## Nothing is ever destructive

This is the rule the whole module is built around.

**A published document is never edited in place.** An answer given in March
cited the March wording, and `kody_citations` points at that row. Editing it
would silently rewrite what Kody is recorded as having said.

So `PATCH` on a published document creates a new row, links it by
`supersedes_id`, bumps the version, and sets `effective_to` on the old one.
Retrieval stops returning the old version the same day, and every existing
citation still resolves to the text that was actually used. There is a test
asserting exactly that.

A draft is edited in place, because nothing has cited it.

**A changed code is superseded, not overwritten**, for the same reason.

---

## The licence guard

CPT is licensed from the AMA and CDT from the ADA, both royalty bearing.
Importing either without a licence is a contractual problem, not a technical
one, so the importer **refuses** rather than warning:

```
CPT is licensed from the AMA. Set org_settings 'codes.licence.CPT' to true
once Dolluz holds the licence.
```

Recording a licence needs `admin` or above and is written to `audit_log`.
Revoking it blocks further imports immediately. Free sets (ICD-10-CM, HCPCS,
CARC, RARC, POS) are never blocked.

---

## Dry run by default

`dryRun` defaults to true. You must pass `dryRun=false` explicitly, and the CLI
requires `--apply`. A dry run reports added, superseded, corrected, unchanged,
retired and skipped counts with sample codes, and writes nothing.

This is deliberate. A bad import silently corrupts every future tier 0 answer,
and tier 0 is the layer that exists so a model never invents a code.

`retireMissing` is opt in. Without it, a partial file adds and updates but
never closes anything off, so uploading the wrong file cannot wipe a code set.

---

## One real bug found by testing

Superseding writes a new row with the import's `effective_from`, and the unique
key is `(code_set_id, code, effective_from)`. Re-importing an edition **on its
own effective date** therefore collided on a duplicate key and the whole import
failed with a 500.

That is not an edge case: it is what happens when someone corrects a typo in
the file they loaded that morning and loads it again.

Fixed by distinguishing two things that were conflated:

- **Correction**: the current row already starts on that date, so it is the
  same edition being fixed. Updated in place.
- **Supersession**: the current row starts earlier, so this is a new edition.
  New row, old one closed off the day before.

The summary now reports `corrected` and `superseded` separately, and a
regression test re-imports on the same date and asserts one row survives.

---

## Two test defects also found

**Cross-suite interference.** The import tests originally loaded `CO-97`, which
is seeded and asserted on by the Kody suite. The test runner runs files in
parallel against one database, so the knowledge suite was rewriting a row the
Kody suite was reading, and the Kody test failed intermittently. The import
tests now own codes nothing else touches.

**A malformed fixture.** A test CSV had an unquoted comma inside a description,
so the parser correctly split it into three fields and the assertion failed.
The parser was right and the fixture was wrong.

---

## Verified behaviour

| Area | Checks |
|---|---|
| Access | members blocked from every route, token required |
| Authoring | draft created, drafts never retrieved by Kody, short body and bad domain rejected, draft edited in place, member cannot publish, publishing records the approver and makes it retrievable, cannot unpublish |
| Versioning | editing published supersedes, old text untouched and retired, new version retrieved and old one not, chain reads oldest to newest, superseded row cannot be edited again, citation still resolves to the used version |
| CSV | quotes, embedded commas, escaped quotes, CRLF, BOM stripped, CMS column name variants, missing code column refused |
| Import | dry run writes nothing, dry run is the default, real import adds and records provenance, changed description supersedes, same-date re-import corrects in place, idempotent when unchanged, retireMissing opt in, unknown set and empty file refused, history lists runs |
| Licence | CPT names the AMA, CDT names the ADA, member cannot record a licence, recording unblocks import, revoking re-blocks, free sets never blocked, overview shows state |

Two mutations were run: removing the licence guard and making published edits
happen in place. Both were caught.

---

## Getting the real code sets in

| Set | Source | Licence |
|---|---|---|
| ICD-10-CM | cms.gov | free |
| HCPCS Level II | cms.gov | free |
| Place of Service | cms.gov | free |
| CARC, RARC | x12.org | free |
| CPT | American Medical Association | royalty bearing |
| CDT | American Dental Association | royalty bearing |

The importer expects a `code` and a `description` column, and optionally
`guidance` or `notes`. It tolerates the header variants CMS uses.

---

## Not yet done

- **Vector retrieval.** Still MySQL fulltext. `codes.retrieve()` remains the
  seam for pgvector or Qdrant.
- **A review workflow with assignees.** `status = 'review'` exists but nobody is
  assigned to it.
- **Bulk document import.** Documents are created one at a time or by resolving
  an SME item.
- **No real code set has been loaded.** Every test uses small fixtures. The
  first real CMS file will be the first test of the parser at scale.
