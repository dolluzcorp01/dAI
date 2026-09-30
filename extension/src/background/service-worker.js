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
  beginSignIn, completeSignIn, clearTokens, getTokens, isSignedIn,
} from "../shared/auth.js";
// dAI: every API call goes through the SDK (docs/PHASES.md 1.4c), and every one
// of them happens here, so token refresh has exactly one home.
import { kodyApi, resetApi } from "../shared/api.js";
import { endpoints, setEndpoints, clearEndpoints, matchPattern } from "../shared/config.js";

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

  resetApi();                      // dAI: endpoints may have changed since the last call
  const { siteBase, apiBase, isProduction } = await endpoints();

  // dAI: Chrome will not let the worker fetch a host the extension has not been
  // granted, and localhost is optional so a packed build never holds it. Check
  // before starting: otherwise the person signs in, a code is minted, and the
  // exchange fails with a bare network error that explains nothing.
  if (!isProduction && !(await hasHostAccess(apiBase, siteBase))) {
    return {
      ok: false,
      error: "host_permission",
      message: `Chrome has not granted Kody access to ${apiBase}. `
        + "Open Server in the popup and click Use this server.",
    };
  }

  const { url } = await beginSignIn({ redirectUri, siteBase });

  // launchWebAuthFlow gives us the redirect without leaving a tab behind.
  if (chrome.identity && chrome.identity.launchWebAuthFlow) {
    try {
      const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
      if (!redirect) return { ok: false, error: "cancelled", message: "Sign in was cancelled." };
      const out = await completeSignIn(redirect, { apiBase });
      await updateBadge();
      return out;
    } catch (err) {
      return { ok: false, error: "flow_failed", message: String(err.message || err) };
    }
  }

  // Fallback: open a tab and wait for the site to hand the code back. This only
  // completes on the production site, which is the one externally_connectable
  // names; against a local server there is nothing to receive the code, so say
  // so rather than leave a tab sitting there.
  const { isProduction } = await endpoints();
  if (!isProduction) {
    return {
      ok: false,
      error: "identity_required",
      message: "Allow Kody the identity permission to sign in against a local server.",
    };
  }
  await chrome.tabs.create({ url });
  return { ok: false, error: "manual", message: "Finish signing in on the Dolluz tab." };
}

/** Does Chrome let us talk to these bases at all? */
async function hasHostAccess(...bases) {
  const origins = [...new Set(bases.map(matchPattern).filter(Boolean))];
  if (origins.length === 0) return false;
  try {
    return await chrome.permissions.contains({ origins });
  } catch (_) {
    return false;                  // cannot ask: treat as not granted
  }
}

/**
 * The site can also hand the code back through the page, for browsers without
 * launchWebAuthFlow. Only our own site is trusted to do this.
 */
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : "");
  // dAI: the trusted origin is the configured site, which is production unless
  // a developer pointed it at their own machine. Still exactly one origin.
  (async () => {
    const { siteBase: SITE_BASE } = await endpoints();
    if (origin !== SITE_BASE) {
      sendResponse({ ok: false, error: "untrusted_origin" });
      return;
    }
    if (!message || message.type !== "kody:auth-code") {
      sendResponse({ ok: false, error: "unknown_message" });
      return;
    }
    const { apiBase } = await endpoints();
    const fake = `https://handoff/?code=${encodeURIComponent(message.code)}&state=${encodeURIComponent(message.state)}`;
    const out = await completeSignIn(fake, { apiBase });
    await updateBadge();
    sendResponse(out);
  })();
  return true;   // async
});

async function signOut() {
  try {
    const api = await kodyApi();
    await api.auth.logout();      // dAI: revokes the session server side, then clears storage
  } catch (_) { /* sign out locally regardless */ }
  await clearTokens();
  resetApi();
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
    const api = await kodyApi();
    const n = await api.notifications.unreadCount();
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

      /* dAI: everything the side panel needs. The panel renders; it never holds
         a token and never calls the API itself (docs/PHASES.md 1.4c). */
      case "kody:ask": {
        if (!(await isSignedIn())) { sendResponse({ ok: false, error: "not_signed_in" }); return; }
        const api = await kodyApi();
        const out = await api.kody.ask(message.question, message.threadId || null);
        sendResponse({ ok: true, ...out });
        return;
      }

      case "kody:threads": {
        if (!(await isSignedIn())) { sendResponse({ ok: false, error: "not_signed_in" }); return; }
        const api = await kodyApi();
        sendResponse({ ok: true, threads: await api.kody.threads() });
        return;
      }

      case "kody:thread": {
        if (!(await isSignedIn())) { sendResponse({ ok: false, error: "not_signed_in" }); return; }
        const api = await kodyApi();
        sendResponse({ ok: true, ...(await api.kody.thread(message.threadId)) });
        return;
      }

      case "kody:feedback": {
        if (!(await isSignedIn())) { sendResponse({ ok: false, error: "not_signed_in" }); return; }
        const api = await kodyApi();
        const out = await api.kody.feedback(message.messageId, message.vote, message.comment);
        await updateBadge();
        sendResponse({ ok: true, ...out });
        return;
      }

      case "kody:points": {
        if (!(await isSignedIn())) { sendResponse({ ok: false, error: "not_signed_in" }); return; }
        const api = await kodyApi();
        sendResponse({ ok: true, points: await api.kody.points() });
        return;
      }

      case "kody:endpoints": {
        const where = await endpoints();
        sendResponse({
          ok: true, ...where,
          hostAccess: where.isProduction || await hasHostAccess(where.apiBase, where.siteBase),
        });
        return;
      }

      case "kody:set-endpoints": {
        // Development convenience. Production is the default and the fallback,
        // and config.js refuses anything but https or http on this machine.
        const out = message.reset
          ? await clearEndpoints()
          : await setEndpoints({ apiBase: message.apiBase, siteBase: message.siteBase });
        if (out.ok !== false) {
          // dAI: a token belongs to the server that issued it. Keeping one
          // across a change looks signed in and fails on the first call.
          await clearTokens();
          broadcast({ type: "kody:signed-out" });
          await updateBadge();
        }
        resetApi();
        sendResponse(out.ok === false ? out : { ok: true, ...(await endpoints()) });
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
