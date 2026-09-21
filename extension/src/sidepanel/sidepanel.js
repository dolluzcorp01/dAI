/**
 * The side panel.
 *
 * This is where answers are rendered, because unlike the content script it
 * runs in the extension's own origin. A page cannot read it, and the
 * extension CSP forbids inline script and remote code.
 *
 * Everything here builds DOM with textContent and createElement. There is no
 * innerHTML anywhere in this file: an answer is model output, and model output
 * is untrusted input like any other.
 */
const $ = (id) => document.getElementById(id);

let threadId = null;
let busy = false;

const send = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: "disconnected" });
      resolve(reply || { ok: false, error: "no_reply" });
    });
  });

/* ---------------- rendering ---------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function addQuestion(text) {
  $("empty").hidden = true;
  const turn = el("div", "turn");
  turn.appendChild(el("div", "q", text));
  $("thread").appendChild(turn);
  $("thread").scrollTop = $("thread").scrollHeight;
  return turn;
}

function addPending(turn) {
  const a = el("div", "a", "Thinking...");
  a.dataset.pending = "1";
  turn.appendChild(a);
  $("thread").scrollTop = $("thread").scrollHeight;
  return a;
}

/**
 * Render an answer. Note what is NOT here: no innerHTML, no dangerous link
 * schemes, and the code description comes from the lookup fields rather than
 * being parsed out of the text.
 */
function renderAnswer(node, answer, degraded) {
  node.textContent = "";
  delete node.dataset.pending;

  if (answer.lookupCode) {
    const head = el("div");
    head.appendChild(el("strong", null, answer.lookupCode));
    if (answer.lookupDescription) {
      head.appendChild(document.createTextNode(` - ${answer.lookupDescription}`));
    }
    node.appendChild(head);
    node.appendChild(el("div", null, answer.body || ""));
  } else {
    node.appendChild(document.createTextNode(answer.body || ""));
  }

  const meta = el("div", "meta");
  if (answer.domain) meta.appendChild(el("span", "chip", answer.domain));
  if (answer.confidence) {
    meta.appendChild(el("span", `chip ${answer.confidence === "low" ? "warn" : ""}`.trim(),
      `${answer.confidence} confidence`));
  }
  if (answer.tier === 0) meta.appendChild(el("span", "chip gold", "from the code set"));
  if (answer.usedWebSearch) meta.appendChild(el("span", "chip", "searched the web"));
  if (answer.sourceName) {
    meta.appendChild(el("span", "chip",
      answer.sourceAsOf ? `${answer.sourceName}, ${answer.sourceAsOf}` : answer.sourceName));
  }
  if (degraded) meta.appendChild(el("span", "chip warn", "degraded"));
  node.appendChild(meta);

  if (answer.disclaimer) node.appendChild(el("div", "disclaimer", answer.disclaimer));

  if (Array.isArray(answer.links) && answer.links.length > 0) {
    const links = el("div", "links");
    for (const l of answer.links) {
      // Only http and https. A model could return javascript: or data:.
      let safe = null;
      try {
        const u = new URL(l.url);
        if (u.protocol === "http:" || u.protocol === "https:") safe = u.toString();
      } catch (_) { /* skip */ }
      if (!safe) continue;
      const a = el("a", null, l.title || safe);
      a.href = safe;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      links.appendChild(a);
    }
    if (links.childNodes.length > 0) node.appendChild(links);
  }

  $("thread").scrollTop = $("thread").scrollHeight;
}

/* ---------------- asking ---------------- */

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
  renderAnswer(pending, out.message || {}, out.degraded);
  busy = false;
  $("send").disabled = false;
}

function showSignIn(show) {
  $("signin").hidden = !show;
  $("composer").hidden = show;
}

/* ---------------- boot ---------------- */

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = $("input").value;
  $("input").value = "";
  ask(value);
});

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("composer").dispatchEvent(new Event("submit"));
  }
});

$("signin-btn").addEventListener("click", async () => {
  const out = await send({ type: "kody:sign-in" });
  if (out.ok) { showSignIn(false); setConnection(true); }
});

function setConnection(on) {
  $("conn").textContent = on ? "connected" : "offline";
  $("conn").setAttribute("data-state", on ? "on" : "off");
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "kody:signed-out") {
    showSignIn(true);
    setConnection(false);
  }
});

(async () => {
  const status = await send({ type: "kody:status" });
  showSignIn(!status.signedIn);
  setConnection(!!status.signedIn);

  // A selection sent from the bubble or the keyboard shortcut waits here.
  const pending = await send({ type: "kody:take-pending" });
  if (pending.ok && pending.pending && pending.pending.kind === "selection") {
    $("input").value = pending.pending.text;
    $("input").focus();
  }
})();

export { renderAnswer, ask };
