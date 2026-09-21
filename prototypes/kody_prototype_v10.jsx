import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles, Users, Bookmark, Send, Search, Settings, Minus, Plus,
  Maximize2, Minimize2, ThumbsUp, ThumbsDown, Share2, Copy,
  Link2, ChevronRight, Check, ArrowLeft, Stethoscope, Shield,
  Code, ClipboardList, Globe, Mic, Smile, Paperclip, X, Upload,
  FileText, Bell, Clock, Hash, Crop, Monitor, Video, Square,
  Award, Trash2, Command, ExternalLink, Mail, MessageCircle, Power, Lightbulb,
  CheckCheck, AlertCircle, Reply, CornerUpRight, Pencil, Trash, Pin,
  Wifi, WifiOff, Download, PlayCircle, Lock, MessageSquare,
  ShieldCheck, CalendarClock, FolderOpen, Settings2, Compass, BellRing
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Kody - UI freeze prototype v3                                      */
/*  Mock data only, no backend, no browser storage.                    */
/*  v3 adds: keyboard summon, select and ask, slash commands,          */
/*  @kody in rooms, cheer points, flash notifications, snip tools,     */
/*  custom quick links, groups and channels, recent codes, history,    */
/*  first-run tour.                                                    */
/* ------------------------------------------------------------------ */

const DOLLUZ_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAAA4CAMAAABpEU60AAAAwFBMVEXTrzLyzzXcsTTz0Tb41jfYtDPOqjK5pzN9fAi5ki6kdiqmci//fwD/qlX/AAD+6zy1ji3//3GXZiiqqlWZayh/Py+uhC0/PwAA/wB/f3+qVVX///8AAADrxzb51jfatjPhvTTNqTH//wDMqDH+5Duxhi3ZtTPYtDL41TfsyTXsyDXsyTXZtjPqxjWYZyjNqTEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADhyVYTAAAAMHRSTlNgGQ9cn5XbDgL18RACAwHtZgKaA2UEtQQBAgMBAPz5+fv4AS38/NKs0KnPbi+S+7W/F7vIAAAF7UlEQVR42p1Xi3ajOAy1DQZSyKvpzL5kAzYNj8Dw/3+3Vyak6W4yc6Y6bQJ6XF3JNijCK9rSjhw9l6zYPTc6BG9JeaGSlIpUQOGeea4fj2yORFpQmnhBc5JTnvgse5pU+W9PyWY+2QJnJuF8CU7zTCev3F0Jzl2/VFLXib/dfnjsnPInjkyT0mdCk6hq70tBQpBaUVSObOlxRymJuq5hTWl3TME6VyuW4ghRelVXgrSo+aYUc5n6OqX8o54F9KhmMJpntXBR6uaQU1r7tJw5GtmEBpwvy7k8q/mcIjG30AvwmIVXR/J1ySJoi5WZ60QIH1qPpOcZRc1l6VGUxqpVGlVW8Bfns6eicKRqU9XwqFufOa/nBG7Ot3CZ69LUilxRkD+fQaaukF1XiWI6JhF/tIykz6CH2n2d1CW3phUpuWSeE0VKtEEF08i9FNVZM077hzgbJjUC2pStF1yAbk3r6Zh6UueSgdDZEfoK5ah20ZBPUTAcdSjZt6VBIaOYNeW6NKVgJJTK7QArTlOyixNn9t/5q0JwF9lLV6wXCNUorhW+0oGUObfsiAJMq4pRC1wBY8zGkNiNJVrSCqF9oVqUIBi35biRRl2NWDloR2bAlorzm5H+4QUWwNfEmauWNNgxV/qLI4DKhAAj1IjcgDmibQaNEyKBQY/soLAZU6nQhapUGmGmHXGpWyVTbErFCUfWYzNggQyWKOUk0BlTJW1SVZzItDjOvOFaU34SGLhBWzaAOrwRglD0BvSVwFoqzQr4Wg3Q5ago0qHYBSQUoq8GgWBtQ2mmmjgeMNvWYLuN4FiBzCQuFYCYkcoABF1V8QdfGZ2pwEiY6iImtvaXCP3Vpt0Kl/bWArgCy8oMSIZeb4O/tgwCNf9BbH81SDiJAe4IQinW9kfHPZLTgBvLPK0ZBxtx4sLJZDIsVl9suJgG6QqmGtlhNJa7wWHDJLlHy1GWMrr0wXkySCydkyT6BegiKRoWm1gsvWU/CCqTckHAM1alAWZYosDOBJvqFx6mk3KxIUV4iqCyYboEzRCgFE6ScHJihk0TajN2iIwFCXkZrjjGTtHtcmALHKLFusZN0glHMpr6YeinpTbmxLYr7gqBy/Xe2pVPf1kiI0lO3J54MrYrW2vsWkvf2IBhh7VSGNc+2FjewgG0w5NYRbFdi7OXy3WZLJJ1jBv1HQhflWxeC7Mx2FC2C0BOMgqK7TsbpLPxtFyhyEvXRVFne1bzatsptqtfH8KA5W5AkAi1fZKru23iuPmP6irxGulu+4h71DXNZzf8dR2CocdXFwfVnTRN96lH2PRSyajZg+QdVBN3DQKjKLIdf9i46eJ7OxqybyKEbm9ArpDxHgzlB6cGQBH33zZ7KffhwkYAuvPAPkaYLBzdHxH+aPY3TnEnY2lD2L6z+xBoWRXf+OwbuUbSXY8KFdl9RNG+Q0UxYrhrvIBMAx3lNiGGoVBjF1xtpIpPPQrTgYwinKTOyqGRgJF0QfaeyUUxr1aP2wjqHh3opO1482G93H+AsC/5oMohIjPh2xHaO4Qdvmxt/GNXRdgsiiaD54FUn+amDyDaHh1XLCM2y4t5KHimwIztDE933NIjoNuAdioEDtP9s/HjGkdRFKcHI5z4P84RL5zw3DfJeL69SPAiTIJS42V1/D+SeDDO/Rne0pCR7t9GPP2wnIV7MCaKh0PjOGIgwVAneAC5CmYCjCW1H0f1KEY8G0BrDFsKk9VNZtwKX+dPAh4DFac0TB08iK6SMJFUuFNBv8MIIAef6nqTXGVT69Qf1FP3p0Dp6QA6mzsBqcMp/W2gUMfhHugg0p84PwXKDxhxN5v3m2w2UBzy3wU60eH9PXn//gH0HbfvBxh+k5Gjw+b72z2jt++bw/NfUT/rEeUv7y83eX/J6Ss9oiz/hBOQ8uwLQDm9IfT15UeQl1fAvlH+FUb0+opfcj+uklP2+kpfYcScGO1lIcQY+Zd6xCu322VXSnmW7Rx9ESgL/wFp6Y77KiOWv+mNcb79yu+XQIBAk3+JQ/8CphiVXfJfmTAAAAAASUVORK5CYII=";

const ACCENTS = {
  gold:   { key: "gold",   name: "Dolluz gold", base: "#C79A18", soft: "#FBF3DC", deep: "#9A7710" },
  teal:   { key: "teal",   name: "Teal",        base: "#0F9E8E", soft: "#E6F5F3", deep: "#0A7A6D" },
  indigo: { key: "indigo", name: "Indigo",      base: "#4C5FD5", soft: "#EBEDFC", deep: "#3A49AE" },
  plum:   { key: "plum",   name: "Plum",        base: "#8B4A9C", soft: "#F5EAF7", deep: "#6E3A7C" },
};

const INK = "#101828";
const MUTED = "#667085";
const HAIRLINE = "#E4E7EC";
const CANVAS = "#FBFBFC";
const GREEN = "#12B76A";
const RED = "#F04438";
const BLUE = "#2E90FA";
const YELLOW = "#F79009";

const DOMAINS = {
  rcm:     { label: "Healthcare RCM", Icon: Stethoscope,   tint: "#0F9E8E" },
  agile:   { label: "Agile / PM",     Icon: ClipboardList, tint: "#4C5FD5" },
  cyber:   { label: "Cybersecurity",  Icon: Shield,        tint: "#B54708" },
  dev:     { label: "Development",    Icon: Code,          tint: "#6941C6" },
  general: { label: "General",        Icon: Globe,         tint: "#667085" },
};

/* Cheer points economics - tune here, nowhere else */
const POINTS = {
  perCent: 1000,        // points required for 1 cent
  showCash: false,      // when false the wallet shows a tier instead of cents
  dailyCap: 500,        // maximum points earnable per day
  earn: {
    helpful:     { pts: 25,  label: "Marked an answer helpful" },
    adopted:     { pts: 50,  label: "Answer adopted by a colleague" },
    smeAccepted: { pts: 100, label: "SME correction accepted" },
  },
  tiers: [
    { at: 0,     name: "Starter" },
    { at: 500,   name: "Contributor" },
    { at: 2000,  name: "Regular" },
    { at: 5000,  name: "Trusted" },
    { at: 15000, name: "Champion" },
  ],
};
const tierFor = (p) => POINTS.tiers.reduce((acc, t) => (p >= t.at ? t : acc), POINTS.tiers[0]);
const nextTier = (p) => POINTS.tiers.find(t => t.at > p) || null;

const TIERS = {
  0: { label: "Lookup", note: "no model call", color: "#0F9E8E" },
  1: { label: "Fast",   note: "small model",   color: "#2E90FA" },
  2: { label: "Standard", note: "retrieval",   color: "#6941C6" },
  3: { label: "Deep",   note: "reasoning",     color: "#B54708" },
};

/* Tier 0 - answered from a local table, no model, sub-millisecond */
const CODE_TABLE = {
  "CO-97": { set: "CARC", desc: "Benefit included in payment for another service already adjudicated", note: "The payer considers this service bundled. Check the primary procedure on the remittance before adjusting anything." },
  "CO-45": { set: "CARC", desc: "Charge exceeds fee schedule or contracted amount", note: "Contractual adjustment. Write off to the fee schedule, do not bill the patient for this portion." },
  "CO-16": { set: "CARC", desc: "Claim lacks information needed for adjudication", note: "Look for the accompanying RARC, which names the missing element. Correct and resubmit." },
  "PR-1":  { set: "CARC", desc: "Deductible amount", note: "Patient responsibility. Bill the patient once you confirm the deductible was applied correctly." },
  "PR-2":  { set: "CARC", desc: "Coinsurance amount", note: "Patient responsibility after the plan pays its share." },
  "D0140": { set: "CDT",  desc: "Limited oral evaluation - problem focused", note: "Used for a problem focused evaluation, typically an emergency or specific complaint." },
  "D0120": { set: "CDT",  desc: "Periodic oral evaluation - established patient", note: "Routine recall exam for a patient of record." },
  "97110": { set: "CPT",  desc: "Therapeutic exercise, each 15 minutes", note: "Time based code. Document the exact minutes to support the units billed." },
  "99213": { set: "CPT",  desc: "Office visit, established patient, low complexity", note: "Level selection is driven by medical decision making or total time." },
  "M54.5": { set: "ICD-10-CM", desc: "Low back pain", note: "As of the 2022 update this expanded into M54.50, M54.51 and M54.59. Use the specific code." },
};

/* Wallpapers - pure CSS so nothing is fetched and nothing can fail to load */
const WALLPAPERS = {
  none:   { name: "None",   css: CANVAS },
  paper:  { name: "Paper",  css: "linear-gradient(180deg, #FFFDF7 0%, #F6F2E8 100%)" },
  dusk:   { name: "Dusk",   css: "linear-gradient(180deg, #F2F4FB 0%, #E7EBF7 100%)" },
  mint:   { name: "Mint",   css: "linear-gradient(180deg, #F3FBF8 0%, #E6F4EE 100%)" },
  slate:  { name: "Slate",  css: "linear-gradient(180deg, #F7F8FA 0%, #ECEEF2 100%)" },
  sand:   { name: "Sand",   css: "linear-gradient(160deg, #FDF6EC 0%, #F7EAD6 100%)" },
};

const AVATARS = [
  { key: "mark", label: "Dolluz mark", logo: true },
  { key: "m1",   label: "Male, young",   glyph: "\u{1F468}" },
  { key: "m2",   label: "Male, mid",     glyph: "\u{1F9D4}" },
  { key: "f1",   label: "Female, young", glyph: "\u{1F469}" },
  { key: "f2",   label: "Female, mid",   glyph: "\u{1F469}\u200D\u{1F9B3}" },
];

const STATUSES = {
  online:  { label: "Online",          color: GREEN },
  away:    { label: "Away",            color: YELLOW },
  busy:    { label: "Busy",            color: RED },
  dnd:     { label: "Do not disturb",  color: "#B42318" },
  offline: { label: "Offline",         color: "#D0D5DD" },
};

const PEOPLE = [
  { id: 1, name: "Pavithran R",   role: "Full-stack developer", status: "online",  initials: "PR" },
  { id: 2, name: "Vignesh Naidu", role: "SOC analyst",          status: "online",  initials: "VN" },
  { id: 3, name: "Diksha Negi",   role: "AD & database audit",  status: "busy",    initials: "DN" },
  { id: 4, name: "Anil Kumar",    role: "Delivery lead",        status: "away",    initials: "AK" },
  { id: 5, name: "Manasi Rao",    role: "AR team lead",         status: "dnd",     initials: "MR" },
  { id: 6, name: "Gopi Krishnan", role: "Reimbursement audit",  status: "offline", initials: "GK" },
];

const SEED_GROUPS = [
  { id: "g1", name: "AR escalations", members: [0, 1, 5, 6], owners: [0], unread: 2,
    topic: "Anything that needs a supervisor", notif: "all", retention: "1y" },
  { id: "g2", name: "Sprint 24 crew", members: [0, 1, 4], owners: [4], unread: 0,
    topic: "Delivery for the current sprint", notif: "mentions", retention: "forever" },
];
const SEED_CHANNELS = [
  { id: "c1", name: "denials-help", members: [0, 1, 2, 3, 4, 5, 6], owners: [5], unread: 5,
    topic: "Ask anything about denials and appeals", purpose: "Shared denial handling knowledge",
    private: false, notif: "all", retention: "1y", isDefault: true, favourite: true },
  { id: "c2", name: "coding-queries", members: [0, 5, 6], owners: [6], unread: 0,
    topic: "CPT, CDT, ICD and HCPCS questions", private: false, notif: "mentions", retention: "1y" },
  { id: "c3", name: "security-alerts", members: [2, 3], owners: [2], unread: 0,
    topic: "SOC notices and advisories", private: false, notif: "all",
    announcement: true, retention: "90d" },
  { id: "c4", name: "leadership", members: [4], owners: [4], unread: 0,
    topic: "Private leadership channel", private: true, notif: "all", retention: "forever" },
  { id: "c5", name: "payer-updates", members: [0, 5], owners: [5], unread: 0,
    topic: "Policy changes by payer", private: false, notif: "all", retention: "1y", archived: true },
];

const EMOJIS = ["\u{1F44D}","\u{1F64F}","\u{1F525}","\u2705","\u{1F44F}","\u{1F440}","\u{1F914}","\u{1F642}",
  "\u{1F605}","\u{1F62E}","\u{1F389}","\u26A0\uFE0F","\u{1F4CC}","\u{1F4A1}","\u{1F680}","\u2764\uFE0F",
  "\u{1F44C}","\u{1F91D}","\u{1F4C8}","\u23F0","\u{1F9E0}","\u{1F4DD}","\u{1F50D}","\u{1F6A8}"];

const KODY_LINKS = [
  { label: "CMS ICD-10 lookup",  host: "cms.gov" },
  { label: "X12 denial codes",   host: "x12.org" },
  { label: "Dolluz SOP library", host: "internal" },
];

const SLASH = [
  { cmd: "/denial", hint: "Explain a denial code",       fill: "Explain denial code " },
  { cmd: "/code",   hint: "Find a procedure code",       fill: "Which code applies to " },
  { cmd: "/appeal", hint: "Draft an appeal letter",      fill: "Draft an appeal for " },
  { cmd: "/explain",hint: "Explain in plain English",    fill: "Explain in plain English: " },
  { cmd: "/sop",    hint: "Search the Dolluz SOP library", fill: "Find the SOP for " },
];

const SEED_NOTIFS = [
  { id: "n1", kind: "update",  text: "Kody 3.0 is live. Groups and channels are now available.", ts: "just now", unread: true },
  { id: "n2", kind: "feature", text: "New: select any text on screen and ask Kody about it.",     ts: "2h ago",   unread: true },
  { id: "n3", kind: "highlight", text: "UHC timely filing window changed. Review the updated SOP.", ts: "yesterday", unread: false },
];
const NOTIF_STYLE = {
  update:    { color: RED,    label: "Update" },
  feature:   { color: BLUE,   label: "New feature" },
  highlight: { color: YELLOW, label: "Highlight" },
};

const SEED_HISTORY = [
  { id: "h1", title: "Timely filing window for Aetna", when: "Yesterday", domain: "rcm" },
  { id: "h2", title: "Story point estimation for spikes", when: "Yesterday", domain: "agile" },
  { id: "h3", title: "Phishing report triage steps", when: "3 Sep", domain: "cyber" },
  { id: "h4", title: "Node retry pattern for flaky APIs", when: "2 Sep", domain: "dev" },
];

const seedThread = [
  { id: "m1", side: "user", ts: "10:42",
    text: "Patient had a limited oral evaluation, problem focused. Which code fits?" },
  { id: "m2", side: "kody", ts: "10:42", domain: "rcm",
    text: "Limited oral evaluation, problem focused, is normally reported with D0140.",
    lookup: { code: "D0140", desc: "Limited oral evaluation - problem focused", set: "CDT" },
    confidence: "high",
    source: { name: "CDT code set", asOf: "Jan 2026" },
    disclaimer: "Verify against clinical documentation and the payer's current policy before submission." },
];

const TOUR = [
  { title: "This is Kody", body: "Drag the bubble anywhere on screen. Click it to open, or press Ctrl+Shift+K from anywhere." },
  { title: "Ask in your own words", body: "Type a question, or press / for shortcuts like /denial and /appeal." },
  { title: "Select text and ask", body: "Highlight anything on the page behind Kody. A chip appears - click it and the text comes straight here." },
  { title: "Work with your team", body: "Chats holds direct messages, groups and channels. Type @kody in any of them to bring an answer into the conversation." },
];

/* ------------------------------------------------------------------ */

function Logo({ size = 18, style }) {
  return <img src={DOLLUZ_LOGO} alt="Dolluz Corp"
    style={{ height: size, width: "auto", display: "block", flexShrink: 0, ...style }} />;
}

function Avatar({ initials, size = 28, tint, glyph, logo, square, photo }) {
  if (photo) {
    return <img src={photo} alt="Kody avatar" style={{
      width: size, height: size, borderRadius: square ? 8 : "50%",
      objectFit: "cover", flexShrink: 0, display: "block",
    }} />;
  }
  if (logo) {
    return <div style={{
      width: size, height: size, borderRadius: "50%", background: "#1A1A1A",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}><Logo size={size * 0.66} /></div>;
  }
  return <div style={{
    width: size, height: size, borderRadius: square ? 8 : "50%",
    background: tint || "#EEF1F5", color: tint ? "#fff" : INK,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: glyph ? size * 0.55 : size * 0.36, fontWeight: 600,
    flexShrink: 0, overflow: "hidden",
  }}>{glyph || initials}</div>;
}

function Dot({ color, size = 8, ring = true }) {
  return <span style={{
    width: size, height: size, borderRadius: "50%", background: color,
    display: "inline-block", flexShrink: 0,
    boxShadow: ring ? "0 0 0 2px #fff" : "none",
  }} />;
}

function IconBtn({ children, onClick, active, accent, title, activeColor, badge }) {
  const [hover, setHover] = useState(false);
  const col = active ? (activeColor || accent.base) : MUTED;
  const bg = active ? (activeColor ? activeColor + "1A" : accent.soft) : hover ? "#F2F4F7" : "transparent";
  return (
    <button onClick={onClick} title={title} aria-label={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, borderRadius: 6, border: "none", cursor: "pointer",
        background: bg, color: col, transition: "background 120ms, color 120ms", flexShrink: 0,
      }}>
      {children}
      {badge && <span style={{
        position: "absolute", top: 2, right: 2, width: 7, height: 7,
        borderRadius: "50%", background: badge, border: "1.5px solid #fff",
      }} />}
    </button>
  );
}

function FileChip({ name, onRemove, accent, compact }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: compact ? "4px 8px" : "6px 9px", borderRadius: 7,
      background: compact ? "rgba(255,255,255,0.18)" : "#F4F5F7",
      border: compact ? "none" : `1px solid ${HAIRLINE}`, maxWidth: "100%",
    }}>
      <FileText size={13} color={compact ? "#fff" : accent.base} style={{ flexShrink: 0 }} />
      <span style={{
        fontSize: 11.5, color: compact ? "#fff" : INK, whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis",
      }}>{name}</span>
      {onRemove && <button onClick={onRemove} aria-label="Remove attachment" style={{
        border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", color: MUTED,
      }}><X size={12} /></button>}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{children}</div>;
}

/* ------------------------------------------------------------------ */

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;
const URL_TEST = /^https?:\/\/[^\s<>"')\]]+$/;

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "link"; }
}

