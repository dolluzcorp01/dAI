/**
 * The sign in page that authorises the Kody extension.
 *
 * What happens here:
 *
 *   1. The extension opens this page with a state value it generated and the
 *      callback it wants the code sent to.
 *   2. If single sign-on from Inside D is configured, the page asks the Dolluz
 *      portal first, in one hop, and only shows a password field when the
 *      portal says there is nobody signed in (docs/17-portal-sso.md).
 *   3. Otherwise the person types their Dolluz password, which is the dAdmin
 *      password (docs/PHASES.md 1.1). It is posted to /api/auth/authorize and
 *      is never stored, never logged, and never reaches the extension.
 *   4. The server returns a one-time code, good for sixty seconds and useless
 *      without the matching state.
 *   5. The code goes back to the extension's own callback.
 *
 * The password form is not a fallback that has been left to rot. It is the way
 * in when the portal is not configured, when nobody is signed in to it, when it
 * is down, and in a private window where this page has nowhere to keep its own
 * state. Every one of those paths lands on the form and says, in a line above
 * it, why it is being asked for.
 *
 * The page refuses to show the form at all unless the callback looks like an
 * extension callback. The server is the real authority and will refuse to mint
 * a code for anything else, but a password should not be typed into a page
 * that has nowhere legitimate to send the result.
 *
 * What never touches this page: dolluzcorp_token. The portal cookie is read by
 * Inside D, on Inside D's own origin. What comes back here is a one-time code
 * worth nothing anywhere but dAI's own token endpoint.
 */
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const surface = params.get("surface") || "extension";

/**
 * Which leg are we on?
 *
 * Outbound, the extension put state and redirect_uri in the URL. Coming back
 * from Inside D there is a code or an error instead, and the state in the URL
 * is the PORTAL state, not the extension's: Inside D is given one fixed
 * redirect_uri with no query of its own, because an allowlist that has to
 * tolerate varying query strings is not much of an allowlist. So what the
 * extension asked for is recovered from this tab's sessionStorage.
 */
const portalCode = params.get("code") || "";
const portalError = params.get("error") || "";
const isPortalReturn = !!(portalCode || portalError);

let state = params.get("state") || "";
let redirectUri = params.get("redirect_uri") || "";

/**
 * Which way the extension wants the code back.
 *
 *   webauth  Chrome's own sign in window. It resolves when the page navigates
 *            to the extension callback, so the page MUST redirect. Posting the
 *            code to the extension instead leaves Chrome waiting, and the
 *            extension closing this window to tidy up is indistinguishable
 *            from the person dismissing it: the sign in works and reports
 *            "The user did not approve access" in the same second.
 *   tab      An ordinary tab, where that redirect would land on a page that
 *            does not exist. Post the code to the extension instead.
 *
 * Absent means an older extension. Redirect, which is the path Chrome drives.
 */
let flow = params.get("flow") === "tab" ? "tab" : "webauth";

/* ---------------- this tab's own memory ---------------- */

/**
 * sessionStorage, which can throw rather than return null: a private window or
 * blocked site data makes every one of these calls an exception. Nothing here
 * is allowed to be fatal, because the password form works without any of it.
 */
const STORE_KEY = "kody.portal.request";
const TRIED_KEY = "kody.portal.tried";

function keep(key, value) {
  try { sessionStorage.setItem(key, value); return true; } catch (_) { return false; }
}
function recall(key) {
  try { return sessionStorage.getItem(key); } catch (_) { return null; }
}
function forget(key) {
  try { sessionStorage.removeItem(key); } catch (_) { /* nothing to do */ }
}

/**
 * Coming back from Inside D: pick up what the extension asked for, and check
 * that this really is the round trip this tab started.
 *
 * The stored request is read once and dropped, whatever happens next, so a code
 * cannot be replayed by going back in history.
 */
let resumed = null;
if (isPortalReturn) {
  const raw = recall(STORE_KEY);
  forget(STORE_KEY);
  let saved = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch (_) { saved = null; }

  // The portal state. This is the check that stops somebody else's handoff code
  // being pushed through this page: it was generated here, kept here, and never
  // left this origin except as an opaque value Inside D echoes back.
  if (saved && saved.portalState && saved.portalState === params.get("state")) {
    resumed = saved;
    state = saved.state || "";
    redirectUri = saved.redirectUri || "";
    flow = saved.flow === "tab" ? "tab" : "webauth";
  }
}

