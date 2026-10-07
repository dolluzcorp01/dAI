# Single sign-on from Inside D

Somebody who already has the Dolluz portal open should not type their password
again to use Kody.

This document is two things. Sections 1 to 4 are the design and dAI's half,
which is **built and merged**, and inert until Inside D exists. Section 5 is the
**contract Inside D has to implement**, and it is written to be handed to
whoever builds that side: it is a separate repository (`dApps/dolluzcorp`) and
nothing in this one can change it.

Nothing in this document has been run end to end, because the Inside D half does
not exist yet. dAI's half runs against a fake Inside D in
`server/tests/portal-sso.test.js`.

> **Interim, decided 2026-10-07.** The handoff below is the long-term design and
> dAI's half of it is built. It is **not what will be switched on first.**
> dAdmin is going to expose one small endpoint instead, and dAI will call that.
>
> Why: dAdmin already holds the shared `JWT_SECRET` that signs
> `dolluzcorp_token`, so it can already verify a portal session, and it already
> has a dedicated shared secret with dAI (`DADMIN_SHARED_JWT_SECRET`, Phase 1.2).
> One endpoint in a repository that already holds the secret and already has a
> trusted channel to dAI beats two endpoints, a new client registration and a new
> secret in a repository that has none of those. The trust boundary does not move:
> anything able to verify that cookie could already mint a session in any dApp,
> and dAdmin is already in that position whether this is built or not.
>
> What carries over unchanged, whichever side answers: the response is an
> `emp_id` and nothing else (section 5.2); dAI decides `app_dAI` itself
> (section 4); the call has a timeout and any failure falls through to the
> password form (section 3); the shorter session and the two places it is said
> out loud (section 4, "When the portal session ends").
>
> What is parked: sections 5.1, 5.3 and 5.4, the browser-facing half. The
> interim's own contract belongs with the dAdmin work and is not written here,
> because inventing it from this side is how two repositories end up disagreeing
> about it in production.
>
> This document stays the long-term design because the interim has one property
> worth replacing later: it puts Kody sign-in behind the **admin console's**
> uptime and deploy cadence, for people who never open the admin console. The
> fallback makes that survivable, not free.

---

## 1. The shape, and the one that was rejected

**What is built: a short-lived handoff code.** Inside D reads its own cookie on
its own origin and hands dAI a one-time code. dAI swaps that code for an
`emp_id`, server to server.

**What was proposed first and rejected: introspection.** dAI's sign in page
would have sent Inside D the raw `dolluzcorp_token` and asked who it belongs to.
It works, and it is fewer moving parts, but it has one property that is not
acceptable: **dAI's sign in page would hold a live portal credential.**

`dolluzcorp_token` is the key to every dApp in the suite. If it passes through
dAI's page and process, even only to be forwarded, then an XSS on that page, a
logging mistake, or one stray error object carrying a request body turns a dAI
incident into a suite-wide one. That is the same risk that kept dAI out of
dAdmin's shared `JWT_SECRET` scheme in the first place, arriving by a different
route.

Three things the handoff gets that introspection does not:

- **dAI never receives the portal token.** Not in a body, not in a log, not in
  an error. It cannot leak what never arrives.
- **Inside D decides, on its own page.** It can refuse, and the refusal happens
  somewhere a person can see rather than as a silent 401 from an endpoint.
- **The code is scoped to dAI and dies on use.** An introspection endpoint that
  returns an `emp_id` for any valid token is a general-purpose identity oracle:
  anything that can reach it and holds a stolen cookie learns whose it is.

The cost is one redirect.

It is also the same handoff shape dAI already uses for the Chrome extension
(`docs/14-extension.md`), so there is one pattern in the system rather than two.

### Why a redirect and not a fetch

A cross-origin `fetch` with credentials would need CORS on Inside D: an exact
allowed origin plus `Access-Control-Allow-Credentials`, which is a second
browser-facing surface to get right. A top-level GET needs neither, and it is
the same redirect the extension handoff already uses.

**Corrected 2026-10-07.** This section previously also said that a credentialed
fetch would require weakening `dolluzcorp_token` to `SameSite=None`. That is
wrong: Inside D already sets it `SameSite=None; Secure; HttpOnly` on
`.dolluzcorp.com` in production (`dApps/dolluzcorp`,
`src/backend_routes/Login_server.js`, `cookieOptions`). Nothing would have had to
be weakened. The security argument against introspection in section 1 stands on
its own and does not depend on that claim; the claim was simply not checked
before it was written down.