/* Turns any bare URL left in the prose into a real anchor */
function Linkified({ text, accent }) {
  const parts = String(text || "").split(URL_RE);
  return (
    <>{parts.map((p, i) =>
      URL_TEST.test(p)
        ? <a key={i} href={p} target="_blank" rel="noopener noreferrer"
            style={{ color: accent.deep, textDecoration: "underline", wordBreak: "break-all" }}>{p}</a>
        : <span key={i}>{p}</span>
    )}</>
  );
}

function LinkList({ links, accent }) {
  if (!links || links.length === 0) return null;
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
            border: `1px solid ${HAIRLINE}`, borderRadius: 9, textDecoration: "none",
            background: "#fff",
          }}>
          <span style={{
            width: 22, height: 22, borderRadius: 6, background: accent.soft, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><ExternalLink size={12} color={accent.base} /></span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{
              display: "block", fontSize: 12.5, color: INK, lineHeight: 1.3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{l.title}</span>
            <span style={{ display: "block", fontSize: 10.5, color: MUTED, marginTop: 1 }}>{hostOf(l.url)}</span>
          </span>
          <ChevronRight size={14} color={MUTED} style={{ flexShrink: 0 }} />
        </a>
      ))}
    </div>
  );
}

function AnswerCard({ msg, accent, saved, onSave, onShare, onVoteUp, inRoom }) {
  const [vote, setVote] = useState(null);
  const [copied, setCopied] = useState(false);
  const d = DOMAINS[msg.domain] || DOMAINS.general;
  const DIcon = d.Icon;

  const up = () => {
    const next = vote === "up" ? null : "up";
    setVote(next);
    if (next === "up") onVoteUp?.();
  };

  return (
    <div style={{
      background: "#fff", border: `1px solid ${HAIRLINE}`, borderRadius: 12,
      overflow: "hidden", boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "7px 11px",
        borderBottom: `1px solid ${HAIRLINE}`, background: "#FCFCFD",
      }}>
        {inRoom
          ? <><Sparkles size={12} color={accent.base} />
              <span style={{ fontSize: 11.5, fontWeight: 600, color: accent.base }}>Kody answered here</span></>
          : <><DIcon size={13} color={d.tint} strokeWidth={2.2} />
              <span style={{ fontSize: 11.5, fontWeight: 600, color: d.tint }}>{d.label}</span></>}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
          {msg.tier !== undefined && TIERS[msg.tier] && (
            <span title={`Tier ${msg.tier} - ${TIERS[msg.tier].note}`} style={{
              fontSize: 10, fontWeight: 600, color: TIERS[msg.tier].color,
              background: TIERS[msg.tier].color + "14", borderRadius: 5, padding: "1px 5px",
            }}>T{msg.tier} {TIERS[msg.tier].label}</span>
          )}
          {msg.live && <span title="Answered with live web search" style={{
            fontSize: 10, fontWeight: 600, color: BLUE, background: BLUE + "14",
            borderRadius: 5, padding: "1px 5px",
          }}>Live</span>}
          {msg.ms !== undefined && <span style={{
            fontSize: 10, color: MUTED, fontVariantNumeric: "tabular-nums",
          }}>{msg.ms < 1000 ? `${msg.ms}ms` : `${(msg.ms / 1000).toFixed(1)}s`}</span>}
          <span style={{ fontSize: 11, color: MUTED }}>{msg.ts}</span>
        </span>
      </div>

      {msg.degraded && (
        <div style={{
          padding: "6px 12px", fontSize: 11, color: "#B54708", background: "#FFFAEB",
          borderBottom: `1px solid ${HAIRLINE}`,
        }}>Degraded answer. Kody could not reach the answer service.</div>
      )}

      <div style={{ padding: "11px 12px 4px" }}>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: INK }}>
          <Linkified text={msg.text} accent={accent} />
        </p>

        <LinkList links={msg.links} accent={accent} />

        {msg.lookup && (
          <div style={{
            marginTop: 10, display: "flex", alignItems: "center", gap: 10,
            padding: "9px 11px", borderRadius: 9,
            background: accent.soft, border: `1px solid ${accent.base}33`,
          }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: accent.deep,
              fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em",
            }}>{msg.lookup.code}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: INK, lineHeight: 1.35 }}>{msg.lookup.desc}</div>
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>Verified against {msg.lookup.set}</div>
            </div>
            <Check size={15} color={accent.base} strokeWidth={2.6} style={{ marginLeft: "auto", flexShrink: 0 }} />
          </div>
        )}

        {msg.confidence && (
          <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 11, color: MUTED }}>Confidence</span>
            <div style={{ display: "flex", gap: 2.5 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 15, height: 3.5, borderRadius: 2,
                  background: i < ({ high: 3, medium: 2, low: 1 }[msg.confidence]) ? accent.base : "#E7EAEE",
                }} />
              ))}
            </div>
            <span style={{ fontSize: 11, color: INK, textTransform: "capitalize" }}>{msg.confidence}</span>
            {msg.source && <span style={{ marginLeft: "auto", fontSize: 10.5, color: MUTED }}>
              {msg.source.name} &middot; {msg.source.asOf}
            </span>}
          </div>
        )}

        {msg.disclaimer && (
          <p style={{
            margin: "9px 0 0", fontSize: 11, lineHeight: 1.45, color: MUTED,
            paddingLeft: 8, borderLeft: `2px solid ${HAIRLINE}`,
          }}>{msg.disclaimer}</p>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "4px 7px 7px" }}>
        <IconBtn active={saved} accent={accent} onClick={onSave} title={saved ? "Saved" : "Save"}>
          <Bookmark size={14} fill={saved ? accent.base : "none"} />
        </IconBtn>
        <IconBtn accent={accent} onClick={onShare} title="Share with a colleague"><Share2 size={14} /></IconBtn>
        <IconBtn accent={accent} active={copied} activeColor={GREEN}
          onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }} title="Copy">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconBtn>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <IconBtn accent={accent} active={vote === "up"} activeColor={GREEN} onClick={up} title="Helpful">
            <ThumbsUp size={14} fill={vote === "up" ? GREEN : "none"} />
          </IconBtn>
          <IconBtn accent={accent} active={vote === "down"} activeColor={RED}
            onClick={() => setVote(vote === "down" ? null : "down")} title="Not helpful">
            <ThumbsDown size={14} fill={vote === "down" ? RED : "none"} />
          </IconBtn>
        </div>
      </div>

      {vote === "up" && <div style={{
        padding: "7px 12px", fontSize: 11, color: "#05603A",
        background: "#F0FDF4", borderTop: `1px solid ${HAIRLINE}`,
      }}>Marked helpful. {POINTS.earn.helpful.pts} cheer points credited.</div>}
      {vote === "down" && <div style={{
        padding: "7px 12px", fontSize: 11, color: "#B42318",
        background: "#FFFBFA", borderTop: `1px solid ${HAIRLINE}`,
      }}>Sent to an SME for review. You will be notified when it is corrected.</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */


/* Seeded conversations so the surface is not empty on first open */
const CHAT_SEED = {
  "dm:1": [
    { id: "s1", convo: "dm:1", from: 1, text: "Morning. Did the CO-97 batch get reworked?", ts: Date.now()-5400000, state: "read", reactions: {}, files: [] },
    { id: "s2", convo: "dm:1", from: 0, text: "Half of them. The **out of network** ones are still open.", ts: Date.now()-5300000, state: "read", reactions: {"\u{1F44D}":[1]}, files: [] },
    { id: "s3", convo: "dm:1", from: 1, text: "Send me the list when you can.", ts: Date.now()-900000, state: "delivered", reactions: {}, files: [] },
  ],
  "channel:c1": [
    { id: "s4", convo: "channel:c1", from: 5, text: "Reminder: use `write-off Estimate correction` for overpayments, not plan interpretation.", ts: Date.now()-7200000, state: "read", reactions: {"\u2705":[1,2]}, files: [] },
    { id: "s5", convo: "channel:c1", from: 2, text: "@here the payer portal is slow this morning.", ts: Date.now()-600000, state: "delivered", reactions: {}, files: [] },
  ],
  "group:g1": [
    { id: "s6", convo: "group:g1", from: 4, text: "Standup in 10.", ts: Date.now()-3600000, state: "read", reactions: {}, files: [] },
  ],
};

/* ==================================================================
   KODY CHAT ENGINE - v9
   A simulated realtime layer. Everything below the SEAM comment is
   what Pavithran replaces with a real Socket.IO client. The React
   code above it never changes.
   ================================================================== */

const MAX_FILE_MB = 25;

/* ---------- SEAM: swap this module for a real socket client ---------- */
function createKodySocket() {
  const listeners = {};
  let connected = true;
  let seq = 1000;
  let timers = [];

  const emit = (evt, payload) => (listeners[evt] || []).forEach(fn => fn(payload));
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };

  const PEER_REPLIES = [
    "Got it, checking now.",
    "That one needs the payer's bundling policy. I will pull it up.",
    "Agreed. Route it to the OON queue rather than writing it off.",
    "Can you forward the remittance?",
    "Thanks, that saves me a call.",
  ];

  return {
    isConnected: () => connected,
    on(evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      return () => { listeners[evt] = listeners[evt].filter(f => f !== fn); };
    },
    setConnected(v) {
      connected = v;
      emit("status", v ? "connected" : "disconnected");
      if (v) emit("resync", null);
    },
    nextSeq: () => ++seq,
    /* server acknowledges, then the recipient's client delivers, then they read it */
    send(msg, { onAck, onDelivered, onRead, peer }) {
      if (!connected) return false;
      later(() => onAck(this.nextSeq()), 320);
      later(() => onDelivered(), 900);
      if (peer && peer.status === "online") {
        later(() => onRead(), 2200);
        later(() => emit("typing", { convo: msg.convo, who: peer.id, on: true }), 2600);
        later(() => {
          emit("typing", { convo: msg.convo, who: peer.id, on: false });
          emit("message", {
            id: "r" + Date.now() + Math.random().toString(36).slice(2, 6),
            convo: msg.convo, from: peer.id, seq: this.nextSeq(),
            text: PEER_REPLIES[Math.floor(Math.random() * PEER_REPLIES.length)],
            ts: Date.now(), state: "delivered", reactions: {}, files: [],
          });
        }, 4200);
      }
      return true;
    },
    dispose() { timers.forEach(clearTimeout); timers = []; },
  };
}
/* ---------- end SEAM ---------- */

/* Markdown-lite. Deliberately tiny: bold, italic, inline code, strike, links. */
function RichText({ text, mentionsMe, accent, onMention }) {
  const lines = String(text || "").split("\n");
  const inline = (s, keyBase) => {
    const out = [];
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|~~[^~]+~~|@[A-Za-z][\w.-]*|https?:\/\/[^\s]+)/g;
    let last = 0, m, i = 0;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) out.push(<span key={keyBase + "t" + i++}>{s.slice(last, m.index)}</span>);
      const tok = m[0];
      if (tok.startsWith("**")) out.push(<strong key={keyBase + "b" + i++}>{tok.slice(2, -2)}</strong>);
      else if (tok.startsWith("~~")) out.push(<s key={keyBase + "s" + i++}>{tok.slice(2, -2)}</s>);
      else if (tok.startsWith("`")) out.push(
        <code key={keyBase + "c" + i++} style={{
          background: "rgba(16,24,40,0.08)", borderRadius: 4, padding: "1px 4px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.92em",
        }}>{tok.slice(1, -1)}</code>);
      else if (tok.startsWith("*")) out.push(<em key={keyBase + "i" + i++}>{tok.slice(1, -1)}</em>);
      else if (tok.startsWith("http")) out.push(
        <a key={keyBase + "l" + i++} href={tok} target="_blank" rel="noopener noreferrer"
          style={{ color: "inherit", textDecoration: "underline", wordBreak: "break-all" }}>{tok}</a>);
      else out.push(
        <span key={keyBase + "m" + i++} onClick={() => onMention && onMention(tok)} style={{
          background: mentionsMe ? "rgba(247,144,9,0.22)" : "rgba(16,24,40,0.10)",
          borderRadius: 4, padding: "0 3px", fontWeight: 600, cursor: "pointer",
        }}>{tok}</span>);
      last = m.index + tok.length;
    }
    if (last < s.length) out.push(<span key={keyBase + "t" + i++}>{s.slice(last)}</span>);
    return out;
  };

  const blocks = [];
  let code = null, list = null;
  const flush = () => {
    if (code !== null) {
      blocks.push(<pre key={"p" + blocks.length} style={{
        margin: "5px 0", padding: "8px 10px", borderRadius: 7, overflowX: "auto",
        background: "rgba(16,24,40,0.10)", fontSize: 11.5, lineHeight: 1.5,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}>{code.join("\n")}</pre>);
      code = null;
    }
    if (list) {
      blocks.push(<ul key={"u" + blocks.length} style={{ margin: "4px 0", paddingLeft: 18 }}>
        {list.map((li, j) => <li key={j} style={{ marginBottom: 2 }}>{inline(li, "li" + j)}</li>)}
      </ul>);
      list = null;
    }
  };
  lines.forEach((ln, idx) => {
    if (ln.trim().startsWith("```")) {
      if (code === null) { flush(); code = []; } else flush();
      return;
    }
    if (code !== null) { code.push(ln); return; }
    if (/^\s*[-*]\s+/.test(ln)) { (list = list || []).push(ln.replace(/^\s*[-*]\s+/, "")); return; }
    flush();
    blocks.push(<div key={"d" + idx}>{ln.trim() === "" ? "\u00A0" : inline(ln, "d" + idx)}</div>);
  });
  flush();
  return <>{blocks}</>;
}

function Ticks({ state, light }) {
  const col = state === "read" ? "#2E90FA" : light ? "rgba(255,255,255,0.75)" : "#98A2B3";
  if (state === "sending") return <Clock size={11} color={col} />;
  if (state === "failed") return <AlertCircle size={11} color="#F04438" />;
  if (state === "sent") return <Check size={12} color={col} strokeWidth={3} />;
  return <CheckCheck size={13} color={col} strokeWidth={2.6} />;
}

function Lightbox({ item, onClose }) {
  if (!item) return null;
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, background: "rgba(16,24,40,0.86)", zIndex: 30,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
    }}>
      <button onClick={onClose} aria-label="Close preview" style={{
        position: "absolute", top: 10, right: 10, border: "none", borderRadius: 8,
        background: "rgba(255,255,255,0.14)", color: "#fff", cursor: "pointer",
        width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
      }}><X size={16} /></button>
      {item.kind === "video"
        ? <video src={item.url} controls style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10 }} />
        : <img src={item.url} alt={item.name} style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10 }} />}
      <div style={{
        position: "absolute", bottom: 12, left: 0, right: 0, textAlign: "center",
        color: "rgba(255,255,255,0.8)", fontSize: 11.5,
      }}>{item.name}</div>
    </div>
  );
}

