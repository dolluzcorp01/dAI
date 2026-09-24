/**
 * The side panel.
 *
 * This is where answers are rendered, because unlike the content script it runs
 * in the extension's own origin. A page cannot read it, and the extension CSP
 * forbids inline script and remote code.
 *
 * Two rules shape the whole file.
 *
 * 1. No innerHTML, anywhere. An answer is model output, and model output is
 *    untrusted input like any other. Everything is built with createElement and
 *    textContent, and links are followed only when they are http or https.
 *
 * 2. No tokens and no fetch. Every call goes to the service worker, which owns
 *    the tokens and the single refresh (docs/14-extension.md). The panel knows
 *    nothing about where the API is.
 *
 * The layout is prototypes/kody_prototype_v10.jsx: Ask, Chats, Saved, History,
 * the recent codes strip, the points wallet and the feedback buttons.
 */
const $ = (id) => document.getElementById(id);

const SAVED_KEY = "kody_saved_answers";
const CODES_KEY = "kody_recent_codes";

let threadId = null;
let busy = false;
let tab = "ask";

const send = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: "disconnected" });
      resolve(reply || { ok: false, error: "no_reply" });
    });
  });

const store = {
  async get(key, fallback) {
    try { return (await chrome.storage.local.get(key))[key] ?? fallback; }
    catch (_) { return fallback; }
  },
  async set(key, value) {
    try { await chrome.storage.local.set({ [key]: value }); } catch (_) { /* private mode */ }
  },
};

/* ---------------- small builders ---------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function button(className, label, onClick, title) {
  const b = el("button", className, label);
  b.type = "button";
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

/** Only http and https. A model can return javascript: or data: just as easily. */
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch (_) {
    return null;
  }
}

const clearNode = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

const scrollThread = () => { $("thread").scrollTop = $("thread").scrollHeight; };

/* ---------------- the answer card, as v10 draws it ---------------- */

const TIER_LABEL = { 0: "T0 Lookup", 1: "T1 Fast", 2: "T2 Standard", 3: "T3 Deep" };

function renderAnswer(node, answer, degraded) {
  clearNode(node);
  delete node.dataset.pending;

  if (degraded || answer.degraded) {
    node.appendChild(el("div", "degraded",
      "Degraded answer. Kody could not reach the answer service."));
  }

  // The code block: the code, what it means, and which set it came from. This
  // is a tier 0 answer, looked up rather than generated.
  if (answer.lookup && answer.lookup.code) {
    const box = el("div", "lookup");
    box.appendChild(el("span", "lookup-code", answer.lookup.code));
    const words = el("span", "lookup-words");
    words.appendChild(el("span", "lookup-desc", answer.lookup.desc || ""));
    if (answer.lookup.set) {
      words.appendChild(el("span", "lookup-set", `Verified against ${answer.lookup.set}`));
    }
    box.appendChild(words);
    node.appendChild(box);
  }

  node.appendChild(el("p", "answer-text", answer.text || ""));

  if (Array.isArray(answer.links) && answer.links.length > 0) {
    const links = el("div", "links");
    for (const link of answer.links) {
      const href = safeUrl(link.url);
      if (!href) continue;
      const a = el("a", null, link.title || href);
      a.href = href;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      links.appendChild(a);
    }
    if (links.childNodes.length > 0) node.appendChild(links);
  }

  const meta = el("div", "meta");
  if (answer.domain) meta.appendChild(el("span", "chip", answer.domain));
  if (answer.confidence) {
    meta.appendChild(el("span", `chip ${answer.confidence === "low" ? "warn" : ""}`.trim(),
      `${answer.confidence} confidence`));
  }
  if (answer.tier !== undefined && TIER_LABEL[answer.tier]) {
    meta.appendChild(el("span", answer.tier === 0 ? "chip gold" : "chip", TIER_LABEL[answer.tier]));
  }
  if (answer.live) meta.appendChild(el("span", "chip", "searched the web"));
  if (typeof answer.ms === "number") {
    meta.appendChild(el("span", "chip",
      answer.ms < 1000 ? `${answer.ms}ms` : `${(answer.ms / 1000).toFixed(1)}s`));
  }
  if (answer.source && answer.source.name) {
    meta.appendChild(el("span", "chip",
      answer.source.asOf ? `${answer.source.name}, ${answer.source.asOf}` : answer.source.name));
  }
  node.appendChild(meta);

  if (answer.disclaimer) node.appendChild(el("div", "disclaimer", answer.disclaimer));

  if (Array.isArray(answer.citations) && answer.citations.length > 0) {
    const cites = el("div", "cites", "From: ");
    cites.appendChild(el("span", null, answer.citations.map(c => c.title).join(", ")));
    node.appendChild(cites);
  }

  node.appendChild(actionsFor(answer));
  scrollThread();
}

