/**
 * Where the extension talks to.
 *
 * Production by default, so a packed extension that has never been configured
 * points at Dolluz and nothing else. A developer can override it, and the
 * override lives in chrome.storage.local, not in the source, so the shipped
 * build cannot be pointed somewhere else by editing a constant and forgetting.
 *
 * An override may only be https, or http on this machine. That is the whole
 * rule: sending a token over plain http to anywhere but localhost is how a
 * session gets read off a network, and a convenience for development is not a
 * reason to allow it.
 */

export const PRODUCTION = Object.freeze({
  apiBase: "https://dai.dolluzcorp.com",
  siteBase: "https://dai.dolluzcorp.com",
});

const KEY = "kody_endpoints";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** https anywhere, http only on this machine. Returns a cleaned base or null. */
export function cleanBase(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return null;
  let url;
  try { url = new URL(text); } catch (_) { return null; }
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

export async function endpoints(storage = chrome.storage.local) {
  let stored = null;
  try {
    stored = (await storage.get(KEY))[KEY] || null;
  } catch (_) {
    stored = null;      // storage unavailable: production is the safe answer
  }
  const apiBase = cleanBase(stored && stored.apiBase) || PRODUCTION.apiBase;
  const siteBase = cleanBase(stored && stored.siteBase) || PRODUCTION.siteBase;
  return {
    apiBase,
    siteBase,
    isProduction: apiBase === PRODUCTION.apiBase && siteBase === PRODUCTION.siteBase,
  };
}

/**
 * Point the extension somewhere else. Both bases are required together: a
 * half-applied override, where sign-in goes to one place and the API to
 * another, is a confusing way to spend an afternoon.
 */
export async function setEndpoints({ apiBase, siteBase }, storage = chrome.storage.local) {
  const api = cleanBase(apiBase);
  const site = cleanBase(siteBase);
  if (!api || !site) {
    return { ok: false, error: "bad_base", message: "Use https, or http on localhost." };
  }
  await storage.set({ [KEY]: { apiBase: api, siteBase: site } });
  return { ok: true, apiBase: api, siteBase: site };
}

export async function clearEndpoints(storage = chrome.storage.local) {
  await storage.remove(KEY);
  return { ok: true, ...PRODUCTION };
}