function Attachments({ files, accent, onOpen, light }) {
  if (!files || files.length === 0) return null;
  const media = files.filter(f => f.kind === "image" || f.kind === "video");
  const docs = files.filter(f => f.kind !== "image" && f.kind !== "video");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 5 }}>
      {media.length > 0 && (
        <div style={{
          display: "grid", gap: 4,
          gridTemplateColumns: media.length === 1 ? "1fr" : "1fr 1fr",
        }}>
          {media.map(f => (
            <button key={f.id} onClick={() => onOpen(f)} style={{
              border: "none", padding: 0, borderRadius: 8, overflow: "hidden",
              cursor: "pointer", background: "rgba(0,0,0,0.06)", position: "relative",
              height: media.length === 1 ? 128 : 84,
            }}>
              {f.kind === "video"
                ? <><video src={f.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <span style={{
                      position: "absolute", inset: 0, display: "flex",
                      alignItems: "center", justifyContent: "center",
                    }}><PlayCircle size={26} color="#fff" /></span></>
                : <img src={f.url} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </button>
          ))}
        </div>
      )}
      {docs.map(f => (
        <a key={f.id} href={f.url || "#"} download={f.name}
          onClick={e => { if (!f.url) e.preventDefault(); }}
          style={{
            display: "flex", alignItems: "center", gap: 7, padding: "6px 9px", borderRadius: 7,
            textDecoration: "none", border: light ? "none" : `1px solid ${HAIRLINE}`,
            background: light ? "rgba(255,255,255,0.18)" : "#F4F5F7",
          }}>
          {f.kind === "audio" ? <Mic size={13} color={light ? "#fff" : accent.base} />
            : <FileText size={13} color={light ? "#fff" : accent.base} />}
          <span style={{
            fontSize: 11.5, color: light ? "#fff" : INK, flex: 1, minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{f.name}</span>
          <span style={{ fontSize: 10, color: light ? "rgba(255,255,255,0.7)" : MUTED }}>{f.size}</span>
          <Download size={12} color={light ? "rgba(255,255,255,0.8)" : MUTED} />
        </a>
      ))}
    </div>
  );
}

function Reactions({ reactions, me, accent, onToggle }) {
  const keys = Object.keys(reactions || {}).filter(k => reactions[k].length > 0);
  if (keys.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {keys.map(k => {
        const mine = reactions[k].includes(me);
        return (
          <button key={k} onClick={() => onToggle(k)} title={`${reactions[k].length} reacted`}
            style={{
              display: "flex", alignItems: "center", gap: 3, padding: "1px 7px",
              borderRadius: 20, cursor: "pointer", fontSize: 11,
              border: `1px solid ${mine ? accent.base : HAIRLINE}`,
              background: mine ? accent.soft : "#fff", color: INK,
            }}>
            <span style={{ fontSize: 12 }}>{k}</span>
            <span style={{ fontWeight: 600 }}>{reactions[k].length}</span>
          </button>
        );
      })}
    </div>
  );
}

const QUICK_REACTIONS = ["\u{1F44D}", "\u2705", "\u{1F525}", "\u{1F64F}", "\u{1F440}", "\u{1F389}"];

function ChatSurface({ accent, wallpaper, people, groups, channels, me, onShareOut, onAskKody,
  flash, copyText, patchGroup, patchChannel, setChannels, onConvosChange, jumpTo, onJumped }) {
  const [segment, setSegment] = React.useState("direct");
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(null);
  const [convos, setConvos] = React.useState(CHAT_SEED);
  const [drafts, setDrafts] = React.useState({});
  const [replyTo, setReplyTo] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [threadOf, setThreadOf] = React.useState(null);
  const [pending, setPending] = React.useState([]);
  const [typing, setTyping] = React.useState({});
  const [online, setOnline] = React.useState(true);
  const [readCursor, setReadCursor] = React.useState({ "dm:1": 0, "dm:2": 0, "group:g1": 0, "channel:c1": 0 });
  const [visibleCount, setVisibleCount] = React.useState(12);
  const [menuFor, setMenuFor] = React.useState(null);
  const [reactFor, setReactFor] = React.useState(null);
  const [forwardOf, setForwardOf] = React.useState(null);
  const [lightbox, setLightbox] = React.useState(null);
  const [pins, setPins] = React.useState({});
  const [showPins, setShowPins] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [staged, setStaged] = React.useState([]);
  const [recording, setRecording] = React.useState(null);
  const [panel, setPanel] = React.useState(null);      /* admin | directory | files */
  const [scheduleFor, setScheduleFor] = React.useState(null);
  const [scheduled, setScheduled] = React.useState([]);

  const sockRef = React.useRef(null);
  const bodyRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const key = active ? `${active.kind}:${active.id}` : null;
  const msgs = key ? (convos[key] || []) : [];
  const shown = msgs.slice(Math.max(0, msgs.length - visibleCount));
  const hasOlder = msgs.length > visibleCount;

  /* ---- socket lifecycle ---- */
  React.useEffect(() => {
    const s = createKodySocket();
    sockRef.current = s;
    const offMsg = s.on("message", (m) => {
      setConvos(p => ({ ...p, [m.convo]: [...(p[m.convo] || []), m] }));
    });
    const offTyping = s.on("typing", ({ convo, who, on }) => {
      setTyping(p => ({ ...p, [convo]: on ? who : null }));
    });
    const offStatus = s.on("status", (st) => setOnline(st === "connected"));
    return () => { offMsg(); offTyping(); offStatus(); s.dispose(); };
  }, []);

  /* ---- flush the offline queue on reconnect ---- */
  React.useEffect(() => {
    if (!online || pending.length === 0) return;
    const queue = pending;
    setPending([]);
    queue.forEach(m => deliver(m));
    flash(`${queue.length} queued message${queue.length > 1 ? "s" : ""} sent`);
  }, [online]);

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [shown.length, threadOf, active]);

  React.useEffect(() => { onConvosChange && onConvosChange(convos); }, [convos]);

  /* jump target from global search, directory or the quick switcher */
  React.useEffect(() => {
    if (!jumpTo) return;
    const [kind, id] = jumpTo.split(":");
    const found = kind === "dm" ? people.find(x => String(x.id) === id)
      : kind === "group" ? groups.find(g => g.id === id)
      : channels.find(c => c.id === id);
    if (found) {
      setActive(kind === "dm"
        ? { kind, id: found.id, name: found.name, status: found.status, initials: found.initials }
        : { kind, id: found.id, name: found.name });
    }
    onJumped && onJumped();
  }, [jumpTo]);

  /* scheduled send - fires when its time arrives */
  React.useEffect(() => {
    if (scheduled.length === 0) return;
    const t = setInterval(() => {
      const due = scheduled.filter(s => s.at <= Date.now());
      if (due.length === 0) return;
      setScheduled(q => q.filter(s => s.at > Date.now()));
      due.forEach(s => {
        setConvos(p => ({ ...p, [s.msg.convo]: [...(p[s.msg.convo] || []), { ...s.msg, state: "sending", ts: Date.now() }] }));
        deliver(s.msg);
      });
      flash(`${due.length} scheduled message${due.length > 1 ? "s" : ""} sent`);
    }, 1000);
    return () => clearInterval(t);
  }, [scheduled]);

  React.useEffect(() => { setVisibleCount(12); setShowPins(false); setThreadOf(null); }, [key]);

  /* mark read on open */
  React.useEffect(() => {
    if (!key) return;
    setReadCursor(p => ({ ...p, [key]: (convos[key] || []).length }));
  }, [key]);

  const patch = (convoKey, id, fn) => setConvos(p => ({
    ...p,
    [convoKey]: (p[convoKey] || []).map(m => (m.id === id ? fn(m) : m)),
  }));

  const deliver = (m) => {
    const peer = m.convo.startsWith("dm:")
      ? people.find(p => String(p.id) === m.convo.split(":")[1]) : null;
    const ok = sockRef.current?.send(m, {
      peer,
      onAck: (seq) => patch(m.convo, m.id, x => ({ ...x, state: "sent", seq })),
      onDelivered: () => patch(m.convo, m.id, x => ({ ...x, state: "delivered" })),
      onRead: () => patch(m.convo, m.id, x => ({ ...x, state: "read" })),
    });
    if (!ok) {
      patch(m.convo, m.id, x => ({ ...x, state: "failed" }));
      setPending(q => [...q, m]);
    }
  };

  const nowTs = () => Date.now();

  const send = () => {
    if (!key) return;
    const text = (drafts[key] || "").trim();
    if (!text && staged.length === 0) return;

    if (editing) {
      patch(key, editing, m => ({ ...m, text, edited: true }));
      setEditing(null);
      setDrafts(d => ({ ...d, [key]: "" }));
      return;
    }

    const space = active.kind === "channel" ? channels.find(c => c.id === active.id)
      : active.kind === "group" ? groups.find(g => g.id === active.id) : null;
    if (space && space.announcement && !(space.owners || []).includes(me.id)) {
      flash("This is an announcement channel. Only owners can post.");
      return;
    }
    if (space && space.archived) { flash("This space is archived."); return; }

    const msg = {
      id: "m" + Date.now() + Math.random().toString(36).slice(2, 5),
      convo: key, from: me.id, text, ts: nowTs(),
      state: online ? "sending" : "failed",
      reactions: {}, files: staged,
      replyTo: replyTo ? replyTo.id : null,
      threadParent: threadOf ? threadOf.id : null,
    };
    setConvos(p => ({ ...p, [key]: [...(p[key] || []), msg] }));
    setDrafts(d => ({ ...d, [key]: "" }));
    setStaged([]); setReplyTo(null);
    if (scheduleFor) {
      setConvos(p => ({ ...p, [key]: (p[key] || []).filter(x => x.id !== msg.id) }));
      setScheduled(q => [...q, { at: Date.now() + scheduleFor * 1000, msg }]);
      flash(`Scheduled in ${scheduleFor < 60 ? scheduleFor + "s" : Math.round(scheduleFor / 60) + " min"}`);
      setScheduleFor(null);
      return;
    }
    if (online) deliver(msg); else { setPending(q => [...q, msg]); flash("Offline. Queued."); }
    if (/@kody/i.test(text)) onAskKody(text.replace(/@kody/ig, "").trim(), key);
  };

  const toggleReaction = (m, emoji) => {
    patch(key, m.id, x => {
      const cur = { ...(x.reactions || {}) };
      const list = cur[emoji] || [];
      cur[emoji] = list.includes(me.id) ? list.filter(u => u !== me.id) : [...list, me.id];
      return { ...x, reactions: cur };
    });
    setReactFor(null);
  };

  const addFiles = (fileList) => {
    const arr = Array.from(fileList || []);
    const next = [];
    arr.forEach(f => {
      const mb = f.size / (1024 * 1024);
      if (mb > MAX_FILE_MB) { flash(`${f.name} is over ${MAX_FILE_MB} MB`); return; }
      const kind = /^image\//.test(f.type) ? "image"
        : /^video\//.test(f.type) ? "video"
        : /^audio\//.test(f.type) ? "audio" : "file";
      let url = null;
      try { url = URL.createObjectURL(f); } catch (e) { url = null; }
      next.push({
        id: "f" + Date.now() + Math.random().toString(36).slice(2, 5),
        name: f.name, kind, url,
        size: mb < 0.1 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${mb.toFixed(1)} MB`,
      });
    });
    if (next.length) setStaged(s => [...s, ...next]);
  };

  const toggleVoice = () => {
    if (recording) {
      const secs = recording.s;
      setRecording(null);
      setStaged(s => [...s, {
        id: "v" + Date.now(), kind: "audio", url: null,
        name: `voice-note-${String(Math.floor(secs / 60)).padStart(2, "0")}-${String(secs % 60).padStart(2, "0")}.webm`,
        size: `${Math.max(1, Math.round(secs * 16))} KB`,
      }]);
      flash("Voice note attached");
    } else setRecording({ s: 0 });
  };

  React.useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecording(r => (r ? { ...r, s: r.s + 1 } : r)), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const list = () => {
    const q = query.toLowerCase();
    if (segment === "direct") return people.filter(p => p.name.toLowerCase().includes(q))
      .map(p => ({ kind: "dm", id: p.id, name: p.name, sub: p.role, status: p.status, initials: p.initials }));
    if (segment === "groups") return groups.filter(g => g.name.toLowerCase().includes(q))
      .map(g => ({ kind: "group", id: g.id, name: g.name, sub: `${g.members.length} members` }));
    return channels
      .filter(c => !c.archived)
      .filter(c => !c.private || (c.members || []).includes(me.id))
      .filter(c => (c.members || []).includes(me.id))
      .filter(c => c.name.toLowerCase().includes(q))
      .sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0))
      .map(c => ({ kind: "channel", id: c.id, name: c.name, sub: `${c.members.length} members`,
        private: c.private, muted: c.muted, favourite: c.favourite }));
  };

  const unreadOf = (k) => Math.max(0, (convos[k] || []).length - (readCursor[k] || 0));
  const nameOf = (uid) => uid === me.id ? "You" : (people.find(p => p.id === uid)?.name || "Someone");
  const initialsOf = (uid) => uid === me.id ? me.initials : (people.find(p => p.id === uid)?.initials || "??");
  const threadCount = (m) => msgs.filter(x => x.threadParent === m.id).length;
  const rootMsgs = shown.filter(m => !m.threadParent);
  const firstUnreadIdx = key ? (readCursor[key] || 0) : 0;

  /* ---------------- conversation list ---------------- */
  if (!active) {
    return (
      <div>
        <div style={{ padding: "10px 12px 8px", background: "#fff", borderBottom: `1px solid ${HAIRLINE}` }}>
          <div style={{ display: "flex", gap: 5, marginBottom: 9 }}>
            {[["direct", "Direct"], ["groups", "Groups"], ["channels", "Channels"]].map(([k, l]) => (
              <button key={k} onClick={() => setSegment(k)} style={{
                flex: 1, padding: "5px 0", borderRadius: 7, fontSize: 11.5, cursor: "pointer",
                border: `1px solid ${segment === k ? accent.base : HAIRLINE}`,
                background: segment === k ? accent.soft : "#fff",
                color: segment === k ? accent.deep : MUTED, fontWeight: segment === k ? 600 : 500,
              }}>{l}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{
              flex: 1, display: "flex", alignItems: "center", gap: 7,
              padding: "7px 10px", background: "#F4F5F7", borderRadius: 8,
            }}>
              <Search size={14} color={MUTED} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${segment}`}
                style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, flex: 1, color: INK }} />
            </div>
            {segment === "channels" && (
              <button onClick={() => setPanel("directory")} title="Browse channels" style={{
                width: 34, borderRadius: 8, border: `1px solid ${HAIRLINE}`, background: "#fff",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: accent.base,
              }}><Compass size={16} /></button>
            )}
          </div>
          {!online && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6, marginTop: 8,
              padding: "5px 9px", borderRadius: 7, background: "#FFFAEB", fontSize: 11, color: "#B54708",
            }}>
              <WifiOff size={12} /> Offline. {pending.length} queued.
            </div>
          )}
        </div>

        {panel === "directory" && (
          <SpaceDirectory channels={channels} me={me} accent={accent}
            onJoin={(c) => patchChannel(c.id, { members: [...(c.members || []), me.id] })}
            onLeave={(c) => patchChannel(c.id, { members: (c.members || []).filter(x => x !== me.id) })}
            onOpen={(c) => { setPanel(null); setActive({ kind: "channel", id: c.id, name: c.name }); }}
            onClose={() => setPanel(null)} />
        )}
        {list().length === 0 ? (
          <div style={{ padding: "34px 20px", textAlign: "center", fontSize: 12.5, color: MUTED }}>
            Nothing matches that.
          </div>
        ) : list().map(c => {
          const k = `${c.kind}:${c.id}`;
          const u = unreadOf(k);
          const last = (convos[k] || []).filter(m => !m.deletedForAll).slice(-1)[0];
          return (
            <button key={k} onClick={() => setActive(c)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", border: "none", borderBottom: `1px solid ${HAIRLINE}`,
              background: "#fff", cursor: "pointer", textAlign: "left",
            }}>
              <div style={{ position: "relative" }}>
                {c.kind === "dm"
                  ? <Avatar initials={c.initials} size={32} />
                  : <Avatar size={32} square tint={accent.base}
                      glyph={c.kind === "channel" ? "#" : c.name.charAt(0).toUpperCase()} />}
                {c.kind === "dm" && <span style={{ position: "absolute", right: -1, bottom: -1 }}>
                  <Dot color={STATUSES[c.status].color} size={9} /></span>}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: u ? 700 : 550, display: "flex", alignItems: "center", gap: 5 }}>
                  {c.kind === "channel" && (c.private ? <Lock size={11} color={MUTED} /> : <Hash size={11} color={MUTED} />)}
                  {c.name}
                </div>
                <div style={{
                  fontSize: 11.5, color: MUTED, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{last ? `${nameOf(last.from)}: ${last.text || "sent a file"}` : c.sub}</div>
              </div>
              {u > 0 && <span style={{
                background: accent.base, color: "#fff", fontSize: 10.5, fontWeight: 700,
                borderRadius: 10, padding: "1px 7px", flexShrink: 0,
              }}>{u}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  /* ---------------- open conversation ---------------- */
  const threadMsgs = threadOf ? msgs.filter(m => m.threadParent === threadOf.id) : [];
  const pinned = (pins[key] || []).map(id => msgs.find(m => m.id === id)).filter(Boolean);

  const MsgRow = ({ m, compact }) => {
    const mine = m.from === me.id;
    const mentionsMe = new RegExp(`@${me.handle}\\b|@here\\b|@channel\\b`, "i").test(m.text || "");
    const parent = m.replyTo ? msgs.find(x => x.id === m.replyTo) : null;
    const tCount = compact ? 0 : threadCount(m);

    if (m.deletedForAll) {
      return (
        <div style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%" }}>
          <div style={{
            padding: "7px 11px", borderRadius: 12, fontSize: 12, fontStyle: "italic",
            color: MUTED, background: "#fff", border: `1px dashed ${HAIRLINE}`,
          }}>Message deleted</div>
        </div>
      );
    }

    return (
      <div style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%", position: "relative" }}>
        {!mine && active.kind !== "dm" && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
            <Avatar initials={initialsOf(m.from)} size={18} />
            <span style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>{nameOf(m.from)}</span>
          </div>
        )}
        <div onClick={() => setMenuFor(menuFor === m.id ? null : m.id)} style={{
          background: mine ? accent.base : "#fff",
          color: mine ? "#fff" : INK,
          border: mine ? "none" : `1px solid ${HAIRLINE}`,
          outline: mentionsMe ? `2px solid ${YELLOW}` : "none",
          padding: "8px 11px", borderRadius: 12, fontSize: 13, lineHeight: 1.5, cursor: "pointer",
        }}>
          {parent && (
            <div style={{
              borderLeft: `3px solid ${mine ? "rgba(255,255,255,0.55)" : accent.base}`,
              paddingLeft: 7, marginBottom: 6, opacity: 0.85,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 600 }}>{nameOf(parent.from)}</div>
              <div style={{
                fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{parent.text || "file"}</div>
            </div>
          )}
          <Attachments files={m.files} accent={accent} light={mine} onOpen={setLightbox} />
          {m.text && <RichText text={m.text} mentionsMe={mentionsMe} accent={accent} />}
          {m.text && unfurlFor(m.text) && <Unfurl data={unfurlFor(m.text)} accent={accent} />}
          <div style={{
            display: "flex", alignItems: "center", gap: 5, marginTop: 4,
            fontSize: 10, color: mine ? "rgba(255,255,255,0.75)" : MUTED,
          }}>
            {m.edited && <span>edited</span>}
            {(pins[key] || []).includes(m.id) && <Pin size={10} />}
            <span style={{ marginLeft: "auto" }}>
              {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {mine && <Ticks state={m.state} light />}
          </div>
        </div>

        <Reactions reactions={m.reactions} me={me.id} accent={accent}
          onToggle={(e) => toggleReaction(m, e)} />

        {tCount > 0 && (
          <button onClick={() => setThreadOf(m)} style={{
            display: "flex", alignItems: "center", gap: 5, marginTop: 4, padding: "3px 8px",
            borderRadius: 20, border: `1px solid ${HAIRLINE}`, background: "#fff",
            cursor: "pointer", fontSize: 11, color: accent.deep, fontWeight: 600,
          }}>
            <MessageSquare size={11} /> {tCount} {tCount === 1 ? "reply" : "replies"}
          </button>
        )}

        {menuFor === m.id && (
          <div style={{
            display: "flex", gap: 2, marginTop: 5, padding: 3, borderRadius: 9,
            background: "#fff", border: `1px solid ${HAIRLINE}`,
            boxShadow: "0 6px 18px rgba(16,24,40,0.14)", flexWrap: "wrap",
            justifyContent: mine ? "flex-end" : "flex-start",
          }}>
            <IconBtn accent={accent} title="React" onClick={() => setReactFor(reactFor === m.id ? null : m.id)}>
              <Smile size={13} />
            </IconBtn>
            <IconBtn accent={accent} title="Reply" onClick={() => { setReplyTo(m); setMenuFor(null); inputRef.current?.focus(); }}>
              <Reply size={13} />
            </IconBtn>
            {!compact && (
              <IconBtn accent={accent} title="Reply in thread" onClick={() => { setThreadOf(m); setMenuFor(null); }}>
                <MessageSquare size={13} />
              </IconBtn>
            )}
            <IconBtn accent={accent} title="Forward" onClick={() => { setForwardOf(m); setMenuFor(null); }}>
              <CornerUpRight size={13} />
            </IconBtn>
            <IconBtn accent={accent} title="Copy link" onClick={() => {
              copyText(`https://dai.dolluzcorp.com/chat/${key.replace(":", "/")}/${m.id}`);
              setMenuFor(null);
            }}><Link2 size={13} /></IconBtn>
            <IconBtn accent={accent} title={(pins[key] || []).includes(m.id) ? "Unpin" : "Pin"}
              active={(pins[key] || []).includes(m.id)}
              onClick={() => {
                setPins(p => {
                  const cur = p[key] || [];
                  return { ...p, [key]: cur.includes(m.id) ? cur.filter(x => x !== m.id) : [...cur, m.id] };
                });
                setMenuFor(null);
              }}><Pin size={13} /></IconBtn>
            {mine && (
              <IconBtn accent={accent} title="Edit" onClick={() => {
                setEditing(m.id);
                setDrafts(d => ({ ...d, [key]: m.text || "" }));
                setMenuFor(null); inputRef.current?.focus();
              }}><Pencil size={13} /></IconBtn>
            )}
            <IconBtn accent={accent} title="Delete for me" activeColor={RED} onClick={() => {
              setConvos(p => ({ ...p, [key]: (p[key] || []).filter(x => x.id !== m.id) }));
              setMenuFor(null); flash("Deleted for you");
            }}><Trash2 size={13} /></IconBtn>
            {mine && (
              <IconBtn accent={accent} title="Delete for everyone" activeColor={RED} onClick={() => {
                patch(key, m.id, x => ({ ...x, deletedForAll: true, text: "", files: [] }));
                setMenuFor(null); flash("Deleted for everyone");
              }}><Trash size={13} /></IconBtn>
            )}
          </div>
        )}

        {reactFor === m.id && (
          <div style={{
            display: "flex", gap: 2, marginTop: 4, padding: 4, borderRadius: 20,
            background: "#fff", border: `1px solid ${HAIRLINE}`, boxShadow: "0 6px 18px rgba(16,24,40,0.14)",
          }}>
            {QUICK_REACTIONS.map(e => (
              <button key={e} onClick={() => toggleReaction(m, e)} style={{
                border: "none", background: "transparent", cursor: "pointer", fontSize: 16, padding: "2px 4px",
              }}>{e}</button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const composerValue = drafts[key] || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer?.files); }}>

      <input ref={fileRef} type="file" multiple onChange={e => { addFiles(e.target.files); e.target.value = ""; }}
        style={{ display: "none" }} />

      {/* conversation header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 11px",
        borderBottom: `1px solid ${HAIRLINE}`, background: "#fff", flexShrink: 0,
      }}>
        <button onClick={() => { setActive(null); setThreadOf(null); }} aria-label="Back"
          style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex", padding: 0 }}>
          <ArrowLeft size={15} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 650, display: "flex", alignItems: "center", gap: 5 }}>
            {active.kind === "channel" && <Hash size={12} color={MUTED} />}
            {active.name}
          </div>
          <div style={{ fontSize: 10.5, color: MUTED }}>
            {typing[key] ? `${nameOf(typing[key])} is typing...` : (online ? "Connected" : "Offline")}
          </div>
        </div>
        {pinned.length > 0 && (
          <IconBtn accent={accent} active={showPins} title="Pinned" onClick={() => setShowPins(s => !s)}>
            <Pin size={14} />
          </IconBtn>
        )}
        <IconBtn accent={accent} title="Files" onClick={() => setPanel("files")}>
          <FolderOpen size={14} />
        </IconBtn>
        {active.kind !== "dm" && (
          <IconBtn accent={accent} title="Space settings" onClick={() => setPanel("admin")}>
            <Settings2 size={14} />
          </IconBtn>
        )}
        <IconBtn accent={accent} title={online ? "Simulate going offline" : "Reconnect"}
          activeColor={RED} active={!online}
          onClick={() => { const v = !online; sockRef.current?.setConnected(v); setOnline(v); }}>
          {online ? <Wifi size={14} /> : <WifiOff size={14} />}
        </IconBtn>
      </div>

      {showPins && pinned.length > 0 && (
        <div style={{ background: "#FFFAEB", borderBottom: `1px solid ${HAIRLINE}`, padding: "7px 11px", flexShrink: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "#B54708", marginBottom: 4 }}>Pinned</div>
          {pinned.map(p => (
            <div key={p.id} style={{ fontSize: 11.5, color: INK, padding: "2px 0" }}>
              {nameOf(p.from)}: {(p.text || "file").slice(0, 60)}
            </div>
          ))}
        </div>
      )}

      {/* thread view */}
      {threadOf ? (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 7, padding: "7px 11px",
            background: accent.soft, borderBottom: `1px solid ${HAIRLINE}`, flexShrink: 0,
          }}>
            <button onClick={() => setThreadOf(null)} style={{
              border: "none", background: "transparent", cursor: "pointer",
              color: accent.deep, display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, padding: 0,
            }}><ArrowLeft size={13} /> Back to conversation</button>
            <span style={{ marginLeft: "auto", fontSize: 11, color: accent.deep, fontWeight: 600 }}>Thread</span>
          </div>
          <div ref={bodyRef} className="kd-scroll" style={{
            flex: 1, overflowY: "auto", padding: 12, background: WALLPAPERS[wallpaper].css,
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ opacity: 0.75 }}><MsgRow m={threadOf} compact /></div>
            <div style={{
              fontSize: 10.5, color: MUTED, textAlign: "center", padding: "3px 0",
              borderTop: `1px solid ${HAIRLINE}`,
            }}>{threadMsgs.length} {threadMsgs.length === 1 ? "reply" : "replies"}</div>
            {threadMsgs.map(m => <MsgRow key={m.id} m={m} compact />)}
          </div>
        </>
      ) : (
        <div ref={bodyRef} className="kd-scroll" style={{
          flex: 1, overflowY: "auto", padding: 12, background: WALLPAPERS[wallpaper].css,
          display: "flex", flexDirection: "column", gap: 8, position: "relative",
        }}>
          {hasOlder && (
            <button onClick={() => setVisibleCount(c => c + 12)} style={{
              alignSelf: "center", padding: "5px 14px", borderRadius: 20, cursor: "pointer",
              border: `1px solid ${HAIRLINE}`, background: "#fff", fontSize: 11.5, color: accent.deep,
            }}>Load older messages</button>
          )}
          {rootMsgs.length === 0 && (
            <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
              Nothing here yet. Send a message, drop a file, or type
              <span style={{ color: accent.deep, fontWeight: 600 }}> @kody </span> for an answer.
            </div>
          )}
          {rootMsgs.map((m, i) => {
            const absIdx = msgs.indexOf(m);
            const divider = absIdx === firstUnreadIdx && absIdx > 0 && m.from !== me.id;
            return (
              <React.Fragment key={m.id}>
                {divider && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0" }}>
                    <span style={{ flex: 1, height: 1, background: RED, opacity: 0.4 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: RED }}>NEW</span>
                    <span style={{ flex: 1, height: 1, background: RED, opacity: 0.4 }} />
                  </div>
                )}
                <MsgRow m={m} />
              </React.Fragment>
            );
          })}
          {typing[key] && (
            <div style={{ display: "flex", gap: 4, padding: "6px 10px", alignSelf: "flex-start" }}>
              {[0, 1, 2].map(i => <span key={i} style={{
                width: 6, height: 6, borderRadius: "50%", background: MUTED,
                animation: `kdBlink 1.1s ${i * 0.18}s infinite`,
              }} />)}
            </div>
          )}
        </div>
      )}

      {dragOver && (
        <div style={{
          position: "absolute", inset: 0, background: accent.soft, opacity: 0.94, zIndex: 12,
          display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8,
          border: `2px dashed ${accent.base}`, borderRadius: 12,
        }}>
          <Upload size={22} color={accent.base} />
          <span style={{ fontSize: 12.5, color: accent.deep, fontWeight: 600 }}>Drop files to attach</span>
        </div>
      )}

      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />

      {panel === "files" && (
        <FileBrowser accent={accent} msgs={msgs} people={people}
          onOpen={setLightbox} onClose={() => setPanel(null)} />
      )}

      {panel === "directory" && (
        <SpaceDirectory channels={channels} me={me} accent={accent}
          onJoin={(c) => patchChannel(c.id, { members: [...(c.members || []), me.id] })}
          onLeave={(c) => patchChannel(c.id, { members: (c.members || []).filter(x => x !== me.id) })}
          onOpen={(c) => { setPanel(null); setActive({ kind: "channel", id: c.id, name: c.name }); }}
          onClose={() => setPanel(null)} />
      )}

      {panel === "admin" && active.kind !== "dm" && (() => {
        const space = active.kind === "channel"
          ? channels.find(c => c.id === active.id) : groups.find(g => g.id === active.id);
        if (!space) return null;
        return (
          <SpaceAdmin space={space} kind={active.kind} accent={accent} people={people} me={me}
            flash={flash}
            onPatch={(f) => {
              if (active.kind === "channel") patchChannel(space.id, f); else patchGroup(space.id, f);
              if (f.name) setActive(a => ({ ...a, name: f.name }));
            }}
            onDelete={() => {
              if (active.kind === "channel") setChannels(cs => cs.filter(c => c.id !== space.id));
              setPanel(null); setActive(null);
            }}
            onClose={() => setPanel(null)} />
        );
      })()}

      {/* forward sheet */}
      {forwardOf && (
        <div onClick={() => setForwardOf(null)} style={{
          position: "absolute", inset: 0, background: "rgba(16,24,40,0.3)", zIndex: 14,
          display: "flex", alignItems: "flex-end",
        }}>
          <div onClick={e => e.stopPropagation()} className="kd-scroll" style={{
            width: "100%", background: "#fff", borderRadius: "14px 14px 0 0",
            padding: "14px 0 8px", maxHeight: "72%", overflowY: "auto",
          }}>
            <div style={{ padding: "0 14px 10px", fontSize: 13, fontWeight: 600 }}>Forward to</div>
            {[...people.map(p => ({ kind: "dm", id: p.id, name: p.name, initials: p.initials })),
              ...groups.map(g => ({ kind: "group", id: g.id, name: g.name })),
              ...channels.map(c => ({ kind: "channel", id: c.id, name: "#" + c.name }))].map(t => (
              <button key={t.kind + t.id} onClick={() => {
                const dest = `${t.kind}:${t.id}`;
                const copy = {
                  ...forwardOf, id: "fw" + Date.now(), convo: dest, from: me.id,
                  ts: nowTs(), state: "sent", forwarded: true, reactions: {},
                  replyTo: null, threadParent: null,
                };
                setConvos(p => ({ ...p, [dest]: [...(p[dest] || []), copy] }));
                setForwardOf(null);
                flash("Forwarded to " + t.name);
              }} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
              }}>
                {t.kind === "dm"
                  ? <Avatar initials={t.initials} size={26} />
                  : <Avatar size={26} square tint={accent.base} glyph={t.kind === "channel" ? "#" : t.name.charAt(0)} />}
                <span style={{ fontSize: 13 }}>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* composer */}
      <div style={{ borderTop: `1px solid ${HAIRLINE}`, background: "#fff", flexShrink: 0 }}>
        {replyTo && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 11px",
            borderBottom: `1px solid ${HAIRLINE}`, background: "#FCFCFD",
          }}>
            <Reply size={13} color={accent.base} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: accent.deep }}>{nameOf(replyTo.from)}</div>
              <div style={{
                fontSize: 11.5, color: MUTED, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{replyTo.text || "file"}</div>
            </div>
            <button onClick={() => setReplyTo(null)} aria-label="Cancel reply"
              style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex" }}>
              <X size={13} />
            </button>
          </div>
        )}

        {editing && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 11px",
            borderBottom: `1px solid ${HAIRLINE}`, background: "#FFFAEB",
          }}>
            <Pencil size={13} color="#B54708" />
            <span style={{ fontSize: 11.5, color: "#B54708", flex: 1 }}>Editing message</span>
            <button onClick={() => { setEditing(null); setDrafts(d => ({ ...d, [key]: "" })); }}
              aria-label="Cancel edit"
              style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex" }}>
              <X size={13} />
            </button>
          </div>
        )}

        {recording && (
          <div style={{
            display: "flex", alignItems: "center", gap: 7, padding: "7px 11px",
            background: "#FFF4F3", borderBottom: `1px solid ${HAIRLINE}`,
          }}>
            <Dot color={RED} size={8} ring={false} />
            <span style={{ fontSize: 11.5, color: "#B42318" }}>
              Recording {String(Math.floor(recording.s / 60)).padStart(2, "0")}:{String(recording.s % 60).padStart(2, "0")}
            </span>
            <button onClick={toggleVoice} style={{
              marginLeft: "auto", border: "none", background: RED, color: "#fff",
              borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer",
            }}>Stop</button>
          </div>
        )}

        {scheduleFor && (
          <div style={{
            display: "flex", alignItems: "center", gap: 7, padding: "7px 11px",
            background: accent.soft, borderBottom: `1px solid ${HAIRLINE}`,
          }}>
            <CalendarClock size={13} color={accent.base} />
            <span style={{ fontSize: 11.5, color: accent.deep, flex: 1 }}>
              Sending in {scheduleFor < 60 ? scheduleFor + " seconds" : Math.round(scheduleFor / 60) + " minutes"}
            </span>
            {[30, 300, 3600].map(s => (
              <button key={s} onClick={() => setScheduleFor(s)} style={{
                border: `1px solid ${scheduleFor === s ? accent.base : HAIRLINE}`,
                background: "#fff", borderRadius: 6, padding: "2px 7px",
                fontSize: 10.5, cursor: "pointer", color: accent.deep,
              }}>{s < 60 ? s + "s" : s < 3600 ? s / 60 + "m" : "1h"}</button>
            ))}
            <button onClick={() => setScheduleFor(null)} aria-label="Cancel schedule"
              style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex" }}>
              <X size={13} />
            </button>
          </div>
        )}

        {scheduled.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 7, padding: "6px 11px",
            background: "#FCFCFD", borderBottom: `1px solid ${HAIRLINE}`, fontSize: 11, color: MUTED,
          }}>
            <CalendarClock size={12} /> {scheduled.length} scheduled
          </div>
        )}

        {staged.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 10px 0" }}>
            {staged.map(f => (
              <FileChip key={f.id} name={f.name} accent={accent}
                onRemove={() => setStaged(s => s.filter(x => x.id !== f.id))} />
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, padding: "9px 10px" }}>
          <IconBtn accent={accent} title="Attach files" onClick={() => fileRef.current?.click()}>
            <Paperclip size={16} />
          </IconBtn>
          <textarea ref={inputRef} rows={1} value={composerValue}
            onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={threadOf ? "Reply in thread" : "Message, @kody for an answer, **bold** or `code`"}
            style={{
              flex: 1, resize: "none", border: `1px solid ${HAIRLINE}`, borderRadius: 9,
              padding: "8px 11px", fontSize: 13.5, lineHeight: 1.45, outline: "none",
              fontFamily: "inherit", color: INK, maxHeight: 84, background: "#fff",
            }} />
          <IconBtn accent={accent} title={scheduleFor ? "Scheduled" : "Schedule send"}
            active={!!scheduleFor}
            onClick={() => setScheduleFor(scheduleFor ? null : 30)}>
            <CalendarClock size={16} />
          </IconBtn>
          <IconBtn accent={accent} title={recording ? "Stop recording" : "Voice note"}
            active={!!recording} activeColor={RED} onClick={toggleVoice}>
            <Mic size={16} />
          </IconBtn>
          <button onClick={send} disabled={!composerValue.trim() && staged.length === 0} title="Send"
            style={{
              width: 32, height: 32, borderRadius: 9, border: "none", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: (composerValue.trim() || staged.length) ? accent.base : "#E7EAEE",
              color: "#fff", cursor: (composerValue.trim() || staged.length) ? "pointer" : "default",
            }}><Send size={15} /></button>
        </div>
      </div>
    </div>
  );
}

/* ==================================================================
   KODY v10 - channels & spaces, presence & profile, notifications,
   search, and the messaging/files items left out of v9.
   ================================================================== */

const TEAMS = ["RCM Operations", "Cybersecurity", "Engineering", "Delivery"];
const SKILLS = {
  1: ["React", "Node", "MySQL"],
  2: ["SOC", "SIEM", "Incident response"],
  3: ["Active Directory", "Database audit", "IAM"],
  4: ["Agile", "Scrum", "Delivery"],
  5: ["AR calling", "Denials", "Appeals"],
  6: ["Payment posting", "Audit", "Reconciliation"],
};
const TEAM_OF = { 1: "Engineering", 2: "Cybersecurity", 3: "Cybersecurity", 4: "Delivery", 5: "RCM Operations", 6: "RCM Operations" };
const TZ_OF = { 1: "Asia/Kolkata", 2: "Asia/Kolkata", 3: "Asia/Kolkata", 4: "Asia/Muscat", 5: "America/Chicago", 6: "Asia/Kolkata" };

const NOTIF_LEVELS = [
  { key: "all", label: "All messages" },
  { key: "mentions", label: "Mentions only" },
  { key: "none", label: "Nothing" },
];

const RETENTIONS = [
  { key: "forever", label: "Keep forever" },
  { key: "1y", label: "1 year" },
  { key: "90d", label: "90 days" },
  { key: "30d", label: "30 days" },
];

const STATUS_PRESETS = [
  { emoji: "\u{1F4DE}", text: "On a payer call", mins: 60 },
  { emoji: "\u{1F374}", text: "Lunch", mins: 45 },
  { emoji: "\u{1F3E5}", text: "Working on denials", mins: 240 },
  { emoji: "\u{1F334}", text: "On leave", mins: 1440 },
];

const localTimeIn = (tz) => {
  try { return new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return "--:--"; }
};

/* ---------- search ---------- */
function parseQuery(raw) {
  const q = { terms: [], from: null, in: null, before: null, after: null, hasFile: false };
  String(raw || "").split(/\s+/).filter(Boolean).forEach(tok => {
    const m = tok.match(/^(from|in|before|after|has):(.+)$/i);
    if (!m) { q.terms.push(tok.toLowerCase()); return; }
    const [, k, v] = m;
    const key = k.toLowerCase();
    if (key === "has") q.hasFile = v.toLowerCase() === "file";
    else if (key === "from") q.from = v.toLowerCase().replace(/^@/, "");
    else if (key === "in") q.in = v.toLowerCase().replace(/^#/, "");
    else q[key] = v;
  });
  return q;
}

function runSearch(q, convos, people, groups, channels) {
  const parsed = parseQuery(q);
  const hit = [];
  if (!q.trim()) return hit;

  const convoName = (k) => {
    const [kind, id] = k.split(":");
    if (kind === "dm") return people.find(p => String(p.id) === id)?.name || "Direct";
    if (kind === "group") return groups.find(g => g.id === id)?.name || "Group";
    return "#" + (channels.find(c => c.id === id)?.name || "channel");
  };

  Object.entries(convos).forEach(([k, list]) => {
    if (parsed.in && !convoName(k).toLowerCase().includes(parsed.in)) return;
    list.forEach(m => {
      if (m.deletedForAll) return;
      const author = m.from === 0 ? "you" : (people.find(p => p.id === m.from)?.name || "").toLowerCase();
      if (parsed.from && !author.includes(parsed.from)) return;
      if (parsed.hasFile && (!m.files || m.files.length === 0)) return;
      if (parsed.before && m.ts >= Date.parse(parsed.before)) return;
      if (parsed.after && m.ts <= Date.parse(parsed.after)) return;
      const body = (m.text || "").toLowerCase();
      if (parsed.terms.length && !parsed.terms.every(t => body.includes(t))) return;
      hit.push({ type: "message", convo: k, convoName: convoName(k), msg: m, author: m.from });
    });
  });

  if (parsed.terms.length) {
    people.forEach(p => {
      if (parsed.terms.every(t => (p.name + " " + p.role + " " + (SKILLS[p.id] || []).join(" ")).toLowerCase().includes(t)))
        hit.push({ type: "person", person: p });
    });
    channels.forEach(c => {
      if (parsed.terms.every(t => (c.name + " " + (c.topic || "")).toLowerCase().includes(t)))
        hit.push({ type: "channel", channel: c });
    });
  }
  return hit;
}

/* ---------- link unfurl ---------- */
const UNFURL_DB = {
  "cms.gov": { title: "ICD-10-CM code files", desc: "Official tabular and index files for the current fiscal year.", site: "CMS" },
  "x12.org": { title: "Claim adjustment reason codes", desc: "Maintained CARC and RARC code lists.", site: "X12" },
  "ada.org": { title: "CDT code set", desc: "Current Dental Terminology, licensed by the ADA.", site: "ADA" },
};
function unfurlFor(text) {
  const m = String(text || "").match(/https?:\/\/([^\s/]+)(\/[^\s]*)?/);
  if (!m) return null;
  const host = m[1].replace(/^www\./, "");
  const meta = UNFURL_DB[host];
  return meta ? { ...meta, host, url: m[0] } : { title: host, desc: m[0], site: host, host, url: m[0] };
}

function Unfurl({ data, accent }) {
  if (!data) return null;
  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer" style={{
      display: "block", marginTop: 6, padding: "8px 10px", borderRadius: 8,
      borderLeft: `3px solid ${accent.base}`, background: "rgba(16,24,40,0.05)",
      textDecoration: "none", color: "inherit",
    }}>
      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>{data.site}</div>
      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{data.title}</div>
      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2, lineHeight: 1.4 }}>{data.desc}</div>
    </a>
  );
}

