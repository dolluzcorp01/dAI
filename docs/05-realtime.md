# Realtime gateway

Module 5. Replaces `createKodySocket`, the block marked **SEAM** in
`kody_prototype_v10.jsx`.

22 tests in this module, 96 across the backend, all passing from an empty
database against real sockets and a real server.

---

## Swapping the prototype mock for this

In v10, `createKodySocket()` returns an object with `on`, `send`,
`setConnected` and `nextSeq`. Replace that one function with a
`socket.io-client` connection. Nothing above the SEAM changes.

```js
import { io } from "socket.io-client";

const socket = io(API_URL, {
  auth: { token: accessToken },        // the access token from module 3
  transports: ["websocket"],
});
```

### Events

| Direction | Event | Payload |
|---|---|---|
| out | `message:send` | `{ conversationId, body, clientMsgId, replyToId?, threadParentId? }` |
| out | `message:read` | `{ conversationId, seq }` |
| out | `typing:start` / `typing:stop` | `{ conversationId }` |
| out | `conversation:sync` | `{ cursors: [{ conversationId, afterSeq }] }` |
| out | `conversation:history` | `{ conversationId, beforeSeq, limit }` |
| out | `presence:set` | `{ presence }` |
| in | `status` | `{ state: "connected", userId, conversations: [...unread] }` |
| in | `message:ack` | `{ clientMsgId, message }` your own, now with a seq |
| in | `message:new` | `{ message }` someone else's |
| in | `receipt` | `{ conversationId, userId, lastReadSeq }` |
| in | `typing` | `{ conversationId, userId, typing }` |
| in | `presence` | `{ userId, presence }` |
| in | `conversation:synced` | `{ conversations: [...] }` |

Every outbound event also takes an acknowledgement callback, which is how the
client learns a send was rejected:

```js
socket.emit("message:send", payload, (res) => {
  if (!res.ok) showError(res.error);      // not_a_member, announcement_only, archived
});
```

### Mapping to the prototype's delivery states

| Prototype state | Real trigger |
|---|---|
| `sending` | set locally the moment the user presses send |
| `sent` | the `message:ack` callback returns |
| `delivered` | recipient's client emits `message:read` or the server sees their socket |
| `read` | a `receipt` arrives with `lastReadSeq >= this message's seq` |
| `failed` | acknowledgement returns `ok: false`, or the socket is down |

The offline queue in the prototype maps directly: hold unsent messages with
their `clientMsgId`, and on reconnect send them again. Resending is safe
because `clientMsgId` is unique per conversation.

---

## The two rules that make sync work

**1. `seq` is allocated under a row lock.**

```sql
SELECT last_seq FROM conversations WHERE id = ? FOR UPDATE;
UPDATE conversations SET last_seq = last_seq + 1 ...;
INSERT INTO messages (conversation_id, seq, ...) VALUES (?, @s+1, ...);
```

`FOR UPDATE` is not optional. Removing it is not a theoretical risk: doing so
makes the concurrency test fail immediately, which is how it was verified.

A stress run of 60 simultaneous sends across 6 sockets produced 60 unique
contiguous sequence numbers and 60 rows.

**2. `clientMsgId` makes retries safe.**

The client generates a UUID before sending. `UNIQUE (conversation_id,
client_msg_id)` means a retry after a dropped connection returns the original
message rather than creating a second one. The duplicate path is handled twice:
a lookup before insert, and a catch on `ER_DUP_ENTRY` for the case where two
retries race.

---

## Authorisation

Membership is checked on the server for every single operation. The prototype
hides the composer in an announcement channel and hides private channels from
the list, but those are conveniences, not controls.

Verified by test:

- A non-member never receives `message:new`. There is an explicit test that
  connects an outsider and asserts no message arrives.
- Sending to a conversation you are not in returns `not_a_member`.
- A non-owner posting to an announcement channel returns `announcement_only`.
- An archived space returns `archived`.
- `conversation:sync` silently skips conversations the caller has left, rather
  than erroring in a way that reveals they exist.
- The handshake rejects a missing token, a forged token, and a token whose
  session was revoked.

---

## Behaviour worth knowing

**No self-echo.** The sender gets `message:ack`, everyone else gets
`message:new`. The client should render optimistically and reconcile on ack.

**The read cursor only moves forward.** Marking an older message read is
ignored, otherwise opening an old message on a second device would make newer
messages unread again.

**Presence on disconnect checks for other sockets.** A user with the extension
and the web app open does not go offline when one tab closes.

**Typing is throttled** to one event per 1.5 seconds per conversation, so a
fast typist does not flood a channel.

**`@kody` is not a mention.** It is a command for the AI layer, so it is
excluded from `message_mentions`. `@here` is stored with a null user.

---

## Not yet done

- **Redis adapter.** The gateway is single process today. Running more than one
  API instance needs `@socket.io/redis-adapter`, or a message sent on instance
  A will not reach a socket on instance B. Module 15.
- **Delivered receipts** are inferred from the read cursor. A true delivered
  state needs the recipient's client to acknowledge arrival, which is a client
  change in module 13.
- **Edit, delete, reactions, pins and forwards over the socket.** The database
  supports all of them; the REST endpoints and socket events are module 6.
