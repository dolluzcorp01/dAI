# Kody AI

Module 8. The model gateway, tier routing, the code lookup gate, retrieval,
citations, feedback, points and the SME loop.

36 tests in this module, 213 across the backend, all passing from an empty
database.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/kody/ask` | Ask, optionally continuing a thread |
| POST | `/api/kody/conversations/:id/ask` | The `@kody` path: answer posted into the room |
| GET | `/api/kody/threads` | My past conversations with Kody |
| GET | `/api/kody/threads/:id` | One thread with full attribution |
| POST | `/api/kody/messages/:id/feedback` | Thumbs up or down |
| GET | `/api/kody/points` | Balance, ledger, conversion rate |
| GET | `/api/kody/codes/:code` | Direct lookup, for the recent-codes strip |
| GET | `/api/kody/codes?q=` | Search code descriptions |
| GET | `/api/kody/sme` | SME queue (admin, super admin, coordinator) |
| POST | `/api/kody/sme/:id/resolve` | Resolve into a knowledge document |

---

## The gateway

**No module outside `src/ai/` calls a vendor API.** Switching providers, or
moving a tier to a cheaper model, is a config change.

| Tier | Trigger | Model |
|---|---|---|
| 0 lookup | an exact code match in the database | none |
| 1 fast | five words or fewer, no domain keyword | `MODEL_TIER1` |
| 2 standard | everything else, with retrieval | `MODEL_TIER2` |
| 3 deep | draft, compare, analyse, root cause, step by step | `MODEL_TIER3` |

Retries only on transient failures (429, 5xx, timeout, unreachable) with
exponential backoff, then fails over to `MODEL_FALLBACK_PROVIDER`. A 400 is not
retried, because sending a malformed request to a second vendor only wastes
money.

Three providers: `anthropic`, `openai`, and `mock`. **The config refuses to
boot in production with the mock provider**, the same way it refuses the local
file scanner.

---

## Tier 0: codes are looked up, never generated

A model inventing a plausible CPT code is this product's worst failure mode.
So anything resolving to a code entry answers from `code_entries` with no model
call, at single-digit milliseconds, with high confidence and the code set named.

Every lookup filters on `effective_from` and `effective_to`. A superseded
entry is never returned.

The system prompt also instructs the model never to invent a code and to name
the code set to check instead.

---

## Retrieval and citations

Tier 2 and 3 retrieve published, currently effective documents and put them in
the system prompt tagged `[[doc:N]]`. The model returns the ids it used, and
**`persistAnswer` drops any id that was not actually supplied**, so a citation
can never point at a document the model never saw.

Draft documents and retired documents are never retrieved. Both have tests.

---

## Everything is reproducible

Every answer stores `model_name`, `prompt_version`, `tier`, `used_web_search`,
`used_retrieval`, `latency_ms` and token counts, plus its citations.

When an associate says Kody told them to write something off, you can identify
the model, the prompt version and the exact documents behind that sentence.
`PROMPT_VERSION` in `src/ai/prompts.js` must be bumped whenever the prompt text
changes.

---

## Degraded paths are visible, never silent

| Failure | Result |
|---|---|
| Every provider failed | An answer saying so, confidence low, disclaimer "degraded response" |
| Reply was not JSON | An answer saying it could not be read, plus an `audit_log` row |
| Reply had no text | Same as malformed |

A confident-looking empty answer is worse than an honest failure, so the
pipeline never produces one.

---

## Points and the SME loop

Thumbs up credits points through an append-only ledger with an idempotency key
of `helpful:kody_message:<id>:<user>`, so the same answer can never be credited
twice, and a daily cap from `point_rules`. The balance is always `SUM(points)`,
never a stored counter.

Thumbs down opens an `sme_queue` item, once per answer. An SME resolves it into
a `knowledge_docs` row with `source_kind = 'sme_answer'`, published and
effective from today, and the person who raised it is credited.

**That resolved document is then retrievable by future answers.** There is a
test asserting exactly that, because this loop is how the corpus grows from
nothing.

---

## One real bug found by testing

`looksLikeCode` stripped all punctuation, including the decimal point inside a
code. `M54.50` became `M5450`, which can never match the database, so **every
ICD-10 lookup would have silently fallen through to a model** - precisely the
failure tier 0 exists to prevent. CARC codes like `CO-97` were unaffected,
which is why it would have been easy to miss in casual testing.

Fixed to strip punctuation from the ends only. A regression test now asserts
that `M54.50` resolves at tier 0.

---

## A weak test, found and strengthened

Three mutations were run against this module. The points idempotency and the
retrieval date filter were both caught immediately. **The citation filter was
not.**

The reason is worth recording. The test forced the model to cite a document id
that did not exist, so the foreign key rejected it and `INSERT IGNORE` dropped
it. The application guard was never exercised. The test would have passed with
the guard deleted.

It now cites a document that **exists but was not supplied** to that answer,
which no database constraint can catch. Removing the filter makes the test fail.

---

## A second defect, found by re-running

The suite passed from a clean database every time, and failed on a second run
against the same one. Two users tests assumed seed defaults that earlier tests
had already changed: a settings test expected the default accent, and a
directory test searched for a skill a later test had replaced.

Tests that only pass once are not much use to a developer who runs them all
day, so the users suite now resets the state it asserts on. Verified by running
the full suite three times in a row against the same database, then once more
against a fresh one.

## Not yet done

- **Vector retrieval.** MySQL fulltext today. `codes.retrieve()` is the seam
  where pgvector or Qdrant goes in; nothing above it changes.
- **Cost accounting.** Tokens are stored per answer but nothing aggregates them
  into a spend report. That belongs with the admin dashboard.
- **The knowledge admin UI.** Documents can only be created by resolving an SME
  item or by direct SQL.
- **No real provider has been called.** Every test uses the mock. The Anthropic
  and OpenAI adapters are code review only until a key is configured.
