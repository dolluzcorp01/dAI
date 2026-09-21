# Frontend integration

Module 13, taken out of order deliberately. The v10 client had never touched
the backend, and every mismatch found here would have been inherited by
everything built afterwards.

20 integration tests in this module, 233 across the project, all passing.

---

## What this module is

`web/src/` is the client SDK Pavithran drops into a Vite React app:

```
web/src/
  api/client.js      fetch wrapper, token storage, automatic refresh
  api/adapters.js    backend shapes -> the frozen v10 UI shapes
  api/endpoints.js   every endpoint, returning UI-shaped objects
  realtime/socket.js REPLACES createKodySocket in the prototype
  screens/LoginScreen.jsx  the v11 flow, web and extension modes
```

Screens never see backend naming. If a column is renamed, `adapters.js` is the
only file that changes.

---

## Every field name differed

The prototype was frozen before the schema existed, so nothing lines up. Rather
than rewrite 2,000 lines of approved UI, the mapping is in one tested file.

| Backend | v10 UI |
|---|---|
| `conversationId` | `convo`, as `"dm:12"` |
| `senderId` | `from` |
| `body` | `text` |
| `createdAt` | `ts`, as a number |
| `editedAt` | `edited`, boolean |
| `deletedForAllAt` | `deletedForAll`, boolean |
| `replyToId` / `threadParentId` | `replyTo` / `threadParent` |
| `forwardedFromId` | `forwarded`, boolean |
| `sourceName` + `sourceAsOf` | `source: { name, asOf }` |
| `lookupCode` + `lookupSet` + `lookupDescription` | `lookup: { code, set, desc }` |
| `latencyMs` | `ms` |
| `usedWebSearch` | `live` |
| `fullName` / `jobTitle` / `presence` | `name` / `role` / `status` |

**The delivery state has no column at all.** The prototype shows sending, sent,
delivered and read ticks. The backend stores read cursors. `deliveryState()`
derives one from the other: read when every other member's cursor has passed
this message's seq, delivered when some have, sent otherwise. This is why the
UI must be handed the cursors, not only the messages.

---

## Replacing the SEAM

`web/src/realtime/socket.js` exports `createKodySocket` with the same surface
as the prototype's mock, so the React code above the SEAM does not change.

What it adds over the mock: reconnect with backoff, an offline queue that
survives a drop and flushes on reconnect, resync from the last seq per
conversation, and optimistic sends reconciled by `clientMsgId`.

Flushing is safe to retry because every queued send carries its `clientMsgId`,
and the server returns the original message rather than creating a duplicate.
There is a test asserting exactly one row after a double send.

---

## Three real defects found here, none visible to the backend tests

**1. The code description vanished on reload.**
A tier 0 answer returned `lookupDescription` when created, because it was
attached in memory, but the column did not exist. On reload the client had a
code with no description, so the answer card rendered a blank line. Fixed by
migration 007, which adds the column and backfills.

The description is denormalised onto the answer on purpose. Joining back to
`code_entries` would show today's wording against an answer given months ago,
and a compliance answer has to read the way it read when it was given.

**2. Opening a DM directly showed no name.**
`listMine` derived the other person's name for a DM, but `GET
/api/conversations/:id` did not. Any client opening a DM from a link or a
notification got `name: null`. Fixed in the service.

**3. A corrupt stored token logged the user out.**
The client retried only on `token_expired`. A corrupt access token in extension
storage returns `invalid_token`, which is equally recoverable by refreshing.
Now both refresh, while `session_revoked`, `refresh_reused` and
`account_disabled` correctly do not, because retrying those would loop.

---

## The refresh stampede

This is the one worth Pavithran reading twice.

The API rotates refresh tokens and treats reuse of a rotated token as theft, so
it **revokes every session for that user**. That is correct security.

It also means a naive client logs people out constantly. Ten parallel requests
hitting an expired access token each start their own refresh. The first
succeeds and rotates. The other nine present the now-rotated token, the server
sees reuse, and every session dies.

`client.js` keeps **one refresh in flight**; everyone else awaits the same
promise. There is a test firing ten parallel calls on a stale token and
asserting all ten succeed and the session survives.

---

## Tokens

| Surface | Store | Why |
|---|---|---|
| Extension | `chrome.storage.local` | shared by the background worker and every content script |
| Web app | memory only | `localStorage` is readable by any script that runs on the page |

---

## Verified behaviour

| Area | Checks |
|---|---|
| Sign in | tokens stored, UI-shaped user, readable error on a bad password, expired JWT refreshes silently, corrupt token recovers, ten parallel calls cause one refresh |
| Shapes | conversation keyed `kind:id`, message exposes all 12 fields the UI reads, delivery state derived correctly in four cases, Kody answer nests source and lookup, description survives reload, person maps to the directory shape, error codes become sentences |
| Socket | connects and reports unread state, delivers to the other side already UI-shaped, offline send queues, double flush produces one row, invalid token stops rather than looping |
| Vertical slice | sign in, list conversations, send, page, mark read, react, edit, ask Kody in a conversation, upload and attach a file, settings round trip |
| Login screen | renders in both modes, password field typed, labelled inputs, extension mode names the extension and explains where the password goes |

---

## Still to do on the client

- **Wiring the v10 prototype itself.** The SDK is proven against the server, but
  the 2,000 lines of prototype UI have not been switched over from mock data.
  That is mechanical now: replace `createKodySocket`, replace `CHAT_SEED` with
  `api.conversations.list()`, replace `askKody` with `api.kody.ask`.
- **The extension shell.** Manifest V3, background worker, content script,
  side panel. The auth handoff this SDK implements is the hard part and it is
  done.
- **Upload progress.** `api.files.upload` takes an `onProgress` callback but
  `fetch` cannot report progress; it needs XHR or a streaming body.
- **No browser has run any of this.** Tests drive the SDK from Node. Rendering,
  CSS and real browser behaviour are unverified.
