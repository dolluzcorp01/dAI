"use strict";
const config = require("../config");
const { getProvider, ProviderError } = require("./providers");

/**
 * The model gateway.
 *
 * One entry point for every model call in the system. It owns:
 *   - which model each tier uses
 *   - retry on a transient failure
 *   - failover to the secondary provider
 *   - latency and token accounting
 *
 * No other module imports a provider directly. Changing vendor, or moving a
 * tier to a cheaper model, is a config change.
 */

const TIERS = {
  0: { key: 0, label: "lookup",   note: "no model call" },
  1: { key: 1, label: "fast",     note: "small model" },
  2: { key: 2, label: "standard", note: "retrieval" },
  3: { key: 3, label: "deep",     note: "reasoning" },
};

/**
 * Tier selection.
 *
 * Tier 0 is decided elsewhere, by an exact code match, because a lookup that
 * hits the database must never reach a model. This function chooses between
 * the model tiers only.
 */
function chooseTier(question) {
  const q = String(question || "").toLowerCase();
  const words = q.trim().split(/\s+/).filter(Boolean).length;

  if (/(draft|appeal letter|compare|analys|analyz|walk me through|step by step|why would|root cause|review this|plan for|write me)/.test(q)) {
    return 3;
  }
  if (words <= 5 && !/(hipaa|hippa|denial|code|payer|audit|sprint|policy|compliance)/.test(q)) {
    return 1;
  }
  return 2;
}

function modelFor(tier) {
  switch (tier) {
    case 1: return config.ai.modelTier1;
    case 3: return config.ai.modelTier3;
    default: return config.ai.modelTier2;
  }
}

function keyFor(providerName) {
  if (providerName === "anthropic") return config.ai.anthropicKey;
  if (providerName === "openai") return config.ai.openaiKey;
  return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callOnce(providerName, args) {
  const provider = getProvider(providerName);
  const apiKey = keyFor(providerName);
  if (provider.requiresKey && !apiKey) {
    throw new ProviderError("missing_key", `No API key configured for ${providerName}`, { retryable: false });
  }
  return provider.complete({ ...args, apiKey });
}

/**
 * Run a completion with retries and failover.
 *
 * Retries only on a transient failure. A 400 from the provider means the
 * request is wrong, and sending it again to a second vendor would just waste
 * money and time.
 */
async function complete({ tier, system, messages, maxTokens = 1000, webSearch = false }) {
  const model = modelFor(tier);
  const primary = config.ai.primaryProvider;
  const fallback = config.ai.fallbackProvider;
  const started = Date.now();

  const attempts = [];
  const order = fallback && fallback !== primary ? [primary, fallback] : [primary];

  for (const providerName of order) {
    for (let attempt = 1; attempt <= config.ai.maxRetries; attempt++) {
      try {
        const out = await callOnce(providerName, { model, system, messages, maxTokens, webSearch });
        return {
          ...out,
          provider: providerName,
          tier,
          latencyMs: Date.now() - started,
          attempts: attempts.length + 1,
          degraded: providerName !== primary,
        };
      } catch (err) {
        attempts.push({ provider: providerName, attempt, code: err.code, message: err.message });
        if (!err.retryable) break;                       // move to the next provider
        if (attempt < config.ai.maxRetries) {
          await sleep(Math.min(2000, 200 * Math.pow(2, attempt - 1)));  // backoff
        }
      }
    }
  }

  const last = attempts[attempts.length - 1] || {};
  const err = new ProviderError(
    last.code || "all_providers_failed",
    `Every provider failed. Last error: ${last.message || "unknown"}`
  );
  err.attempts = attempts;
  err.latencyMs = Date.now() - started;
  throw err;
}

module.exports = { complete, chooseTier, modelFor, TIERS, ProviderError };