### The portal cookie reaches dAI whether dAI wants it or not

Following from the above, and worth writing down because it is a trap rather
than a feature: because `dolluzcorp_token` is scoped to `.dolluzcorp.com` with
`SameSite=None`, **it is sent to `dai.dolluzcorp.com` on every request**, and
`HttpOnly` keeps it from the page's JavaScript but not from dAI's server.

So the thing this whole design exists to avoid holding is already sitting in
dAI's request headers. dAI must never read its value: not to verify it, not to
forward it, not to log it. At the time of writing nothing in `server/src` reads
a cookie at all, and there is no cookie parser in `server/package.json`. That is
deliberate and should stay true.

Its **presence** is a different thing from its value, and is the one safe use.
**Built.** `GET /api/auth/portal/config` answers `enabled: false` with
`reason: "no_portal_cookie"` when the request carries no `dolluzcorp_token`, so
somebody who has never opened the portal is never sent on a round trip that could
only come back `login_required`. An AR caller is in that state every time.

The read lives in `server/src/lib/portal-cookie.js`, which is the only file under
`server/src` that touches a cookie, is deliberately small enough to read in full,
and compares cookie **names** plus the **length** of one value. It never captures
a value, returns one or logs one. Three tests hold that down: one asserts the
list of files reading a cookie is exactly `["lib/portal-cookie.js"]`, one asserts
that file cannot write a value anywhere, and one asserts it stays under forty
lines.

Names are compared whole, because a substring test over the header is a real bug
rather than a theoretical one: `other=dolluzcorp_token` and
`not_dolluzcorp_token=x` both contain the name and neither is a portal session.
That mutation was run and caught.

Presence is a **hint, not proof**. The cookie may be expired, or revoked for one
app: Inside D deliberately does not clear it on a per-app revoke, so that
revoking one app does not sign somebody out of all of them. A true answer means
"worth asking", never "this person is signed in". Nothing is authorised on the
strength of it, and the cost of a wrong yes is the one redirect that used to
happen to everybody. So the default in `pageConfig()` is `true`: a caller that
forgets to pass it gets the old behaviour, which costs a redirect, rather than
silently switching single sign-on off.

> **Measured 2026-10-07**, by Shoban, on his laptop, in the Chrome profile he
> uses for Kody, extension `ikamkodfpkklimdldhfpnhmmlapdjpmn` against
> production. Both probes used Inside D's `/api/employee/me`, which is
> `optionalAuth` and so answers `authenticated: true` or `false` rather than
> 401: the difference is purely whether the cookie arrived.
>
> | Probe | Result |
> |---|---|
> | normal tab (control) | `authenticated: true` |
> | `chrome.identity.launchWebAuthFlow` on that URL | `authenticated: true`. That window DOES carry the profile's `.dolluzcorp.com` cookies. |
> | `fetch` from the extension service worker, `credentials: "include"` | `authenticated: true` |
>
> So neither route is blocked. The interim takes the service worker route anyway
> (section 7), which makes the first of those irrelevant rather than merely
> survivable.

---

## 2. The flow

```
Chrome extension
  |
  |  opens
  v
dai.dolluzcorp.com/extension/authorize?state=S&redirect_uri=R&flow=webauth
  |
  |  GET /api/auth/portal/config   (same origin)
  |  -> { enabled: false }  then the password form, and that is the end of it
  |  -> { enabled: true, authorizeUrl, clientId, redirectUri, sessionHours }
  |
  |  keeps { portalState, state, redirectUri, flow, surface } in sessionStorage
  |  navigates (top level, same tab)
  v
inside.dolluzcorp.com/authorize
    ?client_id=dai&redirect_uri=<dAI>&response_type=code&state=<portalState>&prompt=none
  |
  |  reads ITS OWN cookie, on ITS OWN origin
  |  -> no session:  back with ?error=login_required&state=<portalState>
  |  -> session:     back with ?code=<60s one-time>&state=<portalState>
  v
dai.dolluzcorp.com/extension/authorize?code=...&state=<portalState>
  |
  |  recovers the stored request, checks portalState, drops it
  |  POST /api/auth/portal/callback { portal_code, state, redirect_uri }
  v
dAI server
  |
  |  POST <PORTAL_TOKEN_URL>  { grant_type, code, client_id, client_secret, redirect_uri }
  |  <- { emp_id: "DZIND148" }                  <-- and nothing else
  |
  |  dadmin.employee: active? not deleted? app_dAI?     <-- the same gate as a password
  |  mints a Kody one-time code, origin = portal
  v
back to the extension, which swaps it for a Kody session of 8 hours
```

