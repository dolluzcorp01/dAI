# Browser extension

Module 14. Manifest V3, service worker, floating bubble, side panel, popup and
the auth handoff.

30 tests in this module, 434 across the project, passing on three consecutive
cold databases and on repeat runs.

---

## What is in it

```
extension/
  manifest.json
  build.js                     check and package, no bundler
  icons/                       16, 32, 48, 128, generated from the Dolluz mark
  src/shared/auth.js           token storage, handoff, refresh
  src/background/service-worker.js
  src/content/bubble.js        the floating bubble
  src/content/bubble.css
  src/sidepanel/               where answers are actually rendered
  src/popup/                   sign in, sign out, open
```

No bundler on purpose. Plain ES modules that Chrome loads directly, so what you
review is what ships, and there is no build step where a remote dependency
could hide.

---

## Three structural decisions

**The service worker cannot hold the socket.** A Manifest V3 worker is stopped
after roughly thirty seconds of inactivity. So realtime lives in the side
panel, which stays alive while it is open, and the worker does auth, routing
and alarms while keeping nothing in memory it cannot rebuild from storage.

**The content script never holds a token.** It runs in the page's world, where
any script on that site could read a variable. It asks the worker for what it
needs, and the worker's token branch explicitly refuses a request that came
from a tab. There is a test asserting the content script does not even mention
a token, and another asserting the worker checks the sender.

**The content script never renders an answer.** The page could read anything it
puts in the DOM, and an answer can carry claim detail. The bubble is a button
and a status dot; answers appear in the side panel, which runs in the
extension's own origin.

---

## The bug this module found in the server

The extension could not have signed in at all.

`isAllowedRedirect` was an exact-match list from configuration. A real
extension's callback is `https://<extension-id>.chromiumapp.org/...`, and that
id is not known until the extension is packed. Nothing in that list could ever
have matched, so `/api/auth/authorize` returned `bad_redirect_uri` every time.

Fixed by adding a second, equally closed route: an extension callback is
accepted only when its id appears in `EXTENSION_IDS`. Never a wildcard, because
allowing any `chromiumapp.org` host would let any extension on the machine
collect codes. Verified against the obvious attacks: an unlisted id, plain
http, a host containing the string, and a suffix like
`...chromiumapp.org.evil.com`. All refused.

Removing the id check makes the test suite fail.

---

## The sign in flow

1. The extension generates a state value with `crypto.getRandomValues`, stores
   it, and opens `https://dai.dolluzcorp.com/extension/authorize` with that
   state and its own redirect URI.
2. The person signs in **on the Dolluz site**. The password never reaches the
   extension.
3. The site mints a one-time code, valid for sixty seconds, and redirects back.
4. The extension checks the returned state matches the one it stored, then
   exchanges the code for tokens.

Tested against the real server end to end: a code really is exchanged for real
tokens, **no token travels through the redirect**, a code cannot be used twice,
a mismatched state is refused before any network call is made, and an expired
state is refused.

### Refresh

One refresh in flight at a time, for the same reason as the web client: the API
rotates refresh tokens and treats reuse as theft, revoking every session. There
is a test firing ten concurrent refreshes, asserting exactly one network call,
and then checking the session still works.

A revoked refresh token clears storage rather than retrying, because retrying a
terminal failure just loops.

---

## Permissions

| Asked for | Why |
|---|---|
| `storage` | tokens and bubble position |
| `sidePanel` | the panel |
| `alarms` | periodic badge refresh |
| `contextMenus` | right click, ask about selection |
| `notifications` | mention alerts |
| `identity` | **optional**, requested only when signing in |
| host: `https://dai.dolluzcorp.com/*` | our own API, nothing else |

Not asked for: `<all_urls>`, `tabs`, `webRequest`, `cookies`, `management`.
The content script matches all http and https pages because the bubble has to
appear on the payer portals associates work in, but it is excluded from Google
and Microsoft sign in pages, where an injected script is both unwelcome and a
review risk.

---

## Verified

| Area | Checks |
|---|---|
| Manifest | MV3, no MV2 keys, every named file exists, icons are real PNGs at the declared sizes, narrow permissions, content script excludes identity providers, CSP forbids remote and inline script, shortcuts declared |
| Static safety | no eval or `new Function`, no remote script, no `innerHTML` in the panel or bubble, no inline script or handlers in the HTML, content script never touches a token, worker refuses a token to a tab, external messages only from the Dolluz origin, links restricted to http and https, state from `crypto` |
| Handoff | distinct state every time, state stored and URL built, real code exchanged for real tokens, no token in the redirect, code not reusable, unlisted extension refused, state mismatch refused without a network call, expired state refused, refusal surfaced |
| Refresh | rotates and stores the pair, ten concurrent refreshes make one call and the session survives, a revoked token clears storage, `apiFetch` recovers from a corrupt access token |

Two mutations were run: accepting any `chromiumapp.org` host, and skipping the
state check. Both were caught.

---

## Not verified, and this matters

**No browser has loaded this extension.** There is no Chrome here. Everything
above is either static analysis of the shipped files or the auth flow driven
against the real server with a fake `chrome.storage`.

What that leaves unproven:

- Whether the bubble renders correctly, or at all, on a real page.
- Whether it survives sites with aggressive CSS, `position: static !important`
  rules, or their own shadow DOM.
- Whether `chrome.sidePanel.open` succeeds from each entry point. It requires a
  user gesture, and the fallback window path has never run.
- `launchWebAuthFlow` end to end. The code exchange is tested; the browser
  dialogue around it is not.
- Whether the service worker's lifecycle behaves as expected under real
  suspension.
- Firefox and Safari. Firefox needs its own manifest key and uses
  `browser.*`; Safari needs an Xcode wrapper. Neither has been attempted.

The first hour with Chrome will find things. That is expected, and the
structure is built so those fixes are local.

---

## Loading it

```
node extension/build.js            checks only
node extension/build.js --zip      writes dist/kody-extension-0.9.0.zip
```

Then in Chrome: Extensions, Developer mode, Load unpacked, choose
`extension/`. Copy the id Chrome assigns and put it in the server's
`EXTENSION_IDS`, or sign in will be refused, correctly.
