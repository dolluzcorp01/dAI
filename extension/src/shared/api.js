/**
 * The one way the extension talks to dAI.
 *
 * It is the SDK from web/src/api, vendored into src/shared/sdk because Chrome
 * can only load files that ship inside the extension. build.js fails if the
 * copy has drifted, so there is still one client contract rather than two.
 *
 * Only the service worker uses this. The side panel asks the worker, and the
 * content script is told nothing (rule 22), so tokens stay in one place and,
 * just as important, so does token refresh: the API treats a reused refresh
 * token as theft and kills every session, so two refreshers in two contexts
 * would log people out for no reason.
 */
import { createClient } from "./sdk/client.js";
import { createApi } from "./sdk/endpoints.js";
import { endpoints } from "./config.js";

const KEY_ACCESS = "kody_access";
const KEY_REFRESH = "kody_refresh";
const KEY_USER = "kody_user";

/** The same storage keys shared/auth.js uses, so sign-in and the API agree. */
function tokenStore(storage) {
  return {
    async getAccess() { return (await storage.get(KEY_ACCESS))[KEY_ACCESS] || null; },
    async getRefresh() { return (await storage.get(KEY_REFRESH))[KEY_REFRESH] || null; },
    async set(tokens) {
      await storage.set({ [KEY_ACCESS]: tokens.accessToken, [KEY_REFRESH]: tokens.refreshToken });
    },
    async clear() { await storage.remove([KEY_ACCESS, KEY_REFRESH, KEY_USER]); },
  };
}

let cached = null;

/**
 * The API, pointed at whatever endpoints are configured. Rebuilt when they
 * change, so switching to a local server takes effect without a reload.
 */
export async function kodyApi({ storage = chrome.storage.local, onAuthLost } = {}) {
  const { apiBase } = await endpoints(storage);
  if (cached && cached.apiBase === apiBase) return cached.api;

  const client = createClient({
    baseUrl: apiBase,
    tokens: tokenStore(storage),
    onAuthLost: (reason) => {
      cached = null;
      if (onAuthLost) onAuthLost(reason);
    },
  });
  cached = { apiBase, api: createApi(client), client };
  return cached.api;
}

/** Forget the built client, so the next call picks up new endpoints or tokens. */
export function resetApi() { cached = null; }
