/**
 * Single sign-on through dAdmin, from the service worker (docs/17-portal-sso.md
 * section 7).
 *
 * Somebody who already has the Dolluz portal open should not type a password to
 * use Kody. This is the whole of it, and it runs before any window opens:
 *
 *   1. Ask dAI where dAdmin's handoff endpoint is. Configuration, not a constant
 *      here, so moving it does not need a new extension release. If dAI says the
 *      handoff is not configured, stop: the password form is the way in.
 *   2. POST that URL with credentials, so the browser attaches the portal cookie.
 *      dAdmin reads its OWN cookie and answers with a 60 second JWT carrying one
 *      thing dAI cares about: the emp_id.
 *   3. POST the JWT to dAI, which verifies it, spends its jti once and only once,
 *      and returns a Kody session.
 *
 * Why the service worker and not the sign in page. The call is authenticated by
 * a cookie, so dAI's backend cannot make it. The page could, but then dAdmin
 * would need CORS, a window would open for a sign in that needs no interaction,
 * and the whole thing would depend on launchWebAuthFlow carrying cookies. Here,
 * nothing opens at all: click Kody and you are signed in.
 *
 * What never happens here: dolluzcorp_token is never read, inspected, copied or
 * sent anywhere by this code. `credentials: "include"` asks the BROWSER to
 * attach it to one request to the origin it already belongs to. The value is not
 * visible to this code and must stay that way.
 *
 * Every failure is quiet and falls through to the password sign in, with one
 * exception. If dAdmin says the account has no Kody access, the password will be
 * refused for the same reason, so that one is reported instead of sending
 * somebody to fail twice.
 */

/** dAdmin answers in well under a second. A box mid-deploy can accept a
 *  connection and never answer, which is the case this guards: a hang, not a
 *  refusal. Same five seconds the server uses for its own portal exchange. */
export const TIMEOUT_MS = 5000;

/** https anywhere, http only on this machine, exactly as shared/config.js. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function usableHandoffUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  let url;
  try { url = new URL(text); } catch (_) { return null; }
  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.toString();
  return null;
}

/** fetch with a deadline, so nothing can hang the sign in. */
async function fetchWithTimeout(fetchImpl, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const quiet = (error) => ({ ok: false, error, quiet: true });

/**
 * The one failure a person sees, so it says what the sign in page says. The
 * server's own wording for this names dAdmin, which is accurate and is what an
 * administrator needs, but two surfaces telling the same person the same thing
 * two different ways is worse than either wording.
 */
const NO_ACCESS = {
  ok: false,
  error: "dai_not_enabled",
  quiet: false,
  message: "Your Dolluz account does not have Kody access yet. Ask your administrator.",
};

/**
 * Try to sign in without asking for anything.
 *
 * Returns { ok: true, user, roles } on success. On failure, `quiet: true` means
 * carry on to the password sign in and say nothing; `quiet: false` means show
 * `message` and do NOT open a sign in window, because a password cannot help.
 */
export async function trySilentSignIn({
  apiBase, fetchImpl = fetch, setTokens,
} = {}) {
  // Step 1: is this switched on, and where.
  let cfg = null;
  try {
    const res = await fetchWithTimeout(fetchImpl, `${apiBase}/api/auth/dai-login/config`, {
      method: "GET",
    });
    cfg = await res.json();
  } catch (_) {
    return quiet("config_unreachable");
  }
  if (!cfg || !cfg.enabled) return quiet("not_configured");

  const handoffUrl = usableHandoffUrl(cfg.handoffUrl);
  if (!handoffUrl) return quiet("bad_handoff_url");

  // Step 2: ask dAdmin, with the portal cookie attached by the browser.
  //
  // No body and no headers, deliberately. dAdmin asked for no query string ever,
  // so the token cannot reach a URL, a log or a Referer header, and a request
  // with no Content-Type also stays a CORS-simple request, which matters if this
  // is ever moved to a page.
  let handoff;
  try {
    handoff = await fetchWithTimeout(fetchImpl, handoffUrl, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch (_) {
    return quiet("dadmin_unreachable");
  }

  if (handoff.status === 403) {
    // app_dAI = 0, inactive or deleted. The password would be refused for the
    // same reason, so this is the one failure worth saying out loud.
    return { ...NO_ACCESS };
  }
  // 401 is no portal session, which is most people most of the time. 503 is a
  // configuration dAdmin has to fix and retrying cannot. Both are quiet.
  if (!handoff.ok) return quiet(handoff.status === 401 ? "login_required" : "handoff_refused");

  let body = null;
  try { body = await handoff.json(); } catch (_) { body = null; }
  if (!body || !body.token) return quiet("handoff_empty");

  // Step 3: give it to dAI, which verifies it and spends it.
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `${apiBase}/api/auth/dai-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: body.token }),
    });
  } catch (_) {
    return quiet("kody_unreachable");
  }

  let session = null;
  try { session = await res.json(); } catch (_) { session = null; }

  if (!res.ok || !session || !session.accessToken) {
    const error = (session && session.error) || "exchange_failed";
    // dAdmin may have vouched for somebody whose app_dAI was turned off a moment
    // ago, so the same rule applies one leg later.
    if (error === "dai_not_enabled") return { ...NO_ACCESS };
    return quiet(error);
  }

  await setTokens({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: session.user,
  });

  return {
    ok: true,
    user: session.user,
    roles: session.roles,
    origin: session.origin,
    sessionHours: session.sessionHours,
    silent: true,
  };
}