`prompt=none` is what keeps this from being a trap. Inside D answers immediately
either way and never shows its own sign in page, so somebody with no portal
session comes straight back to Kody's form instead of landing somewhere
unfamiliar, and there is no loop to get stuck in.

### What the portal state does and does not cover

`portalState` is generated by dAI's page, kept in that tab's `sessionStorage`,
and compared against what Inside D echoes back. It is the check that stops
somebody else's handoff code being pushed through the page, and it cannot be
read by another origin.

It is deliberately **not** re-checked on dAI's server, because that would mean
the server storing pending requests for every sign in that starts. What it
protects against is a code being swapped for one belonging to an attacker's own
portal session, which wins the attacker a Kody session as themselves. The
dangerous direction, a victim's Kody session carrying an attacker's identity, is
what the check in the page prevents, and the extension's own `state` prevents a
code reaching the wrong extension on top of that.

If the page has nowhere to keep that value (a private window, blocked site
data), it does not make the trip at all and shows the password form with a line
saying so. A round trip whose answer cannot be checked is worse than typing a
password.

---

## 3. The password form stays first-class

It is the way in when:

- Inside D's half does not exist yet, which is today
- nobody is signed in to the portal (`error=login_required`)
- Inside D is down, or does not answer within 5 seconds
- the page is in a private window and has nowhere to keep its state
- `crypto.getRandomValues` is unavailable, so there is no safe state to generate

**Whoever answers the handoff, being unavailable must never block signing in to
Kody.** Otherwise dAI inherits that service's uptime, having gained nothing.

That is a property of code and not a promise, in one specific way: a box that is
mid-deploy can accept a TCP connection and then never answer, which is a hang
rather than a refusal. `portal.service.js` aborts the exchange after 5 seconds
(`TIMEOUT_MS`) and reports `portal_unreachable`, which is a different error from
`portal_refused` and gets different words, so nobody is left reading "your
password was wrong" when the real answer is "nobody answered".

What a Kody session does NOT depend on is the handoff. Kody's access and refresh
tokens are issued and verified by Kody alone. Refresh re-reads
`dadmin.employee` over the **shared MySQL connection** to enforce `app_dAI`
revocation within one access token lifetime (Phase 1.1,
`dadmin.service.accessRevoked`); it makes no HTTP call to dAdmin or to Inside D
and must never start making one. Restarting or deploying either app signs nobody
out. "Refresh must not call dAdmin" is already true, and must not be mistaken for
"stop re-checking dadmin": the database read is what makes a revoked account lose
access in 15 minutes rather than 30 days.

Every one of those paths lands on the form with one quiet line above it saying
why a password is being asked for. It is deliberately not the red error box:
"you are not signed in to the portal" is the ordinary state of affairs for
anyone who opened Chrome and went straight to Kody, and painting that red
teaches people to ignore red.

One exception, which matters. If the portal vouched for somebody whose
`app_dAI` is off, the page does **not** offer the password form as the way
forward, because the password would be refused for exactly the same reason.
That one goes in the error box: *"Your Dolluz account does not have Kody access
yet. Ask your administrator."* Sending them to type a password would be sending
them to fail twice.

---

## 4. What dAI built

| File | What it does |
|---|---|
| `server/migrations/013_portal_sso.sql` | `origin` on `auth_codes` and `sessions`: `password` or `portal` |
| `server/src/services/portal.service.js` | the exchange with Inside D, and nothing else |
| `server/src/services/dadmin.service.js` | `signInWithEmpId()`, the same `accessProblem()` gate without a password |
| `server/src/services/auth.service.js` | `resolveUser({ email, password, portalEmpId })`, session lifetime by origin |
| `server/src/lib/tokens.js` | `sessionExpiry(origin)` |
| `server/src/routes/auth.routes.js` | `GET /api/auth/portal/config`, `POST /api/auth/portal/callback` |
| `server/public/extension/authorize/` | the two legs, the reasons, the 8 hour line |
| `server/src/config.js` | the `portal` block, `portalEnabled()`, and four boot guards |

**The extension itself changed nothing.** It opens a URL and waits for a code at
its callback, which is what it already did. That was the point of choosing this
shape.

