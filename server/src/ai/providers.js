"use strict";
/**
 * Model providers.
 *
 * Nothing outside this folder calls a vendor API. Every provider exposes the
 * same `complete()` and returns the same shape, so switching vendors is a
 * config change rather than a code change.
 *
 * Returns: { text, inputTokens, outputTokens, model, usedWebSearch }
 */

class ProviderError extends Error {
  constructor(code, message, { retryable = false, status } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 30000);

async function postJson(url, headers, body, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* provider returned non-JSON */ }

    if (!res.ok) {
      // 429 and 5xx are worth retrying or failing over; 4xx is our mistake.
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(
        retryable ? "provider_unavailable" : "provider_rejected",
        (json && json.error && json.error.message) || `HTTP ${res.status}`,
        { retryable, status: res.status }
      );
    }
    return json;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err.name === "AbortError") {
      throw new ProviderError("provider_timeout", `No response within ${timeoutMs}ms`, { retryable: true });
    }
    throw new ProviderError("provider_unreachable", err.message, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- Anthropic ---------------- */

const anthropic = {
  name: "anthropic",
  requiresKey: true,
  async complete({ model, system, messages, maxTokens, apiKey, webSearch }) {
    const body = {
      model,
      max_tokens: maxTokens,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

    const json = await postJson("https://api.anthropic.com/v1/messages", {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    }, body);

    const blocks = (json && json.content) || [];
    const text = blocks.filter(b => b.type === "text").map(b => b.text).join("\n");
    const usedWebSearch = blocks.some(
      b => b.type === "server_tool_use" || b.type === "web_search_tool_result"
    );
    const usage = (json && json.usage) || {};
    return {
      text,
      inputTokens: usage.input_tokens || null,
      outputTokens: usage.output_tokens || null,
      model: (json && json.model) || model,
      usedWebSearch,
    };
  },
};

/* ---------------- OpenAI, the fallback provider ---------------- */

const openai = {
  name: "openai",
  requiresKey: true,
  async complete({ model, system, messages, maxTokens, apiKey }) {
    const json = await postJson("https://api.openai.com/v1/chat/completions", {
      Authorization: `Bearer ${apiKey}`,
    }, {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
    });

    const choice = (json && json.choices && json.choices[0]) || {};
    const usage = (json && json.usage) || {};
    return {
      text: (choice.message && choice.message.content) || "",
      inputTokens: usage.prompt_tokens || null,
      outputTokens: usage.completion_tokens || null,
      model: (json && json.model) || model,
      usedWebSearch: false,
    };
  },
};

/* ---------------- Mock, for tests and local development ---------------- */

/**
 * Deterministic. Reads the last user message and produces a valid answer
 * envelope, so the whole pipeline (routing, parsing, persistence, citations,
 * feedback) can be tested without a network call or an API key.
 *
 * Set MOCK_MODEL_BEHAVIOUR to force a path:
 *   ok | malformed | empty | slow | error
 */
const mock = {
  name: "mock",
  requiresKey: false,
  async complete({ model, messages, system }) {
    const behaviour = process.env.MOCK_MODEL_BEHAVIOUR || "ok";
    const last = [...messages].reverse().find(m => m.role === "user");
    const question = (last && String(last.content)) || "";

    if (behaviour === "error") {
      throw new ProviderError("provider_unavailable", "mock forced failure", { retryable: true });
    }
    if (behaviour === "slow") {
      await new Promise(r => setTimeout(r, 200));
    }
    if (behaviour === "malformed") {
      return { text: "I am not JSON at all, sorry.", inputTokens: 10, outputTokens: 5, model, usedWebSearch: false };
    }
    if (behaviour === "empty") {
      return { text: "", inputTokens: 10, outputTokens: 0, model, usedWebSearch: false };
    }
    if (behaviour === "citeghost") {
      // Cites a document id that was never supplied, so the citation filter
      // in persistAnswer can actually be exercised.
      return {
        text: JSON.stringify({
          domain: "rcm", text: "An answer citing a document it never saw.",
          confidence: "high", source: { name: "Ghost", asOf: "Sep 2026" },
          disclaimer: null, links: [],
          citedDocIds: [Number(process.env.MOCK_CITE_DOC_ID || 987654321)],
        }),
        inputTokens: 10, outputTokens: 20, model, usedWebSearch: false,
      };
    }

    const q = question.toLowerCase();
    const domain =
      /denial|claim|payer|cpt|cdt|icd|hipaa|billing|coding|appeal|remit/.test(q) ? "rcm" :
      /sprint|scrum|agile|retro|backlog/.test(q) ? "agile" :
      /soc|siem|phish|vulnerab|iso 27001|mfa/.test(q) ? "cyber" :
      /react|node|sql|api|deploy|bug/.test(q) ? "dev" : "general";

    const cited = /\[\[doc:(\d+)\]\]/.exec(system || "");
    const payload = {
      domain,
      text: `Mock answer about ${domain}. ${question.slice(0, 80)}`.trim(),
      confidence: domain === "general" ? "low" : "medium",
      source: { name: "Mock source", asOf: "Sep 2026" },
      disclaimer: domain === "rcm" ? "Verify against the payer's current policy." : null,
      links: /link|resource|download/.test(q)
        ? [{ title: "Mock resource", url: "https://example.com/resource" }]
        : [],
      citedDocIds: cited ? [Number(cited[1])] : [],
    };

    return {
      text: JSON.stringify(payload),
      inputTokens: Math.max(1, Math.round(question.length / 4)),
      outputTokens: 42,
      model,
      usedWebSearch: /latest|current|today|news/.test(q),
    };
  },
};

const PROVIDERS = { anthropic, openai, mock };

function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new ProviderError("unknown_provider", `No provider named ${name}`);
  return p;
}

module.exports = { getProvider, PROVIDERS, ProviderError };
