/**
 * Background service worker.
 *
 * Two things shape this file.
 *
 * First, a Manifest V3 service worker is ephemeral. Chrome stops it after
 * about thirty seconds of inactivity, so it CANNOT hold a socket open. The
 * realtime connection lives in the side panel, which stays alive while it is
 * visible. The worker does auth, routing and alarms, and keeps no state in
 * memory that it cannot rebuild from storage.
 *
 * Second, the worker is the only component that ever holds a token. The
 * content script runs in the page's world, where any script on the page could
 * read a variable, so it never receives one. It asks the worker instead.
 */
import {
  beginSignIn, completeSignIn, clearTokens, getTokens, isSignedIn, apiFetch, SITE_BASE,
} from "../shared/auth.js";

const SIDE_PANEL_PATH = "src/sidepanel/index.html";

/* ---------------- install ---------------- */

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (_) { /* older Chrome */ }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "kody-ask-selection",
      title: "Ask Kody about \"%s\"",
      contexts: ["selection"],
    });
  });

  // Refresh well before the access token expires, rather than after a failure.
  chrome.alarms.create("kody-refresh", { periodInMinutes: 10 });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);

/* ---------------- sign in ---------------- */

/**
 * Opens the Dolluz site to sign in. The redirect URI is the extension's own
 * https://<id>.chromiumapp.org/ address, which only this extension can receive.
 */
async function signIn() {
  const redirectUri = chrome.identity && chrome.identity.getRedirectURL
    ? chrome.identity.getRedirectURL("kody")
    : `https://${chrome.runtime.id}.chromiumapp.org/kody`;

  const { url } = await beginSignIn({ redirectUri });

  // launchWebAuthFlow gives us the redirect without leaving a tab behind.
  if (chrome.identity && chrome.identity.launchWebAuthFlow) {
    try {
      const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
      if (!redirect) return { ok: false, error: "cancelled", message: "Sign in was cancelled." };
      const out = await completeSignIn(redirect);
      await updateBadge();
      return out;
    } catch (err) {
      return { ok: false, error: "flow_failed", message: String(err.message || err) };
    }
  }

  // Fallback: open a tab and wait for the site to hand the code back.
  await chrome.tabs.create({ url });
  return { ok: false, error: "manual", message: "Finish signing in on the Dolluz tab." };
}

/**
 * The site can also hand the code back through the page, for browsers without
 * launchWebAuthFlow. Only our own site is trusted to do this.
 */
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : "");
  if (origin !== SITE_BASE) {
    sendResponse({ ok: false, error: "untrusted_origin" });
    return false;
  }
  if (!message || message.type !== "kody:auth-code") {
    sendResponse({ ok: false, error: "unknown_message" });
    return false;
  }
  const fake = `https://handoff/?code=${encodeURIComponent(message.code)}&state=${encodeURIComponent(message.state)}`;
  completeSignIn(fake).then(async (out) => {
    await updateBadge();
    sendResponse(out);
  });
  return true;   // async
});

async function signOut() {
  const { refreshToken } = await getTokens();
  if (refreshToken) {
    try {
      await apiFetch("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch (_) { /* sign out locally regardless */ }
  }
  await clearTokens();
  await updateBadge();
  broadcast({ type: "kody:signed-out" });
  return { ok: true };
}

/* ---------------- badge ---------------- */

async function updateBadge() {
  const signedIn = await isSignedIn();
  if (!signedIn) {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Kody - sign in" });
    return;
  }
  try {
    const res = await apiFetch("/api/notifications?unreadOnly=true&limit=1");
    if (!res.ok) throw new Error("unavailable");
    const body = await res.json();
    const n = Number(body.unread || 0);
    await chrome.action.setBadgeText({ text: n > 0 ? (n > 99 ? "99+" : String(n)) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#C79A18" });
    await chrome.action.setTitle({ title: n > 0 ? `Kody - ${n} unread` : "Kody" });
  } catch (_) {
    await chrome.action.setBadgeText({ text: "" });
  }
}

/* ---------------- panel ---------------- */

async function openPanel(tabId, payload) {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: SIDE_PANEL_PATH, enabled: true });
    await chrome.sidePanel.open({ tabId });
  } catch (err) {
    // sidePanel.open must be called from a user gesture; fall back to a window.
    await chrome.windows.create({
      url: chrome.runtime.getURL(SIDE_PANEL_PATH),
      type: "popup", width: 420, height: 720,
    });
  }
  if (payload) {
    // The panel may still be booting, so keep it until it asks.
    await chrome.storage.session.set({ kody_pending: payload });
  }
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => { /* nothing listening */ });
}

