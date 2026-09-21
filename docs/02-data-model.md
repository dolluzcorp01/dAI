# Kody data model

Module 2 of the build. 38 domain tables, plus `schema_migrations` created
by the runner, so a fresh database shows 39. Verified by executing every migration
against MySQL-compatible MariaDB 10.11 and running behaviour tests, not by
reading the SQL.

Read this before changing anything in `server/migrations/`.

---

## The one decision everything rests on

**Every message carries `seq`, a per-conversation counter issued by the server.**

`messages` has `UNIQUE (conversation_id, seq)`. Clients never order by
timestamp, because clocks differ across machines and a message sent while
offline arrives with a stale one. A client syncs by asking:

```sql
SELECT * FROM messages
WHERE conversation_id = ? AND seq > ?   -- the last seq the client holds
ORDER BY seq
```

That single pattern gives you reconnect sync, the offline queue flush,
pagination, multi-device consistency and the unread divider.

Allocate `seq` in the same transaction as the insert:

```sql
START TRANSACTION;
SELECT last_seq INTO @s FROM conversations WHERE id = ? FOR UPDATE;
UPDATE conversations SET last_seq = last_seq + 1, last_message_at = NOW() WHERE id = ?;
INSERT INTO messages (conversation_id, seq, sender_id, body, client_msg_id)
VALUES (?, @s + 1, ?, ?, ?);
COMMIT;
```

The `FOR UPDATE` is not optional. Without it two concurrent senders get the
same seq and the unique index rejects one of them.

---

## Unread, receipts and the NEW divider

All three come from `conversation_members.last_read_seq`. No counter column
is ever incremented, so nothing can drift out of sync.

```sql
SELECT c.id, c.last_seq - cm.last_read_seq AS unread
FROM conversations c
JOIN conversation_members cm ON cm.conversation_id = c.id
WHERE cm.user_id = ?;
```

The NEW divider renders above the first message whose `seq > last_read_seq`.

`message_receipts` holds per-recipient delivered and read timestamps and
drives the tick states. In a DM that is one row per message. In a busy
channel, writing a row per member per message is expensive, so write it
lazily from `last_read_seq` when someone opens the conversation rather than
eagerly on every send.

---

## Sending twice is safe

`messages.client_msg_id` is a UUID the client generates before sending, with
`UNIQUE (conversation_id, client_msg_id)`. If a send is retried after a
dropped connection, the second insert is rejected rather than duplicated.
This is what makes the offline queue safe to flush blindly on reconnect.

---

## Deleting

Two different things, deliberately stored differently:

- **Delete for me** inserts into `message_hides`. The row stays for everyone else.
- **Delete for everyone** sets `messages.deleted_for_all_at`. The row survives
  so the seq is not orphaned and the audit trail holds. The API must blank
  `body` and detach attachments when it sets this.

---

## Spaces

`conversations.kind` is `dm`, `group` or `channel`. One table, because they
are the same messaging primitive with different membership rules. Everything
the v10 admin screen edits lives here: `topic`, `purpose`, `is_private`,
`is_announcement`, `is_default`, `is_archived`, `retention`.

Per-user, per-space preferences live on `conversation_members`:
`notif_level`, `is_muted`, `is_favourite`, `member_role`.

Announcement channels are enforced server-side. The client hides the
composer, but the API must also reject a post from a non-owner. Client-side
checks are a courtesy, never a control.

---

## Kody AI and why every answer is reproducible

`kody_messages` records `model_name`, `prompt_version`, `tier`,
`used_web_search`, `used_retrieval`, `latency_ms` and token counts on every
answer.

A compliance answer that cannot be reproduced cannot be defended. When an
associate says Kody told them to write something off, you need to know which
model, which prompt version and which documents produced that sentence.
`kody_citations` holds the documents.

**Tier 0 never calls a model.** `code_sets` and `code_entries` answer code
lookups from the database. A model inventing a plausible-looking CPT code is
this product's worst failure mode, so codes are looked up or not given.

`code_entries` has `effective_from` and `effective_to`. Always filter on
these. A documented medical RAG failure traced to a missing temporal filter,
where queries matched superseded guidance alongside current guidance.

---

## The knowledge loop

This is what turns 0 documents into a corpus:

```
thumbs down -> kody_feedback -> sme_queue -> SME writes resolution
            -> knowledge_docs (status: published) -> retrieved by future answers
```

`knowledge_docs.body` is the system of record. Chunks and embeddings live in
the vector store (pgvector or Qdrant), referenced by `vector_ref`. MySQL is
not a vector database and is not being used as one.

---

## Points

`point_events` is append-only. A balance is `SUM(points)`, never a column you
edit, so it cannot drift.

`idempotency_key` (for example `helpful:kody_message:1234`) makes double
credit impossible. `point_rules.daily_cap` is what stops a one-click thumbs
up becoming a money button. Both the cap and the conversion rate live in
`org_settings` and `point_rules`, edited from the admin console, hardcoded
nowhere.

---

## PHI, plainly

The moment an associate pastes claim detail into a channel, `messages.body`
holds PHI. That makes four things launch requirements rather than governance
niceties:

1. `conversations.retention` must actually be enforced by a scheduled job.
2. Encryption at rest on the MySQL volume.
3. `audit_log` written on read of sensitive entities, not only on write.
4. `dlp_rules` checked before a message is persisted, not after.

`attachments.scan_status` starts at `pending`. **The API must refuse to serve
any attachment not marked `clean`.** The schema cannot enforce that; the
download handler has to.

---

## Conventions

- InnoDB, `utf8mb4`, `utf8mb4_unicode_ci` throughout.
- `BIGINT UNSIGNED` surrogate keys. IDs are sequential and therefore
  enumerable; acceptable for an internal tool, revisit before external SaaS.
- Foreign keys everywhere, with `CASCADE` for children and `SET NULL` for
  references to a person who may be deleted.
- `created_at` / `updated_at` on every mutable table. `DATETIME(3)` where
  ordering within a second matters.
- Soft delete via `deleted_at` on users, conversations, knowledge docs.
- No `ON DELETE CASCADE` from `users` to `messages`: deleting a person nulls
  `sender_id` and keeps the conversation readable.

---

## Verified behaviour

Executed against a live server, not inspected:

| Check | Result |
|---|---|
| All 5 migrations apply cleanly | 38 domain tables + schema_migrations |
| Runner is idempotent | second run applies nothing |
| Editing an applied migration | refused, exit 1 |
| seq allocation in a transaction | correct, contiguous |
| Unread from `last_read_seq` | correct per user per space |
| Tier 0 lookup of CO-97 | returns with no model call |
| `@here` mention with NULL user | stored |
| Fulltext search on message body | returns the expected row |
| Duplicate `client_msg_id` | rejected |
| Duplicate seq | rejected |
| Message in a non-existent conversation | rejected |
| Duplicate reaction | rejected |
| Two votes on one answer | rejected |
| Deleting a message | cascades to reactions |

**One real bug found by running it.** `message_mentions` originally used a
composite primary key including a nullable `user_id`, because `@here` and
`@channel` mention nobody. MySQL forbids NULL in a primary key. It is now a
surrogate key with a unique index. Note that MySQL permits repeated NULLs in
a unique index, so the API must refuse to write a second `@here` row for the
same message.
