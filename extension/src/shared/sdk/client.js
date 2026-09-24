/**
 * Kody HTTP client.
 *
 * One place that knows about tokens. Everything else calls `api.get` and
 * friends and never thinks about authentication.
 *
 * The important behaviour is refresh: when an access token expires mid-use,
 * the request is retried once after refreshing, and only ONE refresh is ever
 * in flight. Without that, ten parallel requests hitting a stale token each
 * trigger their own refresh, and because refresh rotates the token, nine of
 * them present an already-rotated token. The server treats that as a stolen
 * token and revokes every session. The user is silently logged out.
 */

const DEFAULT_BASE = (typeof window !== "undefined" && window.KODY_API_URL) || "http://localhost:4000";

export class ApiError extends Error {
  constructor(status, code, message, field) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function createClient({ baseUrl = DEFAULT_BASE, tokens, onAuthLost } = {}) {
  let refreshing = null;   // the single in-flight refresh

  const store = tokens || createMemoryTokenStore();

  async function refresh() {
    if (refreshing) return refreshing;          // everyone waits on the same one
    refreshing = (async () => {
      const refreshToken = await store.getRefresh();
      if (!refreshToken) throw new ApiError(401, "no_refresh", "Not signed in.");
      const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const body = await safeJson(res);
      if (!res.ok) {
        await store.clear();
        if (onAuthLost) onAuthLost(body && body.error);
        throw new ApiError(res.status, body && body.error, body && body.message);
      }
      await store.set({ accessToken: body.accessToken, refreshToken: body.refreshToken });
      return body.accessToken;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function request(method, path, { body, query, retry = true, raw = false } = {}) {
    const url = new URL(baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }

    const accessToken = await store.getAccess();
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)),
    });

    if (res.status === 401 && retry) {
      const payload = await safeJson(res);
      const code = payload && payload.error;
      // Recoverable by refreshing: the access token expired, was never sent,
      // or the stored copy is corrupt. NOT recoverable: the session was
      // revoked, the refresh token was reused, or the account was disabled.
      // Those mean sign in again, and retrying would just loop.
      if (code === "token_expired" || code === "missing_token" || code === "invalid_token") {
        try {
          await refresh();
          return request(method, path, { body, query, retry: false, raw });
        } catch (_) {
          throw new ApiError(401, code, "Your session ended. Sign in again.");
        }
      }
      if (onAuthLost) onAuthLost(code);
      throw new ApiError(401, code, (payload && payload.message) || "Not signed in.");
    }

    if (raw) {
      if (!res.ok) {
        const payload = await safeJson(res);
        throw new ApiError(res.status, payload && payload.error, payload && payload.message);
      }
      return res;
    }

    const payload = await safeJson(res);
    if (!res.ok) {
      throw new ApiError(res.status, payload && payload.error, payload && payload.message, payload && payload.field);
    }
    return payload;
  }

  return {
    baseUrl,
    tokens: store,
    refresh,
    get: (p, o) => request("GET", p, o),
    post: (p, body, o) => request("POST", p, { ...o, body }),
    patch: (p, body, o) => request("PATCH", p, { ...o, body }),
    put: (p, body, o) => request("PUT", p, { ...o, body }),
    del: (p, o) => request("DELETE", p, o),
    raw: (method, p, o) => request(method, p, { ...o, raw: true }),
  };
}

async function safeJson(res) {
  try { return await res.json(); } catch (_) { return null; }
}

/**
 * Token stores.
 *
 * In the extension, tokens live in chrome.storage.local so the background
 * worker and every content script share one session. In the web app they live
 * in memory only, because localStorage is readable by any script that manages
 * to run on the page.
 */
export function createMemoryTokenStore(initial = {}) {
  let accessToken = initial.accessToken || null;
  let refreshToken = initial.refreshToken || null;
  return {
    async getAccess() { return accessToken; },
    async getRefresh() { return refreshToken; },
    async set(t) { accessToken = t.accessToken; refreshToken = t.refreshToken; },
    async clear() { accessToken = null; refreshToken = null; },
  };
}

export function createExtensionTokenStore(chromeApi) {
  const api = chromeApi || (typeof chrome !== "undefined" ? chrome : null);
  if (!api || !api.storage) throw new Error("chrome.storage is not available here.");
  return {
    async getAccess() { return (await api.storage.local.get("kody_access")).kody_access || null; },
    async getRefresh() { return (await api.storage.local.get("kody_refresh")).kody_refresh || null; },
    async set(t) {
      await api.storage.local.set({ kody_access: t.accessToken, kody_refresh: t.refreshToken });
    },
    async clear() { await api.storage.local.remove(["kody_access", "kody_refresh"]); },
  };
}