/* ---------------- routing ---------------- */

/**
 * Every message from a content script or the panel lands here.
 *
 * A content script is untrusted input: it runs alongside whatever the page is
 * doing. So the worker answers a fixed list of message types and never returns
 * a token to one.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fromContentScript = !!(sender && sender.tab);

  (async () => {
    switch (message && message.type) {
      case "kody:status": {
        const signedIn = await isSignedIn();
        const { user } = await getTokens();
        // Deliberately no token in this reply.
        sendResponse({ ok: true, signedIn, user: signedIn ? user : null });
        return;
      }

      case "kody:sign-in":
        sendResponse(await signIn());
        return;

      case "kody:sign-out":
        sendResponse(await signOut());
        return;

      case "kody:open-panel":
        await openPanel(sender.tab ? sender.tab.id : undefined, message.payload);
        sendResponse({ ok: true });
        return;

      case "kody:ask": {
        if (!(await isSignedIn())) { sendResponse({ ok: false, error: "not_signed_in" }); return; }
        const res = await apiFetch("/api/kody/ask", {
          method: "POST",
          body: JSON.stringify({ question: message.question, threadId: message.threadId }),
        });
        const body = await res.json().catch(() => null);
        sendResponse(res.ok ? { ok: true, ...body } : { ok: false, ...(body || { error: "ask_failed" }) });
        return;
      }

      case "kody:take-pending": {
        // Only the panel may collect a queued selection, never a page script.
        if (fromContentScript) { sendResponse({ ok: false, error: "not_allowed" }); return; }
        const stored = await chrome.storage.session.get("kody_pending");
        await chrome.storage.session.remove("kody_pending");
        sendResponse({ ok: true, pending: stored.kody_pending || null });
        return;
      }

      case "kody:token": {
        // The panel needs a token to open its socket. A content script never does.
        if (fromContentScript) { sendResponse({ ok: false, error: "not_allowed" }); return; }
        const { accessToken } = await getTokens();
        sendResponse({ ok: !!accessToken, accessToken: accessToken || null });
        return;
      }

      case "kody:badge":
        await updateBadge();
        sendResponse({ ok: true });
        return;

      default:
        sendResponse({ ok: false, error: "unknown_message" });
    }
  })().catch(err => {
    console.error("worker message failed:", err);
    sendResponse({ ok: false, error: "worker_error", message: String(err.message || err) });
  });

  return true;   // keep the channel open for the async reply
});

/* ---------------- commands and menus ---------------- */

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-kody") {
    await openPanel(tab && tab.id);
  }
  if (command === "ask-selection" && tab && tab.id) {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection() || "").slice(0, 2000),
    }).catch(() => [{}]);
    await openPanel(tab.id, result ? { kind: "selection", text: result } : null);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "kody-ask-selection") return;
  await openPanel(tab && tab.id, { kind: "selection", text: (info.selectionText || "").slice(0, 2000) });
});

chrome.action.onClicked.addListener(async (tab) => {
  await openPanel(tab && tab.id);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "kody-refresh") return;
  if (!(await isSignedIn())) return;
  await updateBadge();
});

export { signIn, signOut, updateBadge, openPanel };
