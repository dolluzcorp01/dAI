/**
 * Authentication for the extension.
 *
 * The password never reaches the extension. Sign in happens on the Dolluz
 * site, which mints a one-time code; the extension exchanges that code for
 * tokens. A code is useless without the state value the extension generated,
 * and it expires in sixty seconds.
 *
 * Tokens live in chrome.storage.local so the service worker, the side panel
 * and the popup share one session. They are NEVER sent to a content script:
 * that runs in the page's world, where any script on the page could read them.
 */

export const API_BASE = "https://dai.dolluzcorp.com";
export const SITE_BASE = "https://dai.dolluzcorp.com";

const KEY_ACCESS = "kody_access";
const KEY_REFRESH = "kody_refresh";
const KEY_USER = "kody_user";
const KEY_STATE = "kody_oauth_state";

/** Cryptographically random, not Math.random, because this is a CSRF guard. */
export function randomState(bytes = 24) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("");
}

export async function getTokens(storage = chrome.storage.local) {
  const out = await storage.get([KEY_ACCESS, KEY_REFRESH, KEY_USER]);
  return {
    accessToken: out[KEY_ACCESS] || null,
    refreshToken: out[KEY_REFRESH] || null,
    user: out[KEY_USER] || null,
  };
}

export async function setTokens({ accessToken, refreshToken, user }, storage = chrome.storage.local) {
  const patch = {};
  if (accessToken !== undefined) patch[KEY_ACCESS] = accessToken;
  if (refreshToken !== undefined) patch[KEY_REFRESH] = refreshToken;
  if (user !== undefined) patch[KEY_USER] = user;
  await storage.set(patch);
}

export async function clearTokens(storage = chrome.storage.local) {
  await storage.remove([KEY_ACCESS, KEY_REFRESH, KEY_USER, KEY_STATE]);
}

export async function isSignedIn(storage = chrome.storage.local) {
  const { refreshToken } = await getTokens(storage);
  return !!refreshToken;
}

/**
 * Step one. Generate a state value, remember it, and return the URL to open.
 * The site signs the person in and redirects back with a code.
 */
export async function beginSignIn({ storage = chrome.storage.local, redirectUri } = {}) {
  const state = randomState();
  await storage.set({ [KEY_STATE]: { state, createdAt: Date.now() } });

  const url = new URL(`${SITE_BASE}/extension/authorize`);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("surface", "extension");
  return { url: url.toString(), state };
}

/**
 * Step two. Swap the code for tokens.
 *
 * The state returned must match the one we stored. Without that check, any
 * page could send us a code minted for a different extension, or replay one.
 */
export async function completeSignIn(redirectUrl, {
  storage = chrome.storage.local, fetchImpl = fetch, apiBase = API_BASE,
} = {}) {
  const parsed = new URL(redirectUrl);
  const code = parsed.searchParams.get("code");
  const returnedState = parsed.searchParams.get("state");
  const error = parsed.searchParams.get("error");

  if (error) return { ok: false, error, message: "Sign in was refused." };
  if (!code || !returnedState) {
    return { ok: false, error: "missing_code", message: "The sign in did not complete." };
  }

  const stored = (await storage.get(KEY_STATE))[KEY_STATE];
  if (!stored || stored.state !== returnedState) {
    return { ok: false, error: "state_mismatch", message: "That sign in did not start here." };
  }
  // The server expires the code in sixty seconds; expire our half too.
  if (Date.now() - stored.createdAt > 5 * 60 * 1000) {
    await storage.remove(KEY_STATE);
    return { ok: false, error: "state_expired", message: "That sign in took too long. Try again." };
  }

  let res;
  try {
    res = await fetchImpl(`${apiBase}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state: returnedState }),
    });
  } catch (err) {
    return { ok: false, error: "network", message: "Could not reach Dolluz." };
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !body.accessToken) {
    return {
      ok: false,
      error: (body && body.error) || "exchange_failed",
      message: (body && body.message) || "Could not complete sign in.",
    };
  }

  await setTokens({
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    user: body.user,
  }, storage);
  await storage.remove(KEY_STATE);

  return { ok: true, user: body.user, roles: body.roles };
}

/**
 * Refresh, with one in flight at a time.
 *
 * The API rotates refresh tokens and treats reuse as theft, revoking every
 * session. Two simultaneous refreshes would therefore sign the person out of
 * everything. The service worker is the only place this runs.
 */
let refreshing = null;

export function refreshAccessToken({
  storage = chrome.storage.local, fetchImpl = fetch, apiBase = API_BASE,
} = {}) {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const { refreshToken } = await getTokens(storage);
    if (!refreshToken) return { ok: false, error: "not_signed_in" };

    let res;
    try {
      res = await fetchImpl(`${apiBase}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch (err) {
      return { ok: false, error: "network" };
    }

    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.accessToken) {
      // A revoked or reused token is terminal. Clear, do not retry.
      await clearTokens(storage);
      return { ok: false, error: (body && body.error) || "refresh_failed", signedOut: true };
    }

    await setTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken }, storage);
    return { ok: true, accessToken: body.accessToken };
  })().finally(() => { refreshing = null; });

  return refreshing;
}

/** For tests, so a previous run cannot leak an in-flight promise. */
export function _resetRefresh() { refreshing = null; }

/**
 * An authenticated call, refreshing once on an expired or corrupt token.
 * Everything in the extension that talks to the API goes through this.
 */
export async function apiFetch(path, options = {}, {
  storage = chrome.storage.local, fetchImpl = fetch, apiBase = API_BASE, retry = true,
} = {}) {
  const { accessToken } = await getTokens(storage);
  const headers = { ...(options.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const res = await fetchImpl(`${apiBase}${path}`, { ...options, headers });

  if (res.status === 401 && retry) {
    const body = await res.clone().json().catch(() => null);
    const code = body && body.error;
    if (code === "token_expired" || code === "invalid_token" || code === "missing_token") {
      const refreshed = await refreshAccessToken({ storage, fetchImpl, apiBase });
      if (refreshed.ok) {
        return apiFetch(path, options, { storage, fetchImpl, apiBase, retry: false });
      }
    }
    return res;
  }
  return res;
}
