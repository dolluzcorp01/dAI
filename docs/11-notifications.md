# Notifications

Module 11. Deciding who to notify, delivering it, and the email digest.

43 tests in this module, 360 across the project, passing on a clean database
and on two repeat runs.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notifications?unreadOnly=` | List with an unread count |
| PUT | `/api/notifications/read` | Mark specific ones read |
| PUT | `/api/notifications/read-all` | Clear the bell |
| GET | `/api/notifications/digest/preview` | What tonight's email would say |
| POST | `/api/notifications/announce` | Product notice, admin only |
| POST | `/api/notifications/digest/run` | Trigger the digest, admin only |

Plus a cron script: `node scripts/send-digests.js` (`--dry` to preview).

---

## The decision is a pure function

`decide()` takes the message, the recipient, their membership, their
preferences and the time, and returns whether to notify and through which
channels. No database, no clock of its own.

That separation matters because the rules interact, and interacting rules are
where bugs live. Every combination is tested directly rather than through the
API.

| Situation | Outcome |
|---|---|
| Your own message | never |
| Channel level `none` | never |
| Channel level `mentions`, ordinary message | no |
| Channel level `mentions`, direct mention | yes |
| Muted channel, ordinary message | no |
| **Muted channel, direct mention** | **yes** |
| Keyword match at `mentions` level | yes |
| Direct message | always |
| `@here` at `mentions` level | yes |

**A mute does not swallow a direct mention.** Muting a channel should mean
"stop the chatter", not "miss someone asking me a question". There is a test
for it, and removing the exception fails the suite.

---

## Quiet hours keep the record

Quiet hours, a DND schedule and manual do-not-disturb all suppress desktop and
push, and **never** suppress the in-app record. The notification is still
written, tagged with `suppressed_reason`, so nothing is lost overnight and the
bell is correct when the person comes back.

Windows that wrap past midnight work: 20:00 to 08:00 covers 23:00 and 03:00 and
excludes noon. Tested at all three.

---

## Message text does not leave the system

This is the important one.

`notifications.include_message_text` defaults to **false**. A notification body
reads "Shoban sent a message in #denials-help", not the message. The email
digest carries counts per space, not content.

The reason: an RCM message can contain a patient name, an account number and a
balance. The moment that appears in an email subject line, a lock screen
preview or a push payload, PHI has left your control and landed somewhere you
do not administer.

An organisation can opt in by flipping the setting, and then text is included.
That is a decision someone should make deliberately, which is why it is a
setting rather than a default. There is a test that posts a message containing
a fake patient name and asserts none of it reaches the notification or the
digest.

---

## Out of office

One auto-reply per sender, per conversation, per day, enforced by a unique key
rather than a check. Two messages arriving together cannot both slip through,
because the second insert fails on the key and is skipped.

---

## The digest

`delivered_email` is set **after** the transport succeeds, never before. A
failed send leaves those notifications in the next run rather than silently
losing them, and writes a `digest_runs` row with the error. There is a test
that injects a broken transport and asserts nothing was marked as emailed.

The script is safe to run twice: already emailed notifications are excluded.

---

## Transports

| Driver | Email | Push |
|---|---|---|
| `memory` | records the payload, sends nothing | same |
| `sendgrid` | real mail | - |
| `fcm` | - | real Android push |
| `none` | drops silently | drops silently |

**Production refuses to boot with a memory transport**, the same way it refuses
the mock model provider and the local file scanner.

---

## Notifications never block a send

The fan-out runs in `setImmediate` with its own catch. A notification failure
cannot fail a message send, and the sender does not wait for it. The tests
allow 400ms for it to settle.

---

## Verified behaviour

| Area | Checks |
|---|---|
| Rules | own message, level all, level none, level mentions, mention at mentions level, mute, mention through mute, keyword at mentions level, case-insensitive keyword, DM always, `@here`, quiet hours suppress but record, outside quiet hours, DND schedule, manual DND, midnight-wrapping windows, desktop and push toggles |
| Delivery | members notified and sender not, mention recorded as a mention, mentions-only respected end to end, keyword alert fires, mute silent then mention breaks through, quiet hours tagged with a reason |
| PHI | body names the space not the message, digest carries no message text, opting in works |
| Out of office | one reply per sender per conversation per day, not one per message |
| Reading | unread count, mark specific, cannot mark someone else's, mark all, bad payload rejected, token required |
| Digest | sends once, does not resend, respects the preference, a failed send leaves them pending and logs why, batch run, member cannot trigger |
| Announcements | admin can, member cannot, wrong kind rejected |
| Push | every registered device, none when there are none |

Three mutations were run: always including message text, letting a mute swallow
mentions, and marking the digest sent before the transport succeeded. All three
were caught.

---

## Not yet done

- **Web push while the tab is closed.** Desktop notifications today mean the
  browser Notification API while Kody is open. Real background push needs a
  service worker and VAPID keys.
- **APNs.** The FCM adapter covers Android. iOS needs its own.
- **Digest scheduling per user timezone.** The cron runs once for everyone, so
  someone in Texas gets it at the Chennai hour.
- **Notification grouping.** Twenty messages in one channel produce twenty rows
  rather than one that says twenty.
- **No real email has been sent.** Every test uses the memory transport. The
  SendGrid adapter is code review only until a key is configured.