### It is inert until Inside D exists

With any of `PORTAL_CLIENT_ID`, `PORTAL_CLIENT_SECRET`, `PORTAL_AUTHORIZE_URL`,
`PORTAL_TOKEN_URL` or `PORTAL_REDIRECT_URI` unset, `portalEnabled()` is false,
`/api/auth/portal/config` answers `{ enabled: false }`, the page never leaves
`dai.dolluzcorp.com`, and `/api/auth/portal/callback` returns 503. That is the
state the repository ships in and the state production is in now.

Set five or none. Four out of five is refused at boot, because half a handoff
sends somebody to another origin and brings them back to an exchange that cannot
work.

### app_dAI is not bypassed

Structural, not a promise. The exchange yields an `emp_id` and nothing else. dAI
then runs the same path a password runs: `accessProblem()` checks `active`,
`deleted_time` and `app_dAI`, and `roleForAccessLevel()` maps the level.

**Portal sign-in replaces proof of identity, not authorisation.** An employee
with a perfect portal session and `app_dAI = 0` gets the same refusal as today.
There is a test that says so in those words
(`tests/portal-sso.test.js`, "portal access is not Kody access"), and another
that proves both doors shut for the same employee.

The portal path also does **not** fall through to a local Kody password outside
production, the way the password path does. An `emp_id` dadmin has never heard
of is a fault at Inside D or a forged exchange, not a development convenience.

And a browser cannot vouch for itself: `portal_emp_id` in the body of
`/api/auth/authorize` is ignored, because the route never reads it. Only
`/portal/callback` sets it, and only after the server to server exchange.

### When the portal session ends

Today, nothing propagates. A portal logout leaves Kody signed in. Rather than
pretend otherwise, a portal sign-in gets a **working day** instead of 30 days:

| Signed in with | Kody session lasts |
|---|---|
| a password | `REFRESH_TOKEN_DAYS`, 30 |
| the portal vouching | `PORTAL_SESSION_HOURS`, 8 |

`origin` lives on the `sessions` row, not just the `auth_codes` row, for one
reason worth stating: refresh rotation INSERTs a new session row every fifteen
minutes. Without carrying the word forward, a portal session would be issued for
8 hours and promoted to 30 days by its own first refresh, and the shorter
lifetime would last a quarter of an hour. There is a test that refreshes three
times and checks the expiry each round.

**It is said out loud, in both directions**, because a session that is quietly
shorter is a session somebody thinks is broken:

- On the way in, the handoff screen says *"Kody is signed in. This came from
  your Dolluz portal sign in, so it lasts 8 hours rather than 30 days. You can
  close this tab."*
- On the way out, refreshing an expired portal session returns
  `portal_session_ended` rather than `refresh_expired`, with the message *"Your
  Kody session came from the Dolluz portal, so it lasts 8 hours rather than 30
  days. Sign in again to carry on."*

The longer-term answer, which needs Inside D to build more than this contract,
is a re-check at refresh: dAI already re-reads `dadmin.employee` on every
refresh, and could also ask Inside D whether that `emp_id` still has a portal
session. That would end a Kody session within one access token lifetime, 15
minutes, of a portal logout. It adds a runtime dependency on Inside D to every
refresh, so it is a decision to take deliberately and not in the first version.
See section 5, "Later".

### The secret

`PORTAL_CLIENT_SECRET` authenticates dAI to Inside D's token endpoint and signs
nothing. It is its own dedicated random value, never `JWT_ACCESS_SECRET`, never
`JWT_REFRESH_SECRET`, never `DADMIN_SHARED_JWT_SECRET`. If it were a signing
secret, dAI could mint a session as any employee in any dApp, and a compromise
of dAI would become a compromise of all of them: the whole reason dAI is outside
that scheme.

The app refuses to start if it is one of those three, or shorter than 32
characters, and `scripts/check-env.js` says the same thing before pm2 does.

That guard, and the "all five or none" one, are **not** production-only, unlike
every other guard in `config.js`. The place somebody wires this up for the first
time is a laptop, so saying it only in production would say it to the wrong
person. The https rule is production-only, because running against a local
Inside D over http is a legitimate thing to do while building it.

---

## 5. The Inside D contract

**Hand this section to whoever builds the Inside D side.** It is the whole of
what dAI needs. dAI's half is already written to it, so anything that differs
here has to be agreed rather than assumed.

