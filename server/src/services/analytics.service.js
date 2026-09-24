"use strict";
const db = require("../db");

/**
 * Analytics for the admin overview.
 *
 * Every number here is derived from tables that already exist. `kody_messages`
 * carries domain, tier, latency, tokens and model on every answer, which is
 * why no new schema was needed.
 *
 * These queries scan the two largest tables, so the overview is cached. A
 * dashboard that is sixty seconds stale is fine; a dashboard that runs six
 * full scans on every page load is not.
 */

/**
 * dAI: what every headline field actually counts.
 *
 * The dAdmin console read activeUsers as "how many people use Kody" and
 * overstated it eightfold: it is every account that exists, and most accounts
 * have never asked anything. A number on a dashboard is read by someone who
 * will not open this file, so each one says what it is, the API serves this
 * guide at GET /api/admin/analytics/fields, and a test fails if a field is
 * added to the headline without a line here.
 *
 * The pairs to keep straight:
 *   accountsTotal      how many accounts exist
 *   peopleWhoAsked7d   how many people actually used Kody in the last week
 */
const FIELD_GUIDE = {
  accountsTotal: "Accounts that exist and are not deactivated or deleted. NOT a measure of use: most accounts may never have asked anything.",
  peopleWhoAsked7d: "Distinct people who asked Kody at least one question in the last 7 days. This is the usage figure.",
  activeUsers: "Deprecated alias of accountsTotal, kept so existing callers do not break. Do not label it as activity.",
  activeUsers7d: "Deprecated alias of peopleWhoAsked7d.",
  questionsToday: "Questions asked since midnight, server time.",
  questionsYesterday: "Questions asked during the whole of yesterday.",
  questionsDelta: "Percentage change from yesterday to today, or null when yesterday was zero.",
  answers30d: "Answers Kody produced in the last 30 days, every tier including lookups.",
  tier0Share: "Fraction between 0 and 1 of those answers that came from the code tables with no model call. Multiply by 100 to show a percentage.",
  avgLatencyMs: "MEAN answer time in milliseconds over the last 30 days, tier 1 and above. It is an average, not a median: one slow answer moves it.",
  maxLatencyMs: "Slowest single answer in the last 30 days, in milliseconds.",
  degradedRate: "Fraction between 0 and 1 of answers that told the person Kody could not answer properly.",
  inputTokens30d: "Prompt tokens sent to models in the last 30 days. Tokens, not money: the API knows no prices and reports no spend.",
  outputTokens30d: "Tokens models returned in the last 30 days. Tokens, not money.",
  messages7d: "Chat messages sent between people in the last 7 days. Nothing to do with Kody answers.",
  filesStored: "Attachments that are clean and not deleted, across the whole organisation.",
  storageMb: "Megabytes those attachments occupy.",
  cached: "True when this response came from the sixty second cache rather than being computed.",
  generatedAt: "When the overview was computed.",
  domains: "Answers by domain for the last 30 days, with how many were low confidence.",
  tiers: "Answers by tier for the last 30 days, with mean latency and token totals.",
  models: "Answers by model for the last 30 days, with token totals and mean latency.",
  unanswered: "Questions answered with low confidence or with no supporting document. Every such question appears, not only ones asked repeatedly: `asked` is how many times that exact wording came up.",
  knowledge: "Corpus health: published documents, how many have ever been cited, the open SME queue, and current code entries.",
};

const CACHE_MS = Number(process.env.ANALYTICS_CACHE_MS || 60000);
const cache = new Map();

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
  return { ...value, cached: false };
}

function clearCache() { cache.clear(); }

const pct = (a, b) => (b === 0 ? null : Math.round(((a - b) / b) * 100));

/* ---------------- headline numbers ---------------- */

