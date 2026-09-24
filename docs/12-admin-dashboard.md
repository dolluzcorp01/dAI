# Admin dashboard

Module 12, part one. The UI had no design, so the screens come first, exactly
as v10 and v11 did for the client.

`kody_admin_v12.jsx` is the prototype. Mock data, shaped like the real API
responses, so it doubles as the contract for the endpoints still to build.

49 interaction checks driven against real DOM, all passing, zero React
warnings, tested file checksummed against the delivered one.

---

## Your BRD dashboard list, covered

| BRD item | Where |
|---|---|
| 1. Role profiling: super admin, admin, sub-admin, coordinator | People and roles |
| 2. Analytical widgets | Overview |
| 3. Downloadable reports, Excel and PDF | Reports |
| 4. Text and message configuration | Messaging and text |
| 5. Useful links setup | Settings |
| 6. Points calculator | Cheer points |
| 7. Subscription rate and plans | Settings |
| 8. Authentication locks | Security and audit |
| 9. Versioning controller | Settings |
| 10. Other UI related controls | Messaging, Spaces |

Plus five sections the BRD predates, because the backend now has them:
Spaces, Knowledge with the SME queue, Code sets with import, Kody AI routing,
and the audit log.

---

## Four decisions worth reviewing before this is frozen

**The overview leads with what Kody cannot answer.** Most dashboards show
volume, which tells you the tool is being used but not whether it is any good.
The panel that matters is questions asked repeatedly, with low confidence and
no supporting document. That is the queue that tells you what to write next,
and it turns the dashboard into a work list rather than a scoreboard.

**Tier 0 share is a headline number.** The percentage answered from the code
tables with no model call is both a cost figure and a quality figure: those
answers are instant, free, and cannot be invented.

**Import is a two-step control.** Apply is disabled until a dry run has been
done, and an unlicensed set cannot be imported at all. The UI mirrors the
guard that already exists in the service rather than assuming the server will
catch it.

**The PHI toggle explains itself in place.** Turning on message text in emails
and push swaps a green panel for a red one that says plainly what it means: an
RCM message can contain a patient name and an account number, and that is PHI
once it reaches an inbox or a lock screen. A setting this consequential should
not be a bare switch.

---

## Verified by driving it

Every section renders. Roles are selectable and deactivation warns that live
sessions are revoked. Retention is editable per space. Documents show version
and citation count, and the SME queue shows the model and tier so an answer is
reproducible. Licence state gates the import button, apply is gated on a dry
run, and the dry run reports superseded and corrected separately. Tier 0's
model field is read only. The console states that API keys never appear in it.
The points calculator shows what the scheme actually pays at the current
numbers. Reports warn that a content export is a PHI export. The audit log
surfaces `auth.refresh_reuse_detected` and `file.infected_rejected`.

---

## What the backend already provides

| Screen | Endpoint | State |
|---|---|---|
| People and roles | `GET /api/users/admin/list`, `PUT .../roles`, `PUT .../active` | done |
| Knowledge | `/api/knowledge/docs`, `/stats`, `/docs/:id/versions` | done |
| SME queue | `GET /api/kody/sme`, `POST /api/kody/sme/:id/resolve` | done |
| Code sets | `/api/knowledge/codesets`, `/import`, `/licence`, `/imports` | done |
| Announcements | `POST /api/notifications/announce` | done |
| Sessions | `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id` | done, own sessions only |
| Quick links | `/api/users/me/quick-links` | done, personal only |

## Part two, built

All of it. 42 tests in `admin.test.js`, 404 across the project, passing on three
consecutive cold databases and on repeat runs.

| Screen | Endpoint |
|---|---|
| Overview | `GET /api/admin/overview`, cached, plus `/analytics/{domains,tiers,models,unanswered,people}` |
| Reports | `GET /api/admin/reports`, `GET /api/admin/reports/:code?format=xlsx|pdf`, `/reports/history` |
| Settings | `GET/PATCH /api/admin/settings` |
| Points | `GET /api/admin/points/rules`, `PATCH /api/admin/points/rules/:code` |
| Spaces | `GET /api/admin/spaces`, org wide including private ones |
| Sessions | `GET /api/admin/sessions`, `DELETE /api/admin/sessions/:id` |
| Versions | `GET/POST /api/admin/versions` |
| Quick links | `GET/POST/DELETE /api/admin/quick-links` |
| Audit | `GET /api/admin/audit`, `/audit/actions` |

### Three guards worth knowing

**The whole router is admin only.** Not each route: `router.use(requireRole(...))`
sits above everything, so a new endpoint added later is gated by default rather
than by remembering.