/** Save, copy, helpful, not helpful. The votes are what feed the SME queue. */
function actionsFor(answer) {
  const row = el("div", "actions");
  const verdict = el("span", "verdict");

  const save = button("action", "Save", async () => {
    const saved = await store.get(SAVED_KEY, []);
    if (saved.some(a => a.id === answer.id)) {
      await store.set(SAVED_KEY, saved.filter(a => a.id !== answer.id));
      save.textContent = "Save";
      save.classList.remove("on");
    } else {
      await store.set(SAVED_KEY, [{ ...answer, savedAt: Date.now() }, ...saved].slice(0, 100));
      save.textContent = "Saved";
      save.classList.add("on");
    }
  }, "Keep this answer in Saved");

  store.get(SAVED_KEY, []).then(saved => {
    if (saved.some(a => a.id === answer.id)) { save.textContent = "Saved"; save.classList.add("on"); }
  });

  const copy = button("action", "Copy", async () => {
    const text = [answer.text, (answer.links || []).map(l => `${l.title}: ${l.url}`).join("\n")]
      .filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1400);
    } catch (_) {
      copy.textContent = "Could not copy";
    }
  }, "Copy the answer");

  const up = button("action vote", "Helpful", () => vote("up"), "Mark this answer helpful");
  const down = button("action vote", "Not helpful", () => vote("down"), "Send this to an expert");

  async function vote(choice) {
    if (!answer.id) return;
    up.disabled = true;
    down.disabled = true;
    const out = await send({ type: "kody:feedback", messageId: answer.id, vote: choice });
    if (!out.ok) {
      verdict.textContent = out.message || "Could not record that.";
      up.disabled = false;
      down.disabled = false;
      return;
    }
    if (choice === "up") {
      up.classList.add("on");
      const credited = out.points && out.points.credited;
      verdict.textContent = credited
        ? `Marked helpful. ${credited} cheer points credited.`
        : "Marked helpful.";
      refreshPoints();
    } else {
      down.classList.add("on");
      verdict.textContent = "Sent to an expert for review. You will be told when it is corrected.";
    }
  }

  row.append(save, copy, up, down);
  const wrap = el("div", "actions-wrap");
  wrap.append(row, verdict);
  return wrap;
}

/* ---------------- asking ---------------- */

function addQuestion(text) {
  $("empty").hidden = true;
  const turn = el("div", "turn");
  turn.appendChild(el("div", "q", text));
  $("thread").appendChild(turn);
  scrollThread();
  return turn;
}

function addPending(turn) {
  const node = el("div", "a", "Thinking...");
  node.dataset.pending = "1";
  turn.appendChild(node);
  scrollThread();
  return node;
}

async function ask(question) {
  const text = String(question || "").trim();
  if (!text || busy) return;
  busy = true;
  $("send").disabled = true;

  const turn = addQuestion(text);
  const pending = addPending(turn);

  const out = await send({ type: "kody:ask", question: text, threadId });

  if (!out.ok) {
    if (out.error === "not_signed_in") {
      pending.textContent = "Sign in to ask Kody.";
      showSignIn(true);
    } else {
      pending.textContent = out.message || "Kody could not answer that just now.";
    }
    busy = false;
    $("send").disabled = false;
    return;
  }

  threadId = out.threadId || threadId;
  const answer = out.answer || {};
  renderAnswer(pending, answer, out.degraded);
  if (answer.lookup && answer.lookup.code) rememberCode(answer.lookup);
  busy = false;
  $("send").disabled = false;
}

/* ---------------- the recent codes strip ---------------- */

async function rememberCode(lookup) {
  const codes = await store.get(CODES_KEY, []);
  const next = [{ code: lookup.code, set: lookup.set || "" },
                ...codes.filter(c => c.code !== lookup.code)].slice(0, 8);
  await store.set(CODES_KEY, next);
  paintCodes(next);
}

function paintCodes(codes) {
  const strip = $("codes");
  clearNode(strip);
  if (!codes || codes.length === 0) { strip.hidden = true; return; }
  strip.hidden = false;
  strip.appendChild(el("span", "codes-label", "Recent codes"));
  for (const entry of codes) {
    const chip = button("code-chip", "", () => {
      $("input").value = $("input").value ? `${$("input").value} ${entry.code}` : entry.code;
      $("input").focus();
    }, `Ask about ${entry.code}`);
    chip.appendChild(el("span", "code", entry.code));
    if (entry.set) chip.appendChild(el("span", "set", entry.set));
    strip.appendChild(chip);
  }
}

/* ---------------- points ---------------- */