/**
 * https://<32 letters a to p>.chromiumapp.org/... is the extension's own
 * callback: Chrome mints that host from the extension id, and only that
 * extension can receive it. http is allowed on this machine so a developer can
 * run the flow against a local server.
 */
function extensionCallback(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch (_) { return null; }

  // Tested against the raw string, not the parsed host, because new URL()
  // lowercases a host and the server's allowlist does not. Same expression as
  // isAllowedRedirect in server/src/lib/tokens.js, so the page is never laxer
  // than the server that has to honour it.
  const extension = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/[A-Za-z0-9_\-/]*$/.exec(value);
  if (extension) return { url, extensionId: extension[1] };

  const local = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  return local ? { url, extensionId: null } : null;
}

const callback = extensionCallback(redirectUri);

$("host").textContent = location.host;

if (!callback || state.length < 8) {
  $("card").hidden = true;
  $("refused").hidden = false;
  if (isPortalReturn && !resumed) {
    // Came back from the portal with nothing to come back to. Either this tab
    // never started the trip, or sessionStorage was cleared under it.
    $("refused-body").textContent =
      "This sign in did not start in this tab, so Kody has nothing to finish. "
      + "Open the Kody extension and choose Sign in.";
  } else if (!callback && redirectUri) {
    $("refused-body").textContent =
      "The address this page was asked to return to is not a Kody extension. "
      + "Nothing has been sent. Open the Kody extension and choose Sign in.";
  }
} else {
  $("email").focus();
}

/* ---------------- show, hide, and Caps Lock ---------------- */

/**
 * The same behaviour as dAdmin's sign in page: the eye swaps the field between
 * password and text, it is out of the tab order, and it says which it will do
 * rather than what it is. Caps Lock is the reason a correct password gets typed
 * wrong, so the page says so instead of letting the server refuse it.
 */
const toggle = $("toggle-password");

toggle.addEventListener("click", () => {
  const showing = toggle.getAttribute("aria-pressed") === "true";
  toggle.setAttribute("aria-pressed", showing ? "false" : "true");
  toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  $("password").type = showing ? "password" : "text";
  $("password").focus();
});

function capsCheck(event) {
  let on = false;
  try { on = !!(event.getModifierState && event.getModifierState("CapsLock")); } catch (_) { on = false; }
  $("caps").hidden = !on;
}

$("password").addEventListener("keyup", capsCheck);
$("password").addEventListener("keydown", capsCheck);
$("password").addEventListener("blur", () => { $("caps").hidden = true; });

/* ---------------- saying things ---------------- */

function fail(message) {
  const box = $("error");
  box.textContent = message;
  box.hidden = !message;
}

/**
 * The quiet line above the form that says why a password is being asked for.
 *
 * Deliberately not the error box. "You are not signed in to the portal" is the
 * ordinary state of affairs for anyone who opened Chrome and went straight to
 * Kody, and painting it red teaches people to ignore red.
 */
function note(message) {
  const box = $("portal-note");
  box.textContent = message || "";
  box.hidden = !message;
}

const MESSAGES = {
  invalid_credentials: "That email or password is not right.",
  account_locked: "Too many attempts. Wait a few minutes and try again.",
  account_inactive: "This account is not active. Ask your administrator.",
  no_app_access: "Your Dolluz account does not have Kody access yet. Ask your administrator.",
  dai_not_enabled: "Your Dolluz account does not have Kody access yet. Ask your administrator.",
  bad_redirect_uri: "This extension is not registered with Kody. Ask your administrator.",
  bad_state: "This sign in did not start properly. Open Kody and try again.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
};

/**
 * Why the portal did not sign this person in.
 *
 * login_required is not a fault: it is what Inside D says when nobody is signed
 * in to it, which is most of the time. The rest are, and they get wording that
 * says the portal is the thing that went wrong, so nobody spends five minutes
 * doubting a password that was fine.
 */
function reasonForPortalError(code) {
  if (code === "login_required" || code === "interaction_required" || code === "consent_required") {
    return "You are not signed in to the Dolluz portal, so Kody needs your password.";
  }
  if (code === "access_denied") {
    return "The Dolluz portal did not allow this sign in, so Kody needs your password.";
  }
  return "The Dolluz portal could not confirm who you are, so Kody needs your password.";
}

