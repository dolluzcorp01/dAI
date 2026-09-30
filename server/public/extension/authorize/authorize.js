/**
 * The sign in page that authorises the Kody extension.
 *
 * What happens here:
 *
 *   1. The extension opens this page with a state value it generated and the
 *      callback it wants the code sent to.
 *   2. The person types their Dolluz password, which is the dAdmin password
 *      (docs/PHASES.md 1.1). It is posted to /api/auth/authorize and is never
 *      stored, never logged, and never reaches the extension.
 *   3. The server returns a one-time code, good for sixty seconds and useless
 *      without the matching state.
 *   4. The code goes back to the extension's own callback.
 *
 * The page refuses to show the form at all unless the callback looks like an
 * extension callback. The server is the real authority and will refuse to mint
 * a code for anything else, but a password should not be typed into a page
 * that has nowhere legitimate to send the result.
 */
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const state = params.get("state") || "";
const redirectUri = params.get("redirect_uri") || "";
const surface = params.get("surface") || "extension";

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
  if (!callback && redirectUri) {
    $("refused-body").textContent =
      "The address this page was asked to return to is not a Kody extension. "
      + "Nothing has been sent. Open the Kody extension and choose Sign in.";
  }
} else {
  $("email").focus();
}

/* ---------------- signing in ---------------- */

function fail(message) {
  const box = $("error");
  box.textContent = message;
  box.hidden = !message;
}

const MESSAGES = {
  invalid_credentials: "That email or password is not right.",
  account_locked: "Too many attempts. Wait a few minutes and try again.",
  account_inactive: "This account is not active. Ask your administrator.",
  no_app_access: "Your Dolluz account does not have Kody access yet. Ask your administrator.",
  bad_redirect_uri: "This extension is not registered with Kody. Ask your administrator.",
  bad_state: "This sign in did not start properly. Open Kody and try again.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
};

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  fail("");

  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) { fail("Email and password are required."); return; }

  $("submit").disabled = true;
  $("submit").textContent = "Signing in...";

  let res, body;
  try {
    res = await fetch("/api/auth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, state, redirect_uri: redirectUri, surface }),
    });
    body = await res.json();
  } catch (_) {
    $("submit").disabled = false;
    $("submit").textContent = "Sign in";
    fail("Could not reach Kody. Check your connection and try again.");
    return;
  }

  // Whatever happens next, the password does not stay in the page.
  $("password").value = "";

  if (!res.ok || !body || !body.code) {
    $("submit").disabled = false;
    $("submit").textContent = "Sign in";
    fail(MESSAGES[body && body.error] || (body && body.message) || "Could not sign in.");
    return;
  }

  handOff(body.code);
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
function handOff(code) {
  $("card").hidden = true;
  $("handoff").hidden = false;

  const target = new URL(callback.url.toString());
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);

  const canMessage = callback.extensionId
    && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;

  if (canMessage) {
    try {
      chrome.runtime.sendMessage(callback.extensionId, { type: "kody:auth-code", code, state },
        (reply) => {
          if (reply && reply.ok) {
            $("handoff-note").textContent = "Kody is signed in. You can close this tab.";
            return;
          }
          location.assign(target.toString());
        });
      return;
    } catch (_) { /* fall through to the redirect */ }
  }

  location.assign(target.toString());
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
      link.textContent = "Open dAdmin";
      box.appendChild(link);
    }
  } catch (_) {
    fail("Your Kody password is your Dolluz sign-in password. Reset it in dAdmin.");
  }
});
