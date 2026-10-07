"use strict";
/**
 * Central configuration. Nothing else in the codebase reads process.env,
 * so every knob is visible in one place and missing values fail loudly at
 * boot rather than at the first request.
 */

function required(key) {
  const v = process.env[key];
  if (v === undefined || v === "") {
    throw new Error(`Missing required environment variable: ${key}. Copy .env.example to .env.`);
  }
  return v;
}
function optional(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}
function int(key, fallback) {
  return Number.parseInt(optional(key, String(fallback)), 10);
}

const config = {
  env: optional("NODE_ENV", "development"),
  port: int("PORT", 4000),
  publicUrl: optional("PUBLIC_URL", "http://localhost:4000"),
  webUrl: optional("WEB_URL", "http://localhost:5173"),

  db: {
    host: optional("DB_HOST", "127.0.0.1"),
    port: int("DB_PORT", 3306),
    user: optional("DB_USER", "kody"),
    password: optional("DB_PASSWORD", ""),
    database: optional("DB_NAME", "kody"),
    socketPath: optional("DB_SOCKET", undefined),
    connectionLimit: int("DB_POOL", 10),
  },

  auth: {
    accessSecret: optional("JWT_ACCESS_SECRET", "dev_access_secret_change_me"),
    refreshSecret: optional("JWT_REFRESH_SECRET", "dev_refresh_secret_change_me"),
    accessMinutes: int("ACCESS_TOKEN_MINUTES", 15),
    refreshDays: int("REFRESH_TOKEN_DAYS", 30),
    codeTtlSeconds: int("AUTH_CODE_TTL_SECONDS", 60),
    maxFailedAttempts: int("AUTH_MAX_FAILED", 5),
    lockoutMinutes: int("AUTH_LOCKOUT_MINUTES", 15),
    allowedRedirectUris: optional("ALLOWED_REDIRECT_URIS", "http://localhost:5173/auth/callback")
      .split(",").map(s => s.trim()).filter(Boolean),
    // Login attempts per minute, per IP and email. Deliberately configurable:
    // a shared office NAT behind one IP needs headroom, and account lockout
    // (maxFailedAttempts) is the real defence against guessing.
    rateLoginMax: int("AUTH_RATE_LOGIN_MAX", 10),
    rateTokenMax: int("AUTH_RATE_TOKEN_MAX", 30),
    rateRefreshMax: int("AUTH_RATE_REFRESH_MAX", 60),
  },

  // dAI: the dAdmin link (docs/PHASES.md 1.1 and 1.2). dadmin lives on the same
  // MySQL server and dAI only ever reads it: the database user holds SELECT on
  // the sign-in columns of dadmin.employee and nothing else.
  dadmin: {
    dbName: optional("DADMIN_DB_NAME", "dadmin"),
    // A dedicated random secret shared only with dAdmin's DAI_SHARED_JWT_SECRET,
    // never dAdmin's own JWT_SECRET. Used by the service-token middleware in 1.2.
    sharedJwtSecret: optional("DADMIN_SHARED_JWT_SECRET", ""),
    // dAI: where to send somebody who has forgotten their password.
    //
    // Inside D, not dAdmin. The password belongs to dadmin.employee either way,
    // but only Admin and Sub Admin can sign in to the dAdmin console, and Kody
    // is for everyone: a User-level AR caller sent there lands on a page that
    // refuses them. Inside D is the portal every employee can use, and its
    // Forgot password runs a five minute email OTP against the same
    // dadmin.employee row.
    //
    // The old name is still read, so a box that has not had its .env updated
    // keeps working rather than silently losing the link.
    resetUrl: optional("PASSWORD_RESET_URL", "") || optional("DADMIN_RESET_URL", ""),
  },

  // dAI: single sign-on from Inside D (docs/17-portal-sso.md).
  //
  // INERT until every one of clientId, clientSecret, authorizeUrl and tokenUrl
  // is set. With any of them missing, portalEnabled() is false, the sign in
  // page never leaves dai.dolluzcorp.com and the password form is the only way
  // in, which is exactly how Phase 1 works today. That is deliberate: the
  // Inside D half is a separate repository and does not exist yet, so this
  // code has to ship doing nothing.
  //
  // clientSecret authenticates dAI to Inside D's token endpoint and NOTHING
  // else. It is its own dedicated random value: never a JWT secret, never the
  // dAdmin shared secret. A guard below refuses to boot if it is one of those,
  // because holding a signing secret would let dAI mint a session as any
  // employee in any dApp, which is the thing this design exists to avoid.
  portal: {
    clientId: optional("PORTAL_CLIENT_ID", ""),
    clientSecret: optional("PORTAL_CLIENT_SECRET", ""),
    authorizeUrl: optional("PORTAL_AUTHORIZE_URL", ""),
    tokenUrl: optional("PORTAL_TOKEN_URL", ""),
    // Where Inside D sends people back. One exact string, on Inside D's
    // allowlist, with no query of its own: the sign in page carries what it
    // needs to resume in its own sessionStorage, not in this URL.
    redirectUri: optional("PORTAL_REDIRECT_URI", ""),
    // A Kody session that came from a portal session gets a working day, not
    // the 30 days a password gets. Portal logout does not yet end a Kody
    // session, so the honest thing is not to let one outlive the other by a
    // month. docs/17-portal-sso.md "When the portal session ends".
    sessionHours: int("PORTAL_SESSION_HOURS", 8),
  },

  // Extension ids allowed to receive the auth handoff (chromiumapp.org callback).
  // Comma separated. Never a wildcard. See docs/14-extension.md.
  extensionIds: optional("EXTENSION_IDS", "")
    .split(",").map(s => s.trim()).filter(Boolean),

  socketPath: optional("SOCKET_PATH", "/socket.io"),

  redis: {
    url: optional("REDIS_URL", ""),
  },

  // dAI: the zone a bare date means (docs/PHASES.md 1.3). Everything is STORED
  // in UTC: the pool sets time_zone to +00:00 on every connection. But "today"
  // is a thing people say, and our people are in India, so a bare date in a
  // filter is read as an IST day and converted. Without this it was read in
  // whatever zone the server process happened to run in, which is IST on a
  // laptop and UTC on a droplet: the same request meaning two different days.
  // India has no daylight saving, so a fixed offset is exact.
  businessDay: {
    offset: optional("BUSINESS_DAY_OFFSET", "+05:30"),
  },

  ai: {
    primaryProvider: optional("MODEL_PRIMARY_PROVIDER", "anthropic"),
    fallbackProvider: optional("MODEL_FALLBACK_PROVIDER", ""),
    anthropicKey: optional("ANTHROPIC_API_KEY", ""),
    openaiKey: optional("OPENAI_API_KEY", ""),
    modelTier1: optional("MODEL_TIER1", "claude-haiku-4-5"),
    modelTier2: optional("MODEL_TIER2", "claude-sonnet-5"),
    modelTier3: optional("MODEL_TIER3", "claude-opus-5"),
    maxRetries: int("MODEL_MAX_RETRIES", 2),
    maxTokens: int("MODEL_MAX_TOKENS", 1500),
    webSearch: optional("MODEL_WEB_SEARCH", "false") === "true",
    rateMax: int("KODY_RATE_MAX", 30),
  },

  files: {
    driver: optional("STORAGE_DRIVER", "local"),
    localPath: optional("STORAGE_LOCAL_PATH", "./var/uploads"),
    maxMb: int("MAX_FILE_MB", 25),
    scanner: optional("FILE_SCANNER", "local"),
    clamavHost: optional("CLAMAV_HOST", ""),
    clamavPort: int("CLAMAV_PORT", 3310),
    spaces: {
      endpoint: optional("SPACES_ENDPOINT", ""),
      bucket: optional("SPACES_BUCKET", ""),
      region: optional("SPACES_REGION", ""),
      accessKey: optional("SPACES_ACCESS_KEY", ""),
      secretKey: optional("SPACES_SECRET_KEY", ""),
    },
  },

  mail: {
    driver: optional("MAIL_DRIVER", "memory"),
    from: optional("MAIL_FROM", "kody@dolluzcorp.com"),
    sendgridKey: optional("SENDGRID_API_KEY", ""),
  },

  push: {
    driver: optional("PUSH_DRIVER", "memory"),
    fcmKey: optional("FCM_SERVER_KEY", ""),
  },

  isProd() { return this.env === "production"; },

  /**
   * dAI: is single sign-on from Inside D wired up at all?
   *
   * All or nothing on purpose. Three values out of four is a half configured
   * handoff that fails at the exchange, after the person has already been sent
   * to another origin and back. Answering false here keeps them on the
   * password form instead.
   */
  portalEnabled() {
    const p = this.portal;
    return !!(p.clientId && p.clientSecret && p.authorizeUrl && p.tokenUrl && p.redirectUri);
  },
};