/* ---------------- single sign-on from Inside D ---------------- */

/** 32 hex characters from the browser's own generator, never Math.random. */
function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** The card goes away while the page is in the middle of something. */
function checking(message) {
  $("card").hidden = true;
  $("checking").hidden = false;
  if (message) $("checking-note").textContent = message;
}

/** And comes back when the answer is: ask for the password after all. */
function backToForm(reason, error) {
  $("checking").hidden = true;
  $("card").hidden = false;
  note(reason);
  fail(error || "");
  $("email").focus();
}

/**
 * Ask the Dolluz portal, once, before showing a password field.
 *
 * prompt=none is the whole trick. Inside D answers immediately either way and
 * never shows its own sign in page, so somebody who has no portal session is
 * not bounced to an unfamiliar login and there is no loop to get stuck in.
 *
 * It is a navigation and not a fetch on purpose. Reading the portal session
 * from here would mean a cross-origin request with credentials, which needs the
 * portal cookie to be SameSite=None: a weaker cookie for every dApp, so that
 * Kody could save one hop. A top-level GET carries a SameSite=Lax cookie as it
 * is, and changes nothing on the portal's side.
 */
async function tryPortal() {
  // Been round once already in this tab. Going again would be a loop.
  if (recall(TRIED_KEY)) return;
  if (typeof crypto === "undefined" || !crypto || !crypto.getRandomValues) return;

  let cfg = null;
  try {
    const res = await fetch("/api/auth/portal/config");
    cfg = await res.json();
  } catch (_) {
    return;   // the form is already on screen, which is the right answer
  }
  if (!cfg || !cfg.enabled || !cfg.authorizeUrl) return;

  const portalState = randomState();
  const stored = keep(STORE_KEY, JSON.stringify({ portalState, state, redirectUri, flow, surface }))
    && keep(TRIED_KEY, "1");
  if (!stored) {
    // A private window, or site data blocked. With nowhere to keep the state
    // there would be nothing to compare on the way back, and a round trip whose
    // reply cannot be checked is worse than typing a password.
    note("Kody cannot check the Dolluz portal in this window, so it needs your password.");
    return;
  }

  let url;
  try { url = new URL(cfg.authorizeUrl); } catch (_) { return; }
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", portalState);
  url.searchParams.set("prompt", "none");

  checking("Checking whether you are signed in to the Dolluz portal.");
  location.assign(url.toString());
}

/**
 * The return leg: swap Inside D's one-time code for a Kody code.
 *
 * The exchange happens on dAI's server, not here, because it needs the client
 * secret and this page is not allowed to hold one.
 */
async function finishPortalSignIn(code) {
  checking("Finishing your sign in.");

  let res;
  try {
    res = await fetch("/api/auth/portal/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portal_code: code, state, redirect_uri: redirectUri, surface,
      }),
    });
  } catch (_) {
    backToForm("Kody did not answer, so it needs your password. Nothing was signed in.");
    return;
  }

  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }

  if (res.ok && body && body.code) {
    handOff(body.code, "portal", body.sessionHours);
    return;
  }

  // An account that may not use Kody is NOT a reason to offer the password
  // form as the way forward: the password will be refused for the same reason.
  // So that one goes in the error box and the quiet note stays empty.
  const error = body && body.error;
  if (error === "dai_not_enabled" || error === "no_app_access" || error === "account_inactive") {
    backToForm("", MESSAGES[error]);
    return;
  }
  if (error === "portal_unreachable") {
    backToForm("The Dolluz portal did not answer, so Kody needs your password.");
    return;
  }
  if (error === "portal_refused" || error === "portal_bad_response" || error === "portal_disabled") {
    backToForm("The Dolluz portal could not confirm this sign in, so Kody needs your password.");
    return;
  }
  backToForm("Kody could not finish signing you in through the portal, so it needs your password.",
    (body && MESSAGES[error]) || (body && body.message) || "");
}