Inside D is `dApps/dolluzcorp`, serving `https://inside.dolluzcorp.com`. It
already owns a session cookie named `dolluzcorp_token` and already authenticates
against `dadmin.employee`.

### 5.1 `GET /authorize`

A browser arrives here by top-level navigation, carrying the portal's own cookie.

| Query parameter | Value |
|---|---|
| `client_id` | `dai` |
| `redirect_uri` | must match the registered value for that client, exactly |
| `response_type` | `code` |
| `state` | opaque; echo it back untouched, never interpret it |
| `prompt` | `none` when present: answer without showing a login page |

Behaviour:

1. Reject the request **before reading the cookie** if `client_id` is unknown or
   `redirect_uri` is not the exact registered string for it. Reply on Inside D's
   own page. **Do not redirect to an unregistered URI to report the error**:
   that is how an open redirect becomes a way to harvest codes.
2. If the cookie is valid, mint a handoff code (5.3) and redirect to
   `redirect_uri?code=<code>&state=<state>`.
3. If it is not, and `prompt=none`, redirect to
   `redirect_uri?error=login_required&state=<state>`.
4. If it is not, and `prompt` is absent, Inside D may show its normal login and
   continue afterwards. dAI does not use this today and always sends
   `prompt=none`.

Error values dAI understands, all returned the same way as `login_required`:
`login_required`, `interaction_required`, `consent_required`, `access_denied`.
Anything else is reported to the person as "the portal could not confirm who you
are" and the password form.

### 5.2 `POST /oauth/token`

Server to server. dAI's backend calls this. No browser is involved and no cookie
is read.

Request body, `application/json`:

```json
{
  "grant_type": "authorization_code",
  "code": "<the code from 5.1>",
  "client_id": "dai",
  "client_secret": "<the registered secret for that client>",
  "redirect_uri": "https://dai.dolluzcorp.com/extension/authorize"
}
```

Success, HTTP 200:

```json
{ "emp_id": "DZIND148" }
```

**And nothing else.** No name, no email, no access level, no roles, no portal
token. Those live on `dadmin.employee` and dAI reads them itself. If Inside D
sends them anyway, dAI drops them, deliberately: reading them here would make
Inside D able to change who somebody is in Kody. There is a test for that.

`emp_id` is `VARCHAR(20)` holding codes like `DZIND148`. It is a string. Never
`Number()` it on either side.

Failure: any non-200 with a JSON body. dAI reports it to the person as "the
portal could not confirm this sign in" and offers the password form, so the
body's contents are for Inside D's own logs rather than for dAI.

Checks this endpoint must make, all of them:

- `client_id` is known, and `client_secret` matches it, compared in constant
  time
- the code exists, has not been redeemed, and has not expired
- the code was issued **to this client**, so one client cannot redeem another's
- `redirect_uri` matches the one the code was issued for

### 5.3 The handoff code

| | |
|---|---|
| Lifetime | **60 seconds.** dAI exchanges it within one request of receiving it. |
| Uses | **Exactly one.** Enforced at redemption, inside a transaction. A second redemption fails; it does not return a second session. |
| Bound to | the `client_id`, the `redirect_uri`, and the `emp_id` it was minted for |
| Storage | hashed, not in clear. dAI stores its own codes as SHA-256 and so should this. |
| Entropy | at least 32 bytes from a CSPRNG |

A code redeemed twice must **fail**. Re-issuing on a second redemption turns a
single-use code into a bearer token with a 60 second window.

### 5.4 The client registration

One row, per client, holding at least:

| Field | For dAI |
|---|---|
| `client_id` | `dai` |
| `client_secret` | a dedicated random value, hashed at rest, generated by Shoban when this is ready |
| `redirect_uri` | `https://dai.dolluzcorp.com/extension/authorize`, one exact string |
| `name` | what the person sees if Inside D ever shows a consent screen |

An allowlist, not a pattern. No wildcards, no prefix matching, no "starts with
https://dai.dolluzcorp.com". A prefix match lets somebody append a path and
collect codes. dAI applies exactly this rule to its own extension callbacks
(`server/src/lib/tokens.js`, `isAllowedRedirect`), for exactly this reason.

### 5.5 What Inside D must NOT do

- **Do not return the portal token**, or anything derived from it, from either
  endpoint.
- **Do not accept `client_secret` from a browser.** 5.2 is server to server. If
  it has CORS headers, something has gone wrong.