/*
 * dAI: two guards that are NOT production-only (docs/17-portal-sso.md).
 *
 * The guards below this live inside the production block because what they
 * refuse is only wrong on a server. These two are wrong anywhere, and the place
 * somebody wires portal sign-on up for the first time is a laptop, so saying it
 * only in production would say it to the wrong person.
 */
if (config.portal.clientSecret) {
  // The Inside D client secret is its own value or dAI does not start. If it
  // were a signing secret, dAI could mint a session as any employee in any dApp
  // in the suite, and a compromise of dAI would become a compromise of all of
  // them. docs/17-portal-sso.md "The secret".
  const forbidden = {
    JWT_ACCESS_SECRET: config.auth.accessSecret,
    JWT_REFRESH_SECRET: config.auth.refreshSecret,
    DADMIN_SHARED_JWT_SECRET: config.dadmin.sharedJwtSecret,
  };
  for (const [name, value] of Object.entries(forbidden)) {
    if (value && config.portal.clientSecret === value) {
      throw new Error(
        `Refusing to start: PORTAL_CLIENT_SECRET is the same value as ${name}. `
        + "It must be its own dedicated random value. It authenticates dAI to "
        + "Inside D's token endpoint and signs nothing."
      );
    }
  }
  if (config.portal.clientSecret.length < 32) {
    throw new Error(
      "Refusing to start: PORTAL_CLIENT_SECRET is shorter than 32 characters. "
      + "Generate one with: openssl rand -base64 48"
    );
  }
}

