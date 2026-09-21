# Auth service

Module 3. Implements the flow frozen in `kody_auth_flow_v11.jsx`.

Verified against a live MySQL-compatible database and a live HTTP server.
31 tests, all passing from an empty database.

---

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | none | Web and desktop sign-in. Returns tokens. |
| POST | `/api/auth/authorize` | none | Extension handoff step 1. Returns a one-time code. |
| POST | `/api/auth/token` | none | Extension handoff step 2. Swaps code for tokens. |
| POST | `/api/auth/refresh` | none | Rotates the refresh token. |
| POST | `/api/auth/logout` | none | Revokes one session. |
| GET | `/api/auth/me` | bearer | Current user, session and roles. |
| GET | `/api/auth/sessions` | bearer | Every live sign-in for this user. |
| DELETE | `/api/auth/sessions/:id` | bearer | Sign out another surface remotely. |

### The extension handoff

```
extension                    site (dai.dolluzcorp.com)              API
   |  opens tab with state=<random>                                  |
   |------------------------------------->                           |
   |                          user types password                    |
   |                                    POST /api/auth/authorize     |
   |                                    {email,password,state,redirect_uri}
   |                                            -------------------->|
   |                                            <-- { code } --------|
   |  <-- redirect to redirect_uri?code=...&state=...                |
   |                                                                 |
   |  POST /api/auth/token {code,state}                              |
   |---------------------------------------------------------------->|
   |  <-- { accessToken, refreshToken, user, roles } -----------------|
```

Why a code rather than the tokens directly: the authorize response travels
through a browser redirect, where a URL can land in history, logs or a
referrer header. A code that dies in 60 seconds and works once is safe there.
A refresh token valid for 30 days is not.

---

## Token model

| | Lifetime | Storage | Revocable |
|---|---|---|---|
| Access token | 15 min | nowhere, it is a JWT | indirectly, via the session check |
| Refresh token | 30 days | SHA-256 only | yes |
| Auth code | 60 s | SHA-256 only | single use |

**The JWT alone is never trusted.** `authenticate` verifies the signature and
then looks up the session row. Without that, revoking a session would leave
the access token working for up to 15 more minutes. The test
"rejects an access token whose session was revoked, without waiting for
expiry" is what proves it.

**Refresh rotation with reuse detection.** Every refresh mints a new token and
revokes the old one. If an already-revoked token is presented, it has been
stolen and replayed, so **every session for that user is killed**, not just
that one. The user signs in again; the attacker gets nothing.

---

## What is stored

Never in the database: passwords, refresh tokens, auth codes. Only hashes.

- Passwords: scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte random salt),
  stored as `scrypt$N$r$p$salt$hash`. The prefix means argon2id can be added
  later and both formats can coexist.
- Refresh tokens and auth codes: SHA-256 of a 256-bit random value.

A database dump therefore hands an attacker nothing usable.

---

## Defences

**Account enumeration.** A wrong password and an unknown email return exactly
the same 401 and `invalid_credentials`. Unknown accounts still run a dummy
scrypt so response timing does not leak which emails exist.

**Brute force.** Two independent layers:
- Account lockout after `AUTH_MAX_FAILED` (default 5) failures, for
  `AUTH_LOCKOUT_MINUTES` (default 15). While locked, even the correct password
  is refused.
- Rate limiting per IP and email, configurable, defaults to 10 a minute.

The limits are configurable on purpose. An office behind one NAT address shares
an IP, and lockout is the real defence against guessing.

**Redirect URI theft.** `ALLOWED_REDIRECT_URIS` is matched exactly, never by
prefix. Prefix matching would let an attacker append a path and capture the
code.

**Code injection.** The code is bound to the `state` the extension generated.
A code injected by another page cannot be redeemed because the state will not
match.

**Audit.** `auth.login_failed`, `auth.session_issued`, `auth.code_issued`,
`auth.refresh_reuse_detected`, `auth.session_revoked` and `auth.logout` all
write to `audit_log`.

---

## What Pavithran must not do

1. **Do not trust the JWT without the session lookup.** The middleware already
   does both; do not "optimise" the query away.
2. **Do not return tokens from `/authorize`.** That response goes through a
   redirect.
3. **Do not widen `ALLOWED_REDIRECT_URIS` to a prefix or wildcard.**
4. **Do not log tokens or codes**, including at debug level.
5. **Do not remove reuse detection** because it "logs users out too often".
   Being logged out is the correct outcome of a stolen token.

---

## Running it

```bash
npm run migrate
node scripts/seed-passwords.js          # dev only, all users get one password
node src/server.js
npm test                                # 31 tests against the real database
```

Environment variables used: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`, `AUTH_CODE_TTL_SECONDS`,
`AUTH_MAX_FAILED`, `AUTH_LOCKOUT_MINUTES`, `ALLOWED_REDIRECT_URIS`,
`AUTH_RATE_LOGIN_MAX`, `AUTH_RATE_TOKEN_MAX`, `AUTH_RATE_REFRESH_MAX`.

The server refuses to boot in production with the development JWT secrets.

---

## Verified behaviour

| Area | Checks |
|---|---|
| Login | wrong password, unknown email, success, no hash leaked, only hash stored |
| Protected routes | no token, forged token, valid token, revoked session |
| Extension handoff | bad redirect, bad state, code issued, only hash stored, exchange, single use, wrong state, invented code, expired code |
| Refresh rotation | rotates, old token dies, reuse kills all sessions, expired refresh |
| Sessions | list, revoke one surface, other surface unaffected |
| Lockout and audit | locks after failures, correct password still refused, recovers, audit rows written |
| Password hashing | salted, verifies, rejects wrong, rejects short, survives malformed input |
| Rate limiting | blocks a burst, sets headers |

**One design fault found by testing.** The rate limit was hardcoded at 10 per
minute per IP and email. The suite exhausted it on a shared account and later
tests never reached the service. Hardcoding it would have caused the same
failure for any team behind a single office IP. Now configurable, with the
limiter proven separately.

## Still missing

Password reset by email (needs SendGrid, module 11), SSO and SAML, SCIM
provisioning, and the login screen itself. The v11 prototype specifies that
screen; module 13 builds it.