async function headline() {
  // dAI: this counts ACCOUNTS, not people using Kody. See FIELD_GUIDE above.
  const accounts = await db.one(
    `SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND deleted_at IS NULL`
  );
  const activeRecently = await db.one(
    `SELECT COUNT(DISTINCT user_id) AS n FROM kody_messages
      WHERE role = 'user' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
  );

  const today = await db.one(
    `SELECT COUNT(*) AS n FROM kody_messages
      WHERE role = 'user' AND created_at >= CURDATE()`
  );
  const yesterday = await db.one(
    `SELECT COUNT(*) AS n FROM kody_messages
      WHERE role = 'user' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND created_at < CURDATE()`
  );

  // Tier 0 answers never touch a model, so this is both a cost and a quality figure.
  const tiers = await db.one(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN tier = 0 THEN 1 ELSE 0 END) AS tier0
       FROM kody_messages
      WHERE role = 'assistant' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );

  const latency = await db.one(
    `SELECT AVG(latency_ms) AS avgMs, MAX(latency_ms) AS maxMs
       FROM kody_messages
      WHERE role = 'assistant' AND tier > 0
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );

  // A degraded answer is one that told the user it could not answer properly.
  const degraded = await db.one(
    `SELECT COUNT(*) AS n FROM kody_messages
      WHERE role = 'assistant' AND source_name IN ('Service unavailable','Malformed response')
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );

  const tokens = await db.one(
    `SELECT COALESCE(SUM(input_tokens),0) AS inTok, COALESCE(SUM(output_tokens),0) AS outTok
       FROM kody_messages
      WHERE role = 'assistant' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );

  const messages = await db.one(
    `SELECT COUNT(*) AS n FROM messages WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
  );
  const files = await db.one(
    `SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes
       FROM attachments WHERE deleted_at IS NULL AND scan_status = 'clean'`
  );

  const total = Number(tiers.total) || 0;
  return {
    // dAI: named so they cannot be confused with each other. The two old names
    // stay as aliases, so dAdmin and anything else already reading them keeps
    // working while it moves across.
    accountsTotal: Number(accounts.n),
    peopleWhoAsked7d: Number(activeRecently.n),
    activeUsers: Number(accounts.n),
    activeUsers7d: Number(activeRecently.n),
    questionsToday: Number(today.n),
    questionsYesterday: Number(yesterday.n),
    questionsDelta: pct(Number(today.n), Number(yesterday.n)),
    answers30d: total,
    tier0Share: total ? Number(tiers.tier0) / total : 0,
    avgLatencyMs: latency.avgMs ? Math.round(Number(latency.avgMs)) : 0,
    maxLatencyMs: latency.maxMs ? Number(latency.maxMs) : 0,
    degradedRate: total ? Number(degraded.n) / total : 0,
    inputTokens30d: Number(tokens.inTok),
    outputTokens30d: Number(tokens.outTok),
    messages7d: Number(messages.n),
    filesStored: Number(files.n),
    storageMb: Math.round((Number(files.bytes) / (1024 * 1024)) * 10) / 10,
  };
}

async function byDomain() {
  const [rows] = await db.query(
    `SELECT domain, COUNT(*) AS n,
            SUM(CASE WHEN confidence = 'low' THEN 1 ELSE 0 END) AS lowConfidence
       FROM kody_messages
      WHERE role = 'assistant' AND domain IS NOT NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY domain ORDER BY n DESC`
  );
  return rows.map(r => ({
    domain: r.domain, n: Number(r.n), lowConfidence: Number(r.lowConfidence),
  }));
}

async function byTier() {
  const [rows] = await db.query(
    `SELECT tier, COUNT(*) AS n, AVG(latency_ms) AS avgMs,
            COALESCE(SUM(input_tokens),0) AS inTok,
            COALESCE(SUM(output_tokens),0) AS outTok
       FROM kody_messages
      WHERE role = 'assistant' AND tier IS NOT NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY tier ORDER BY tier`
  );
  return rows.map(r => ({
    tier: Number(r.tier), n: Number(r.n),
    avgMs: r.avgMs ? Math.round(Number(r.avgMs)) : 0,
    inputTokens: Number(r.inTok), outputTokens: Number(r.outTok),
  }));
}

async function byModel() {
  const [rows] = await db.query(
    `SELECT model_name AS model, COUNT(*) AS n,
            COALESCE(SUM(input_tokens),0) AS inTok,
            COALESCE(SUM(output_tokens),0) AS outTok,
            AVG(latency_ms) AS avgMs
       FROM kody_messages
      WHERE role = 'assistant' AND model_name IS NOT NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY model_name ORDER BY n DESC`
  );
  return rows.map(r => ({
    model: r.model, n: Number(r.n),
    inputTokens: Number(r.inTok), outputTokens: Number(r.outTok),
    avgMs: r.avgMs ? Math.round(Number(r.avgMs)) : 0,
  }));
}

/**
 * dAI: the key a dismissal is stored under.
 *
 * Defined once, here, in SQL, and used both to label a row and to exclude a
 * dismissed one. Normalising in JavaScript as well would be two definitions of
 * "the same question" that drift apart, so the API never takes a question to
 * dismiss: it takes the key it handed out.
 *
 * Normalisation: lower case, trimmed, runs of whitespace collapsed, trailing
 * question and full stop marks removed, then joined to the domain.
 */
const QUESTION_KEY_SQL = `
  SHA2(CONCAT(
    REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(q.body)), '[[:space:]]+', ' '), '[?!.]+$', ''),
    '|', COALESCE(a.domain, '')
  ), 256)`;

/**
 * The panel that matters: asked repeatedly, answered with low confidence, and
 * no document backed it. This is the queue that says what to write next.
 *
 * dAI: rows an admin has dismissed are excluded, in the query rather than
 * afterwards, so the limit still returns a full page.
 */
async function unanswered({ limit = 10 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const [rows] = await db.query(
    `SELECT ${QUESTION_KEY_SQL} AS questionKey,
            q.body AS question, a.domain,
            COUNT(*) AS asked,
            SUM(CASE WHEN a.confidence = 'low' THEN 1 ELSE 0 END) AS lowConfidence,
            SUM(CASE WHEN a.used_retrieval = 0 THEN 1 ELSE 0 END) AS withoutDocument
       FROM kody_messages a
       JOIN kody_messages q
         ON q.thread_id = a.thread_id AND q.role = 'user' AND q.id < a.id
      WHERE a.role = 'assistant'
        AND a.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND (a.confidence = 'low' OR a.used_retrieval = 0)
        AND q.id = (SELECT MAX(q2.id) FROM kody_messages q2
                     WHERE q2.thread_id = a.thread_id AND q2.role = 'user' AND q2.id < a.id)
        AND NOT EXISTS (
              SELECT 1 FROM unanswered_dismissals d
               WHERE d.question_key = ${QUESTION_KEY_SQL}
            )
      GROUP BY q.body, a.domain
      HAVING asked >= 1
      ORDER BY asked DESC, lowConfidence DESC
      LIMIT ?`,
    [lim]
  );
  return rows.map(r => ({
    questionKey: r.questionKey,     // dAI: what a dismissal is keyed on
    question: r.question, domain: r.domain,
    asked: Number(r.asked), lowConfidence: Number(r.lowConfidence),
    withoutDocument: Number(r.withoutDocument),
  }));
}

async function knowledgeHealth() {
  const published = await db.one(
    `SELECT COUNT(*) AS n FROM knowledge_docs WHERE status = 'published'`
  );
  const cited = await db.one(
    `SELECT COUNT(DISTINCT c.doc_id) AS n
       FROM kody_citations c JOIN knowledge_docs d ON d.id = c.doc_id
      WHERE d.status = 'published'`
  );
  const sme = await db.one(
    `SELECT SUM(status IN ('open','in_review')) AS open,
            SUM(status = 'resolved' AND resolved_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS resolved30d
       FROM sme_queue`
  );
  const codes = await db.one(
    `SELECT COUNT(*) AS n FROM code_entries
      WHERE (effective_to IS NULL OR effective_to >= CURDATE())`
  );
  return {
    publishedDocs: Number(published.n),
    citedDocs: Number(cited.n),
    uncitedDocs: Number(published.n) - Number(cited.n),
    smeOpen: Number(sme.open || 0),
    smeResolved30d: Number(sme.resolved30d || 0),
    currentCodeEntries: Number(codes.n),
  };
}

/** Everything the overview screen needs, in one cached call. */
async function overview() {
  return cached("overview", async () => {
    const [h, domains, tiers, models, gaps, knowledge] = await Promise.all([
      headline(), byDomain(), byTier(), byModel(), unanswered({ limit: 8 }), knowledgeHealth(),
    ]);
    return { ...h, domains, tiers, models, unanswered: gaps, knowledge, generatedAt: new Date() };
  });
}

/* ---------------- per person ---------------- */

async function byPerson({ from, to } = {}) {
  const params = [];
  let range = "";
  if (from) { range += " AND m.created_at >= ?"; params.push(from + " 00:00:00"); }
  if (to)   { range += " AND m.created_at <= ?"; params.push(to + " 23:59:59"); }

  const [rows] = await db.query(
    `SELECT u.id AS userId, u.full_name AS fullName, u.email, u.team,
            SUM(m.role = 'user') AS questions,
            SUM(m.role = 'assistant' AND m.tier = 0) AS lookups,
            COALESCE((SELECT COUNT(*) FROM kody_feedback f
                       WHERE f.user_id = u.id AND f.vote = 'up'), 0) AS helpfulVotes,
            COALESCE((SELECT SUM(points) FROM point_events p WHERE p.user_id = u.id), 0) AS points
       FROM users u
       LEFT JOIN kody_messages m ON m.user_id = u.id ${range ? "AND 1=1" + range : ""}
      WHERE u.deleted_at IS NULL
      GROUP BY u.id ORDER BY questions DESC, u.full_name`,
    params
  );
  return rows.map(r => ({
    userId: r.userId, fullName: r.fullName, email: r.email, team: r.team,
    questions: Number(r.questions || 0), lookups: Number(r.lookups || 0),
    helpfulVotes: Number(r.helpfulVotes || 0), points: Number(r.points || 0),
  }));
}

module.exports = {
  overview, headline, byDomain, byTier, byModel, unanswered,
  knowledgeHealth, byPerson, clearCache, CACHE_MS,
  FIELD_GUIDE,   // dAI: what every headline field actually counts
};