**A content export needs the organisation to opt in.** `unanswered` and
`sme_queue` contain question text, and a question an associate typed can itself
carry claim detail. Both are refused with a 403 naming PHI until
`reports.allow_content_export` is true. Every run is written to `report_runs`
with who, what range, how many rows, and whether content left, and to
`audit_log` as well.

**Settings are a whitelist with a validator each.** `org_settings` stores
strings, so without this a bad number would be stored happily and surface as
odd behaviour weeks later. An unknown key is rejected and nothing is written.
Good keys in a mixed patch still apply, and the rejected ones come back named.

### On the reports

`usage_by_person`, `questions_by_domain` and `model_spend` carry no message
text. `unanswered`, `sme_queue` do. `audit_export` carries actions, not content.

The tests open the produced files rather than trusting a 200: the spreadsheet
is loaded with ExcelJS and its header row located, and the PDF is checked for
its magic number and trailer. A corrupt file fails here, not on someone's desk.

PDF is capped at 300 rows with a line saying how many were omitted, because a
circulated document is not the right format for five thousand audit rows. The
spreadsheet is.

### A test defect that only a cold database revealed

The suite passed on a populated database and failed three tests on a fresh one,
every time.

The session revocation test picked the first session belonging to that user
from a list ordered by last use. On a populated database that happened to be
the session under test; on a cold one it was not, so the test revoked a
different session, the assertion failed, and the re-login line after it never
ran. Two later tests then used a token that was still revoked and failed with
an unrelated-looking `cannot read properties of undefined`.

Fixed by asking `/api/auth/me` for the session the token actually belongs to
and revoking that. Verified with three consecutive cold runs.

Worth recording because the misleading part was the cascade: two of the three
failures had nothing wrong with them.

### Analytics caching

The overview runs six aggregate queries over `kody_messages` and `messages`,
the two largest tables. It is cached for sixty seconds, and a settings change
clears the cache. There is a test asserting the first call computes, the second
is served from cache, and clearing forces a recompute.

`ANALYTICS_CACHE_MS` tunes it. At real volume this should move to a scheduled
job writing a summary table, and the seam for that is `analytics.overview()`.

---

## Originally missing, for the record

| Screen | Missing |
|---|---|
| Overview | Every analytic. Question volume by domain and tier, latency, degraded rate, model spend, and the unanswered-questions query |
| Spaces | An org-wide list of every space. Today a space is only reachable by its members |
| Security | An org-wide session list. `GET /api/auth/sessions` returns your own |
| Security | Auth settings as editable values. They are environment variables today |
| Reports | Everything. No Excel or PDF generation exists |
| Settings | Subscription plans. No table, no billing |
| Settings | Version registry and release notes |
| Settings | Org-wide default quick links. `user_id IS NULL` rows exist but have no admin route |
| Messaging | Org settings as an API. `org_settings` rows exist but are edited by SQL |

The honest summary: roughly half the dashboard has a backend, and the half that
does not is mostly read-only aggregation plus two export formats.

---

## What the headline numbers count, before you label one

dAI: the dAdmin console labelled `activeUsers` as people using Kody and
overstated it eightfold. It counts accounts. On the development database that
was 218 accounts against 28 people who had ever asked anything.

The two to keep apart:

| Field | What it counts |
|---|---|
| `accountsTotal` | Accounts that exist and are not deactivated or deleted. Not usage. |
| `peopleWhoAsked7d` | Distinct people who asked at least one question in 7 days. This is usage. |

`activeUsers` and `activeUsers7d` remain as aliases so nothing breaks, and they
mean exactly the same as the two above. Do not label either as activity.

Three more that are easy to read wrong:

- `avgLatencyMs` is a **mean**, not a median. The v12 prototype's "Median answer
  time" tile is mislabelled: either rename the label or compute a median.
- `tier0Share` and `degradedRate` are fractions between 0 and 1. Multiply by 100
  to show a percentage.
- `inputTokens30d` and `outputTokens30d` are **tokens, not money**. The API knows
  no prices and reports no spend, so the v12 "Model spend $41.20" tile has no
  field behind it. Either price the tokens in dAdmin, deliberately, or drop the
  tile.

`GET /api/admin/analytics/fields` serves these definitions, so a dashboard can
show the same sentence the API means. A test fails if a headline field is added
without a definition.

## A note on the analytics

Every number on the overview is derivable from tables that already exist:
`kody_messages` carries domain, tier, latency, tokens and model on every
answer, `kody_feedback` carries the votes, `sme_queue` carries the corrections,
and `audit_log` carries the rest.

Nothing new needs storing. The work is queries and caching, not schema.

One caution: these queries scan `kody_messages` and `messages`, which are the
two largest tables. The overview should be computed on a schedule and cached,
not on every page load.