/* ---------------- signing in with a password ---------------- */

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  fail("");

  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) { fail("Email and password are required."); return; }

  $("submit").disabled = true;
  $("submit").textContent = "Signing in...";
  const ready = () => { $("submit").disabled = false; $("submit").textContent = "Sign in"; };

  // No answer at all is a different thing from an answer that says no, and
  // saying the wrong one sends people hunting for a password that was fine.
  // So the request and the reading of the reply are separate steps.
  let res;
  try {
    res = await fetch("/api/auth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, state, redirect_uri: redirectUri, surface }),
    });
  } catch (_) {
    ready();
    fail("Kody did not answer. The server may be down, or the connection dropped. "
      + "Your password was not checked.");
    return;
  }

  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }

  // Whatever happens next, the password does not stay in the page.
  $("password").value = "";
  $("caps").hidden = true;

  if (res.ok && body && body.code) {
    handOff(body.code, "password");
    return;
  }

  ready();
  if (body && body.error && MESSAGES[body.error]) { fail(MESSAGES[body.error]); return; }
  if (body && body.message) { fail(body.message); return; }
  if (res.status >= 500) {
    fail(`Kody answered with an error (${res.status}). Nothing was signed in. Try again shortly.`);
    return;
  }
  fail(`Could not sign in (${res.status}).`);
});

/**
 * Give the code to the extension.
 *
 * The normal path is a redirect to the extension's callback: Chrome's sign in
 * window catches it and the tab never really goes anywhere. Where the flow was
 * opened as an ordinary tab instead, that redirect would land on a page that
 * does not exist, so the code is posted to the extension directly. The
 * extension checks that the message came from this origin before it accepts.
 */
function handOff(code, origin, sessionHours) {
  $("card").hidden = true;
  $("checking").hidden = true;
  $("handoff").hidden = false;

  if (origin === "portal") {
    $("step-1").textContent = "Signed in through the Dolluz portal";
  }

  const target = new URL(callback.url.toString());
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);

  const canMessage = flow === "tab"
    && callback.extensionId
    && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;

  if (canMessage) {
    try {
      chrome.runtime.sendMessage(callback.extensionId, { type: "kody:auth-code", code, state },
        (reply) => {
          if (reply && reply.ok) {
            signedIn(origin, sessionHours);
            return;
          }
          location.assign(target.toString());
        });
      return;
    } catch (_) { /* fall through to the redirect */ }
  }

  location.assign(target.toString());
}

/**
 * Finished. The spinner becomes a tick and the words change with it.
 *
 * It used to say "Kody is signed in, you can close this tab" underneath a
 * spinner that was still turning, which reads as still working: the one thing
 * on the page that moves says "wait" while the text says "done".
 *
 * A portal sign-in also says how long it lasts. It is shorter than a password
 * sign-in, deliberately, and somebody who is not told that just finds Kody
 * signed out in the evening and assumes it is broken.
 */
function signedIn(origin, sessionHours) {
  $("spinner").classList.add("done");
  $("handoff-title").textContent = "Signed in";
  $("handoff-note").textContent = origin === "portal"
    ? `Kody is signed in. This came from your Dolluz portal sign in, so it lasts `
      + `${sessionHours || 8} hours rather than 30 days. You can close this tab.`
    : "Kody is signed in. You can close this tab.";
  for (const id of ["step-1", "step-2", "step-3"]) {
    $(id).classList.add("done");
  }
}

/* ---------------- forgot password ---------------- */

/**
 * The password belongs to dAdmin, so Kody never resets one. The server holds
 * the answer, and it gives the same answer for every email so this cannot be
 * used to find out who has an account.
 */
$("forgot").addEventListener("click", async (event) => {
  event.preventDefault();
  fail("");
  try {
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("email").value.trim() }),
    });
    const body = await res.json();
    fail(body.message || "Your Kody password is your Dolluz sign-in password.");
    if (body.resetUrl) {
      const box = $("error");
      box.appendChild(document.createTextNode(" "));
      const link = document.createElement("a");
      link.href = body.resetUrl;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = "Open the Dolluz portal";
      box.appendChild(link);
    }
  } catch (_) {
    fail("Your Kody password is your Dolluz sign-in password. Reset it on the Dolluz portal.");
  }
});

/* ---------------- which leg, decided last ---------------- */

/**
 * Last, so that everything above is wired up before any of it can be called,
 * and so the synchronous decision the page has already made (form, or refused)
 * is what somebody sees while this is in flight.
 */
if (callback && state.length >= 8) {
  if (isPortalReturn && resumed) {
    if (portalError) {
      note(reasonForPortalError(portalError));
    } else {
      finishPortalSignIn(portalCode);
    }
  } else if (!isPortalReturn) {
    tryPortal();
  }
}
