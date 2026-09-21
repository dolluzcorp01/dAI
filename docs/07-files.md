# Files service

Module 7. Upload, the scan gate, download, the per-space browser, versioning.

34 tests in this module, 177 across the backend, all passing from an empty
database with real bytes written to disk.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/conversations/:id/files` | Upload, multipart, field name `file` |
| GET | `/api/conversations/:id/files?kind=` | Browser: all, media, image, video, audio, file |
| POST | `/api/messages/:id/attachments` | Attach uploaded files to your message |
| GET | `/api/files/:id` | Metadata |
| GET | `/api/files/:id/download` | Stream the bytes |
| GET | `/api/files/:id/versions` | Version chain, newest first |
| DELETE | `/api/files/:id` | Uploader or space owner |

The client uploads first and sends the message second, attaching by id. That
way a failed scan never produces a message pointing at a file that does not
exist.

---

## The scan gate

Every upload is written as `pending`, scanned, then updated. **The download
handler checks the column rather than trusting the upload**, which is what
makes the gate hold even if a file is marked infected later by a rescan.

| Status | Download |
|---|---|
| `pending` | 409 `scan_pending` |
| `clean` | served |
| `infected` | 403 `not_clean` |
| `skipped` | 403 `not_clean` |

An infected file is deleted from storage immediately, soft deleted in the
database, and written to `audit_log` as `file.infected_rejected`.

### Two scanner drivers

`clamav` talks to a real clamd over TCP using the INSTREAM protocol. This is
the production driver and is not exercised in CI, because there is no clamd
here.

`local` detects the EICAR string, the industry standard harmless antivirus
test file. **It is not antivirus.** It exists so the infected path is actually
tested rather than assumed. The config refuses to boot in production with
`FILE_SCANNER=local`.

---

## Three things that protect you

**The storage key never contains user input.** A file uploaded as
`../../../etc/passwd` is stored as `2026/09/<uuid>.txt`. The original name
lives only in a database column, for display. The local driver also resolves
the final path and verifies it is still inside the root, so a malformed key
cannot escape.

**HTML and SVG are never served with a renderable content type.** A browser
renders them in the origin of whoever opens the link, which turns an upload
into stored XSS against your own staff. Both come back as
`application/octet-stream`, always with `Content-Disposition: attachment`,
`nosniff`, and a restrictive `Content-Security-Policy`.

**Type checking is an allowlist, not a blocklist.** A blocklist is always one
new extension behind.

---

## Verified behaviour

| Area | Checks |
|---|---|
| Upload | allowed type accepted and marked clean, bytes land under a generated key, disallowed type refused, empty file refused, oversize refused, non-member refused, token required |
| Filename safety | path traversal stripped, shell and filesystem characters replaced, leading dots removed, empty name handled, HTML and SVG never renderable |
| Scan gate | EICAR detected and rejected, no downloadable row and no bytes left behind, audit row written, pending not served, later-infected not served |
| Download | exact bytes round-trip, safe headers, other member can download, non-member cannot, token required, missing file 404, missing bytes 410 |
| Attaching | attaches and appears on the message, cannot attach to someone else's message, cannot attach across conversations, maximum ten |
| Browser | lists clean files newest first, excludes infected, filters by kind, paginates, caps the limit, non-member blocked |
| Versions and deletion | version chain links back, uploader deletes and bytes go, non-owner cannot delete another's file |
| Scanner | EICAR detected at the start and mid-file, ordinary content passes |

---

## How the tests were checked

Three guards were deliberately broken to confirm the suite notices:

- Removing the scan status check made both "pending cannot be downloaded" and
  "later-infected stops being served" fail.
- Removing the membership check made "a non-member cannot download it" fail.
- Putting the original filename back into the storage key made both the
  generated-key test and the path traversal test fail.

All files were restored and checksummed against their originals before the
final run.

---

## Storage drivers

`local` writes under `STORAGE_LOCAL_PATH`. Fine for development and a single
server.

`spaces` is not implemented and **throws on construction** rather than failing
silently, so a misconfigured production deploy stops at boot instead of losing
files. Module 15 adds the S3 client.

Note for production: local disk does not survive a redeploy on most hosts, and
two API instances do not share it. Spaces is required before there is more than
one server.

---

## PHI note

An uploaded remittance or EOB is PHI. Three consequences that are not the
schema's job:

1. `conversations.retention` must actually delete these files on a schedule.
2. The storage volume needs encryption at rest.
3. Downloads should be audited, not only uploads. Today only deletions and
   infected rejections are written to `audit_log`.

---

## Not yet done

Avatar upload. `users.avatarUrl` accepts a URL but nothing stores an image yet;
it wants the same pipeline with a separate public-read bucket, which is a
module 13 concern once the frontend needs it.