- **Do not log the handoff code, the client secret, or the request body** of
  5.2. dAI's own rule, which applies to both sides of this: a database driver
  error carries the statement with the values filled in, so nothing logs an
  error object.
- **Do not decide whether somebody may use Kody.** `app_dAI` is dAI's business
  and dAI checks it. Inside D says who, not whether.
- **Do not reuse `JWT_SECRET` as the client secret.** See section 4, "The
  secret".

### 5.6 Later, not now

Not needed for the handoff, and listed so it is not designed out by accident:

**`POST /sessions/active`**, server to server, taking an `emp_id` and answering
whether that employee currently has a live portal session. It is what would let
a portal logout end a Kody session within 15 minutes rather than at the 8 hour
mark. It is a decision to take deliberately: it puts Inside D in the path of
every Kody refresh.

If it is built, it needs the same client authentication as 5.2 and must answer
with a boolean and nothing else.

---

## 6. Turning it on

In order. Steps 1 to 3 are Inside D's, 4 and 5 are dAI's.

1. Inside D builds 5.1 to 5.4.
2. Shoban generates the client secret: `openssl rand -base64 48`. It goes into
   Inside D's client row (hashed) and into dAI's `.env`. It is not in this
   repository and never will be.
3. Inside D registers `https://dai.dolluzcorp.com/extension/authorize`.
4. On the dAI box, in `/var/www/dolluzcorp.com/dai/.env`:

   ```
   PORTAL_CLIENT_ID=dai
   PORTAL_CLIENT_SECRET=<the generated value>
   PORTAL_AUTHORIZE_URL=https://inside.dolluzcorp.com/authorize
   PORTAL_TOKEN_URL=https://inside.dolluzcorp.com/oauth/token
   PORTAL_REDIRECT_URI=https://dai.dolluzcorp.com/extension/authorize
   PORTAL_SESSION_HOURS=8
   ```

   Then `node --env-file=.env server/scripts/check-env.js --port 4011`, which
   checks the five are all set, that the secret is not a signing secret, and
   that the redirect URI is actually on `PUBLIC_URL`.
5. `pm2 restart dai-backend`, then sign in through the extension twice: once
   signed in to the portal, once signed out of it. Both must work, and the
   second must show the password form with a line explaining why.

### Backing it out

Blank the five `PORTAL_*` lines and restart. The page stops leaving the origin
and the password form is the only way in again. Sessions already issued keep
their 8 hours and expire normally; nothing has to be revoked.

---

## 7. The interim: dAdmin's handoff endpoint

**Status: contract agreed 2026-10-07. dAI's half is BUILT. dAdmin's half is not
built yet.** All four of dAI's changes were accepted, and the caller is the
extension service worker only. It is inert until `DAI_LOGIN_JWT_SECRET` and
`DAI_LOGIN_HANDOFF_URL` are both set.

dAdmin exposes one endpoint and dAI calls it. dAdmin's half of the contract came
from the dAdmin session on 2026-10-07; this section records it, plus the four
changes dAI asked for and what dAI will do with it. Nothing here is agreed until
dAdmin confirms, because changing it afterwards means changing both repositories.

### What dAdmin offered

```
POST https://dadmin.dolluzcorp.com/api/login/dai/handoff
  credentials: include        the portal cookie is what authenticates it
  body: none, and no query string ever: the token must not reach a URL,
        a log or a Referer header

200 { "token": "<jwt>", "expiresInSeconds": 60 }
    payload { emp_id, aud: "dai-login", jti, iat, exp }, exp = iat + 60
401 { "error": "login_required" }      no cookie, invalid, expired, revoked
403 { "error": "dai_not_enabled" }     app_dAI = 0, inactive, or deleted
503 { "error": "dai_not_configured" }  the shared secret is missing on dAdmin
```

dAdmin checks, in order: the cookie is valid under `JWT_SECRET`; it is not a
half-finished two-step challenge token; the session is not revoked in dAdmin's
Login Page Config; and the employee row has `active = 1`,
`deleted_time IS NULL`, `app_dAI = 1`. The handler does one JWT verify and one
indexed SELECT, with no outbound calls.

### Who makes the call, and why it is not dAI's server

`credentials: include` means **the browser** authenticates this, so dAI's backend
cannot make it: the backend has no cookie. That leaves two candidates, and the
extension's **service worker** wins on every axis:

