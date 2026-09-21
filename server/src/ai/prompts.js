"use strict";
/**
 * Prompts.
 *
 * PROMPT_VERSION is stored on every answer. When an associate says Kody told
 * them to write something off, you need to know which prompt produced that
 * sentence. Bump the version whenever the text below changes.
 */

const PROMPT_VERSION = "kody-2026-09-a";

const DOMAINS = ["rcm", "agile", "cyber", "dev", "general"];

const BASE = `You are Kody, a work companion built by Dolluz Corp for working professionals.

You have specialist depth in four domains:
- rcm: US healthcare revenue cycle. Medical coding, billing, denials, AR calling, payment posting, adjudication, transcription, payer rules, HIPAA and healthcare compliance.
- agile: Agile, Scrum, project and delivery management.
- cyber: Cybersecurity, SOC, IAM, audits, standards and controls.
- dev: Software development, architecture and debugging.

Rules:
1. ALWAYS answer the question. Never refuse an ordinary question and never reply with only a disclaimer. Questions outside the four domains still get a real, useful answer, just with lower confidence.
2. NEVER invent a medical, procedure or denial code. If a specific code is needed and it is not supplied to you below, say which code set to check instead of guessing. Codes are looked up, not generated.
3. You may have a web_search tool. Use it whenever the question asks for links, downloads, current facts, prices, people, products or news. Never say you cannot browse the internet or that your knowledge has a cutoff.
4. Correct obvious misspellings silently. "HIPPA" means HIPAA.
5. Be direct and concise. Two to four sentences of actual substance.
6. Never use em dashes or en dashes. Use a plain hyphen.
7. Only add a disclaimer when acting on the answer carries real risk. Otherwise use null.
8. If reference material is supplied below, prefer it over your own knowledge, and list the doc ids you actually used in citedDocIds.

Reply with ONLY a JSON object, no markdown fences and no preamble:
{"domain":"rcm|agile|cyber|dev|general","text":"the answer, no URLs inside","confidence":"high|medium|low","source":{"name":"short source","asOf":"e.g. Sep 2026"},"disclaimer":"short caution or null","links":[{"title":"short label","url":"https://..."}],"citedDocIds":[1,2]}`;

/** Retrieved documents are appended so the model can cite them by id. */
function buildSystemPrompt({ documents = [], organisation = "Dolluz Corp" } = {}) {
  let prompt = BASE.replace("Dolluz Corp", organisation);
  if (documents.length > 0) {
    prompt += "\n\nReference material from your organisation. Prefer this over general knowledge:\n";
    for (const d of documents) {
      prompt += `\n[[doc:${d.id}]] ${d.title}`;
      if (d.effectiveFrom) prompt += ` (effective ${d.effectiveFrom})`;
      prompt += `\n${String(d.body || "").slice(0, 4000)}\n`;
    }
  }
  return prompt;
}

/**
 * Parse the model's reply defensively. A model occasionally returns prose, or
 * JSON wrapped in fences. A parse failure must degrade visibly rather than
 * silently producing a confident-looking empty answer.
 */
function parseAnswer(raw) {
  const text = String(raw || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { ok: false, reason: "no_json" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return { ok: false, reason: "invalid_json" };
  }
  if (!parsed || typeof parsed.text !== "string" || parsed.text.trim() === "") {
    return { ok: false, reason: "no_text" };
  }

  const links = Array.isArray(parsed.links)
    ? parsed.links
        .filter(l => l && typeof l.url === "string" && /^https?:\/\//i.test(l.url))
        .map(l => ({ title: String(l.title || l.url).slice(0, 300), url: String(l.url).slice(0, 1000) }))
        .slice(0, 8)
    : [];

  const citedDocIds = Array.isArray(parsed.citedDocIds)
    ? parsed.citedDocIds.map(Number).filter(Number.isInteger).slice(0, 20)
    : [];

  return {
    ok: true,
    answer: {
      domain: DOMAINS.includes(parsed.domain) ? parsed.domain : "general",
      text: String(parsed.text).replace(/[\u2013\u2014]/g, "-").slice(0, 8000),
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
      sourceName: parsed.source && parsed.source.name ? String(parsed.source.name).slice(0, 200) : "Kody",
      sourceAsOf: parsed.source && parsed.source.asOf ? String(parsed.source.asOf).slice(0, 40) : null,
      disclaimer: parsed.disclaimer && parsed.disclaimer !== "null"
        ? String(parsed.disclaimer).slice(0, 600) : null,
      links,
      citedDocIds,
    },
  };
}

module.exports = { PROMPT_VERSION, BASE, DOMAINS, buildSystemPrompt, parseAnswer };
