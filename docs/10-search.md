# Search

Module 10. Global search, operators, the quick switcher and saved searches.

41 tests in this module, 316 across the project, passing on a clean database
and on a repeat run.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/search?q=` | Everything in one call: messages, files, people, channels, answers |
| GET | `/api/search/messages?q=&limit=&offset=` | Messages only, paginated |
| GET | `/api/search/files?q=` | Files by name |
| GET | `/api/search/people?q=` | Name, role, team, email or skill |
| GET | `/api/search/channels?q=` | Channels you could open |
| GET | `/api/search/answers?q=` | Your own Kody history |
| GET | `/api/search/switch?q=` | Ctrl+K quick switcher |
| GET/POST/DELETE | `/api/search/saved` | Saved searches |

---

## Permission scoping is in the query, not a filter

This is the property the module exists to guarantee.

Every message query joins `conversation_members` for the caller. A private
channel or someone else's DM is never selected, so it cannot appear in results,
in a count, or in a snippet. Filtering afterwards would be one forgotten branch
away from a breach.

Verified by test:

- An outsider searching a term that exists in a DM they are not in gets nothing.
- The same for a private channel.
- **The total count does not leak either.** A member's total is higher than an
  outsider's, and the outsider's total equals the rows actually returned.
- Leaving a channel removes its messages from your search immediately.
- A message you deleted for yourself vanishes from your search and stays in
  theirs.
- A message deleted for everyone vanishes for everyone.
- Another user's Kody history is not searchable.
- A private channel is not offered by the quick switcher to an outsider.

Two mutations were run. Removing the membership join and letting private
channels through both failed the suite immediately.

---

## Operators

```
from:pavithran  in:denials-help  has:file  has:link  is:pinned
before:2026-09-01  after:2026-09-01  "quoted phrase"
```

`@` and `#` are stripped, because people type `from:@pavithran` and
`in:#denials-help`. A malformed date is ignored rather than erroring, so
`after:last-tuesday` searches for nothing instead of failing.

---

## Short terms, which matter more than they look

InnoDB's `innodb_ft_min_token_size` defaults to 3, so a `MATCH ... AGAINST`
query for `CO` or `AR` returns nothing at all. Silently. Those are exactly the
terms an RCM associate types.

So search uses fulltext when every term is three characters or longer and falls
back to `LIKE` otherwise. There is a test that posts a message containing `CO`
and asserts searching for it finds the message.

The tradeoff: `LIKE '%co%'` cannot use an index. At volume, short-term search
will need either a lowered token size on the server or a dedicated search
engine. The seam is `searchMessages`, and `docs/02-data-model.md` already flags
Meilisearch or OpenSearch as the eventual home.

---

## Snippets

Results carry a window of text centred on the first match rather than the whole
message, so a long message does not flood the result list. Everything the v10
result row renders is in the payload: conversation name (with a `#` for
channels), sender, snippet, file count, timestamp.

---

## Input safety

Every value is bound as a parameter. `%`, `_`, `"`, backslash and a bare quote
are all tested and return a 200 with an empty or sensible result rather than an
error or a malformed query.

Free text goes to `AGAINST(? IN NATURAL LANGUAGE MODE)`, never boolean mode,
so a stray `+` or `-` cannot change the query's meaning.

---

## A third case of cross-suite interference

The search tests originally asserted that searching `SIEM` finds Vignesh. The
users suite rewrites his skills, and the test runner runs files in parallel
against one database, so this failed depending on which suite ran first.

That is now the third time this has happened, in three different modules. The
rule for anyone adding tests here: **a suite must create the data it asserts
on.** Seeded rows are shared and another suite may own them.

---

## Verified behaviour

| Area | Checks |
|---|---|
| Permission scoping | DM leak, private channel leak, count leak, shared channel visible, leaving removes access, delete for me is per user, delete for all is global, private channel hidden from channel search, Kody history is private, token required |
| Parser | operators split from text, `@` and `#` stripped, quoted phrase kept whole, malformed date ignored, empty query |
| Operators | `from:`, `in:`, `has:file`, `after:`, `before:` all narrow correctly |
| Short terms | a two character code matches, a long term uses fulltext |
| Results | every field the UI row needs, `#` prefix on channels, snippet is a window, pagination, empty query returns nothing, nonsense returns empty, special characters handled |
| Global | all five sections in one call, people by skill, file by name |
| Quick switcher | recent conversations with no query, filters as you type, falls through to people, never offers a conversation you are not in |
| Saved | save, no duplicates, mine only, another user cannot delete mine, I can delete my own |

---

## Not yet done

- **A dedicated search engine.** MySQL is fine at this size. Past a few million
  messages, short-term `LIKE` scans will hurt.
- **Relevance tuning.** Ordering is fulltext relevance then recency. No boost
  for the current conversation, recent senders or exact phrase matches.
- **Search inside a single conversation.** The prototype has no UI for it, but
  the API would need a `conversationId` filter.
- **Highlighting.** Snippets carry the window but do not mark the matched term,
  so the client has to highlight it.