| | service worker | the sign in page |
|---|---|---|
| A window opens | no. Sign-on is invisible. | yes, the existing page |
| CORS on dAdmin | none needed | `Access-Control-Allow-Origin: https://dai.dolluzcorp.com` exactly, `Allow-Credentials: true`, and an `OPTIONS` handler |
| Depends on `launchWebAuthFlow` carrying cookies | no | yes |
| Cookie-presence gate (section "The portal cookie reaches dAI") | not needed: there is no redirect to save, and a 401 in 50ms is not worth gating | useful |

So the interim does **not** use the `PORTAL_*` configuration, and does not turn
on the redirect legs in `server/public/extension/authorize/`. Those stay inert,
with `PORTAL_*` unset, and remain the long-term design. The interim gets its own
configuration.

#### The host permission is already granted, by accident rather than by intent

A service worker `fetch` to another origin needs host permission, and
`dadmin.dolluzcorp.com` is **not** in the extension's `host_permissions`, which
lists only `https://dai.dolluzcorp.com/*`. It is covered by the content script's
`https://*/*` match, which the bubble needs in order to appear on any page, and
which Chrome counts as a required host permission. That is why probe B needed no
grant, and why `permissions.remove` answered "You cannot remove required
permissions".

It works, and it should not be left resting on that. `https://dadmin.dolluzcorp.com/*`
belongs in `host_permissions` explicitly, so the dependency is declared where
somebody reviewing the manifest can see it. The Web Store listing in Phase 3 is a
realistic reason to narrow a `https://*/*` content script match, and narrowing it
would take single sign-on with it, silently, with everybody falling back to the
password form and nothing saying why.

### The four changes dAI asked for

1. **403 is not silent.** dAdmin proposed treating 401 and 403 alike: show the
   password form, no error. 401 yes. 403 no: it means `app_dAI = 0`, inactive or
   deleted, and **the password will be refused for the same reason**, so a silent
   password form sends that person to fail twice and then raise a ticket. dAI
   already says *"Your Dolluz account does not have Kody access yet. Ask your
   administrator."* and has a test for it. It leaks nothing, because the portal
   has already authenticated them as themselves.

2. **`dai-login` gets its own secret, `DAI_LOGIN_JWT_SECRET`.**
   `DADMIN_SHARED_JWT_SECRET` currently signs only tokens that travel dAdmin to
   dAI, server to server. This design has it signing a token that lives in a
   browser. A leaked token does not leak the secret, so this is survivable rather
   than broken, but one environment variable each side removes the question
   instead of managing it. If dAdmin would rather keep one secret, the audience
   split becomes load-bearing: dAI's admin middleware already passes
   `audience: "dai-admin"` and an independent `maxAge` to `jwt.verify`
   (`server/src/middleware/dadmin-service.js`), and dAI will add a test in both
   directions, because strictness with no test aimed at it is how strictness
   stops being strict.

3. **`jti` single use is a MySQL row, not an in-memory set.** dAdmin left
   enforcement to dAI and suggested memory or Redis. Memory is wrong twice over:
   two pm2 instances each keep their own set, so a replay against the other
   instance succeeds and nothing fails loudly; and a `pm2 restart` empties the
   set, so a replay inside the remaining window succeeds. A row with a unique key,
   consumed inside a transaction, is the mechanism `auth_codes` already proves.
   Migration 014. A token with no `jti` is refused rather than accepted without
   enforcement.

4. **503 `dai_not_configured` lands on the password form silently**, not as
   `portal_unreachable`. It is a configuration answer and not an outage: retrying
   cannot help, and "the portal did not answer" is the wrong thing to tell
   somebody about a state only dAdmin can fix. The 5xx rule is right for
   everything else.

### Smaller notes, needing nothing from dAdmin

- `dai.dolluzcorp.com` to `dadmin.dolluzcorp.com` is **same-site** (eTLD+1 is
  `dolluzcorp.com`), so SameSite and third-party cookie blocking do not apply to
  the page route if it is ever used. Only CORS does.
- The 5 second abort stays, as dAdmin asked. A box mid-deploy can accept a
  connection and never answer, which is the case it guards.
- Clock skew is nil, since both apps are on the same droplet. dAI will allow a
  few seconds of tolerance anyway, and apply a `maxAge` bound independent of
  `exp`, so a bug issuing a long-lived token still could not produce a key that
  works for hours.
