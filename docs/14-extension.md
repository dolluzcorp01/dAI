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
  src/shared/config.js         which server, production by default
  src/shared/api.js            the SDK client, built for the worker only
  src/shared/sdk/              vendored copy of web/src/api, checked by build.js
  src/background/service-worker.js
  src/content/bubble.js        the floating bubble
  src/content/bubble.css
  src/sidepanel/               where answers are actually rendered
  src/popup/                   sign in, sign out, open

server/public/extension/authorize/   the sign in page, served by the API host
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
| host: `http://localhost/*`, `http://127.0.0.1/*` | **optional**, development only, requested from the popup when a developer points the extension at their own machine |
| `externally_connectable`: `https://dai.dolluzcorp.com/*` | the sign in page hands the code back this way when the flow ran in an ordinary tab. One host, never a wildcard, and the worker checks the origin again before it accepts |

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
| Parsing | every shipped script is parsed as a module, the way Chrome parses it. This exists because a syntax error once passed a full green suite: every other check here is a regular expression over the text, and a regular expression cannot see a duplicate declaration |
| Static safety | no eval or `new Function`, no remote script, no `innerHTML` in the panel or bubble, no inline script or handlers in the HTML, content script never touches a token, worker refuses a token to a tab, external messages only from the Dolluz origin, links restricted to http and https, state from `crypto` |
| Handoff | distinct state every time, state stored and URL built, real code exchanged for real tokens, no token in the redirect, code not reusable, unlisted extension refused, state mismatch refused without a network call, expired state refused, refusal surfaced |
| Where it points | production with nothing configured, production when storage itself fails, a local server accepted and reported as not production, plain http refused for every host but this machine, both bases required together, clearing returns to production, the manifest holds localhost only as an optional host |
| Sign in page | shows a password field only for a real extension callback and refuses seven hostile ones, refuses a missing or trivial state, agrees with the server's own allowlist case for case, a correct password returns a code that exchanges for real tokens and cannot be used twice, a wrong password says so and hands nothing back, the password is cleared from the page either way, forgot password points at dAdmin without revealing whether the account exists, the page is served with its own strict policy and no-store, its assets are served and a directory listing is not, and it persists nothing |
| Side panel | the four tabs of the prototype with Chats marked Phase 2, the codes strip, the points wallet and the feedback buttons present, the panel holds no token and never calls `fetch`, every message it sends has a case in the worker, every API case in the worker checks the session, the vendored SDK is byte for byte web/src/api |
| Refresh | rotates and stores the pair, ten concurrent refreshes make one call and the session survives, a revoked token clears storage, `apiFetch` recovers from a corrupt access token |

Ten mutations have been run against this suite: accepting any
`chromiumapp.org` host, skipping the state check, drifting the vendored SDK,
letting plain http point anywhere, dropping the session check from
`kody:points`, adding a `fetch` to the side panel, letting the sign in page
return to any https address, leaving the password in the page, loosening the
page's content security policy, and widening `externally_connectable` to
`https://*/*`. All ten were caught, and every file was restored byte for byte.

---

## Not verified, and this matters

**No browser has loaded this extension.** There is no Chrome here. Everything
above is either static analysis of the shipped files or the auth flow driven
against the real server with a fake `chrome.storage`.

What that leaves unproven:

- Whether the bubble renders correctly, or at all, on a real page.
- Whether the sign in page looks like the prototype, or renders at all. Its
  own JavaScript is driven against the real server in a DOM written for the
  test, which proves what it does, not what it looks like.
- Whether the side panel looks like the prototype. Its HTML and CSS have never
  been rendered. Ask, Saved, History, the codes strip and the wallet are wired
  to the worker and statically checked, and nothing more than that.
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

**It did.** The done-check on 2026-10-01 passed, and found five faults first:
`authorize` never asked dAdmin so no real employee could sign in through the
extension; `identity` is optional so `chrome.identity` did not exist until
granted; a Chrome match pattern may not carry a port so the host permission
request was rejected; changing server kept the old server's tokens; and a
duplicate declaration stopped the worker loading while 581 green tests saw
nothing, because every check here was a regular expression over the text.
Four of those were in paths no test covered. The fifth was a hole in the
testing itself, and is why every shipped script is now parsed.

---

## One panel, and the tab closes itself

