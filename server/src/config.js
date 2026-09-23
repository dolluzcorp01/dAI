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
    // Where to send someone who forgot their password. The password belongs to dAdmin.
    resetUrl: optional("DADMIN_RESET_URL", ""),
  },

  // Extension ids allowed to receive the auth handoff (chromiumapp.org callback).
  // Comma separated. Never a wildcard. See docs/14-extension.md.
  extensionIds: optional("EXTENSION_IDS", "")
    .split(",").map(s => s.trim()).filter(Boolean),

  socketPath: optional("SOCKET_PATH", "/socket.io"),

  redis: {
    url: optional("REDIS_URL", ""),
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
};

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
  if (config.files.driver === "local") {
    throw new Error("Refusing to start in production with STORAGE_DRIVER=local: disk is not shared and does not survive a redeploy.");
  }
  if (config.files.scanner === "local") {
    throw new Error("Refusing to start in production with FILE_SCANNER=local: EICAR detection is not antivirus.");
  }
  if (config.ai.primaryProvider === "mock" || config.ai.fallbackProvider === "mock") {
    throw new Error("Refusing to start in production with the mock model provider.");
  }
  if (config.mail.driver === "memory" || config.push.driver === "memory") {
    throw new Error("Refusing to start in production with a memory transport: mail and push would vanish.");
  }
}

module.exports = config;
