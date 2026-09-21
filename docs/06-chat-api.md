# Chat API

Module 6. Conversations, membership, message mutations, drafts and the
broadcasts that keep HTTP and socket clients in step.

47 tests in this module, 143 across the backend, all passing from an empty
database.

---

## Endpoints

All require a bearer token.

### Conversations

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/conversations` | My list, favourites first |
| GET | `/api/conversations/directory` | Public channels to browse |
| POST | `/api/conversations` | Create a group or channel |
| POST | `/api/conversations/dm` | Open or find the DM with someone |
| GET | `/api/conversations/:id` | One conversation with members |
| PATCH | `/api/conversations/:id` | Owner only: name, topic, purpose, private, announcement, default, archive, retention |
| DELETE | `/api/conversations/:id` | Owner only, soft delete |
| PATCH | `/api/conversations/:id/membership` | My own mute, favourite, notification level |
| POST | `/api/conversations/:id/join` | Join a public channel |
| POST | `/api/conversations/:id/leave` | Leave |

### Members

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/conversations/:id/members` | List |
| POST | `/api/conversations/:id/members` | Owner only: add |
| DELETE | `/api/conversations/:id/members/:userId` | Owner only: remove |
| PUT | `/api/conversations/:id/members/:userId/role` | Owner only: owner, member, guest |

### Messages

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/conversations/:id/messages?afterSeq=` | Forward from a cursor |
| GET | `/api/conversations/:id/messages?beforeSeq=` | Older, for scrolling up |
| POST | `/api/conversations/:id/messages` | Send |
| PUT | `/api/conversations/:id/read` | Move the read cursor |
| GET | `/api/conversations/:id/pins` | Pinned messages |
| PUT | `/api/conversations/:id/draft` | Save or clear a draft |
| GET | `/api/conversations/drafts` | All my drafts |
| PATCH | `/api/messages/:id` | Edit, author only |
| DELETE | `/api/messages/:id?scope=me\|all` | Delete |
| POST/DELETE | `/api/messages/:id/reactions` | React |
| PUT/DELETE | `/api/messages/:id/pin` | Pin |
| POST | `/api/messages/:id/forward` | Copy into another conversation |
| GET | `/api/messages/:id/thread` | Root plus replies |

---

## Decisions worth knowing

**A private space returns 404, not 403.** Returning "forbidden" would confirm
the space exists. A non-member gets the same answer as for a conversation that
was never created.

**DMs are find-or-create and deterministic.** Opening a DM with the same person
twice returns the same conversation, from either side, so two clients cannot
create competing threads for the same pair.

**Delete for me and delete for everyone are different operations.** Delete for
me inserts into `message_hides` and filters that user's reads. Delete for
everyone sets `deleted_for_all_at`, clears the body, drops attachments,
reactions and pins, and **keeps the row** so `seq` is not orphaned and the
audit trail holds. A deleted message cannot then be edited.

**Only the author edits. The author or a space owner deletes for everyone.**
Both are enforced in the service, not the route, so the socket path gets the
same rules.

**A space must keep at least one owner.** The last owner cannot be demoted,
removed, or leave. Otherwise a channel becomes unadministrable.

**HTTP mutations broadcast.** Editing, reacting or posting over REST emits on
the socket through `realtime/bus.js`, so a client with an open socket sees the
change without refreshing. Adding a member also moves their live sockets into
the room, so they start receiving messages without reconnecting.

---

## Verified behaviour

| Area | Checks |
|---|---|
| Creating | channel with owner, duplicate name rejected, group with members, bad kind, DM find-or-create from both sides, no DM with yourself |
| Visibility | private channel 404 to outsiders, directory excludes private, my list excludes others' DMs, DM shows the peer's name |
| Settings | owner renames and sets topic, non-owner blocked, bad retention rejected, archive blocks and unarchive restores, announcement blocks non-owner, own mute and favourite not owner-gated, favourites sort first |
| Membership | owner adds and removes, member cannot add, last owner protected on demote and remove, second owner then demote works, join public, private refused, leaving removes from list, cannot leave a DM |
| Messages | post, idempotent resend, author edits, others cannot, reactions add and remove, double reaction counts once, pin and unpin, outsider blocked from react, pin and read, delete for me is per user, delete for everyone preserves seq and clears body, deleted cannot be edited, non-author blocked, owner allowed |
| Threads and forwarding | replies attach to a root, forward copies with provenance, cannot forward into a space you are not in |
| Drafts | save, list, clear |
| Broadcasts | HTTP send, edit and reaction all reach an open socket, and a member added over HTTP starts receiving without reconnecting |
| Input | non-numeric id rejected, missing conversation 404, every route requires a token |

---

## How the tests were checked

All 47 passed on the first run, which is a reason for suspicion rather than
confidence, so two guards were deliberately broken to confirm the suite would
notice:

- Removing the private-channel check made "a private channel is invisible to a
  non-member" fail.
- Removing the author-or-owner check made "a non-author member cannot delete
  for everyone" fail.

Both files were then restored and checksummed against their originals before
the final run.

---

## One gap closed during the build

`deleteForMe` wrote to `message_hides`, but the fetch queries did not read it,
so a message you deleted for yourself would have reappeared on the next sync.
`since` and `before` now exclude messages hidden by the caller.

---

## Not yet done

Attachments on messages. The schema and the read path support them, but upload
is module 7, so `files` comes back empty on every message today.