/* ---------- small shared bits ---------- */
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function TextInput(props) {
  return <input {...props} style={{
    width: "100%", border: `1px solid ${HAIRLINE}`, borderRadius: 8,
    padding: "8px 10px", fontSize: 12.5, outline: "none",
    fontFamily: "inherit", boxSizing: "border-box", ...(props.style || {}),
  }} />;
}

function Segmented({ options, value, onChange, accent }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{
          flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11.5, cursor: "pointer",
          border: `1px solid ${value === o.key ? accent.base : HAIRLINE}`,
          background: value === o.key ? accent.soft : "#fff",
          color: value === o.key ? accent.deep : MUTED, fontWeight: value === o.key ? 600 : 500,
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, accent }) {
  return (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on} style={{
      width: 34, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
      background: on ? accent.base : "#D0D5DD", position: "relative", flexShrink: 0,
    }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16,
        borderRadius: "50%", background: "#fff", transition: "left 140ms",
      }} />
    </button>
  );
}

/* ---------------- channel / group admin ---------------- */
function SpaceAdmin({ space, kind, accent, people, me, onPatch, onDelete, onClose, flash }) {
  const [tab, setTab] = React.useState("about");
  const [name, setName] = React.useState(space.name);
  const isOwner = (space.owners || [0]).includes(me.id);

  const row = { display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderBottom: `1px solid ${HAIRLINE}` };

  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff", zIndex: 16, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
        <button onClick={onClose} aria-label="Close admin" style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex", padding: 0 }}>
          <ArrowLeft size={15} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 650 }}>{kind === "channel" ? "#" : ""}{space.name}</span>
        {space.archived && <span style={{ fontSize: 10, background: "#F2F4F7", color: MUTED, borderRadius: 5, padding: "1px 6px" }}>Archived</span>}
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${HAIRLINE}` }}>
        {[["about", "About"], ["members", "Members"], ["settings", "Settings"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 0", border: "none", background: "transparent", cursor: "pointer",
            fontSize: 12, fontWeight: tab === k ? 600 : 500,
            color: tab === k ? accent.base : MUTED,
            boxShadow: tab === k ? `inset 0 -2px 0 ${accent.base}` : "none",
          }}>{l}</button>
        ))}
      </div>

      <div className="kd-scroll" style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {tab === "about" && (
          <>
            <Field label="Name">
              <div style={{ display: "flex", gap: 6 }}>
                <TextInput value={name} onChange={e => setName(e.target.value)} disabled={!isOwner} />
                <button onClick={() => { onPatch({ name: name.trim() || space.name }); flash("Renamed"); }}
                  disabled={!isOwner || !name.trim()} style={{
                    border: "none", borderRadius: 8, padding: "0 12px", fontSize: 12, cursor: isOwner ? "pointer" : "default",
                    background: isOwner ? accent.base : "#E7EAEE", color: "#fff",
                  }}>Save</button>
              </div>
            </Field>
            <Field label="Topic">
              <TextInput value={space.topic || ""} placeholder="What is this space for?"
                onChange={e => onPatch({ topic: e.target.value })} />
            </Field>
            <Field label="Purpose">
              <TextInput value={space.purpose || ""} placeholder="Longer description"
                onChange={e => onPatch({ purpose: e.target.value })} />
            </Field>
            <Field label="Visibility">
              <Segmented accent={accent} value={space.private ? "private" : "public"}
                onChange={v => onPatch({ private: v === "private" })}
                options={[{ key: "public", label: "Public" }, { key: "private", label: "Private" }]} />
              <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>
                {space.private ? "Invite only. Hidden from the directory." : "Anyone in Dolluz can find and join."}
              </div>
            </Field>
          </>
        )}

        {tab === "members" && (
          <>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
              {(space.members || []).length} members
            </div>
            {people.map(p => {
              const inSpace = (space.members || []).includes(p.id);
              const owner = (space.owners || []).includes(p.id);
              return (
                <div key={p.id} style={row}>
                  <Avatar initials={p.initials} size={28} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5 }}>{p.name}</div>
                    <div style={{ fontSize: 10.5, color: MUTED }}>{owner ? "Owner" : inSpace ? "Member" : "Not a member"}</div>
                  </div>
                  {inSpace && !owner && isOwner && (
                    <button onClick={() => onPatch({ owners: [...(space.owners || []), p.id] })} style={{
                      border: `1px solid ${HAIRLINE}`, background: "#fff", borderRadius: 6,
                      padding: "3px 8px", fontSize: 10.5, cursor: "pointer", color: accent.deep,
                    }}>Make owner</button>
                  )}
                  <button onClick={() => onPatch({
                    members: inSpace ? (space.members || []).filter(x => x !== p.id) : [...(space.members || []), p.id],
                  })} style={{
                    border: "none", background: inSpace ? "#FFFBFA" : accent.soft, borderRadius: 6,
                    padding: "4px 9px", fontSize: 11, cursor: "pointer",
                    color: inSpace ? "#B42318" : accent.deep, fontWeight: 600,
                  }}>{inSpace ? "Remove" : "Add"}</button>
                </div>
              );
            })}
          </>
        )}

        {tab === "settings" && (
          <>
            <Field label="Notifications">
              <Segmented accent={accent} value={space.notif || "all"} options={NOTIF_LEVELS}
                onChange={v => onPatch({ notif: v })} />
            </Field>
            <div style={{ ...row, borderBottom: "none" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5 }}>Mute</div>
                <div style={{ fontSize: 11, color: MUTED }}>No badge, no sound</div>
              </div>
              <Toggle accent={accent} on={!!space.muted} onChange={v => onPatch({ muted: v })} />
            </div>
            <div style={row}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5 }}>Favourite</div>
                <div style={{ fontSize: 11, color: MUTED }}>Pin to the top of the list</div>
              </div>
              <Toggle accent={accent} on={!!space.favourite} onChange={v => onPatch({ favourite: v })} />
            </div>
            <div style={row}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5 }}>Announcement only</div>
                <div style={{ fontSize: 11, color: MUTED }}>Only owners can post</div>
              </div>
              <Toggle accent={accent} on={!!space.announcement} onChange={v => onPatch({ announcement: v })} />
            </div>
            <div style={row}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5 }}>Default for new joiners</div>
                <div style={{ fontSize: 11, color: MUTED }}>New Dolluz staff join automatically</div>
              </div>
              <Toggle accent={accent} on={!!space.isDefault} onChange={v => onPatch({ isDefault: v })} />
            </div>
            <div style={{ marginTop: 14 }}>
              <Field label="Retention policy">
                <Segmented accent={accent} value={space.retention || "forever"} options={RETENTIONS.slice(0, 2)}
                  onChange={v => onPatch({ retention: v })} />
                <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                  {RETENTIONS.slice(2).map(r => (
                    <button key={r.key} onClick={() => onPatch({ retention: r.key })} style={{
                      flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11.5, cursor: "pointer",
                      border: `1px solid ${space.retention === r.key ? accent.base : HAIRLINE}`,
                      background: space.retention === r.key ? accent.soft : "#fff",
                      color: space.retention === r.key ? accent.deep : MUTED,
                    }}>{r.label}</button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#B54708", marginTop: 6, lineHeight: 1.45 }}>
                  Messages here may contain claim detail. Shorter retention reduces stored PHI.
                </div>
              </Field>
            </div>

            <div style={{ display: "flex", gap: 7, marginTop: 6 }}>
              <button onClick={() => { onPatch({ archived: !space.archived }); flash(space.archived ? "Unarchived" : "Archived"); }}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8, cursor: "pointer", fontSize: 12,
                  border: `1px solid ${HAIRLINE}`, background: "#fff", color: INK,
                }}>{space.archived ? "Unarchive" : "Archive"}</button>
              <button onClick={() => { if (isOwner) { onDelete(); flash("Deleted"); } else flash("Owners only"); }}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600,
                  border: `1px solid ${RED}44`, background: "#FFFBFA", color: "#B42318",
                }}>Delete</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- channel directory ---------------- */
function SpaceDirectory({ channels, me, accent, onJoin, onLeave, onOpen, onClose }) {
  const [q, setQ] = React.useState("");
  const visible = channels.filter(c =>
    !c.private || (c.members || []).includes(me.id)
  ).filter(c => (c.name + " " + (c.topic || "")).toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff", zIndex: 16, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
        <button onClick={onClose} aria-label="Close directory" style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex", padding: 0 }}>
          <ArrowLeft size={15} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 650 }}>Browse channels</span>
      </div>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", background: "#F4F5F7", borderRadius: 8 }}>
          <Search size={14} color={MUTED} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search channels"
            style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, flex: 1, color: INK }} />
        </div>
      </div>
      <div className="kd-scroll" style={{ flex: 1, overflowY: "auto" }}>
        {visible.length === 0 && (
          <div style={{ padding: "30px 18px", textAlign: "center", fontSize: 12.5, color: MUTED }}>No channels match that.</div>
        )}
        {visible.map(c => {
          const joined = (c.members || []).includes(me.id);
          return (
            <div key={c.id} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              borderBottom: `1px solid ${HAIRLINE}`,
            }}>
              <Avatar size={30} square tint={accent.base} glyph={c.private ? "\u{1F512}" : "#"} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                  {c.name}
                  {c.archived && <span style={{ fontSize: 9.5, background: "#F2F4F7", color: MUTED, borderRadius: 4, padding: "0 5px" }}>Archived</span>}
                </div>
                <div style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(c.members || []).length} members{c.topic ? " \u00B7 " + c.topic : ""}
                </div>
              </div>
              {joined
                ? <button onClick={() => onLeave(c)} style={{
                    border: `1px solid ${HAIRLINE}`, background: "#fff", borderRadius: 7,
                    padding: "5px 11px", fontSize: 11.5, cursor: "pointer", color: MUTED,
                  }}>Leave</button>
                : <button onClick={() => { onJoin(c); onOpen(c); }} style={{
                    border: "none", background: accent.base, color: "#fff", borderRadius: 7,
                    padding: "5px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                  }}>Join</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- presence & profile ---------------- */
function ProfilePanel({ accent, profile, setProfile, myStatus, setMyStatus, flash }) {
  const [text, setText] = React.useState(profile.statusText || "");
  const [emoji, setEmoji] = React.useState(profile.statusEmoji || "");
  return (
    <div>
      <SectionLabel>Custom status</SectionLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <TextInput value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="\u{1F642}"
          style={{ width: 52, flex: "0 0 52px", textAlign: "center" }} />
        <TextInput value={text} onChange={e => setText(e.target.value)} placeholder="What's your status?" />
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {STATUS_PRESETS.map(p => (
          <button key={p.text} onClick={() => { setEmoji(p.emoji); setText(p.text); }} style={{
            display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 20,
            border: `1px solid ${HAIRLINE}`, background: "#fff", cursor: "pointer", fontSize: 11,
          }}>{p.emoji} {p.text}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
        {[30, 60, 240, 0].map(m => (
          <button key={m} onClick={() => {
            setProfile(p => ({ ...p, statusText: text, statusEmoji: emoji, statusExpiry: m ? Date.now() + m * 60000 : null }));
            flash(m ? `Status set for ${m} minutes` : "Status set");
          }} style={{
            flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11, cursor: "pointer",
            border: `1px solid ${HAIRLINE}`, background: "#fff", color: accent.deep,
          }}>{m ? (m >= 60 ? `${m / 60}h` : `${m}m`) : "No expiry"}</button>
        ))}
      </div>

      <SectionLabel>Availability</SectionLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {["online", "away", "busy", "dnd"].map(s => (
          <button key={s} onClick={() => setMyStatus(s)} style={{
            display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
            padding: "5px 10px", borderRadius: 20, fontSize: 11.5,
            border: `1px solid ${myStatus === s ? STATUSES[s].color : HAIRLINE}`,
            background: myStatus === s ? STATUSES[s].color + "14" : "#fff",
            color: myStatus === s ? INK : MUTED, fontWeight: myStatus === s ? 600 : 500,
          }}>
            <Dot color={STATUSES[s].color} size={7} ring={false} />{STATUSES[s].label}
          </button>
        ))}
      </div>

      <Field label="Working hours">
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <TextInput value={profile.workStart} onChange={e => setProfile(p => ({ ...p, workStart: e.target.value }))} style={{ width: 70, flex: "0 0 70px" }} />
          <span style={{ fontSize: 12, color: MUTED }}>to</span>
          <TextInput value={profile.workEnd} onChange={e => setProfile(p => ({ ...p, workEnd: e.target.value }))} style={{ width: 70, flex: "0 0 70px" }} />
          <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>
            {profile.tz.split("/")[1]} &middot; {localTimeIn(profile.tz)}
          </span>
        </div>
      </Field>

      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderTop: `1px solid ${HAIRLINE}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5 }}>Out of office</div>
          <div style={{ fontSize: 11, color: MUTED }}>Auto-reply to anyone who messages you</div>
        </div>
        <Toggle accent={accent} on={!!profile.ooo} onChange={v => setProfile(p => ({ ...p, ooo: v }))} />
      </div>
      {profile.ooo && (
        <TextInput value={profile.oooMessage} onChange={e => setProfile(p => ({ ...p, oooMessage: e.target.value }))}
          placeholder="I am out until Monday. For AR escalations contact Manasi." style={{ marginBottom: 12 }} />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderTop: `1px solid ${HAIRLINE}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5 }}>Do not disturb schedule</div>
          <div style={{ fontSize: 11, color: MUTED }}>Silence notifications on a timer</div>
        </div>
        <Toggle accent={accent} on={!!profile.dndSchedule} onChange={v => setProfile(p => ({ ...p, dndSchedule: v }))} />
      </div>
      {profile.dndSchedule && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <TextInput value={profile.dndStart} onChange={e => setProfile(p => ({ ...p, dndStart: e.target.value }))} style={{ width: 70, flex: "0 0 70px" }} />
          <span style={{ fontSize: 12, color: MUTED }}>to</span>
          <TextInput value={profile.dndEnd} onChange={e => setProfile(p => ({ ...p, dndEnd: e.target.value }))} style={{ width: 70, flex: "0 0 70px" }} />
        </div>
      )}
    </div>
  );
}

/* ---------------- org directory ---------------- */
function OrgDirectory({ people, accent, onMessage, onClose }) {
  const [q, setQ] = React.useState("");
  const [team, setTeam] = React.useState("All");
  const rows = people.filter(p => {
    if (team !== "All" && TEAM_OF[p.id] !== team) return false;
    const hay = (p.name + " " + p.role + " " + (SKILLS[p.id] || []).join(" ") + " " + TEAM_OF[p.id]).toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff", zIndex: 16, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
        <button onClick={onClose} aria-label="Close directory" style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex", padding: 0 }}>
          <ArrowLeft size={15} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 650 }}>Directory</span>
      </div>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", background: "#F4F5F7", borderRadius: 8, marginBottom: 8 }}>
          <Search size={14} color={MUTED} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, role or skill"
            style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, flex: 1, color: INK }} />
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {["All", ...TEAMS].map(t => (
            <button key={t} onClick={() => setTeam(t)} style={{
              padding: "4px 9px", borderRadius: 20, fontSize: 10.5, cursor: "pointer",
              border: `1px solid ${team === t ? accent.base : HAIRLINE}`,
              background: team === t ? accent.soft : "#fff", color: team === t ? accent.deep : MUTED,
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div className="kd-scroll" style={{ flex: 1, overflowY: "auto" }}>
        {rows.length === 0 && <div style={{ padding: "30px 18px", textAlign: "center", fontSize: 12.5, color: MUTED }}>Nobody matches that.</div>}
        {rows.map(p => (
          <div key={p.id} style={{ display: "flex", gap: 10, padding: "11px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
            <div style={{ position: "relative" }}>
              <Avatar initials={p.initials} size={34} />
              <span style={{ position: "absolute", right: -1, bottom: -1 }}><Dot color={STATUSES[p.status].color} size={9} /></span>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: MUTED }}>{p.role} &middot; {TEAM_OF[p.id]}</div>
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
                {localTimeIn(TZ_OF[p.id])} local
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                {(SKILLS[p.id] || []).map(s => (
                  <span key={s} style={{
                    fontSize: 9.5, padding: "1px 6px", borderRadius: 20,
                    background: accent.soft, color: accent.deep,
                  }}>{s}</span>
                ))}
              </div>
            </div>
            <button onClick={() => onMessage(p)} style={{
              alignSelf: "center", border: "none", background: accent.base, color: "#fff",
              borderRadius: 7, padding: "5px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
            }}>Message</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- notifications settings ---------------- */
function NotifSettings({ accent, prefs, setPrefs, channels, onPatchChannel, flash }) {
  const [kw, setKw] = React.useState("");
  return (
    <div>
      <SectionLabel>Delivery</SectionLabel>
      {[
        ["desktop", "Desktop notifications", "Browser notifications while Kody is open"],
        ["push", "Mobile push", "Requires the Kody mobile app"],
        ["digest", "Email digest", "A daily summary of what you missed"],
      ].map(([k, label, sub]) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5 }}>{label}</div>
            <div style={{ fontSize: 11, color: MUTED }}>{sub}</div>
          </div>
          <Toggle accent={accent} on={!!prefs[k]} onChange={v => {
            setPrefs(p => ({ ...p, [k]: v }));
            if (k === "desktop" && v) {
              try { if (typeof Notification !== "undefined" && Notification.requestPermission) Notification.requestPermission(); }
              catch (e) { /* not available */ }
            }
          }} />
        </div>
      ))}

      <SectionLabel>Quiet hours</SectionLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5 }}>Silence outside working hours</div>
        </div>
        <Toggle accent={accent} on={!!prefs.quiet} onChange={v => setPrefs(p => ({ ...p, quiet: v }))} />
      </div>
      {prefs.quiet && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
          <TextInput value={prefs.quietStart} onChange={e => setPrefs(p => ({ ...p, quietStart: e.target.value }))} style={{ width: 70, flex: "0 0 70px" }} />
          <span style={{ fontSize: 12, color: MUTED }}>to</span>
          <TextInput value={prefs.quietEnd} onChange={e => setPrefs(p => ({ ...p, quietEnd: e.target.value }))} style={{ width: 70, flex: "0 0 70px" }} />
        </div>
      )}

      <SectionLabel>Keyword alerts</SectionLabel>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 7 }}>
        {(prefs.keywords || []).map(k => (
          <span key={k} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 20,
            background: accent.soft, color: accent.deep, fontSize: 11,
          }}>
            {k}
            <button onClick={() => setPrefs(p => ({ ...p, keywords: p.keywords.filter(x => x !== k) }))}
              aria-label={"Remove " + k}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: accent.deep, display: "flex", padding: 0 }}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <TextInput value={kw} onChange={e => setKw(e.target.value)} placeholder="e.g. CO-97, escalation"
          onKeyDown={e => {
            if (e.key === "Enter" && kw.trim()) {
              setPrefs(p => ({ ...p, keywords: [...(p.keywords || []), kw.trim()] })); setKw("");
            }
          }} />
        <button onClick={() => { if (kw.trim()) { setPrefs(p => ({ ...p, keywords: [...(p.keywords || []), kw.trim()] })); setKw(""); } }}
          style={{ border: "none", background: accent.base, color: "#fff", borderRadius: 8, padding: "0 12px", fontSize: 12, cursor: "pointer" }}>
          Add
        </button>
      </div>

      <SectionLabel>Per channel</SectionLabel>
      {channels.map(c => (
        <div key={c.id} style={{ padding: "8px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
          <div style={{ fontSize: 12, marginBottom: 5 }}>#{c.name}</div>
          <Segmented accent={accent} value={c.notif || "all"} options={NOTIF_LEVELS}
            onChange={v => onPatchChannel(c.id, { notif: v })} />
        </div>
      ))}
    </div>
  );
}

/* ---------------- search ---------------- */
function SearchPanel({ accent, convos, people, groups, channels, saved, setSaved, onOpenConvo, onClose, flash }) {
  const [q, setQ] = React.useState("");
  const results = runSearch(q, convos, people, groups, channels);
  const msgHits = results.filter(r => r.type === "message");
  const peopleHits = results.filter(r => r.type === "person");
  const chanHits = results.filter(r => r.type === "channel");

  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff", zIndex: 17, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
        <button onClick={onClose} aria-label="Close search" style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex", padding: 0 }}>
          <ArrowLeft size={15} />
        </button>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", background: "#F4F5F7", borderRadius: 8 }}>
          <Search size={14} color={MUTED} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search everything"
            style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, flex: 1, color: INK }} />
        </div>
        {q.trim() && (
          <button onClick={() => { setSaved(s => [...s, q]); flash("Search saved"); }} aria-label="Save search"
            style={{ border: "none", background: "transparent", cursor: "pointer", color: accent.base, display: "flex" }}>
            <Bookmark size={15} />
          </button>
        )}
      </div>

      <div style={{ padding: "7px 12px", borderBottom: `1px solid ${HAIRLINE}`, background: "#FCFCFD" }}>
        <div style={{ fontSize: 10.5, color: MUTED }}>
          Operators: from:pavithran &middot; in:denials-help &middot; has:file &middot; after:2026-09-01
        </div>
      </div>

      {saved.length > 0 && !q.trim() && (
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6 }}>Saved searches</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {saved.map((s, i) => (
              <button key={i} onClick={() => setQ(s)} style={{
                padding: "4px 9px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                border: `1px solid ${HAIRLINE}`, background: "#fff", color: accent.deep,
              }}>{s}</button>
            ))}
          </div>
        </div>
      )}

      <div className="kd-scroll" style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {!q.trim() && (
          <div style={{ padding: "26px 16px", textAlign: "center", fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
            Search messages, files, people and channels.
          </div>
        )}
        {q.trim() && results.length === 0 && (
          <div style={{ padding: "26px 16px", textAlign: "center", fontSize: 12.5, color: MUTED }}>
            Nothing matches that.
          </div>
        )}

        {peopleHits.length > 0 && <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: "2px 0 6px" }}>People</div>}
        {peopleHits.map(r => (
          <div key={"p" + r.person.id} style={{
            display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", marginBottom: 6,
            border: `1px solid ${HAIRLINE}`, borderRadius: 9, background: "#fff",
          }}>
            <Avatar initials={r.person.initials} size={26} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5 }}>{r.person.name}</div>
              <div style={{ fontSize: 10.5, color: MUTED }}>{r.person.role}</div>
            </div>
          </div>
        ))}

        {chanHits.length > 0 && <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: "8px 0 6px" }}>Channels</div>}
        {chanHits.map(r => (
          <div key={"c" + r.channel.id} style={{
            display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", marginBottom: 6,
            border: `1px solid ${HAIRLINE}`, borderRadius: 9, background: "#fff",
          }}>
            <Avatar size={26} square tint={accent.base} glyph="#" />
            <div style={{ fontSize: 12.5 }}>{r.channel.name}</div>
          </div>
        ))}

        {msgHits.length > 0 && (
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: "8px 0 6px" }}>
            Messages ({msgHits.length})
          </div>
        )}
        {msgHits.slice(0, 40).map((r, i) => (
          <button key={"m" + i} onClick={() => onOpenConvo(r.convo)} style={{
            width: "100%", textAlign: "left", padding: "9px 10px", marginBottom: 6,
            border: `1px solid ${HAIRLINE}`, borderRadius: 9, background: "#fff", cursor: "pointer",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: accent.deep }}>{r.convoName}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: MUTED }}>
                {new Date(r.msg.ts).toLocaleDateString()}
              </span>
            </div>
            <div style={{ fontSize: 12, color: INK, lineHeight: 1.45 }}>
              {(r.msg.text || "").slice(0, 120) || "file"}
            </div>
            {r.msg.files && r.msg.files.length > 0 && (
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>
                {r.msg.files.length} attachment{r.msg.files.length > 1 ? "s" : ""}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- quick switcher ---------------- */
function QuickSwitcher({ accent, people, groups, channels, onPick, onClose }) {
  const [q, setQ] = React.useState("");
  const items = [
    ...people.map(p => ({ kind: "dm", id: p.id, label: p.name, icon: "person" })),
    ...groups.map(g => ({ kind: "group", id: g.id, label: g.name, icon: "group" })),
    ...channels.map(c => ({ kind: "channel", id: c.id, label: "#" + c.name, icon: "channel" })),
  ].filter(i => i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 8);

  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, background: "rgba(16,24,40,0.45)", zIndex: 22,
      display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 54,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "88%", background: "#fff", borderRadius: 12, overflow: "hidden",
        boxShadow: "0 16px 40px rgba(16,24,40,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
          <Command size={14} color={accent.base} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Jump to a conversation"
            onKeyDown={e => { if (e.key === "Enter" && items[0]) onPick(items[0]); }}
            style={{ border: "none", outline: "none", fontSize: 13.5, flex: 1, color: INK }} />
        </div>
        <div className="kd-scroll" style={{ maxHeight: 250, overflowY: "auto" }}>
          {items.length === 0 && <div style={{ padding: "20px 14px", fontSize: 12.5, color: MUTED, textAlign: "center" }}>No match.</div>}
          {items.map(i => (
            <button key={i.kind + i.id} onClick={() => onPick(i)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "9px 12px",
              border: "none", borderBottom: `1px solid ${HAIRLINE}`, background: "#fff",
              cursor: "pointer", textAlign: "left", fontSize: 12.5,
            }}>
              {i.icon === "channel" ? <Hash size={13} color={MUTED} />
                : i.icon === "group" ? <Users size={13} color={MUTED} />
                : <MessageSquare size={13} color={MUTED} />}
              {i.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- per-space file browser ---------------- */
function FileBrowser({ accent, msgs, people, onOpen, onClose }) {
  const [kind, setKind] = React.useState("all");
  const files = [];
  msgs.forEach(m => (m.files || []).forEach(f => files.push({ ...f, from: m.from, ts: m.ts })));
  const rows = files.filter(f => kind === "all" || (kind === "media" ? (f.kind === "image" || f.kind === "video") : f.kind === kind));
  const nameOf = (uid) => uid === 0 ? "You" : (people.find(p => p.id === uid)?.name || "Someone");

  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff", zIndex: 16, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
        <button onClick={onClose} aria-label="Close files" style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex", padding: 0 }}>
          <ArrowLeft size={15} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 650 }}>Files</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>{rows.length}</span>
      </div>
      <div style={{ padding: "9px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
        <Segmented accent={accent} value={kind} onChange={setKind}
          options={[{ key: "all", label: "All" }, { key: "media", label: "Media" }, { key: "audio", label: "Voice" }, { key: "file", label: "Docs" }]} />
      </div>
      <div className="kd-scroll" style={{ flex: 1, overflowY: "auto" }}>
        {rows.length === 0 && (
          <div style={{ padding: "30px 18px", textAlign: "center", fontSize: 12.5, color: MUTED }}>
            No files here yet.
          </div>
        )}
        {rows.map(f => (
          <div key={f.id} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
            borderBottom: `1px solid ${HAIRLINE}`,
          }}>
            {(f.kind === "image" || f.kind === "video") && f.url
              ? <button onClick={() => onOpen(f)} style={{ border: "none", padding: 0, borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "#F2F4F7", width: 34, height: 34 }}>
                  {f.kind === "video"
                    ? <video src={f.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <img src={f.url} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </button>
              : <span style={{ width: 34, height: 34, borderRadius: 6, background: accent.soft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {f.kind === "audio" ? <Mic size={14} color={accent.base} /> : <FileText size={14} color={accent.base} />}
                </span>}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              <div style={{ fontSize: 10.5, color: MUTED }}>
                {nameOf(f.from)} &middot; {f.size} &middot; {new Date(f.ts).toLocaleDateString()}
              </div>
            </div>
            <span title="Scanned, no threats found" style={{ display: "flex" }}>
              <ShieldCheck size={13} color={GREEN} />
            </span>
            <a href={f.url || "#"} download={f.name} onClick={e => { if (!f.url) e.preventDefault(); }}
              aria-label={"Download " + f.name}
              style={{ color: MUTED, display: "flex" }}><Download size={14} /></a>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function KodyPrototype() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState("ask");
  const [accentKey, setAccentKey] = useState("gold");
  const [kodyAvatar, setKodyAvatar] = useState("mark");
  const [photoUrl, setPhotoUrl] = useState(null);
  const [wallpaper, setWallpaper] = useState("none");
  const [forceClosed, setForceClosed] = useState(false);
  const [hint, setHint] = useState(null);
  const [overlay, setOverlay] = useState(null);          /* search | directory | quickswitch */
  const [savedSearches, setSavedSearches] = useState(["in:denials-help has:file"]);
  const [chatConvos, setChatConvos] = useState(CHAT_SEED); /* seeded so search works before Chats is opened */
  const [jumpTo, setJumpTo] = useState(null);
  const [profile, setProfile] = useState({
    statusText: "", statusEmoji: "", statusExpiry: null,
    tz: "Asia/Kolkata", workStart: "09:30", workEnd: "18:30",
    ooo: false, oooMessage: "", dndSchedule: false, dndStart: "20:00", dndEnd: "08:00",
  });
  const [notifPrefs, setNotifPrefs] = useState({
    desktop: false, push: false, digest: true,
    quiet: true, quietStart: "20:00", quietEnd: "08:00",
    keywords: ["CO-97", "escalation"],
  });
  const [myStatus, setMyStatus] = useState("online");
  const [predictive, setPredictive] = useState(true);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const [thread, setThread] = useState(seedThread);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [savedIds, setSavedIds] = useState([]);
  const [shareFor, setShareFor] = useState(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [segment, setSegment] = useState("direct");
  const [chatQuery, setChatQuery] = useState("");
  const [activeChat, setActiveChat] = useState(null);
  const [convos, setConvos] = useState({});
  const [roomDraft, setRoomDraft] = useState("");
  const [groups, setGroups] = useState(SEED_GROUPS);
  const [channels, setChannels] = useState(SEED_CHANNELS);
  const [createOpen, setCreateOpen] = useState(null);
  const [newName, setNewName] = useState("");
  const [newMembers, setNewMembers] = useState([]);

  const [sheet, setSheet] = useState(null);
  const [points, setPoints] = useState(1450);
  const [ledger, setLedger] = useState([
    { id: "l1", text: POINTS.earn.helpful.label,     pts: POINTS.earn.helpful.pts,     when: "Today" },
    { id: "l2", text: POINTS.earn.adopted.label,     pts: POINTS.earn.adopted.pts,     when: "Yesterday" },
    { id: "l3", text: POINTS.earn.smeAccepted.label, pts: POINTS.earn.smeAccepted.pts, when: "3 Sep" },
  ]);
  const [earnedToday, setEarnedToday] = useState(POINTS.earn.helpful.pts);
  const [notifs, setNotifs] = useState(SEED_NOTIFS);
  const [customLinks, setCustomLinks] = useState([{ label: "My payer matrix", host: "internal" }]);
  const [newLink, setNewLink] = useState("");
  const [recentCodes, setRecentCodes] = useState([
    { code: "D0140", set: "CDT" }, { code: "97110", set: "CPT" },
    { code: "M54.5", set: "ICD-10" }, { code: "CO-97", set: "CARC" },
  ]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [tourStep, setTourStep] = useState(null);
  const [tourDone, setTourDone] = useState(false);
  const [selChip, setSelChip] = useState(null);
  const [recording, setRecording] = useState(null);
  const [toast, setToast] = useState(null);
  const [unread, setUnread] = useState(true);

  const accent = ACCENTS[accentKey];
  const dragRef = useRef({ active: false, dx: 0, dy: 0, moved: false });
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const avatarRef = useRef(null);
  const inputRef = useRef(null);

  const W = expanded ? 440 : 376;
  const H = expanded ? 648 : 556;
  const avatarDef = kodyAvatar === "photo" && photoUrl
    ? { key: "photo", label: "Your photo", photo: photoUrl }
    : (AVATARS.find(a => a.key === kodyAvatar) || AVATARS[0]);
  const unreadNotifs = notifs.filter(n => n.unread).length;

  useEffect(() => { setPos({ x: window.innerWidth - 96, y: window.innerHeight - 108 }); }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, thinking, tab, expanded, convos, activeChat]);

  /* keyboard summon */
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "K" || e.key === "k")) {
        e.preventDefault();
        setForceClosed(false);
        setOpen(o => {
          const next = !o;
          if (next) { setUnread(false); setTimeout(() => inputRef.current?.focus(), 60); }
          return next;
        });
      }
      if (e.ctrlKey && !e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); setForceClosed(false); setOpen(true); setOverlay("quickswitch");
      }
      if (e.key === "Escape") { setEmojiOpen(false); setToolsOpen(false); setSheet(null); setCreateOpen(null); setOverlay(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* select and ask */
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const t = sel ? sel.toString().trim() : "";
      if (t.length > 3 && sel.rangeCount) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        setSelChip({ text: t, x: r.left + r.width / 2, y: r.top });
      } else setSelChip(null);
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  /* recording timer */
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecording(r => r ? { ...r, s: r.s + 1 } : r), 1000);
    return () => clearInterval(t);
  }, [recording]);

  /* predictive results - fires while Kody is minimised, from the page context */
  useEffect(() => {
    if (!predictive || forceClosed || open) { setHint(null); return; }
    const t = setTimeout(() => {
      setHint({
        title: "Spotted on this page",
        body: "Line 2 is a CO-97 inclusive denial and the provider is out of network.",
        ask: "How do I handle a CO-97 denial when the provider is out of network?",
      });
    }, 6000);
    return () => clearTimeout(t);
  }, [predictive, forceClosed, open]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 1900); };

  const openPanel = () => {
    if (forceClosed) { setForceClosed(false); flash("Kody is back"); return; }
    setOpen(true); setUnread(false); setHint(null);
    if (!tourDone && tourStep === null) setTourStep(0);
  };

  /* ---- drag ---- */
  const onPointerDown = (e) => {
    dragRef.current = { active: true, dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = useCallback((e) => {
    if (!dragRef.current.active) return;
    const nx = e.clientX - dragRef.current.dx, ny = e.clientY - dragRef.current.dy;
    if (Math.abs(nx - pos.x) > 3 || Math.abs(ny - pos.y) > 3) dragRef.current.moved = true;
    setPos({
      x: Math.max(8, Math.min(window.innerWidth - 64, nx)),
      y: Math.max(8, Math.min(window.innerHeight - 64, ny)),
    });
  }, [pos.x, pos.y]);
  const onPointerUp = () => {
    const moved = dragRef.current.moved;
    dragRef.current.active = false; setDragging(false);
    if (!moved) openPanel();
  };

  const anchor = () => {
    const left = pos.x + 56 + W > window.innerWidth ? Math.max(8, pos.x + 56 - W) : pos.x;
    const top = pos.y - H - 12 < 8 ? Math.min(pos.y + 68, window.innerHeight - H - 8) : pos.y - H - 12;
    return { left: Math.max(8, left), top: Math.max(8, top) };
  };

  /* ---- answers ---- */
  const routeDomain = (t) => {
    const s = t.toLowerCase();
    if (/(cpt|cdt|icd|denial|claim|payer|ar |billing|coding|posting|carc|eob|adjudicat|appeal|filing|hipaa|hippa|hipa|phi|eligibilit|authoriz|modifier|remit|deductible|copay|coinsurance|revenue cycle|rcm)/.test(s)) return "rcm";
    if (/(sprint|scrum|agile|standup|retro|backlog|story point|jira|velocity)/.test(s)) return "agile";
    if (/(soc|iam|phish|vulnerab|firewall|siem|pentest|cve|audit|iso 27001)/.test(s)) return "cyber";
    if (/(react|node|api|sql|deploy|bug|function|database|git|typescript)/.test(s)) return "dev";
    return "general";
  };

  const canned = (domain, hasFile) => {
    const base = {
      rcm: {
        text: hasFile
          ? "I read the attached remittance. Two lines are denied as inclusive and one shows a patient responsibility mismatch. Start with the inclusive lines - check the primary procedure before adjusting anything."
          : "For an inclusive denial the payer is saying the service is bundled into another line on the same claim. Check the primary procedure on the EOB, confirm whether a modifier would unbundle it legitimately, and only write off once the bundling is confirmed correct.",
        confidence: "medium",
        source: { name: "CARC/RARC reference", asOf: "Aug 2026" },
        disclaimer: "Confirm against the payer's current bundling policy before adjusting the account.",
        code: { code: "CO-97", set: "CARC" },
      },
      agile: {
        text: "Keep the retrospective to one improvement the team actually owns. Pick the item with the shortest feedback loop, put a name against it, and review it at the next retro before adding anything new.",
        confidence: "high", source: { name: "Scrum Guide 2020", asOf: "Nov 2020" }, disclaimer: null,
      },
      cyber: {
        text: "Start with scope: which accounts hold privileged access, and which of those lack MFA. That list is usually short and it is where most of the risk sits. Everything else can wait until it is closed.",
        confidence: "medium", source: { name: "ISO 27001:2022 A.5.15", asOf: "2022" },
        disclaimer: "Guidance only. Align with your organisation's control framework.",
      },
      dev: {
        text: "Put the retry and fallback in one gateway module rather than at each call site. Every caller then gets the same behaviour and you change vendors in one file.",
        confidence: "high", source: { name: "Dolluz engineering notes", asOf: "Sep 2026" }, disclaimer: null,
      },
      general: {
        text: "I could not reach the answer service just now, so I cannot give you a proper answer to this one. Check your connection and ask again.",
        confidence: "low", source: { name: "Offline fallback", asOf: "Sep 2026" },
        disclaimer: null,
      },
    }[domain];
    return { ...base, domain };
  };

  const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const KODY_SYSTEM = `You are Kody, a work companion built by Dolluz Corp for working professionals.

You have specialist depth in four domains:
- rcm: US healthcare revenue cycle. Medical coding, billing, denials, AR calling, payment posting, adjudication, transcription, payer rules, HIPAA and healthcare compliance.
- agile: Agile, Scrum, project and delivery management.
- cyber: Cybersecurity, SOC, IAM, audits, standards and controls.
- dev: Software development, architecture and debugging.

Rules:
1. ALWAYS answer the question. Never refuse an ordinary question and never reply with only a disclaimer. Questions outside the four domains still get a real, useful answer, just with lower confidence.
2. You HAVE a web_search tool. Use it whenever the question asks for links, downloads, current facts, prices, people, products, news, or anything that may have changed. NEVER say you cannot browse the internet, cannot fetch links, or that your knowledge has a cutoff. Search instead.
3. When the user asks for links, resources, downloads or references, ALWAYS search and ALWAYS fill the "links" array with real URLs you actually found. Never put URLs in the "text" field.
4. Correct obvious misspellings silently. "HIPPA" means HIPAA.
5. Be direct and concise. 2 to 4 sentences of actual substance.
6. Never use em dashes or en dashes. Use a plain hyphen.
7. Only add a disclaimer when acting on the answer carries real risk. Otherwise use null.
8. Only fill "lookup" when one specific standard code clearly applies (CPT, CDT, ICD-10, HCPCS, CARC, RARC).

Reply with ONLY a JSON object, no markdown fences and no preamble:
{"domain":"rcm|agile|cyber|dev|general","text":"the answer, no URLs inside","confidence":"high|medium|low","source":{"name":"short source","asOf":"e.g. Sep 2026"},"disclaimer":"short caution or null","lookup":{"code":"","desc":"","set":""},"links":[{"title":"short label","url":"https://..."}]}`;

  /* ---- tier router ---- */
  const pickTier = (q) => {
    const s = q.trim().toUpperCase();
    for (const code of Object.keys(CODE_TABLE)) {
      if (s === code || new RegExp(`\\b${code.replace(/[.\-]/g, "\\$&")}\\b`).test(s)) {
        if (s.split(/\s+/).length <= 6) return { tier: 0, code };
      }
    }
    const l = q.toLowerCase();
    if (/(draft|appeal letter|compare|analys|analyz|walk me through|step by step|why would|root cause|review this|plan for)/.test(l)) return { tier: 3 };
    if (q.trim().split(/\s+/).length <= 5 && !/(hipaa|hippa|denial|code|payer|audit|sprint)/.test(l)) return { tier: 1 };
    return { tier: 2 };
  };

  const askKody = async (question, hasFile, fileName, history) => {
    const t0 = performance.now();
    const routed = pickTier(question || "");

    /* Tier 0 - local table, no network */
    if (routed.tier === 0) {
      const e = CODE_TABLE[routed.code];
      return {
        domain: "rcm", text: e.note, confidence: "high",
        source: { name: e.set + " code set", asOf: "2026" }, disclaimer: null,
        lookup: { code: routed.code, desc: e.desc, set: e.set },
        code: { code: routed.code, set: e.set },
        tier: 0, ms: Math.max(1, Math.round(performance.now() - t0)),
      };
    }

    const prompt = hasFile
      ? `The user attached a file named "${fileName}". Their question: ${question || "Review this document."}`
      : question;

    const msgs = [...(history || []), { role: "user", content: prompt }];

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: KODY_SYSTEM,
          messages: msgs,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      const data = await res.json();
      const blocks = data.content || [];
      const searched = blocks.some(c => c.type === "server_tool_use" || c.type === "web_search_tool_result");
      const raw = blocks.map(c => (c.type === "text" ? c.text : "")).filter(Boolean).join("\n");
      const clean = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      const p = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
      const lookup = p.lookup && p.lookup.code ? p.lookup : null;
      const links = Array.isArray(p.links)
        ? p.links.filter(l => l && typeof l.url === "string" && /^https?:\/\//.test(l.url))
            .map(l => ({ title: l.title || l.url, url: l.url })).slice(0, 8)
        : [];
      return {
        domain: DOMAINS[p.domain] ? p.domain : "general",
        text: (p.text || "").replace(/[\u2013\u2014]/g, "-"),
        confidence: ["high", "medium", "low"].includes(p.confidence) ? p.confidence : "medium",
        source: p.source && p.source.name ? p.source : { name: "Kody", asOf: "Sep 2026" },
        disclaimer: p.disclaimer && p.disclaimer !== "null" ? p.disclaimer : null,
        lookup, code: lookup ? { code: lookup.code, set: lookup.set } : null,
        links, tier: routed.tier, live: searched, ms: Math.round(performance.now() - t0),
      };
    } catch (err) {
      const fb = canned(routeDomain(question || ""), hasFile);
      return { ...fb, degraded: true, tier: routed.tier, ms: Math.round(performance.now() - t0) };
    }
  };

  const send = () => {
    const t = draft.trim();
    if (!t && !attachment) return;
    setThread(p => [...p, { id: "u" + Date.now(), side: "user", text: t, ts: now(), file: attachment }]);
    const hadFile = !!attachment;
    const fileName = attachment?.name;
    const history = thread.map(m => m.side === "user"
      ? { role: "user", content: m.text || (m.file ? `[attached ${m.file.name}]` : "") }
      : { role: "assistant", content: m.text || "" }
    ).filter(m => m.content);
    setDraft(""); setAttachment(null); setEmojiOpen(false); setToolsOpen(false); setThinking(true);
    askKody(t, hadFile, fileName, history).then(a => {
      setThread(p => [...p, { id: "k" + Date.now(), side: "kody", ts: now(), ...a }]);
      if (a.code) setRecentCodes(rc => [a.code, ...rc.filter(c => c.code !== a.code.code)].slice(0, 8));
      setThinking(false);
    });
  };

  const chatKey = (c) => c ? `${c.kind}:${c.id}` : null;

  const sendRoom = () => {
    const t = roomDraft.trim();
    if ((!t && !attachment) || !activeChat) return;
    const k = chatKey(activeChat);
    setConvos(p => ({ ...p, [k]: [...(p[k] || []), { me: true, text: t, file: attachment, ts: now() }] }));
    const askedKody = /@kody/i.test(t);
    setRoomDraft(""); setAttachment(null); setEmojiOpen(false); setToolsOpen(false);
    if (askedKody) {
      const roomHist = (convos[k] || []).map(m => m.kody
        ? { role: "assistant", content: m.text || "" }
        : { role: "user", content: m.text || "" }
      ).filter(m => m.content);
      askKody(t.replace(/@kody/ig, "").trim(), false, null, roomHist).then(a => {
        setConvos(p => ({ ...p, [k]: [...(p[k] || []), { kody: true, ts: now(), ...a }] }));
      });
    }
  };

  const toggleSave = (id) => {
    setSavedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    flash(savedIds.includes(id) ? "Removed from saved" : "Saved");
  };

  const creditPoints = () => {
    const e = POINTS.earn.helpful;
    if (earnedToday + e.pts > POINTS.dailyCap) {
      flash(`Daily cap reached (${POINTS.dailyCap} points)`);
      return;
    }
    setPoints(p => p + e.pts);
    setEarnedToday(v => v + e.pts);
    setLedger(l => [{ id: "l" + Date.now(), text: e.label, pts: e.pts, when: "Today" }, ...l]);
  };

  const patchChannel = (id, fields) =>
    setChannels(cs => cs.map(c => (c.id === id ? { ...c, ...fields } : c)));
  const patchGroup = (id, fields) =>
    setGroups(gs => gs.map(g => (g.id === id ? { ...g, ...fields } : g)));

  const shareText = () => {
    const m = shareFor;
    if (!m || typeof m !== "object") return "Shared from Kody";
    const links = (m.links || []).map(l => `${l.title}: ${l.url}`).join("\n");
    return [m.text, links].filter(Boolean).join("\n\n") + "\n\nShared from Kody by Dolluz Corp";
  };

  const openExt = (url) => {
    try { window.open(url, "_blank", "noopener"); } catch (e) { flash("Could not open"); }
    setShareFor(null);
  };

  const nativeShare = () => {
    const text = shareText();
    if (navigator.share) {
      navigator.share({ title: "Kody", text }).then(() => setShareFor(null)).catch(() => setShareFor(null));
    } else {
      copyText(text);
      setShareFor(null);
    }
  };

  const shareTo = (target) => {
    const k = target.kind ? chatKey(target) : `dm:${target.id}`;
    setConvos(p => ({ ...p, [k]: [...(p[k] || []), { me: true, text: "Shared a Kody answer with you", card: true, ts: now() }] }));
    setShareFor(null);
    flash(`Shared with ${target.name}`);
  };

  const copyText = (t) => {
    const text = String(t || "");
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => flash("Copied")).catch(() => flash("Could not copy"));
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      flash("Copied");
    } catch (e) { flash("Could not copy"); }
  };

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    if (f) setAttachment({ name: f.name });
    e.target.value = "";
  };

  const pickAvatar = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) { flash("Pick an image file"); return; }
    const reader = new FileReader();
    reader.onload = () => { setPhotoUrl(reader.result); setKodyAvatar("photo"); flash("Kody's photo updated"); };
    reader.onerror = () => flash("Could not read that image");
    reader.readAsDataURL(f);
  };

  const addEmoji = (em) => {
    if (tab === "ask") setDraft(d => d + em); else setRoomDraft(d => d + em);
    setEmojiOpen(false);
  };

  const snip = (kind) => {
    setToolsOpen(false);
    if (kind === "record") {
      if (recording) {
        setRecording(null);
        setAttachment({ name: "kody-recording-01.webm" });
        flash("Recording attached");
      } else { setRecording({ s: 0 }); flash("Recording started"); }
      return;
    }
    setAttachment({ name: kind === "full" ? "kody-fullscreen-01.png" : "kody-region-01.png" });
    flash(kind === "full" ? "Full screen captured" : "Region captured");
  };

  const useCode = (c) => {
    if (tab === "ask") setDraft(d => (d ? d + " " : "") + c.code);
    else setRoomDraft(d => (d ? d + " " : "") + c.code);
    setCodesOpen(false);
    inputRef.current?.focus();
  };

  const askSelection = () => {
    if (!selChip) return;
    setDraft(selChip.text);
    setTab("ask"); setActiveChat(null); setOpen(true); setUnread(false);
    setSelChip(null);
    window.getSelection()?.removeAllRanges();
    setTimeout(() => inputRef.current?.focus(), 60);
  };

  const createRoom = () => {
    const n = newName.trim();
    if (!n) return;
    const item = { id: (createOpen === "channel" ? "c" : "g") + Date.now(), name: n, members: newMembers, unread: 0 };
    if (createOpen === "channel") { setChannels(c => [...c, item]); setSegment("channels"); }
    else { setGroups(g => [...g, item]); setSegment("groups"); }
    setCreateOpen(null); setNewName(""); setNewMembers([]);
    flash((createOpen === "channel" ? "Channel " : "Group ") + n + " created");
  };

  const addLink = () => {
    const l = newLink.trim();
    if (!l) return;
    setCustomLinks(c => [...c, { label: l, host: "custom" }]);
    setNewLink("");
  };

  const state = open ? "active" : predictive ? "predictive" : "snooze";
  const stateColor = { active: accent.base, predictive: YELLOW, snooze: "#98A2B3" }[state];
  const panelPos = anchor();
  const composerValue = tab === "ask" ? draft : roomDraft;
  const canSend = !!(composerValue.trim() || attachment);
  const slashOpen = tab === "ask" && draft.startsWith("/");
  const slashMatches = SLASH.filter(s => s.cmd.startsWith(draft.split(" ")[0].toLowerCase()));
  const savedMsgs = thread.filter(m => savedIds.includes(m.id));
  const historyRows = SEED_HISTORY.filter(h => h.title.toLowerCase().includes(historyQuery.toLowerCase()));
  const activeMsgs = activeChat ? (convos[chatKey(activeChat)] || []) : [];

  const chatList = () => {
    const q = chatQuery.toLowerCase();
    if (segment === "direct") return PEOPLE.filter(p => p.name.toLowerCase().includes(q))
      .map(p => ({ kind: "dm", id: p.id, name: p.name, sub: p.role, status: p.status, initials: p.initials }));
    if (segment === "groups") return groups.filter(g => g.name.toLowerCase().includes(q))
      .map(g => ({ kind: "group", id: g.id, name: g.name, sub: `${g.members.length} members`, unread: g.unread }));
    return channels.filter(c => c.name.toLowerCase().includes(q))
      .map(c => ({ kind: "channel", id: c.id, name: c.name, sub: `${c.members.length} members`, unread: c.unread }));
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: CANVAS,
      fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      color: INK, overflow: "hidden",
    }} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>

      <style>{`
        .kd-scroll::-webkit-scrollbar { width: 6px; }
        .kd-scroll::-webkit-scrollbar-thumb { background: #D6DAE1; border-radius: 3px; }
        .kd-scroll::-webkit-scrollbar-track { background: transparent; }
        @keyframes kdIn { from { opacity: 0; transform: scale(.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes kdPulse { 0%,100% { opacity: .3; } 50% { opacity: .85; } }
        @keyframes kdBlink { 0%,80%,100% { opacity: .25; } 40% { opacity: 1; } }
        @keyframes kdBuzz { 0%,100% { transform: translateX(0) rotate(0); } 20% { transform: translateX(-2px) rotate(-6deg); } 40% { transform: translateX(2px) rotate(6deg); } 60% { transform: translateX(-1px) rotate(-3deg); } 80% { transform: translateX(1px) rotate(3deg); } }
        .kd-panel { animation: kdIn 190ms cubic-bezier(.2,.8,.3,1); }
        .kd-buzz { animation: kdBuzz 700ms ease-in-out 2s infinite; }
        button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${accent.base}; outline-offset: 1px; }
        @media (prefers-reduced-motion: reduce) { .kd-panel, .kd-buzz { animation: none; } }
      `}</style>

      <input ref={fileRef} type="file" onChange={pickFile} style={{ display: "none" }} />
      <input ref={avatarRef} type="file" accept="image/*" onChange={pickAvatar} style={{ display: "none" }} />

      {/* ---- backdrop: mock work surface, selectable ---- */}
      <div style={{ position: "absolute", inset: 0, padding: "26px 30px", overflow: "auto" }} className="kd-scroll">
        <div style={{ fontSize: 11, color: "#98A2B3", marginBottom: 14 }}>
          Mock payer portal. Select any sentence below, or press Ctrl+Shift+K.
        </div>
        <div style={{
          maxWidth: 560, background: "#fff", border: `1px solid ${HAIRLINE}`,
          borderRadius: 12, padding: "18px 20px",
        }}>
          <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 10 }}>Claim 88213-A &middot; remittance detail</div>
          <p style={{ fontSize: 12.5, lineHeight: 1.7, color: "#475467", margin: 0 }}>
            Line 2 denied with CARC CO-97: the benefit for this service is included in the payment
            for another service already adjudicated. Line 4 shows an allowed amount of 148.00 against
            a billed amount of 210.00, with patient responsibility calculated at 62.00. Provider is
            listed as out of network for this plan year. Timely filing limit for this payer is
            ninety days from date of service.
          </p>
        </div>
      </div>

      {/* select-and-ask chip */}
      {selChip && !open && (
        <button onClick={askSelection} style={{
          position: "absolute", left: Math.max(60, Math.min(selChip.x - 55, window.innerWidth - 130)),
          top: Math.max(8, selChip.y - 42), zIndex: 55,
          display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
          background: "#111417", color: "#fff", border: "none", borderRadius: 20,
          fontSize: 12, cursor: "pointer", boxShadow: "0 6px 18px rgba(16,24,40,0.28)",
        }}>
          <Logo size={14} /> Ask Kody
        </button>
      )}

      {/* ---------------- panel ---------------- */}
      {open && (
        <div className="kd-panel" style={{
          position: "absolute", left: panelPos.left, top: panelPos.top,
          width: W, height: H, background: "#fff", borderRadius: 16,
          border: `1px solid ${HAIRLINE}`,
          boxShadow: "0 20px 48px -12px rgba(16,24,40,0.22), 0 4px 12px rgba(16,24,40,0.06)",
          display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 40,
        }}>

          {/* brand strip */}
          <div style={{
            display: "flex", alignItems: "center", gap: 7, padding: "6px 12px",
            background: "#111417", flexShrink: 0,
          }}>
            <Logo size={15} />
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#E6C765", letterSpacing: "0.06em" }}>DOLLUZ CORP</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#7A8087" }}>One Place . One Start . One Team</span>
          </div>

          {/* header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 10px 10px 12px",
            borderBottom: `1px solid ${HAIRLINE}`, background: "#fff", flexShrink: 0,
          }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <Avatar initials="K" size={32} tint={avatarDef.glyph || avatarDef.photo ? null : accent.base}
                glyph={avatarDef.glyph} logo={avatarDef.logo} photo={avatarDef.photo} />
              <span style={{ position: "absolute", right: -1, bottom: -1 }}><Dot color={stateColor} size={9} /></span>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 650, letterSpacing: "-0.01em" }}>Kody</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 0.5 }}>
                {state === "active" ? "Ready" : state === "predictive" ? "Watching for context" : "Snoozed"}
              </div>
            </div>

            <button onClick={() => setSheet(sheet === "points" ? null : "points")} title="Cheer points"
              style={{
                display: "flex", alignItems: "center", gap: 4, border: `1px solid ${accent.base}44`,
                borderRadius: 20, padding: "3px 8px", background: accent.soft, cursor: "pointer",
                fontSize: 11, color: accent.deep, fontWeight: 600, flexShrink: 0,
              }}>
              <Award size={12} />{points.toLocaleString()}
            </button>
            <IconBtn accent={accent} title="Search" active={overlay === "search"}
              onClick={() => setOverlay(overlay === "search" ? null : "search")}>
              <Search size={15} />
            </IconBtn>
            <IconBtn accent={accent} title="Directory" active={overlay === "directory"}
              onClick={() => setOverlay(overlay === "directory" ? null : "directory")}>
              <Compass size={15} />
            </IconBtn>
            <IconBtn accent={accent} active={sheet === "notifications"} title="Notifications"
              badge={unreadNotifs ? RED : null}
              onClick={() => { setSheet(sheet === "notifications" ? null : "notifications"); }}>
              <Bell size={15} />
            </IconBtn>
            <IconBtn accent={accent} active={showSettings} onClick={() => setShowSettings(s => !s)} title="Settings">
              <Settings size={15} />
            </IconBtn>
            <IconBtn accent={accent} onClick={() => setExpanded(e => !e)} title={expanded ? "Contract" : "Expand"}>
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </IconBtn>
            <IconBtn accent={accent} onClick={() => setOpen(false)} title="Minimise"><Minus size={15} /></IconBtn>
          </div>

          {/* settings */}
          {showSettings && (
            <div className="kd-scroll" style={{
              padding: "12px 14px", borderBottom: `1px solid ${HAIRLINE}`,
              background: "#FCFCFD", flexShrink: 0, maxHeight: 250, overflowY: "auto",
            }}>
              <SectionLabel>Kody's face</SectionLabel>
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                {AVATARS.map(a => (
                  <button key={a.key} onClick={() => setKodyAvatar(a.key)} title={a.label}
                    style={{
                      padding: 2, borderRadius: "50%", cursor: "pointer", background: "transparent", display: "flex",
                      border: kodyAvatar === a.key ? `2px solid ${accent.base}` : "2px solid transparent",
                    }}>
                    <Avatar size={32} initials="K" glyph={a.glyph} logo={a.logo}
                      tint={a.glyph || a.logo ? null : accent.base} />
                  </button>
                ))}
                {photoUrl && (
                  <button onClick={() => setKodyAvatar("photo")} title="Your photo"
                    style={{
                      padding: 2, borderRadius: "50%", cursor: "pointer", background: "transparent", display: "flex",
                      border: kodyAvatar === "photo" ? `2px solid ${accent.base}` : "2px solid transparent",
                    }}>
                    <Avatar size={32} photo={photoUrl} />
                  </button>
                )}
                <button onClick={() => avatarRef.current?.click()} title="Upload a photo"
                  style={{
                    width: 36, height: 36, borderRadius: "50%", cursor: "pointer",
                    border: "1.5px dashed #C4CAD4", background: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", color: MUTED,
                  }}><Upload size={14} /></button>
              </div>

              <ProfilePanel accent={accent} profile={profile} setProfile={setProfile}
                myStatus={myStatus} setMyStatus={setMyStatus} flash={flash} />

              <SectionLabel>Notifications</SectionLabel>
              <NotifSettings accent={accent} prefs={notifPrefs} setPrefs={setNotifPrefs}
                channels={channels} onPatchChannel={patchChannel} flash={flash} />

              <SectionLabel>My quick links</SectionLabel>
              {customLinks.map((l, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                  <Link2 size={13} color={accent.base} />
                  <span style={{ fontSize: 12.5, flex: 1 }}>{l.label}</span>
                  <button onClick={() => setCustomLinks(c => c.filter((_, j) => j !== i))}
                    aria-label="Remove link"
                    style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex" }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, margin: "6px 0 14px" }}>
                <input value={newLink} onChange={e => setNewLink(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addLink(); }}
                  placeholder="Add a link name"
                  style={{
                    flex: 1, border: `1px solid ${HAIRLINE}`, borderRadius: 7,
                    padding: "6px 9px", fontSize: 12, outline: "none", fontFamily: "inherit",
                  }} />
                <button onClick={addLink} style={{
                  border: "none", background: accent.base, color: "#fff", borderRadius: 7,
                  padding: "0 12px", fontSize: 12, cursor: "pointer",
                }}>Add</button>
              </div>

              <SectionLabel>Theme</SectionLabel>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {Object.values(ACCENTS).map(a => (
                  <button key={a.key} onClick={() => setAccentKey(a.key)} title={a.name} style={{
                    width: 24, height: 24, borderRadius: "50%", background: a.base,
                    border: accentKey === a.key ? `2px solid ${INK}` : "2px solid transparent",
                    boxShadow: "0 0 0 2px #fff inset", cursor: "pointer",
                  }} />
                ))}
              </div>

              <SectionLabel>Wallpaper</SectionLabel>
              <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap" }}>
                {Object.entries(WALLPAPERS).map(([k, w]) => (
                  <button key={k} onClick={() => setWallpaper(k)} title={w.name} style={{
                    width: 34, height: 26, borderRadius: 6, background: w.css, cursor: "pointer",
                    border: wallpaper === k ? `2px solid ${accent.base}` : `1px solid ${HAIRLINE}`,
                  }} />
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <button onClick={() => setPredictive(p => !p)} role="switch" aria-checked={predictive}
                  style={{
                    width: 34, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                    background: predictive ? accent.base : "#D0D5DD", position: "relative",
                    transition: "background 140ms", flexShrink: 0,
                  }}>
                  <span style={{
                    position: "absolute", top: 2, left: predictive ? 16 : 2, width: 16, height: 16,
                    borderRadius: "50%", background: "#fff", transition: "left 140ms",
                  }} />
                </button>
                <div>
                  <div style={{ fontSize: 12.5 }}>Predictive suggestions</div>
                  <div style={{ fontSize: 11, color: MUTED }}>Approved page fields only. Never patient identifiers.</div>
                </div>
              </div>

              <button onClick={() => { setForceClosed(true); setOpen(false); setShowSettings(false); setHint(null); flash("Kody force closed. Click the bubble to bring it back."); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  width: "100%", marginTop: 14, padding: "9px 0", borderRadius: 8,
                  border: `1px solid ${RED}44`, background: "#FFFBFA", color: "#B42318",
                  fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                }}>
                <Power size={14} /> Force close Kody
              </button>
            </div>
          )}

          {/* tabs */}
          <div style={{ display: "flex", borderBottom: `1px solid ${HAIRLINE}`, flexShrink: 0, background: "#fff" }}>
            {[
              { k: "ask", label: "Ask", Icon: Sparkles },
              { k: "chats", label: "Chats", Icon: Users },
              { k: "saved", label: savedIds.length ? `Saved ${savedIds.length}` : "Saved", Icon: Bookmark },
              { k: "history", label: "History", Icon: Clock },
            ].map(t => (
              <button key={t.k} onClick={() => { setTab(t.k); setActiveChat(null); setEmojiOpen(false); setToolsOpen(false); }}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  padding: "9px 0", border: "none", background: "transparent", cursor: "pointer",
                  fontSize: 11.5, fontWeight: tab === t.k ? 600 : 500,
                  color: tab === t.k ? accent.base : MUTED,
                  boxShadow: tab === t.k ? `inset 0 -2px 0 ${accent.base}` : "none",
                }}>
                <t.Icon size={13} strokeWidth={2.2} />{t.label}
              </button>
            ))}
          </div>

          {/* body */}
          <div ref={scrollRef} className="kd-scroll" style={{
            flex: 1, overflowY: "auto", background: WALLPAPERS[wallpaper].css,
            padding: tab === "chats" ? 0 : "12px", display: tab === "chats" ? "flex" : "block",
          }}>

            {/* ASK */}
            {tab === "ask" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {thread.map(m => m.side === "user" ? (
                  <div key={m.id} style={{ alignSelf: "flex-end", maxWidth: "84%" }}>
                    <div style={{
                      background: accent.base, color: "#fff", padding: "8px 12px",
                      borderRadius: "12px 12px 3px 12px", fontSize: 13.5, lineHeight: 1.5,
                    }}>
                      {m.file && <div style={{ marginBottom: m.text ? 6 : 0 }}>
                        <FileChip name={m.file.name} accent={accent} compact /></div>}
                      {m.text}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "flex-end", marginTop: 2 }}>
                      <IconBtn accent={accent} active={savedIds.includes(m.id)}
                        onClick={() => toggleSave(m.id)} title={savedIds.includes(m.id) ? "Saved" : "Save"}>
                        <Bookmark size={13} fill={savedIds.includes(m.id) ? accent.base : "none"} />
                      </IconBtn>
                      <IconBtn accent={accent} onClick={() => setShareFor(m)} title="Share">
                        <Share2 size={13} />
                      </IconBtn>
                      <IconBtn accent={accent} onClick={() => { copyText(m.text); }} title="Copy">
                        <Copy size={13} />
                      </IconBtn>
                      <span style={{ fontSize: 10.5, color: MUTED, marginLeft: 3 }}>{m.ts}</span>
                    </div>
                  </div>
                ) : (
                  <AnswerCard key={m.id} msg={m} accent={accent} saved={savedIds.includes(m.id)}
                    onSave={() => toggleSave(m.id)} onShare={() => setShareFor(m)} onVoteUp={creditPoints} />
                ))}
                {thinking && (
                  <div style={{ display: "flex", gap: 4, padding: "10px 12px" }}>
                    {[0, 1, 2].map(i => <span key={i} style={{
                      width: 6, height: 6, borderRadius: "50%", background: accent.base,
                      animation: `kdBlink 1.1s ${i * 0.18}s infinite`,
                    }} />)}
                  </div>
                )}
              </div>
            )}

            {/* CHATS list */}
            {tab === "chats" && (
              <ChatSurface accent={accent} wallpaper={wallpaper} people={PEOPLE}
                groups={groups} channels={channels}
                patchGroup={patchGroup} patchChannel={patchChannel}
                setGroups={setGroups} setChannels={setChannels}
                me={{ id: 0, name: "You", initials: "SB", handle: "shoban" }}
                flash={flash} copyText={copyText}
                onShareOut={setShareFor} onConvosChange={setChatConvos}
                jumpTo={jumpTo} onJumped={() => setJumpTo(null)}
                onAskKody={(q, k) => askKody(q, false, null, []).then(a => flash("Kody replied in " + k))} />
            )}

            {/* SAVED */}
            {tab === "saved" && (savedMsgs.length === 0 ? (
              <div style={{ padding: "40px 22px", textAlign: "center" }}>
                <Bookmark size={22} color="#D0D5DD" strokeWidth={1.8} />
                <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, marginTop: 10 }}>
                  Answers you save appear here. Use the bookmark icon on any answer to keep it.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {savedMsgs.map(m => m.side === "user" ? (
                  <div key={m.id} style={{
                    background: "#fff", border: `1px solid ${HAIRLINE}`, borderRadius: 12, padding: "10px 12px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>Your question</span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>{m.ts}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: INK }}>{m.text}</p>
                    <div style={{ display: "flex", gap: 2, marginTop: 6 }}>
                      <IconBtn accent={accent} active onClick={() => toggleSave(m.id)} title="Remove from saved">
                        <Bookmark size={13} fill={accent.base} />
                      </IconBtn>
                      <IconBtn accent={accent} onClick={() => setShareFor(m)} title="Share"><Share2 size={13} /></IconBtn>
                      <IconBtn accent={accent} onClick={() => copyText(m.text)} title="Copy"><Copy size={13} /></IconBtn>
                    </div>
                  </div>
                ) : (
                  <AnswerCard key={m.id} msg={m} accent={accent} saved
                    onSave={() => toggleSave(m.id)} onShare={() => setShareFor(m)} onVoteUp={creditPoints} />
                ))}
              </div>
            ))}

            {/* HISTORY */}
            {tab === "history" && (
              <div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "7px 10px",
                  background: "#fff", borderRadius: 8, border: `1px solid ${HAIRLINE}`, marginBottom: 10,
                }}>
                  <Search size={14} color={MUTED} />
                  <input value={historyQuery} onChange={e => setHistoryQuery(e.target.value)}
                    placeholder="Search past conversations"
                    style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, flex: 1, color: INK }} />
                </div>
                {historyRows.length === 0 ? (
                  <div style={{ padding: "30px 18px", textAlign: "center", fontSize: 12.5, color: MUTED }}>
                    No conversation matches that. Try a different word.
                  </div>
                ) : historyRows.map(h => {
                  const d = DOMAINS[h.domain]; const HIcon = d.Icon;
                  return (
                    <button key={h.id} onClick={() => { setTab("ask"); flash("Opened: " + h.title); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10, marginBottom: 7,
                        padding: "10px 11px", border: `1px solid ${HAIRLINE}`, borderRadius: 10,
                        background: "#fff", cursor: "pointer", textAlign: "left",
                      }}>
                      <HIcon size={14} color={d.tint} style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, lineHeight: 1.35 }}>{h.title}</div>
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{h.when}</div>
                      </div>
                      <ChevronRight size={14} color={MUTED} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ---- sheets ---- */}
          {sheet && (
            <div style={{
              position: "absolute", inset: 0, background: "rgba(16,24,40,0.28)",
              display: "flex", alignItems: "flex-end", zIndex: 6,
            }} onClick={() => setSheet(null)}>
              <div onClick={e => e.stopPropagation()} className="kd-scroll" style={{
                width: "100%", background: "#fff", borderRadius: "14px 14px 0 0",
                padding: "14px 0 10px", maxHeight: "78%", overflowY: "auto",
              }}>
                {sheet === "points" && (
                  <>
                    <div style={{ padding: "0 16px 12px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Cheer points</div>
                      <div style={{
                        padding: "14px 16px", borderRadius: 12,
                        background: accent.soft, border: `1px solid ${accent.base}33`,
                      }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: 26, fontWeight: 700, color: accent.deep, letterSpacing: "-0.02em" }}>
                            {points.toLocaleString()}
                          </span>
                          <span style={{ fontSize: 12, color: MUTED }}>points</span>
                          <span style={{
                            marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: accent.deep,
                            background: "#fff", borderRadius: 20, padding: "3px 10px",
                          }}>{tierFor(points).name}</span>
                        </div>
                        {nextTier(points) && (
                          <>
                            <div style={{
                              height: 5, borderRadius: 3, background: "#fff",
                              marginTop: 11, overflow: "hidden",
                            }}>
                              <div style={{
                                height: "100%", borderRadius: 3, background: accent.base,
                                width: `${Math.min(100, Math.round((points / nextTier(points).at) * 100))}%`,
                              }} />
                            </div>
                            <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>
                              {(nextTier(points).at - points).toLocaleString()} points to {nextTier(points).name}
                            </div>
                          </>
                        )}
                      </div>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        fontSize: 11, color: MUTED, marginTop: 8,
                      }}>
                        <span>{POINTS.perCent.toLocaleString()} points = 1 cent</span>
                        {POINTS.showCash && <span style={{ marginLeft: "auto", color: INK }}>
                          worth {(points / POINTS.perCent).toFixed(2)} cents
                        </span>}
                        <span style={{ marginLeft: POINTS.showCash ? 0 : "auto" }}>
                          {earnedToday}/{POINTS.dailyCap} today
                        </span>
                      </div>
                    </div>
                    <div style={{ padding: "0 16px 6px", fontSize: 12, fontWeight: 600 }}>Recent activity</div>
                    {ledger.map(l => (
                      <div key={l.id} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "9px 16px",
                        borderTop: `1px solid ${HAIRLINE}`,
                      }}>
                        <Award size={14} color={accent.base} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5 }}>{l.text}</div>
                          <div style={{ fontSize: 11, color: MUTED }}>{l.when}</div>
                        </div>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: GREEN }}>+{l.pts}</span>
                      </div>
                    ))}
                  </>
                )}

                {sheet === "notifications" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", padding: "0 16px 12px" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Notifications</span>
                      <button onClick={() => setNotifs(n => n.map(x => ({ ...x, unread: false })))}
                        style={{
                          marginLeft: "auto", border: "none", background: "transparent",
                          cursor: "pointer", fontSize: 11.5, color: accent.deep, fontWeight: 600,
                        }}>Mark all read</button>
                    </div>
                    {notifs.map(n => {
                      const st = NOTIF_STYLE[n.kind];
                      return (
                        <div key={n.id} style={{
                          display: "flex", gap: 10, padding: "10px 16px",
                          borderTop: `1px solid ${HAIRLINE}`,
                          background: n.unread ? st.color + "0D" : "#fff",
                        }}>
                          <span style={{ marginTop: 5 }}><Dot color={st.color} size={8} ring={false} /></span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: st.color, marginBottom: 2 }}>{st.label}</div>
                            <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>{n.text}</div>
                            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{n.ts}</div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          )}

          {/* create group / channel */}
          {createOpen && (
            <div style={{
              position: "absolute", inset: 0, background: "rgba(16,24,40,0.28)",
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 7, padding: 16,
            }} onClick={() => setCreateOpen(null)}>
              <div onClick={e => e.stopPropagation()} style={{
                width: "100%", background: "#fff", borderRadius: 14, padding: 16,
                boxShadow: "0 12px 32px rgba(16,24,40,0.24)",
              }}>
                <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 12 }}>
                  New {createOpen}
                </div>
                <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
                  placeholder={createOpen === "channel" ? "channel-name" : "Group name"}
                  style={{
                    width: "100%", border: `1px solid ${HAIRLINE}`, borderRadius: 8,
                    padding: "9px 11px", fontSize: 13, outline: "none",
                    fontFamily: "inherit", marginBottom: 12, boxSizing: "border-box",
                  }} />
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 7 }}>
                  Members {newMembers.length > 0 && `(${newMembers.length})`}
                </div>
                <div className="kd-scroll" style={{ maxHeight: 150, overflowY: "auto", marginBottom: 14 }}>
                  {PEOPLE.map(p => {
                    const on = newMembers.includes(p.id);
                    return (
                      <button key={p.id}
                        onClick={() => setNewMembers(m => on ? m.filter(x => x !== p.id) : [...m, p.id])}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 9,
                          padding: "7px 4px", border: "none", background: "transparent",
                          cursor: "pointer", textAlign: "left",
                        }}>
                        <Avatar initials={p.initials} size={26} />
                        <span style={{ fontSize: 12.5, flex: 1 }}>{p.name}</span>
                        <span style={{
                          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                          border: `1.5px solid ${on ? accent.base : "#C4CAD4"}`,
                          background: on ? accent.base : "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>{on && <Check size={12} color="#fff" strokeWidth={3} />}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setCreateOpen(null)} style={{
                    flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${HAIRLINE}`,
                    background: "#fff", fontSize: 12.5, cursor: "pointer", color: MUTED,
                  }}>Cancel</button>
                  <button onClick={createRoom} disabled={!newName.trim()} style={{
                    flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                    background: newName.trim() ? accent.base : "#E7EAEE", color: "#fff",
                    fontSize: 12.5, fontWeight: 600, cursor: newName.trim() ? "pointer" : "default",
                  }}>Create</button>
                </div>
              </div>
            </div>
          )}

          {/* share sheet */}
          {shareFor && (
            <div style={{
              position: "absolute", inset: 0, background: "rgba(16,24,40,0.28)",
              display: "flex", alignItems: "flex-end", zIndex: 6,
            }} onClick={() => setShareFor(null)}>
              <div onClick={e => e.stopPropagation()} className="kd-scroll" style={{
                width: "100%", background: "#fff", borderRadius: "14px 14px 0 0",
                padding: "14px 0 8px", maxHeight: "76%", overflowY: "auto",
              }}>
                <div style={{ padding: "0 14px 10px", fontSize: 13, fontWeight: 600 }}>Share this</div>

                <div style={{ display: "flex", gap: 6, padding: "0 14px 12px" }}>
                  {[
                    { Icon: Copy, label: "Copy", fn: () => { copyText(shareText()); setShareFor(null); } },
                    { Icon: Mail, label: "Email", fn: () => { openExt("mailto:?subject=" + encodeURIComponent("From Kody") + "&body=" + encodeURIComponent(shareText())); } },
                    { Icon: MessageCircle, label: "WhatsApp", fn: () => { openExt("https://wa.me/?text=" + encodeURIComponent(shareText())); } },
                    { Icon: Share2, label: "More", fn: nativeShare },
                  ].map(o => (
                    <button key={o.label} onClick={o.fn} style={{
                      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                      padding: "10px 2px", border: `1px solid ${HAIRLINE}`, borderRadius: 9,
                      background: "#fff", cursor: "pointer",
                    }}>
                      <o.Icon size={16} color={accent.base} />
                      <span style={{ fontSize: 10.5, color: INK }}>{o.label}</span>
                    </button>
                  ))}
                </div>

                <div style={{ padding: "0 14px 6px", fontSize: 11.5, color: MUTED, borderTop: `1px solid ${HAIRLINE}`, paddingTop: 10 }}>
                  People
                </div>
                {PEOPLE.map(p => (
                  <button key={"p" + p.id} onClick={() => shareTo({ id: p.id, name: p.name })} style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                    border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                  }}>
                    <Avatar initials={p.initials} size={28} />
                    <span style={{ fontSize: 13 }}>{p.name}</span>
                  </button>
                ))}
                <div style={{ padding: "8px 14px 6px", fontSize: 11.5, color: MUTED, borderTop: `1px solid ${HAIRLINE}` }}>
                  Groups and channels
                </div>
                {[...groups.map(g => ({ ...g, kind: "group" })), ...channels.map(c => ({ ...c, kind: "channel" }))].map(r => (
                  <button key={r.kind + r.id} onClick={() => shareTo(r)} style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                    border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                  }}>
                    <Avatar size={28} square tint={accent.base}
                      glyph={r.kind === "channel" ? "#" : r.name.charAt(0).toUpperCase()} />
                    <span style={{ fontSize: 13 }}>{r.kind === "channel" ? "#" + r.name : r.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ---- utility area ---- */}
          {tab === "ask" && (
            <div style={{ borderTop: `1px solid ${HAIRLINE}`, background: "#fff", flexShrink: 0, position: "relative" }}>

              {/* slash menu */}
              {slashOpen && slashMatches.length > 0 && (
                <div style={{
                  position: "absolute", bottom: "100%", left: 8, right: 8, marginBottom: 6,
                  background: "#fff", border: `1px solid ${HAIRLINE}`, borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(16,24,40,0.14)", overflow: "hidden", zIndex: 8,
                }}>
                  {slashMatches.map(s => (
                    <button key={s.cmd} onClick={() => { setDraft(s.fill); inputRef.current?.focus(); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "9px 12px",
                        border: "none", borderBottom: `1px solid ${HAIRLINE}`, background: "#fff",
                        cursor: "pointer", textAlign: "left",
                      }}>
                      <Command size={13} color={accent.base} />
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: accent.deep }}>{s.cmd}</span>
                      <span style={{ fontSize: 12, color: MUTED }}>{s.hint}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* emoji */}
              {emojiOpen && (
                <div style={{
                  position: "absolute", bottom: "100%", left: 8, right: 8, marginBottom: 6,
                  background: "#fff", border: `1px solid ${HAIRLINE}`, borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(16,24,40,0.14)", padding: 8,
                  display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2, zIndex: 8,
                }}>
                  {EMOJIS.map(em => (
                    <button key={em} onClick={() => addEmoji(em)} style={{
                      border: "none", background: "transparent", cursor: "pointer",
                      fontSize: 17, padding: 4, borderRadius: 6, lineHeight: 1,
                    }}>{em}</button>
                  ))}
                </div>
              )}

              {/* tools tray */}
              {toolsOpen && (
                <div style={{
                  position: "absolute", bottom: "100%", left: 8, right: 8, marginBottom: 6,
                  background: "#fff", border: `1px solid ${HAIRLINE}`, borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(16,24,40,0.14)", padding: 8,
                  display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, zIndex: 8,
                }}>
                  {[
                    { Icon: Paperclip, label: "Attach", fn: () => { setToolsOpen(false); fileRef.current?.click(); } },
                    { Icon: Monitor, label: "Full screen", fn: () => snip("full") },
                    { Icon: Crop, label: "Region", fn: () => snip("region") },
                    { Icon: recording ? Square : Video, label: recording ? "Stop" : "Record", fn: () => snip("record") },
                    { Icon: Link2, label: "Quick links", fn: () => { setToolsOpen(false); setLinksOpen(true); } },
                    { Icon: Hash, label: "Recent codes", fn: () => { setToolsOpen(false); setCodesOpen(true); } },
                  ].map(t => (
                    <button key={t.label} onClick={t.fn} style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                      padding: "10px 4px", border: `1px solid ${HAIRLINE}`, borderRadius: 9,
                      background: "#fff", cursor: "pointer",
                    }}>
                      <t.Icon size={16} color={t.label === "Stop" ? RED : accent.base} />
                      <span style={{ fontSize: 10.5, color: INK }}>{t.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* quick links strip */}
              {linksOpen && (
                <div style={{ padding: "9px 12px 4px", borderBottom: `1px solid ${HAIRLINE}` }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: MUTED }}>Kody team links</span>
                    <button onClick={() => setLinksOpen(false)} style={{
                      marginLeft: "auto", border: "none", background: "transparent",
                      cursor: "pointer", color: MUTED, display: "flex",
                    }}><X size={13} /></button>
                  </div>
                  {KODY_LINKS.map((l, i) => (
                    <button key={i} onClick={() => flash("Opening " + l.label)} style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 2px",
                      border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                    }}>
                      <Link2 size={13} color={accent.base} />
                      <span style={{ fontSize: 12.5 }}>{l.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>{l.host}</span>
                    </button>
                  ))}
                  {customLinks.length > 0 && (
                    <div style={{ fontSize: 11, color: MUTED, margin: "6px 0 2px" }}>My links</div>
                  )}
                  {customLinks.map((l, i) => (
                    <button key={"c" + i} onClick={() => flash("Opening " + l.label)} style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 2px",
                      border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                    }}>
                      <Link2 size={13} color={MUTED} />
                      <span style={{ fontSize: 12.5 }}>{l.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>{l.host}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* recent codes strip */}
              {codesOpen && (
                <div style={{ padding: "9px 12px", borderBottom: `1px solid ${HAIRLINE}` }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 7 }}>
                    <span style={{ fontSize: 11, color: MUTED }}>Recent codes</span>
                    <button onClick={() => setCodesOpen(false)} style={{
                      marginLeft: "auto", border: "none", background: "transparent",
                      cursor: "pointer", color: MUTED, display: "flex",
                    }}><X size={13} /></button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {recentCodes.map(c => (
                      <button key={c.code} onClick={() => useCode(c)} style={{
                        display: "flex", alignItems: "center", gap: 5, padding: "5px 9px",
                        borderRadius: 20, border: `1px solid ${HAIRLINE}`, background: "#fff",
                        cursor: "pointer", fontSize: 11.5,
                      }}>
                        <span style={{ fontWeight: 650, color: accent.deep, fontVariantNumeric: "tabular-nums" }}>{c.code}</span>
                        <span style={{ color: MUTED, fontSize: 10.5 }}>{c.set}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* room header */}
              {tab === "chats" && activeChat && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                  borderBottom: `1px solid ${HAIRLINE}`,
                }}>
                  <button onClick={() => setActiveChat(null)} style={{
                    display: "flex", alignItems: "center", gap: 5, border: "none",
                    background: "transparent", cursor: "pointer", fontSize: 12.5, color: MUTED, padding: 0,
                  }}><ArrowLeft size={14} /> Back</button>
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    {activeChat.kind === "dm"
                      ? <><Dot color={STATUSES[activeChat.status].color} size={7} ring={false} />{activeChat.name}</>
                      : <>{activeChat.kind === "channel" ? <Hash size={12} color={MUTED} /> : <Users size={12} color={MUTED} />}{activeChat.name}</>}
                  </span>
                </div>
              )}

              {recording && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "7px 12px",
                  background: "#FFF4F3", borderBottom: `1px solid ${HAIRLINE}`,
                }}>
                  <Dot color={RED} size={8} ring={false} />
                  <span style={{ fontSize: 11.5, color: "#B42318" }}>
                    Recording {String(Math.floor(recording.s / 60)).padStart(2, "0")}:{String(recording.s % 60).padStart(2, "0")}
                  </span>
                  <button onClick={() => snip("record")} style={{
                    marginLeft: "auto", border: "none", background: RED, color: "#fff",
                    borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer",
                  }}>Stop</button>
                </div>
              )}

              {attachment && (
                <div style={{ padding: "8px 10px 0" }}>
                  <FileChip name={attachment.name} accent={accent} onRemove={() => setAttachment(null)} />
                </div>
              )}

              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, padding: "9px 10px" }}>
                <IconBtn accent={accent} active={toolsOpen} onClick={() => { setToolsOpen(o => !o); setEmojiOpen(false); }} title="Tools">
                  <Plus size={17} style={{ transform: toolsOpen ? "rotate(45deg)" : "none", transition: "transform 140ms" }} />
                </IconBtn>
                <textarea ref={inputRef} rows={1} value={composerValue}
                  onChange={e => tab === "ask" ? setDraft(e.target.value) : setRoomDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      tab === "ask" ? send() : sendRoom();
                    }
                  }}
                  placeholder={tab === "ask" ? "Ask Kody, or press / for shortcuts" : "Message, or type @kody"}
                  style={{
                    flex: 1, resize: "none", border: `1px solid ${HAIRLINE}`, borderRadius: 9,
                    padding: "8px 11px", fontSize: 13.5, lineHeight: 1.45, outline: "none",
                    fontFamily: "inherit", color: INK, maxHeight: 84, background: "#fff",
                  }} />
                <IconBtn accent={accent} active={emojiOpen} onClick={() => { setEmojiOpen(o => !o); setToolsOpen(false); }} title="Emoji">
                  <Smile size={16} />
                </IconBtn>
                {tab === "ask" && (
                  <IconBtn accent={accent} onClick={() => flash("Voice input")} title="Voice input"><Mic size={16} /></IconBtn>
                )}
                <button onClick={tab === "ask" ? send : sendRoom} disabled={!canSend} title="Send"
                  style={{
                    width: 32, height: 32, borderRadius: 9, border: "none", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: canSend ? accent.base : "#E7EAEE", color: "#fff",
                    cursor: canSend ? "pointer" : "default", transition: "background 140ms",
                  }}><Send size={15} /></button>
              </div>
            </div>
          )}

          {overlay === "search" && (
            <SearchPanel accent={accent} convos={chatConvos} people={PEOPLE}
              groups={groups} channels={channels} saved={savedSearches} setSaved={setSavedSearches}
              onOpenConvo={(k) => { setOverlay(null); setTab("chats"); setJumpTo(k); }}
              onClose={() => setOverlay(null)} flash={flash} />
          )}

          {overlay === "directory" && (
            <OrgDirectory people={PEOPLE} accent={accent}
              onMessage={(p) => { setOverlay(null); setTab("chats"); setJumpTo("dm:" + p.id); }}
              onClose={() => setOverlay(null)} />
          )}

          {overlay === "quickswitch" && (
            <QuickSwitcher accent={accent} people={PEOPLE} groups={groups} channels={channels}
              onPick={(i) => { setOverlay(null); setTab("chats"); setJumpTo(i.kind + ":" + i.id); }}
              onClose={() => setOverlay(null)} />
          )}

          {/* first-run tour */}
          {tourStep !== null && !tourDone && (
            <div style={{
              position: "absolute", inset: 0, background: "rgba(16,24,40,0.55)",
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20, padding: 18,
            }}>
              <div style={{
                background: "#fff", borderRadius: 14, padding: "18px 18px 14px", width: "100%",
                boxShadow: "0 14px 34px rgba(16,24,40,0.3)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                  <Logo size={16} />
                  <span style={{ fontSize: 10.5, color: MUTED, letterSpacing: "0.05em" }}>
                    {tourStep + 1} of {TOUR.length}
                  </span>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 6 }}>{TOUR[tourStep].title}</div>
                <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "#475467", margin: "0 0 14px" }}>
                  {TOUR[tourStep].body}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  {TOUR.map((_, i) => (
                    <span key={i} style={{
                      width: i === tourStep ? 16 : 6, height: 6, borderRadius: 3,
                      background: i === tourStep ? accent.base : "#E0E3E8", transition: "width 160ms",
                    }} />
                  ))}
                  <button onClick={() => { setTourDone(true); setTourStep(null); }} style={{
                    marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer",
                    fontSize: 12, color: MUTED, padding: "6px 8px",
                  }}>Skip</button>
                  <button onClick={() => {
                    if (tourStep === TOUR.length - 1) { setTourDone(true); setTourStep(null); }
                    else setTourStep(s => s + 1);
                  }} style={{
                    border: "none", background: accent.base, color: "#fff", borderRadius: 8,
                    padding: "7px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  }}>{tourStep === TOUR.length - 1 ? "Start using Kody" : "Next"}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* predictive suggestion, shown while minimised */}
      {hint && !open && !forceClosed && (
        <div style={{
          position: "absolute",
          left: Math.max(8, Math.min(pos.x + 56 + 268 > window.innerWidth ? pos.x - 276 : pos.x + 56, window.innerWidth - 276)),
          top: Math.max(8, Math.min(pos.y - 20, window.innerHeight - 150)),
          width: 268, background: "#fff", borderRadius: 12, zIndex: 52,
          border: `1px solid ${YELLOW}55`, boxShadow: "0 12px 30px rgba(16,24,40,0.2)",
          overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 11px",
            background: "#FFFAEB", borderBottom: `1px solid ${HAIRLINE}`,
          }}>
            <Lightbulb size={13} color="#B54708" />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#B54708" }}>{hint.title}</span>
            <button onClick={() => setHint(null)} aria-label="Dismiss"
              style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex" }}>
              <X size={13} />
            </button>
          </div>
          <div style={{ padding: "10px 11px" }}>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: INK }}>{hint.body}</p>
            <button onClick={() => {
              setDraft(hint.ask); setTab("ask"); setActiveChat(null);
              setOpen(true); setUnread(false); setHint(null);
              setTimeout(() => inputRef.current?.focus(), 60);
            }} style={{
              marginTop: 9, width: "100%", padding: "7px 0", borderRadius: 8, border: "none",
              background: accent.base, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>Ask Kody about this</button>
          </div>
        </div>
      )}

      {/* ---------------- bubble ---------------- */}
      <div onPointerDown={onPointerDown} role="button" tabIndex={0}
        aria-label={forceClosed ? "Kody is closed, click to reopen" : "Open Kody"}
        className={!open && !forceClosed && unreadNotifs > 0 ? "kd-buzz" : ""}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open ? setOpen(false) : openPanel(); } }}
        style={{
          position: "absolute", left: pos.x, top: pos.y, width: 52, height: 52, borderRadius: "50%",
          background: forceClosed ? "#3A3F45" : "#111417",
          border: `2px solid ${forceClosed ? "#5A6069" : stateColor}`,
          opacity: forceClosed ? 0.55 : 1,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: dragging ? "grabbing" : "grab", touchAction: "none", zIndex: 50,
          boxShadow: dragging ? "0 12px 28px rgba(16,24,40,0.24)" : "0 4px 14px rgba(16,24,40,0.16)",
          transform: dragging ? "scale(1.06)" : "scale(1)",
          transition: dragging ? "none" : "transform 140ms, box-shadow 140ms, border-color 200ms, opacity 200ms",
          userSelect: "none",
        }}>
        <Logo size={26} />
        {predictive && !open && !forceClosed && (
          <span style={{
            position: "absolute", inset: -5, borderRadius: "50%", border: `2px solid ${stateColor}`,
            animation: "kdPulse 2.4s ease-in-out infinite", pointerEvents: "none",
          }} />
        )}
        {(unread || unreadNotifs > 0) && !open && (
          <span style={{
            position: "absolute", top: 0, right: 0, minWidth: 15, height: 15, padding: "0 3px",
            borderRadius: 8, background: RED, border: "2px solid #111417", color: "#fff",
            fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
          }}>{unreadNotifs || ""}</span>
        )}
        <span style={{ position: "absolute", right: -1, bottom: -1 }}>
          <Dot color={STATUSES[myStatus].color} size={11} />
        </span>
      </div>

      {toast && (
        <div style={{
          position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)",
          background: INK, color: "#fff", padding: "8px 15px", borderRadius: 8,
          fontSize: 12.5, zIndex: 60, boxShadow: "0 6px 18px rgba(16,24,40,0.24)",
        }}>{toast}</div>
      )}
    </div>
  );
}