The bubble and the popup both open Kody. Where `sidePanel.open` is not
available, each used to create its own window, so two panels could sit side by
side, both saying connected, sharing one session and one points balance and
disagreeing about it within a minute. `openPanel` now looks for a panel it has
already opened and focuses that instead, before it tries anything else. The
window id lives in `chrome.storage.session`, because MV3 stops the worker after
about thirty seconds and a variable would be gone by the second click, and a
`windows.onRemoved` listener forgets it once the person closes it.

When the sign in page hands the code over through `onMessageExternal`, the
worker closes that tab about a second later, after the page has shown its tick.
If the worker is stopped before that fires, the page still says what happened
and the tab can be closed by hand.

---

## Which server it talks to

Production is the default and the fallback: a packed extension that has never
been configured talks to `https://dai.dolluzcorp.com` and nowhere else. The
override lives in `chrome.storage.local`, not in a constant in the source, so a
shipped build cannot be pointed elsewhere by an edit someone forgets to undo.

An override may be https anywhere, or http only on this machine. Sending a
token over plain http to anything but localhost is how a session gets read off
a network, and convenience during development is not a reason to allow it.
`setEndpoints` takes both bases together, because a half-applied override, with
sign-in going to one place and the API to another, is a confusing way to spend
an afternoon.

To use a local server: open the popup, expand **Server**, enter
`http://localhost:4014` and `http://localhost:3000`, and click **Use this
server**. Chrome asks for the host permission at that click, since localhost is
optional and a packed build never holds it. Sign in again afterwards; the old
tokens belong to the old server.

---

## The sign in page

A Kody password is typed in exactly one place: `/extension/authorize` on the
dAI host, served as plain static files by the API server. The extension opens
it with a state value it generated and the callback it wants the code sent to,
and never sees the password at all.

The page checks the callback before it draws a password field. It uses the
same expression as `isAllowedRedirect` in `server/src/lib/tokens.js`, tested
against the raw string rather than the parsed host, because `new URL()`
lowercases a host and the server's allowlist does not: a page that is laxer
than the server it depends on is how an open redirect starts. The server
remains the authority and will refuse to mint a code for anything else, but a
password should not be typed into a page with nowhere legitimate to send the
result.

The code goes back one of two ways. Normally the page redirects to the
extension's callback, which Chrome's sign in window catches. Where the flow was
opened as an ordinary tab, that redirect would land nowhere, so the page posts
the code to the extension directly; that is why `externally_connectable` names
the site, and the worker checks the origin again before accepting.

The page is served with its own policy: `default-src 'none'` with script and
style from this origin only, `frame-ancestors 'none'` because it carries a
password field, and `Cache-Control: no-store`. It stores nothing, in any form.

Passwords belong to dAdmin (docs/PHASES.md 1.1), so Forgot password asks the
server, which answers the same way for every address and cannot be used to find
out who has an account.

---

## The SDK is vendored, not imported

Chrome only loads files that ship inside the extension, so `web/src/api` cannot
be imported across the repo. It is copied into `src/shared/sdk/` instead, and
`build.js` fails if the copy has drifted:

```
node extension/build.js --sync     re-copy after changing web/src/api
```

An extension test asserts the same thing, so a drifted copy fails the suite as
well as the build. That keeps one client contract rather than two that slowly
disagree.

---

## The id is pinned by a key

`manifest.json` carries a `key`: the public half of `.secrets/kody-extension.pem`.
Chrome
derives the extension id from it, so every machine that loads this unpacked
gets the same id and the server needs one `EXTENSION_IDS` entry rather than one
per tester. Without it Chrome derives the id from the folder path, which
differs on every machine.

The id is **`ikamkodfpkklimdldhfpnhmmlapdjpmn`**, and `node extension/build.js`
prints it so nobody has to open Chrome to find out.

The private half lives in `.secrets/` at the repository root, **outside the
extension folder**, and `node extension/build.js` refuses to build if any
`.pem`, `.key`, `.p12` or `.pfx` appears anywhere under `extension/`. It used to
sit in `extension/`, where Chrome warned "This extension includes the key file
... You probably don't want to do that" and a Web Store package would have
carried it. Whoever holds it can publish an update as us.

It is gitignored and must be kept: losing it means a new id for everyone, and
the Web Store listing in Phase 3 has to be created with this same key or the
published extension will have a different id again. Keep a copy somewhere that
is not this machine.

---

## Loading it

```
node extension/build.js            checks only
node extension/build.js --zip      writes dist/kody-extension-0.9.0.zip
```

Then in Chrome: Extensions, Developer mode, Load unpacked, choose
`extension/`. Copy the id Chrome assigns and put it in the server's
`EXTENSION_IDS`, or sign in will be refused, correctly.
