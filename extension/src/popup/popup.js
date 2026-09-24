/**
 * The popup.
 *
 * It holds no login form and it never sees a password. Its only job is to start
 * the handoff: the service worker opens the Dolluz site, the person signs in
 * there, and the site hands back a one time code (docs/14-extension.md).
 *
 * It also never holds a token. It asks the worker what the state is, and the
 * worker's reply deliberately carries no token.
 *
 * Everything is built with textContent, so nothing here can render markup that
 * came back from the network.
 */
const $ = (id) => document.getElementById(id);

const send = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: "disconnected" });
      resolve(reply || { ok: false, error: "no_reply" });
    });
  });

function show(section) {
  for (const id of ["loading", "signed-in", "signed-out"]) {
    $(id).hidden = id !== section;
  }
}

function fail(message) {
  const box = $("error");
  box.textContent = message;
  box.hidden = !message;
}

function initialsFor(user) {
  if (user && user.initials) return String(user.initials).slice(0, 3).toUpperCase();
  const name = (user && (user.fullName || user.email)) || "";
  const letters = String(name).split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map(part => part[0].toUpperCase()).join("");
  return letters || "K";
}

async function paint() {
  fail("");
  const status = await send({ type: "kody:status" });
  if (!status.ok) {
    show("signed-out");
    fail("Kody could not reach its background service. Reload the extension.");
    return;
  }
  if (!status.signedIn) {
    show("signed-out");
    return;
  }
  const user = status.user || {};
  $("initials").textContent = initialsFor(user);
  $("full-name").textContent = user.fullName || "Signed in";
  $("email").textContent = user.email || "";
  show("signed-in");
}

/* ---------------- actions ---------------- */

$("sign-in").addEventListener("click", async () => {
  const button = $("sign-in");
  button.disabled = true;
  button.textContent = "Opening Dolluz...";
  const out = await send({ type: "kody:sign-in" });
  button.disabled = false;
  button.textContent = "Continue to Dolluz";

  if (out.ok) {
    await paint();
    return;
  }
  if (out.error === "manual") {
    // The fallback path opened a tab. The popup closes as soon as focus moves,
    // so say what happens next rather than leaving it looking broken.
    fail(out.message || "Finish signing in on the Dolluz tab, then open this again.");
    return;
  }
  if (out.error === "cancelled") {
    fail("Sign in was cancelled.");
    return;
  }
  fail(out.message || "Could not sign in. Try again.");
});

$("sign-out").addEventListener("click", async () => {
  $("sign-out").disabled = true;
  await send({ type: "kody:sign-out" });
  $("sign-out").disabled = false;
  await paint();
});

$("open-panel").addEventListener("click", async () => {
  // sidePanel.open needs a user gesture, and this click is one. Ask the worker
  // first, since it owns the panel path, and fall back to opening it here.
  const out = await send({ type: "kody:open-panel" });
  if (out.ok) {
    window.close();
    return;
  }
  try {
    const current = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: current.id });
    window.close();
  } catch (err) {
    fail("Could not open the side panel. Click the Kody bubble on the page instead.");
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && (message.type === "kody:signed-out" || message.type === "kody:signed-in")) paint();
});

paint();
