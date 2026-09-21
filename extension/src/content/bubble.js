/**
 * The floating bubble.
 *
 * This script runs in the page's world, alongside whatever that site is doing.
 * Three consequences drive every decision here:
 *
 * 1. It never holds a token. Anything needing one goes to the service worker
 *    by message.
 * 2. It never renders answer content. The side panel does. A page could read
 *    anything this script puts in the DOM, and an answer can carry claim
 *    detail.
 * 3. Its styles live in a closed shadow root, so the host page cannot restyle
 *    Kody and Kody cannot break the host page.
 */
(() => {
  "use strict";

  if (window.__kodyBubbleLoaded) return;
  window.__kodyBubbleLoaded = true;

  // Not in a frame, not in a PDF viewer.
  if (window.top !== window.self) return;
  if (document.contentType && document.contentType !== "text/html") return;

  const POS_KEY = "kody_bubble_pos";
  const HIDE_KEY = "kody_bubble_hidden";

  let host = null;
  let dragging = false;
  let moved = false;

  const send = (message) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (reply) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: "disconnected" });
          resolve(reply || { ok: false, error: "no_reply" });
        });
      } catch (_) {
        resolve({ ok: false, error: "disconnected" });
      }
    });

  function build() {
    host = document.createElement("div");
    host.id = "kody-bubble-host";
    // Some sites set aggressive global rules, so pin what matters inline too.
    host.style.cssText = [
      "position:fixed", "z-index:2147483646", "right:20px", "bottom:20px",
      "width:52px", "height:52px", "border:0", "margin:0", "padding:0",
      "background:transparent", "pointer-events:auto",
    ].join(";");

    const root = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .bubble {
        width: 52px; height: 52px; border-radius: 50%;
        background: #111417; border: 1px solid rgba(255,255,255,0.10);
        box-shadow: 0 6px 20px rgba(16,24,40,0.28);
        display: flex; align-items: center; justify-content: center;
        cursor: grab; user-select: none; position: relative;
        transition: transform 140ms ease, box-shadow 140ms ease;
        font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      .bubble:hover { transform: scale(1.06); box-shadow: 0 10px 26px rgba(16,24,40,0.34); }
      .bubble:active { cursor: grabbing; transform: scale(0.98); }
      .bubble img { width: 26px; height: auto; pointer-events: none; }
      .badge {
        position: absolute; top: -2px; right: -2px; min-width: 17px; height: 17px;
        border-radius: 9px; background: #C79A18; color: #fff;
        font-size: 10px; font-weight: 700; line-height: 17px; text-align: center;
        padding: 0 4px; box-sizing: border-box; display: none;
      }
      .badge[data-show="1"] { display: block; }
      .dot {
        position: absolute; bottom: 1px; right: 1px; width: 11px; height: 11px;
        border-radius: 50%; border: 2px solid #111417; background: #98A2B3;
      }
      .dot[data-state="on"] { background: #12B76A; }
      .tip {
        position: absolute; right: 60px; top: 50%; transform: translateY(-50%);
        background: #101828; color: #fff; font-size: 11.5px; white-space: nowrap;
        padding: 5px 9px; border-radius: 7px; opacity: 0; pointer-events: none;
        transition: opacity 120ms;
      }
      .bubble:hover .tip { opacity: 1; }
      @media (prefers-reduced-motion: reduce) { .bubble, .tip { transition: none; } }
    `;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.setAttribute("role", "button");
    bubble.setAttribute("tabindex", "0");
    bubble.setAttribute("aria-label", "Open Kody");

    const img = document.createElement("img");
    img.alt = "";
    img.src = chrome.runtime.getURL("icons/icon-32.png");

    const badge = document.createElement("span");
    badge.className = "badge";

    const dot = document.createElement("span");
    dot.className = "dot";

    const tip = document.createElement("span");
    tip.className = "tip";
    tip.textContent = "Kody";

    bubble.append(img, badge, dot, tip);
    root.append(style, bubble);
    document.documentElement.appendChild(host);

    wire(bubble, badge, dot);
  }

  function wire(bubble, badge, dot) {
    let startX = 0, startY = 0, originX = 0, originY = 0;

    const onMove = (e) => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - startX;
      const dy = p.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      if (e.cancelable) e.preventDefault();
      const x = Math.min(Math.max(originX + dx, 4), window.innerWidth - 56);
      const y = Math.min(Math.max(originY + dy, 4), window.innerHeight - 56);
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
    };

    const onUp = async () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
      if (!dragging) return;
      dragging = false;
      if (moved) {
        try {
          const rect = host.getBoundingClientRect();
          await chrome.storage.local.set({ [POS_KEY]: { left: rect.left, top: rect.top } });
        } catch (_) { /* storage may be unavailable */ }
      }
    };

    const onDown = (e) => {
      dragging = true;
      moved = false;
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX; startY = p.clientY;
      const rect = host.getBoundingClientRect();
      originX = rect.left; originY = rect.top;
      document.addEventListener("mousemove", onMove, { passive: false });
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onUp);
    };

    bubble.addEventListener("mousedown", onDown);
    bubble.addEventListener("touchstart", onDown, { passive: true });

    const open = async () => {
      if (moved) { moved = false; return; }   // a drag is not a click
      const selection = String(window.getSelection() || "").trim().slice(0, 2000);
      await send({
        type: "kody:open-panel",
        payload: selection ? { kind: "selection", text: selection } : null,
      });
    };

    bubble.addEventListener("click", open);
    bubble.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    const paint = async () => {
      const status = await send({ type: "kody:status" });
      const on = !!(status && status.signedIn);
      dot.setAttribute("data-state", on ? "on" : "off");
      bubble.setAttribute("aria-label", on ? "Open Kody" : "Sign in to Kody");
    };
    paint();

    chrome.runtime.onMessage.addListener((message) => {
      if (!message) return;
      if (message.type === "kody:unread") {
        const n = Number(message.count || 0);
        badge.textContent = n > 99 ? "99+" : String(n);
        badge.setAttribute("data-show", n > 0 ? "1" : "0");
      }
      if (message.type === "kody:signed-out" || message.type === "kody:signed-in") paint();
    });
  }

  async function restore() {
    try {
      const stored = await chrome.storage.local.get([POS_KEY, HIDE_KEY]);
      if (stored[HIDE_KEY]) return false;
      const pos = stored[POS_KEY];
      if (pos && host) {
        const left = Math.min(Math.max(pos.left, 4), window.innerWidth - 56);
        const top = Math.min(Math.max(pos.top, 4), window.innerHeight - 56);
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
        host.style.right = "auto";
        host.style.bottom = "auto";
      }
      return true;
    } catch (_) {
      return true;
    }
  }

  const start = async () => {
    build();
    const visible = await restore();
    if (!visible && host) host.remove();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