- The handoff URL is configuration, not a constant:
  `DAI_LOGIN_HANDOFF_URL`. Not secret.

### What dAI built

| | |
|---|---|
| `extension/manifest.json` | `https://dadmin.dolluzcorp.com/*` declared in `host_permissions` |
| `extension/src/shared/dai-login.js` | the whole caller: ask dAI where to go, call dAdmin with credentials, post the token back. Five second abort, no body, no query string, `referrerPolicy: "no-referrer"` |
| `extension/src/background/service-worker.js` | tries it BEFORE any window opens; every failure but one falls silently through to the sign in page |
| `server/migrations/014_dai_login_jti.sql` | the replay guard. The INSERT is the check, so there is no window between looking and writing |
| `server/src/services/dai-login.service.js` | verify, then spend the jti, then act. `audience: "dai-login"`, a `maxAge` bound independent of `exp`, five seconds of clock tolerance |
| `server/src/routes/auth.routes.js` | `GET /api/auth/dai-login/config` and `POST /api/auth/dai-login` |
| `server/src/services/auth.service.js` | `loginWithVouchedEmpId`, which is `resolveUser({ portalEmpId })` plus a session with `origin = 'portal'` |
| `server/src/config.js` | `daiLogin`, `daiLoginEnabled()`, and the boot guards |
| `server/scripts/retention.js` | sweeps spent jti rows after a week, measured from `expires_at` |

The session that comes out is `origin = 'portal'` and so lasts
`PORTAL_SESSION_HOURS`, and says so in both places, exactly as section 4
describes. None of that changed.

#### No one-time code on this path, and why

The other two paths mint a Kody `auth_code` because the answer travels through a
browser redirect, where it can be seen. This one has no redirect: the service
worker calls dAI directly over https and reads the tokens from the response, so a
code would be a round trip that protects nothing. `POST /api/auth/dai-login`
returns a session the way `POST /api/auth/login` does.

#### Where a person sees any of this

Nowhere, when it works. No window opens.

The single exception is an account without Kody access. dAdmin answers 403, or
dAI does a moment later if `app_dAI` was turned off between the two calls, and
the worker reports *"Your Dolluz account does not have Kody access yet. Ask your
administrator."* without opening the sign in page. That wording is the sign in
page's own, deliberately: the server's message for the same condition names
dAdmin, which is right for an administrator, but two surfaces telling one person
the same thing two different ways is worse than either wording.

Everything else is silent and lands on the password form: no portal session
(401), dAdmin unreachable or mid-deploy (timeout), dAdmin missing its own secret
(503), the handoff not configured, or a configured URL that is not https.

### What was measured, and where

Nothing below was run on the box. All of it on this laptop, against the dev
server on `localhost:4014` and a stand-in dAdmin on port 4998 implementing
section 5 of this document, with the REAL local `dadmin.employee` table.

| | |
|---|---|
| a portal session | `ok=true  user=Pavithran V V  origin=portal  8h`, tokens stored, no window |
| the same handoff token twice | `attempt 1: HTTP 200 (a session)`, `attempt 2: HTTP 401 handoff_used` |
| `DZIND002`, whose `app_dAI` is 0 | dAdmin vouched for them, dAI answered `HTTP 403 dai_not_enabled` and created no user |
| what dAI tells the extension | `{"enabled":true,"handoffUrl":"..."}` and nothing else |

Twelve mutations run against this work, twelve caught, every file restored
byte-identical: single use not enforced, a duplicate jti treated as success, a
token with no jti accepted, the audience unchecked, the second age bound dropped,
the session issued as a password session, the client sending no credentials, an
account with no access sent to the password form, a plain http handoff URL
accepted, the worker opening a window before trying silently, and the two on the
test cleanup below.

### One thing this found in the test harness

`dai_login_jti` is keyed on the jti, because the unique key IS the single-use
enforcement and a surrogate id would add nothing. The test cleanup hook sweeps
"every table with an auto-increment id", read from the schema, so this one was
never swept: sixty rows survived one run of the suite.

The hook now also sweeps an explicit short list of tables by `created_at`. The
first version of that did nothing at all, silently, because the hook's pool never
set its session time zone: `NOW()` came back in the server's local zone while the
rows the suite wrote carried UTC, so on an IST box the mark landed five and a half
hours in the future and the DELETE matched nothing. A sweep that removes zero rows
looks exactly like a sweep with nothing to remove. Both of those are now tests,
and both mutations are caught.