async function refreshPoints() {
  const out = await send({ type: "kody:points" });
  if (!out.ok || !out.points) return;
  const wallet = $("points");
  wallet.hidden = false;
  clearNode(wallet);
  wallet.appendChild(el("span", "points-value", Number(out.points.balance || 0).toLocaleString()));
  wallet.appendChild(el("span", "points-label", "cheer points"));
  wallet.title = `${out.points.earnedToday || 0} earned today`;
}

/* ---------------- tabs ---------------- */

function showTab(next) {
  tab = next;
  for (const name of ["ask", "chats", "saved", "history"]) {
    $(`tab-${name}`).classList.toggle("on", name === next);
    $(`panel-${name}`).hidden = name !== next;
  }
  $("composer").hidden = next !== "ask" || !$("signin").hidden;
  $("codes").hidden = next !== "ask" || !$("codes").childNodes.length;
  if (next === "saved") paintSaved();
  if (next === "history") paintHistory();
}

async function paintSaved() {
  const list = $("panel-saved");
  clearNode(list);
  const saved = await store.get(SAVED_KEY, []);
  if (saved.length === 0) {
    list.appendChild(el("p", "hint", "Answers you save appear here. Use Save on any answer to keep it."));
    return;
  }
  for (const answer of saved) {
    const card = el("div", "a");
    renderAnswer(card, answer, answer.degraded);
    list.appendChild(card);
  }
}

async function paintHistory() {
  const list = $("panel-history");
  clearNode(list);
  list.appendChild(el("p", "hint", "Loading your past conversations..."));

  const out = await send({ type: "kody:threads" });
  clearNode(list);
  if (!out.ok) {
    list.appendChild(el("p", "hint", out.error === "not_signed_in"
      ? "Sign in to see your history." : "Could not load your history."));
    return;
  }
  const threads = out.threads || [];
  if (threads.length === 0) {
    list.appendChild(el("p", "hint", "Nothing yet. Ask Kody something and it will appear here."));
    return;
  }
  for (const thread of threads) {
    const row = button("history-row", "", () => openThread(thread.id));
    row.appendChild(el("span", "history-title", thread.title || thread.firstQuestion || "Conversation"));
    const when = thread.updatedAt ? new Date(thread.updatedAt).toLocaleDateString() : "";
    row.appendChild(el("span", "history-when", [thread.lastDomain, when].filter(Boolean).join(" . ")));
    list.appendChild(row);
  }
}

async function openThread(id) {
  const out = await send({ type: "kody:thread", threadId: id });
  if (!out.ok) return;
  threadId = id;
  showTab("ask");
  const pane = $("thread");
  clearNode(pane);
  $("empty").hidden = true;
  pane.appendChild($("empty"));
  for (const message of out.messages || []) {
    if (message.role === "user") {
      addQuestion(message.text || "");
    } else if (message.answer) {
      const turn = $("thread").lastChild && $("thread").lastChild.className === "turn"
        ? $("thread").lastChild
        : $("thread").appendChild(el("div", "turn"));
      const card = el("div", "a");
      turn.appendChild(card);
      renderAnswer(card, message.answer, message.answer.degraded);
    }
  }
  scrollThread();
}

/* ---------------- sign in ---------------- */

function showSignIn(show) {
  $("signin").hidden = !show;
  $("composer").hidden = show || tab !== "ask";
}

function setConnection(on, where) {
  const node = $("conn");
  node.textContent = on ? (where && !where.isProduction ? "connected, local server" : "connected") : "offline";
  node.setAttribute("data-state", on ? "on" : "off");
  if (where) node.title = `${where.apiBase}`;
}

/* ---------------- wiring ---------------- */

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = $("input").value;
  $("input").value = "";
  ask(value);
});

$("input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
});

$("signin-btn").addEventListener("click", async () => {
  const out = await send({ type: "kody:sign-in" });
  if (out.ok) {
    showSignIn(false);
    const where = await send({ type: "kody:endpoints" });
    setConnection(true, where.ok ? where : null);
    refreshPoints();
  }
});

for (const name of ["ask", "chats", "saved", "history"]) {
  $(`tab-${name}`).addEventListener("click", () => showTab(name));
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "kody:signed-out") {
    showSignIn(true);
    setConnection(false);
    $("points").hidden = true;
  }
});

(async () => {
  const status = await send({ type: "kody:status" });
  const where = await send({ type: "kody:endpoints" });
  showSignIn(!status.signedIn);
  setConnection(!!status.signedIn, where.ok ? where : null);
  showTab("ask");
  paintCodes(await store.get(CODES_KEY, []));
  if (status.signedIn) refreshPoints();

  // A selection sent from the bubble or the keyboard shortcut waits here.
  const pending = await send({ type: "kody:take-pending" });
  if (pending.ok && pending.pending && pending.pending.kind === "selection") {
    $("input").value = pending.pending.text;
    $("input").focus();
  }
})();

export { renderAnswer, ask, safeUrl };
