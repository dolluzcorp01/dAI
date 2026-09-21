# Users, profile and presence

Module 4. The API behind the v10 settings panel, directory and quick links.

43 tests in this module, 74 across the backend, all passing from an empty
database against a real MySQL-compatible server.

---

## Endpoints

All require a bearer token.

### Me

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users/me` | Profile with derived fields |
| PATCH | `/api/users/me` | Update profile |
| PUT | `/api/users/me/presence` | online, away, busy, dnd, offline |
| PUT | `/api/users/me/status` | Custom status with emoji and expiry |
| GET | `/api/users/me/settings` | Accent, wallpaper, avatar, predictive, font scale |
| PATCH | `/api/users/me/settings` | Update settings |
| PUT | `/api/users/me/skills` | Replace own skills |

### Quick links

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users/me/quick-links` | Kody team defaults plus your own |
| POST | `/api/users/me/quick-links` | Add one |
| DELETE | `/api/users/me/quick-links/:id` | Remove your own |

### Directory

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users?q=&team=&skill=&presence=&limit=&offset=` | Search |
| GET | `/api/users/teams` | Teams with member counts |
| GET | `/api/users/skills` | Skills with people counts |
| GET | `/api/users/:id` | One profile |

### Admin (`admin` or `super_admin`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users/admin/list` | Users with roles, optionally inactive |
| PUT | `/api/users/admin/:id/roles` | Replace roles |
| PUT | `/api/users/admin/:id/active` | Activate or deactivate |

---

## Derived fields

`GET /api/users/me` returns more than the row:

- `localTime` computed from the user's timezone, which is what the v10
  directory shows next to each person.
- `withinWorkingHours` true, false or null. Handles an overnight shift, so a
  22:00 to 06:00 window works.
- `skills` from `user_skills`.

---

## Three decisions worth knowing

**Whitelisted updates.** `PATCH /api/users/me` passes the body through
`pick()` with an explicit field list. Anything else is dropped silently rather
than reaching SQL. Sending `{"isActive": false, "email": "attacker@evil.com"}`
changes nothing. There is a test that asserts exactly that. Never spread a
request body into an UPDATE.

**Status expiry is applied on read.** A custom status whose `status_expires_at`
has passed reads as cleared, whether or not a sweeper has run. The status is
therefore always correct even if a background job is late or missing.

**Deactivating revokes sessions immediately.** Setting `isActive: false`
revokes every live session in the same call, so access stops now rather than
whenever the 15-minute access token happens to expire. An admin also cannot
deactivate themselves, which would otherwise be a way to lock the last
super admin out of their own workspace.

---

## Verified behaviour

| Area | Checks |
|---|---|
| Auth guard | every route rejects an unauthenticated request |
| Profile | derived fields, valid update, whitelist enforced, bad timezone, bad time, empty patch, out of office |
| Presence and status | set presence, reject unknown presence, status with expiry, expired status reads as cleared, clearing |
| Settings | defaults, update, reject unknown accent, font scale bounds |
| Directory | list with totals, search by name, search by skill, filter by team, filter by skill, pagination, limit capped at 100, empty result |
| Skills | replace own, create new ones on the fly, refuse more than twenty |
| Quick links | defaults listed, add, reject non-http url, cannot delete another user's link, cannot delete a default |
| Admin | member blocked, admin lists roles, member cannot change roles, admin can and it is audited, unknown role rejected, deactivation kills sessions, cannot self-deactivate, deactivated user leaves the directory |

---

## Three faults found by running it

**Express 5 removed inline route regex.** `router.get("/:id(\\d+)")` throws at
startup in Express 5, where it was valid in Express 4. Every route using it
failed to load. The id is validated in the handler now. Worth knowing before
Pavithran copies an Express 4 snippet from anywhere.

**A join referenced a derived table before it existed.** Migration 006 had
`JOIN skills s ON s.name = v.skill` before `v` was joined. MySQL rejected it.

**A failed migration leaves the database half-changed.** MySQL cannot roll back
DDL, so when 006 failed partway, `skills` had already been created and the
retry then failed with "table already exists". The runner now prints a warning
telling the operator to inspect and undo before retrying. Keep migrations small
for exactly this reason.

---

## Still missing

Avatar image upload, which needs the files service in module 7. Until then
`avatarUrl` and `kodyAvatarUrl` accept a URL but nothing stores the image.