// Half a handoff is worse than none: the person is sent to Inside D and comes
// back to an exchange that cannot work, after the redirect has already happened.
// Say so at boot instead.
{
  const portalKeys = {
    PORTAL_CLIENT_ID: config.portal.clientId,
    PORTAL_CLIENT_SECRET: config.portal.clientSecret,
    PORTAL_AUTHORIZE_URL: config.portal.authorizeUrl,
    PORTAL_TOKEN_URL: config.portal.tokenUrl,
    PORTAL_REDIRECT_URI: config.portal.redirectUri,
  };
  const set = Object.entries(portalKeys).filter(([, v]) => !!v).map(([k]) => k);
  const missing = Object.entries(portalKeys).filter(([, v]) => !v).map(([k]) => k);
  if (set.length > 0 && missing.length > 0) {
    throw new Error(
      `Refusing to start with portal sign-on half configured. Set is ${set.join(", ")}; `
      + `missing is ${missing.join(", ")}. Set all five, or none of them to leave the `
      + "password form as the only way in."
    );
  }
}

/*
 * In production, refuse to boot on settings that would look fine and fail
 * quietly. Each guard has a test in tests/deploy.test.js. See
 * docs/15-deployment.md "Production refuses to start misconfigured".
 */
if (config.env === "production") {
  for (const k of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) required(k);
  if (config.auth.accessSecret.startsWith("dev_") || config.auth.refreshSecret.startsWith("dev_")) {
    throw new Error("Refusing to start in production with development JWT secrets.");
  }
  if (!config.redis.url) {
    throw new Error("Refusing to start in production without REDIS_URL: a second instance would silently drop messages.");
  }
  // dAI: a whitelist, not a blacklist. The old check refused the exact string
  // "local", so FILE_SCANNER=off passed it and then fell through to the local
  // EICAR stub, which is the failure the check existed to prevent.
  const STORAGE_DRIVERS = ["spaces", "none"];
  const SCANNERS = ["clamav", "none"];

  if (!STORAGE_DRIVERS.includes(config.files.driver)) {
    throw new Error(
      `Refusing to start in production with STORAGE_DRIVER=${config.files.driver}. `
      + "Use spaces, or none to turn file sharing off. Local disk is not shared "
      + "and does not survive a redeploy."
    );
  }
  if (!SCANNERS.includes(config.files.scanner)) {
    throw new Error(
      `Refusing to start in production with FILE_SCANNER=${config.files.scanner}. `
      + "Use clamav, or none when file sharing is off. EICAR detection is not antivirus."
    );
  }
  // The pair matters more than either alone: uploads must never be accepted
  // without a real scanner, and turning storage on while leaving the scanner at
  // none would do exactly that by forgetting one line.
  if (config.files.driver !== "none" && config.files.scanner === "none") {
    throw new Error(
      "Refusing to start in production with file sharing on and FILE_SCANNER=none. "
      + "Set FILE_SCANNER=clamav, or STORAGE_DRIVER=none to turn file sharing off."
    );
  }
  // dAI: the mock provider in production is refused, UNLESS somebody has said
  // so on purpose. The first deploy of the pilot runs on mock deliberately, to
  // prove nginx, pm2, MySQL, Redis, sign in and the extension before a real key
  // and a real bill are involved. The alternative was NODE_ENV=development,
  // which would switch off every other guard here, including the one that lets
  // a local Kody password stand in for a dAdmin one. Working around one guard
  // by disabling six is not a trade worth making.
  if (config.ai.primaryProvider === "mock" || config.ai.fallbackProvider === "mock") {
    if (process.env.ALLOW_MOCK_MODEL !== "1") {
      throw new Error(
        "Refusing to start in production with the mock model provider. "
        + "If this is a plumbing deploy and you mean it, set ALLOW_MOCK_MODEL=1."
      );
    }
    console.warn(
      "WARNING: running in production with the MOCK model provider. "
      + "Every answer is canned and no model is called. "
      + "Remove ALLOW_MOCK_MODEL before anyone relies on an answer."
    );
  }
  // dAI: https for every portal URL. Only in production, because running
  // against a local Inside D over http is a legitimate thing to do on a laptop.
  for (const [key, value] of [["PORTAL_AUTHORIZE_URL", config.portal.authorizeUrl],
                              ["PORTAL_TOKEN_URL", config.portal.tokenUrl],
                              ["PORTAL_REDIRECT_URI", config.portal.redirectUri]]) {
    if (value && !/^https:\/\//.test(value)) {
      throw new Error(`Refusing to start in production with a non-https ${key}.`);
    }
  }
  if (config.mail.driver === "memory" || config.push.driver === "memory") {
    throw new Error("Refusing to start in production with a memory transport: mail and push would vanish.");
  }
}

module.exports = config;
