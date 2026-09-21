import React, { useState, useMemo } from "react";
import {
  LayoutDashboard, Users, Hash, BookOpen, Binary, Sparkles, Award,
  Bell, FileDown, ShieldCheck, Settings2, Search, Check, AlertTriangle,
  TrendingUp, TrendingDown, Upload, Play, Lock, Unlock, Trash2, Plus,
  ExternalLink, Info
} from "lucide-react";

/* ==================================================================
   Kody admin dashboard - v12 prototype
   Mock data shaped exactly like the real API responses, so this
   doubles as the UI contract for module 12's remaining endpoints.
   ================================================================== */

const DOLLUZ_LOGO = "data:image/png;base64,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";

const INK = "#101828";
const MUTED = "#667085";
const FAINT = "#98A2B3";
const HAIRLINE = "#E4E7EC";
const CANVAS = "#F7F8FA";
const GOLD = "#C79A18";
const GOLD_SOFT = "#FBF3DC";
const GOLD_DEEP = "#9A7710";
const GREEN = "#12B76A";
const RED = "#F04438";
const AMBER = "#F79009";
const BLUE = "#2E90FA";

/* ---------------- mock data, in real API shapes ---------------- */

const STATS = {
  activeUsers: 27, activeUsers7d: 24, questionsToday: 184, questionsYesterday: 151,
  tier0Share: 0.38, avgLatencyMs: 1840, degradedRate: 0.012,
  publishedDocs: 46, citedDocs: 31, currentCodeEntries: 1428,
  smeOpen: 7, smeResolved30d: 23, unansweredTop: 12,
  messages7d: 3120, filesStored: 214, storageMb: 1840,
  modelSpend30d: 41.20, modelSpendPrev: 33.80,
};

const DOMAIN_SPLIT = [
  { domain: "Healthcare RCM", n: 612, tint: "#0F9E8E" },
  { domain: "Agile / PM", n: 141, tint: "#4C5FD5" },
  { domain: "Cybersecurity", n: 98, tint: "#B54708" },
  { domain: "Development", n: 74, tint: "#6941C6" },
  { domain: "General", n: 63, tint: "#667085" },
];

const TIER_SPLIT = [
  { tier: "T0 lookup", n: 372, ms: 3, cost: 0 },
  { tier: "T1 fast", n: 168, ms: 720, cost: 1.10 },
  { tier: "T2 standard", n: 381, ms: 2100, cost: 24.60 },
  { tier: "T3 deep", n: 67, ms: 5400, cost: 15.50 },
];

const UNANSWERED = [
  { q: "What is the timely filing limit for WebTPA?", n: 14, domain: "rcm" },
  { q: "How do we handle a GEHA secondary claim?", n: 11, domain: "rcm" },
  { q: "Which modifier unbundles D4341 and D0180?", n: 9, domain: "rcm" },
  { q: "What is our SLA for a P2 SOC incident?", n: 6, domain: "cyber" },
];

const USERS = [
  { id: 1, fullName: "Shoban Balasubramanian", email: "shoban@dolluzcorp.com", team: "Delivery", roles: ["super_admin"], presence: "online", isActive: true, lastSeenAt: "2 min ago" },
  { id: 2, fullName: "Pavithran R", email: "pavithran@dolluzcorp.com", team: "Engineering", roles: ["admin"], presence: "online", isActive: true, lastSeenAt: "just now" },
  { id: 3, fullName: "Vignesh Naidu", email: "vignesh@dolluzcorp.com", team: "Cybersecurity", roles: ["member"], presence: "busy", isActive: true, lastSeenAt: "18 min ago" },
  { id: 4, fullName: "Diksha Negi", email: "diksha@dolluzcorp.com", team: "Cybersecurity", roles: ["coordinator"], presence: "away", isActive: true, lastSeenAt: "1 h ago" },
  { id: 5, fullName: "Anil Kumar", email: "anil@dolluzcorp.com", team: "Delivery", roles: ["coordinator"], presence: "offline", isActive: true, lastSeenAt: "yesterday" },
  { id: 6, fullName: "Manasi Rao", email: "manasi@dolluzcorp.com", team: "RCM Operations", roles: ["member"], presence: "dnd", isActive: true, lastSeenAt: "4 h ago" },
  { id: 7, fullName: "Gopi Krishnan", email: "gopi@dolluzcorp.com", team: "RCM Operations", roles: ["member"], presence: "offline", isActive: false, lastSeenAt: "12 Aug" },
];

const ROLES = [
  { code: "super_admin", label: "Super admin", note: "Everything, including roles and billing" },
  { code: "admin", label: "Admin", note: "Publish knowledge, import codes, manage people" },
  { code: "sub_admin", label: "Sub-admin", note: "Manage spaces and members" },
  { code: "coordinator", label: "Coordinator", note: "Author knowledge, work the SME queue" },
  { code: "member", label: "Member", note: "Use Kody and chat" },
  { code: "guest", label: "Guest", note: "One space only, no directory" },
];

const SPACES = [
  { id: 1, kind: "channel", name: "denials-help", members: 26, isPrivate: false, isAnnouncement: false, isArchived: false, retention: "1y", isDefault: true },
  { id: 2, kind: "channel", name: "coding-queries", members: 18, isPrivate: false, isAnnouncement: false, isArchived: false, retention: "1y", isDefault: false },
  { id: 3, kind: "channel", name: "security-alerts", members: 9, isPrivate: false, isAnnouncement: true, isArchived: false, retention: "90d", isDefault: false },
  { id: 4, kind: "channel", name: "leadership", members: 4, isPrivate: true, isAnnouncement: false, isArchived: false, retention: "forever", isDefault: false },
  { id: 5, kind: "group", name: "AR escalations", members: 6, isPrivate: true, isAnnouncement: false, isArchived: false, retention: "1y", isDefault: false },
];

const DOCS = [
  { id: 41, title: "Inclusive denial handling", domain: "rcm", status: "published", version: 3, timesCited: 28, updatedAt: "12 Sep" },
  { id: 38, title: "Timely filing windows by payer", domain: "rcm", status: "published", version: 2, timesCited: 19, updatedAt: "9 Sep" },
  { id: 44, title: "OON overpayment routing", domain: "rcm", status: "review", version: 1, timesCited: 0, updatedAt: "17 Sep" },
  { id: 45, title: "Sprint spike estimation", domain: "agile", status: "draft", version: 1, timesCited: 0, updatedAt: "17 Sep" },
  { id: 22, title: "Old UHC filing rule", domain: "rcm", status: "retired", version: 1, timesCited: 6, updatedAt: "3 Jun" },
];

const SME_QUEUE = [
  { id: 12, question: "Can we write off a CO-97 without checking the primary?", domain: "rcm", confidence: "medium", model: "claude-sonnet-5", tier: 2, raisedBy: "Manasi Rao", createdAt: "2 h ago" },
  { id: 13, question: "Is D0180 billable with D4341 on the same date?", domain: "rcm", confidence: "low", model: "claude-sonnet-5", tier: 2, raisedBy: "Gopi Krishnan", createdAt: "5 h ago" },
  { id: 14, question: "What is our password rotation policy?", domain: "cyber", confidence: "medium", model: "claude-haiku-4-5", tier: 1, raisedBy: "Diksha Negi", createdAt: "yesterday" },
];

const CODE_SETS = [
  { code: "ICD-10-CM", label: "ICD-10-CM diagnosis codes", licensed: false, licenceRecorded: true, currentEntries: 0, versionYear: "-", lastImport: null },
  { code: "HCPCS", label: "HCPCS Level II", licensed: false, licenceRecorded: true, currentEntries: 0, versionYear: "-", lastImport: null },
  { code: "CARC", label: "Claim adjustment reason codes", licensed: false, licenceRecorded: true, currentEntries: 412, versionYear: "2026", lastImport: "12 Sep 2026" },
  { code: "RARC", label: "Remittance advice remark codes", licensed: false, licenceRecorded: true, currentEntries: 1016, versionYear: "2026", lastImport: "12 Sep 2026" },
  { code: "POS", label: "Place of service codes", licensed: false, licenceRecorded: true, currentEntries: 0, versionYear: "-", lastImport: null },
  { code: "CPT", label: "Current Procedural Terminology", licensed: true, licenceRecorded: false, currentEntries: 0, versionYear: "-", lastImport: null },
  { code: "CDT", label: "Current Dental Terminology", licensed: true, licenceRecorded: false, currentEntries: 0, versionYear: "-", lastImport: null },
];

const AUDIT = [
  { id: 901, action: "codes.imported", actor: "Shoban Balasubramanian", entity: "CARC", at: "12 Sep 14:02", ip: "49.204.x.x" },
  { id: 900, action: "user.roles_changed", actor: "Shoban Balasubramanian", entity: "Diksha Negi", at: "12 Sep 11:47", ip: "49.204.x.x" },
  { id: 899, action: "auth.refresh_reuse_detected", actor: "Manasi Rao", entity: "session 4412", at: "11 Sep 22:15", ip: "73.118.x.x" },
  { id: 898, action: "knowledge.superseded", actor: "Anil Kumar", entity: "doc 38", at: "11 Sep 16:30", ip: "5.62.x.x" },
  { id: 897, action: "file.infected_rejected", actor: "Gopi Krishnan", entity: "eob-scan.pdf", at: "11 Sep 09:58", ip: "49.204.x.x" },
];

const SESSIONS = [
  { id: 4501, user: "Pavithran R", surface: "extension", issuedAt: "today 09:12", lastUsedAt: "2 min ago", ip: "49.204.x.x" },
  { id: 4498, user: "Manasi Rao", surface: "web", issuedAt: "today 07:40", lastUsedAt: "1 h ago", ip: "73.118.x.x" },
  { id: 4490, user: "Vignesh Naidu", surface: "web", issuedAt: "yesterday", lastUsedAt: "18 min ago", ip: "49.204.x.x" },
];

const PLANS = [
  { code: "internal", name: "Dolluz internal", seats: 27, price: 0, active: true, note: "Staff use, no billing" },
  { code: "team", name: "Team", seats: 25, price: 9, active: false, note: "Per user per month" },
  { code: "business", name: "Business", seats: 100, price: 15, active: false, note: "Adds SSO and audit export" },
];

const SECTIONS = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard },
  { key: "people", label: "People and roles", Icon: Users },
  { key: "spaces", label: "Spaces", Icon: Hash },
  { key: "knowledge", label: "Knowledge", Icon: BookOpen },
  { key: "codes", label: "Code sets", Icon: Binary },
  { key: "kody", label: "Kody AI", Icon: Sparkles },
  { key: "points", label: "Cheer points", Icon: Award },
  { key: "messaging", label: "Messaging and text", Icon: Bell },
  { key: "reports", label: "Reports", Icon: FileDown },
  { key: "security", label: "Security and audit", Icon: ShieldCheck },
  { key: "settings", label: "Settings", Icon: Settings2 },
];

/* ---------------- small building blocks ---------------- */

function Card({ children, style, pad = 16 }) {
  return (
    <div style={{
      background: "#fff", border: `1px solid ${HAIRLINE}`, borderRadius: 12,
      padding: pad, ...style,
    }}>{children}</div>
  );
}

function SectionTitle({ children, sub, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 650, letterSpacing: "-0.015em" }}>{children}</h2>
        {sub && <p style={{ margin: "3px 0 0", fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>{sub}</p>}
      </div>
      <div style={{ marginLeft: "auto" }}>{right}</div>
    </div>
  );
}

function Metric({ label, value, delta, suffix, tone }) {
  const up = delta !== undefined && delta >= 0;
  return (
    <Card pad={14}>
      <div style={{ fontSize: 11.5, color: MUTED }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 5 }}>
        <span style={{
          fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em",
          color: tone === "warn" ? "#B54708" : INK,
        }}>{value}</span>
        {suffix && <span style={{ fontSize: 12, color: MUTED }}>{suffix}</span>}
      </div>
      {delta !== undefined && (
        <div style={{
          display: "flex", alignItems: "center", gap: 4, marginTop: 6,
          fontSize: 11.5, color: up ? "#05603A" : "#B42318",
        }}>
          {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {Math.abs(delta)}% vs last period
        </div>
      )}
    </Card>
  );
}

function Pill({ children, tone = "grey" }) {
  const map = {
    grey:   { bg: "#F2F4F7", fg: MUTED },
    green:  { bg: "#ECFDF3", fg: "#05603A" },
    amber:  { bg: "#FFFAEB", fg: "#B54708" },
    red:    { bg: "#FEF3F2", fg: "#B42318" },
    gold:   { bg: GOLD_SOFT, fg: GOLD_DEEP },
    blue:   { bg: "#EFF8FF", fg: "#175CD3" },
  };
  const c = map[tone] || map.grey;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
      borderRadius: 20, background: c.bg, color: c.fg, fontSize: 10.5, fontWeight: 600,
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Button({ children, onClick, tone = "default", size = "md", disabled, title }) {
  const tones = {
    default: { bg: "#fff", fg: INK, border: HAIRLINE },
    primary: { bg: GOLD, fg: "#fff", border: "transparent" },
    danger:  { bg: "#FFFBFA", fg: "#B42318", border: "#F0443833" },
  };
  const t = tones[tone] || tones.default;
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: size === "sm" ? "5px 10px" : "8px 14px",
      borderRadius: 8, border: `1px solid ${t.border}`,
      background: disabled ? "#F2F4F7" : t.bg, color: disabled ? FAINT : t.fg,
      fontSize: size === "sm" ? 11.5 : 12.5, fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
    }}>{children}</button>
  );
}

function Table({ columns, rows, empty = "Nothing here yet." }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c} style={{
                textAlign: "left", padding: "8px 10px", color: MUTED, fontWeight: 600,
                fontSize: 11, borderBottom: `1px solid ${HAIRLINE}`, whiteSpace: "nowrap",
              }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} style={{ padding: "22px 10px", color: MUTED, textAlign: "center" }}>{empty}</td></tr>
          ) : rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td key={j} style={{
                  padding: "9px 10px", borderBottom: `1px solid ${HAIRLINE}`, verticalAlign: "middle",
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bar({ value, max, tint }) {
  return (
    <span style={{ display: "block", height: 6, borderRadius: 3, background: "#F2F4F7", minWidth: 60 }}>
      <span style={{
        display: "block", height: "100%", borderRadius: 3,
        width: `${Math.round((value / max) * 100)}%`, background: tint,
      }} />
    </span>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
      <button onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label} style={{
        width: 34, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
        background: on ? GOLD : "#D0D5DD", position: "relative", flexShrink: 0,
      }}>
        <span style={{
          position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16,
          borderRadius: "50%", background: "#fff", transition: "left 140ms",
        }} />
      </button>
      {label && <span style={{ fontSize: 12.5 }}>{label}</span>}
    </label>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: MUTED, marginBottom: 5 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: MUTED, marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "8px 11px", borderRadius: 8, fontSize: 12.5,
  border: `1px solid ${HAIRLINE}`, outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};

/* ================================================================= */

export default function AdminDashboard() {
  const [section, setSection] = useState("overview");
  const [toast, setToast] = useState(null);
  const [users, setUsers] = useState(USERS);
  const [spaces, setSpaces] = useState(SPACES);
  const [codeSets, setCodeSets] = useState(CODE_SETS);
  const [userQuery, setUserQuery] = useState("");
  const [importFor, setImportFor] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [points, setPoints] = useState({ perCent: 1000, showCash: false, helpful: 25, adopted: 50, sme: 100, dailyCap: 500 });
  const [org, setOrg] = useState({
    includeMessageText: false, maxFileMb: 25, accessMinutes: 15, refreshDays: 30,
    forceMfa: false, lockAfter: 5, lockMinutes: 15, defaultRetention: "1y",
  });
  const [announce, setAnnounce] = useState({ kind: "feature", title: "", body: "" });

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  const filteredUsers = useMemo(() => users.filter(u =>
    (u.fullName + u.email + u.team + u.roles.join(" ")).toLowerCase().includes(userQuery.toLowerCase())
  ), [users, userQuery]);

  const setRole = (id, role) => {
    setUsers(us => us.map(u => u.id === id ? { ...u, roles: [role] } : u));
    flash("Role updated. The change is audited.");
  };

  const toggleActive = (id) => {
    setUsers(us => us.map(u => {
      if (u.id !== id) return u;
      const next = !u.isActive;
      flash(next ? "Account reactivated." : "Account deactivated. Every live session was revoked.");
      return { ...u, isActive: next };
    }));
  };

  const runImport = (dry) => {
    setImportResult({
      dryRun: dry, codeSet: importFor, parsed: 412, added: 7, superseded: 3,
      corrected: 1, unchanged: 401, retired: 0, skipped: 0,
      samples: { added: ["CO-301", "CO-302", "PR-49"] },
    });
    flash(dry ? "Dry run complete. Nothing was written." : "Import applied.");
  };

  const recordLicence = (code) => {
    setCodeSets(cs => cs.map(c => c.code === code ? { ...c, licenceRecorded: !c.licenceRecorded } : c));
    flash("Licence state changed. This is audited.");
  };

  const maxDomain = Math.max(...DOMAIN_SPLIT.map(d => d.n));
  const maxTier = Math.max(...TIER_SPLIT.map(t => t.n));
  const totalQuestions = TIER_SPLIT.reduce((a, t) => a + t.n, 0);

  return (
    <div style={{
      position: "fixed", inset: 0, display: "flex", background: CANVAS, overflow: "hidden",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      color: INK,
    }}>
      <style>{`
        .kd-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .kd-scroll::-webkit-scrollbar-thumb { background: #D6DAE1; border-radius: 4px; }
        button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
          outline: 2px solid ${GOLD}; outline-offset: 1px;
        }
      `}</style>

      {/* ---------------- sidebar ---------------- */}
      <nav style={{
        width: 216, flexShrink: 0, background: "#111417", display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "16px 14px" }}>
          <img src={DOLLUZ_LOGO} alt="Dolluz Corp" style={{ height: 22, width: "auto" }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#E6C765", letterSpacing: "0.05em" }}>KODY</div>
            <div style={{ fontSize: 9.5, color: "#7A8087" }}>Admin console</div>
          </div>
        </div>

        <div className="kd-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 8px 12px" }}>
          {SECTIONS.map(s => (
            <button key={s.key} onClick={() => setSection(s.key)} style={{
              display: "flex", alignItems: "center", gap: 9, width: "100%",
              padding: "8px 10px", marginBottom: 2, borderRadius: 8, border: "none",
              background: section === s.key ? "rgba(199,154,24,0.16)" : "transparent",
              color: section === s.key ? "#E6C765" : "#98A2B3",
              fontSize: 12.5, fontWeight: section === s.key ? 600 : 500,
              cursor: "pointer", textAlign: "left", fontFamily: "inherit",
            }}>
              <s.Icon size={15} strokeWidth={2.1} />{s.label}
            </button>
          ))}
        </div>

        <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 10.5, color: "#7A8087", lineHeight: 1.6 }}>
            Signed in as<br />
            <span style={{ color: "#E4E7EC" }}>Shoban Balasubramanian</span><br />
            <Pill tone="gold">super admin</Pill>
          </div>
        </div>
      </nav>

      {/* ---------------- content ---------------- */}
      <main className="kd-scroll" style={{ flex: 1, overflowY: "auto", padding: "22px 26px 60px" }}>

        {/* ---------- OVERVIEW ---------- */}
        {section === "overview" && (
          <>
            <SectionTitle sub="How Kody is being used across Dolluz. Last 30 days unless stated.">
              Overview
            </SectionTitle>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", marginBottom: 18 }}>
              <Metric label="Active people" value={STATS.activeUsers} delta={13} />
              <Metric label="Questions today" value={STATS.questionsToday} delta={22} />
              <Metric label="Answered without a model" value={`${Math.round(STATS.tier0Share * 100)}%`} suffix="tier 0" />
              <Metric label="Median answer time" value={(STATS.avgLatencyMs / 1000).toFixed(1)} suffix="seconds" />
              <Metric label="Degraded answers" value={`${(STATS.degradedRate * 100).toFixed(1)}%`} tone={STATS.degradedRate > 0.02 ? "warn" : undefined} />
              <Metric label="Model spend" value={`$${STATS.modelSpend30d.toFixed(2)}`} delta={22} />
            </div>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 12 }}>Questions by domain</div>
                {DOMAIN_SPLIT.map(d => (
                  <div key={d.domain} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                    <span style={{ fontSize: 12, width: 110, color: MUTED }}>{d.domain}</span>
                    <span style={{ flex: 1 }}><Bar value={d.n} max={maxDomain} tint={d.tint} /></span>
                    <span style={{ fontSize: 12, width: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.n}</span>
                  </div>
                ))}
              </Card>

              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 4 }}>Where the answers come from</div>
                <p style={{ margin: "0 0 12px", fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                  Tier 0 answers from the code tables with no model call, so it costs nothing and returns instantly.
                </p>
                <Table
                  columns={["Tier", "Questions", "Share", "Median", "Cost"]}
                  rows={TIER_SPLIT.map(t => [
                    t.tier,
                    t.n,
                    `${Math.round((t.n / totalQuestions) * 100)}%`,
                    t.ms < 1000 ? `${t.ms} ms` : `${(t.ms / 1000).toFixed(1)} s`,
                    t.cost === 0 ? <Pill tone="green">free</Pill> : `$${t.cost.toFixed(2)}`,
                  ])}
                />
              </Card>

              <Card>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                  <AlertTriangle size={14} color={AMBER} />
                  <span style={{ fontSize: 13, fontWeight: 650 }}>What Kody cannot answer well</span>
                </div>
                <p style={{ margin: "0 0 12px", fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                  Asked repeatedly with low confidence and no supporting document. This is the queue that tells
                  you what to write next.
                </p>
                {UNANSWERED.map(u => (
                  <div key={u.q} style={{
                    display: "flex", alignItems: "center", gap: 9, padding: "8px 0",
                    borderTop: `1px solid ${HAIRLINE}`,
                  }}>
                    <Pill tone="amber">{u.n}x</Pill>
                    <span style={{ fontSize: 12, flex: 1, lineHeight: 1.4 }}>{u.q}</span>
                    <Button size="sm" onClick={() => { setSection("knowledge"); flash("Draft started from an unanswered question."); }}>
                      Write it
                    </Button>
                  </div>
                ))}
              </Card>

              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 12 }}>Knowledge and corpus</div>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                  {[
                    ["Published documents", STATS.publishedDocs],
                    ["Documents ever cited", STATS.citedDocs],
                    ["Current code entries", STATS.currentCodeEntries.toLocaleString()],
                    ["SME queue open", STATS.smeOpen],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 11, color: MUTED }}>{k}</div>
                      <div style={{ fontSize: 18, fontWeight: 650, marginTop: 2 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{
                  marginTop: 12, padding: "8px 10px", borderRadius: 8, background: GOLD_SOFT,
                  fontSize: 11.5, color: GOLD_DEEP, lineHeight: 1.5,
                }}>
                  {STATS.publishedDocs - STATS.citedDocs} published documents have never been cited by an answer.
                  Either nobody asks about them, or retrieval is not finding them.
                </div>
              </Card>
            </div>
          </>
        )}

        {/* ---------- PEOPLE ---------- */}
        {section === "people" && (
          <>
            <SectionTitle
              sub="Roles decide what someone can reach. Deactivating revokes every live session immediately."
              right={<Button tone="primary" onClick={() => flash("Invite flow is module 14.")}><Plus size={14} /> Invite</Button>}
            >People and roles</SectionTitle>

            <Card style={{ marginBottom: 14 }} pad={12}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#F4F5F7", borderRadius: 8 }}>
                <Search size={14} color={MUTED} />
                <input value={userQuery} onChange={e => setUserQuery(e.target.value)}
                  placeholder="Search name, email, team or role"
                  style={{ border: "none", background: "transparent", outline: "none", fontSize: 12.5, flex: 1, fontFamily: "inherit" }} />
              </div>
            </Card>

            <Card pad={0}>
              <Table
                columns={["Person", "Team", "Role", "Presence", "Last seen", ""]}
                rows={filteredUsers.map(u => [
                  <span>
                    <div style={{ fontWeight: 600 }}>{u.fullName}</div>
                    <div style={{ fontSize: 11, color: MUTED }}>{u.email}</div>
                  </span>,
                  u.team,
                  <select value={u.roles[0]} onChange={e => setRole(u.id, e.target.value)}
                    aria-label={`Role for ${u.fullName}`}
                    style={{ ...inputStyle, width: 148, padding: "5px 8px", fontSize: 11.5 }}>
                    {ROLES.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>,
                  <Pill tone={u.presence === "online" ? "green" : u.presence === "dnd" ? "red" : "grey"}>{u.presence}</Pill>,
                  <span style={{ color: MUTED }}>{u.lastSeenAt}</span>,
                  <Button size="sm" tone={u.isActive ? "danger" : "default"} onClick={() => toggleActive(u.id)}>
                    {u.isActive ? <><Lock size={12} /> Deactivate</> : <><Unlock size={12} /> Reactivate</>}
                  </Button>,
                ])}
              />
            </Card>

            <Card style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 10 }}>What each role can do</div>
              <Table
                columns={["Role", "Reach"]}
                rows={ROLES.map(r => [<Pill tone={r.code.includes("admin") ? "gold" : "grey"}>{r.label}</Pill>, r.note])}
              />
            </Card>
          </>
        )}

        {/* ---------- SPACES ---------- */}
        {section === "spaces" && (
          <>
            <SectionTitle sub="Channels and groups across the organisation. Retention decides how long messages, and any claim detail in them, are kept.">
              Spaces
            </SectionTitle>
            <Card pad={0}>
              <Table
                columns={["Space", "Members", "Visibility", "Mode", "Retention", "Default", ""]}
                rows={spaces.map(s => [
                  <span style={{ fontWeight: 600 }}>{s.kind === "channel" ? `#${s.name}` : s.name}</span>,
                  s.members,
                  s.isPrivate ? <Pill tone="amber">private</Pill> : <Pill tone="green">public</Pill>,
                  s.isAnnouncement ? <Pill tone="blue">announcement</Pill> : "open",
                  <select value={s.retention}
                    aria-label={`Retention for ${s.name}`}
                    onChange={e => {
                      setSpaces(sp => sp.map(x => x.id === s.id ? { ...x, retention: e.target.value } : x));
                      flash("Retention changed. A shorter window reduces stored PHI.");
                    }}
                    style={{ ...inputStyle, width: 116, padding: "5px 8px", fontSize: 11.5 }}>
                    {["forever", "1y", "90d", "30d"].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>,
                  s.isDefault ? <Check size={14} color={GREEN} /> : "",
                  <Button size="sm" tone="danger" onClick={() => flash("Archived. History is kept, posting stops.")}>Archive</Button>,
                ])}
              />
            </Card>
          </>
        )}

        {/* ---------- KNOWLEDGE ---------- */}
        {section === "knowledge" && (
          <>
            <SectionTitle
              sub="Editing a published document creates a new version. Past answers keep citing the wording they actually used."
              right={<Button tone="primary" onClick={() => flash("New draft created.")}><Plus size={14} /> New document</Button>}
            >Knowledge</SectionTitle>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1.4fr 1fr" }}>
              <Card pad={0}>
                <div style={{ padding: "12px 14px", fontSize: 13, fontWeight: 650 }}>Documents</div>
                <Table
                  columns={["Title", "Domain", "Status", "Ver", "Cited", "Updated"]}
                  rows={DOCS.map(d => [
                    d.title,
                    d.domain,
                    <Pill tone={d.status === "published" ? "green" : d.status === "retired" ? "grey" : "amber"}>{d.status}</Pill>,
                    `v${d.version}`,
                    d.timesCited,
                    <span style={{ color: MUTED }}>{d.updatedAt}</span>,
                  ])}
                />
              </Card>

              <Card pad={0}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px" }}>
                  <span style={{ fontSize: 13, fontWeight: 650 }}>SME queue</span>
                  <Pill tone="amber">{SME_QUEUE.length} open</Pill>
                </div>
                <div style={{ padding: "0 14px 12px", fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                  A thumbs down lands here. Resolving one publishes a document and credits the person who raised it.
                </div>
                {SME_QUEUE.map(q => (
                  <div key={q.id} style={{ padding: "11px 14px", borderTop: `1px solid ${HAIRLINE}` }}>
                    <div style={{ fontSize: 12.5, lineHeight: 1.45, marginBottom: 6 }}>{q.question}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Pill tone={q.confidence === "low" ? "red" : "amber"}>{q.confidence}</Pill>
                      <Pill>T{q.tier}</Pill>
                      <Pill>{q.model}</Pill>
                      <span style={{ fontSize: 10.5, color: MUTED, marginLeft: "auto" }}>{q.raisedBy} &middot; {q.createdAt}</span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Button size="sm" tone="primary" onClick={() => flash("Resolved. Published as a knowledge document.")}>Resolve</Button>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          </>
        )}

        {/* ---------- CODE SETS ---------- */}
        {section === "codes" && (
          <>
            <SectionTitle sub="Tier 0 answers come from these tables. A licensed set cannot be imported until the licence is recorded.">
              Code sets
            </SectionTitle>

            <Card pad={0} style={{ marginBottom: 14 }}>
              <Table
                columns={["Set", "Entries", "Edition", "Last import", "Licence", ""]}
                rows={codeSets.map(c => [
                  <span>
                    <div style={{ fontWeight: 600 }}>{c.code}</div>
                    <div style={{ fontSize: 11, color: MUTED }}>{c.label}</div>
                  </span>,
                  c.currentEntries.toLocaleString(),
                  c.versionYear,
                  <span style={{ color: MUTED }}>{c.lastImport || "never"}</span>,
                  c.licensed
                    ? (c.licenceRecorded
                        ? <Pill tone="green">recorded</Pill>
                        : <Pill tone="red">not recorded</Pill>)
                    : <Pill tone="grey">free</Pill>,
                  <span style={{ display: "flex", gap: 6 }}>
                    {c.licensed && (
                      <Button size="sm" onClick={() => recordLicence(c.code)}>
                        {c.licenceRecorded ? "Revoke" : "Record licence"}
                      </Button>
                    )}
                    <Button size="sm" tone="primary"
                      disabled={c.licensed && !c.licenceRecorded}
                      title={c.licensed && !c.licenceRecorded ? "Record the licence first" : "Import a CSV"}
                      onClick={() => { setImportFor(c.code); setImportResult(null); }}>
                      <Upload size={12} /> Import
                    </Button>
                  </span>,
                ])}
              />
            </Card>

            {importFor && (
              <Card>
                <SectionTitle sub={`CSV with a code and description column. ${importFor} entries take effect from the date you set.`}>
                  Import into {importFor}
                </SectionTitle>
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                  <Field label="File">
                    <input type="file" aria-label="Code set CSV" style={{ ...inputStyle, padding: 7 }} />
                  </Field>
                  <Field label="Effective from">
                    <input type="date" defaultValue="2027-01-01" aria-label="Effective from" style={inputStyle} />
                  </Field>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <Toggle on={false} onChange={() => flash("Codes absent from the file would be retired.")}
                    label="Retire codes missing from this file" />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={() => runImport(true)}><Play size={13} /> Dry run</Button>
                  <Button tone="primary" onClick={() => runImport(false)} disabled={!importResult}>
                    Apply import
                  </Button>
                  <Button onClick={() => { setImportFor(null); setImportResult(null); }}>Cancel</Button>
                </div>

                {importResult && (
                  <div style={{
                    marginTop: 14, padding: 14, borderRadius: 10,
                    background: importResult.dryRun ? "#FFFAEB" : "#ECFDF3",
                    border: `1px solid ${importResult.dryRun ? "#F7900933" : "#12B76A33"}`,
                  }}>
                    <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 8 }}>
                      {importResult.dryRun ? "Dry run, nothing written" : "Import applied"}
                    </div>
                    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(90px,1fr))" }}>
                      {[["parsed", importResult.parsed], ["added", importResult.added],
                        ["superseded", importResult.superseded], ["corrected", importResult.corrected],
                        ["unchanged", importResult.unchanged], ["skipped", importResult.skipped]].map(([k, v]) => (
                        <div key={k}>
                          <div style={{ fontSize: 10.5, color: MUTED }}>{k}</div>
                          <div style={{ fontSize: 16, fontWeight: 650 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
                      New codes include {importResult.samples.added.join(", ")}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </>
        )}

        {/* ---------- KODY AI ---------- */}
        {section === "kody" && (
          <>
            <SectionTitle sub="Which model answers which kind of question. Changing a tier is a configuration change, not a deploy.">
              Kody AI
            </SectionTitle>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))" }}>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 12 }}>Model routing</div>
                {[
                  ["T0 lookup", "no model", "Codes answered from the database"],
                  ["T1 fast", "claude-haiku-4-5", "Short, simple questions"],
                  ["T2 standard", "claude-sonnet-5", "Domain questions with retrieval"],
                  ["T3 deep", "claude-opus-5", "Drafting, comparison, root cause"],
                ].map(([tier, model, note]) => (
                  <div key={tier} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${HAIRLINE}` }}>
                    <span style={{ fontSize: 12, fontWeight: 600, width: 84 }}>{tier}</span>
                    <span style={{ flex: 1 }}>
                      <input defaultValue={model} readOnly={tier === "T0 lookup"}
                        aria-label={`Model for ${tier}`}
                        style={{ ...inputStyle, padding: "5px 9px", fontSize: 11.5,
                                 background: tier === "T0 lookup" ? "#F2F4F7" : "#fff" }} />
                      <span style={{ fontSize: 10.5, color: MUTED }}>{note}</span>
                    </span>
                  </div>
                ))}
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <Button tone="primary" onClick={() => flash("Routing saved.")}>Save routing</Button>
                </div>
              </Card>

              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 10 }}>Providers and safety</div>
                <Field label="Primary provider">
                  <select defaultValue="anthropic" aria-label="Primary provider" style={inputStyle}>
                    <option value="anthropic">anthropic</option>
                    <option value="openai">openai</option>
                  </select>
                </Field>
                <Field label="Fallback provider" hint="Used when the primary is unreachable or rate limited.">
                  <select defaultValue="openai" aria-label="Fallback provider" style={inputStyle}>
                    <option value="openai">openai</option>
                    <option value="">none</option>
                  </select>
                </Field>
                <Field label="Prompt version" hint="Stored on every answer. Bump it whenever the prompt changes, or answers stop being reproducible.">
                  <input defaultValue="kody-2026-09-a" aria-label="Prompt version" style={inputStyle} />
                </Field>
                <div style={{ padding: "9px 11px", borderRadius: 8, background: GOLD_SOFT, fontSize: 11.5, color: GOLD_DEEP, lineHeight: 1.5 }}>
                  API keys live in the server environment, never here. This console never displays a key.
                </div>
              </Card>
            </div>
          </>
        )}

        {/* ---------- POINTS ---------- */}
        {section === "points" && (
          <>
            <SectionTitle sub="Your BRD's points calculator. The ledger is append only, so a balance is always a sum and cannot drift.">
              Cheer points
            </SectionTitle>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
              <Card>
                <Field label="Points per cent" hint="Higher means each point is worth less.">
                  <input type="number" value={points.perCent} aria-label="Points per cent"
                    onChange={e => setPoints(p => ({ ...p, perCent: Number(e.target.value) || 0 }))}
                    style={inputStyle} />
                </Field>
                <Field label="Daily cap" hint="Stops a one click thumbs up becoming a money button.">
                  <input type="number" value={points.dailyCap} aria-label="Daily cap"
                    onChange={e => setPoints(p => ({ ...p, dailyCap: Number(e.target.value) || 0 }))}
                    style={inputStyle} />
                </Field>
                <div style={{ marginBottom: 14 }}>
                  <Toggle on={points.showCash} onChange={v => setPoints(p => ({ ...p, showCash: v }))}
                    label="Show the cash value to associates" />
                </div>
                <Button tone="primary" onClick={() => flash("Points rules saved.")}>Save rules</Button>
              </Card>

              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 10 }}>Earning events</div>
                {[["helpful", "Marked an answer helpful"], ["adopted", "Answer adopted by a colleague"], ["sme", "SME correction accepted"]].map(([k, label]) => (
                  <Field key={k} label={label}>
                    <input type="number" value={points[k]} aria-label={label}
                      onChange={e => setPoints(p => ({ ...p, [k]: Number(e.target.value) || 0 }))}
                      style={inputStyle} />
                  </Field>
                ))}

                <div style={{ padding: 12, borderRadius: 10, background: "#F9FAFB", border: `1px solid ${HAIRLINE}` }}>
                  <div style={{ fontSize: 11.5, fontWeight: 650, marginBottom: 6 }}>What this actually pays</div>
                  <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.7 }}>
                    Cap of {points.dailyCap} a day is {Math.floor(points.dailyCap / (points.helpful || 1))} helpful votes.<br />
                    Over 20 working days that is {(points.dailyCap * 20).toLocaleString()} points,
                    worth {points.perCent ? ((points.dailyCap * 20) / points.perCent).toFixed(2) : "0"} cents.<br />
                    Reaching one dollar takes {points.perCent ? (100 * points.perCent).toLocaleString() : "0"} points.
                  </div>
                </div>
              </Card>
            </div>
          </>
        )}

        {/* ---------- MESSAGING ---------- */}
        {section === "messaging" && (
          <>
            <SectionTitle sub="Your BRD's text and message configuration, plus what Kody is allowed to send outside the system.">
              Messaging and text
            </SectionTitle>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 12 }}>Announcement</div>
                <Field label="Type">
                  <select value={announce.kind} aria-label="Announcement type"
                    onChange={e => setAnnounce(a => ({ ...a, kind: e.target.value }))} style={inputStyle}>
                    <option value="feature">New feature (blue dot)</option>
                    <option value="update">Update (red dot)</option>
                    <option value="highlight">Highlight (yellow)</option>
                    <option value="system">System notice</option>
                  </select>
                </Field>
                <Field label="Title">
                  <input value={announce.title} aria-label="Announcement title"
                    onChange={e => setAnnounce(a => ({ ...a, title: e.target.value }))} style={inputStyle} />
                </Field>
                <Field label="Message">
                  <textarea value={announce.body} rows={3} aria-label="Announcement message"
                    onChange={e => setAnnounce(a => ({ ...a, body: e.target.value }))}
                    style={{ ...inputStyle, resize: "vertical" }} />
                </Field>
                <Button tone="primary" disabled={!announce.body.trim()}
                  onClick={() => { flash("Announcement sent to 27 people."); setAnnounce({ kind: "feature", title: "", body: "" }); }}>
                  Send to everyone
                </Button>
              </Card>

              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 12 }}>What may leave the system</div>
                <div style={{
                  display: "flex", gap: 9, padding: "10px 12px", borderRadius: 9, marginBottom: 14,
                  background: org.includeMessageText ? "#FEF3F2" : "#ECFDF3",
                  border: `1px solid ${org.includeMessageText ? "#F0443833" : "#12B76A33"}`,
                }}>
                  <Info size={15} color={org.includeMessageText ? RED : GREEN} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 11.5, lineHeight: 1.6, color: org.includeMessageText ? "#B42318" : "#05603A" }}>
                    {org.includeMessageText
                      ? "Message text is being copied into emails and push payloads. An RCM message can contain a patient name and an account number, and that is PHI once it reaches an inbox or a lock screen."
                      : "Notifications say who sent a message and where, never what it said. Claim detail stays inside Kody."}
                  </span>
                </div>
                <Toggle on={org.includeMessageText} label="Include message text in emails and push"
                  onChange={v => { setOrg(o => ({ ...o, includeMessageText: v })); flash(v ? "Message text will now leave the system." : "Message text will stay inside Kody."); }} />

                <div style={{ marginTop: 18 }}>
                  <Field label="Default retention for new spaces">
                    <select value={org.defaultRetention} aria-label="Default retention"
                      onChange={e => setOrg(o => ({ ...o, defaultRetention: e.target.value }))} style={inputStyle}>
                      {["forever", "1y", "90d", "30d"].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Field>
                  <Field label="Maximum upload size (MB)">
                    <input type="number" value={org.maxFileMb} aria-label="Maximum upload size"
                      onChange={e => setOrg(o => ({ ...o, maxFileMb: Number(e.target.value) || 0 }))} style={inputStyle} />
                  </Field>
                </div>
              </Card>
            </div>
          </>
        )}

        {/* ---------- REPORTS ---------- */}
        {section === "reports" && (
          <>
            <SectionTitle sub="Your BRD's downloadable reports. Excel for analysis, PDF for circulation.">
              Reports
            </SectionTitle>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))" }}>
              {[
                ["Usage by person", "Questions asked, answers marked helpful, points earned."],
                ["Questions by domain", "Volume and confidence across the four domains."],
                ["Unanswered questions", "Asked repeatedly with low confidence and no document."],
                ["SME queue and resolutions", "What was wrong, who fixed it, what was published."],
                ["Model spend", "Cost by tier and by model, with token counts."],
                ["Audit export", "Every recorded action for a date range. For compliance requests."],
              ].map(([title, note]) => (
                <Card key={title}>
                  <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 5 }}>{title}</div>
                  <p style={{ margin: "0 0 12px", fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>{note}</p>
                  <div style={{ display: "flex", gap: 7 }}>
                    <Button size="sm" onClick={() => flash(`${title} queued as Excel.`)}><FileDown size={12} /> Excel</Button>
                    <Button size="sm" onClick={() => flash(`${title} queued as PDF.`)}><FileDown size={12} /> PDF</Button>
                  </div>
                </Card>
              ))}
            </div>
            <Card style={{ marginTop: 14 }}>
              <div style={{ display: "flex", gap: 9 }}>
                <AlertTriangle size={15} color={AMBER} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
                  A report containing message content is an export of PHI. Exports are written to the audit log
                  with who ran them and over what date range.
                </span>
              </div>
            </Card>
          </>
        )}

        {/* ---------- SECURITY ---------- */}
        {section === "security" && (
          <>
            <SectionTitle sub="Your BRD's authentication locks, plus the audit trail behind them.">
              Security and audit
            </SectionTitle>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 12 }}>Authentication</div>
                <Field label="Access token lifetime (minutes)">
                  <input type="number" value={org.accessMinutes} aria-label="Access token lifetime"
                    onChange={e => setOrg(o => ({ ...o, accessMinutes: Number(e.target.value) || 0 }))} style={inputStyle} />
                </Field>
                <Field label="Stay signed in for (days)">
                  <input type="number" value={org.refreshDays} aria-label="Refresh token lifetime"
                    onChange={e => setOrg(o => ({ ...o, refreshDays: Number(e.target.value) || 0 }))} style={inputStyle} />
                </Field>
                <Field label="Lock an account after this many failures">
                  <input type="number" value={org.lockAfter} aria-label="Failures before lockout"
                    onChange={e => setOrg(o => ({ ...o, lockAfter: Number(e.target.value) || 0 }))} style={inputStyle} />
                </Field>
                <Toggle on={org.forceMfa} label="Require multi-factor authentication"
                  onChange={v => { setOrg(o => ({ ...o, forceMfa: v })); flash(v ? "MFA will be required. This needs module 14." : "MFA requirement removed."); }} />
              </Card>

              <Card pad={0}>
                <div style={{ padding: "12px 14px", fontSize: 13, fontWeight: 650 }}>Live sessions</div>
                <Table
                  columns={["Person", "Surface", "Last used", "IP", ""]}
                  rows={SESSIONS.map(s => [
                    s.user,
                    <Pill tone="blue">{s.surface}</Pill>,
                    <span style={{ color: MUTED }}>{s.lastUsedAt}</span>,
                    <span style={{ color: MUTED, fontSize: 11 }}>{s.ip}</span>,
                    <Button size="sm" tone="danger" onClick={() => flash("Session revoked. That surface is signed out now.")}>Revoke</Button>,
                  ])}
                />
              </Card>
            </div>

            <Card pad={0}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px" }}>
                <span style={{ fontSize: 13, fontWeight: 650 }}>Audit log</span>
                <span style={{ marginLeft: "auto" }}>
                  <Button size="sm" onClick={() => flash("Audit export queued.")}><FileDown size={12} /> Export</Button>
                </span>
              </div>
              <Table
                columns={["When", "Action", "Who", "What", "IP"]}
                rows={AUDIT.map(a => [
                  <span style={{ color: MUTED, whiteSpace: "nowrap" }}>{a.at}</span>,
                  <Pill tone={a.action.includes("infected") || a.action.includes("reuse") ? "red" : "grey"}>{a.action}</Pill>,
                  a.actor,
                  a.entity,
                  <span style={{ color: MUTED, fontSize: 11 }}>{a.ip}</span>,
                ])}
              />
            </Card>
          </>
        )}

        {/* ---------- SETTINGS ---------- */}
        {section === "settings" && (
          <>
            <SectionTitle sub="Organisation settings, plans, and what version of Kody everyone is running.">
              Settings
            </SectionTitle>

            <Card style={{ marginBottom: 14 }} pad={0}>
              <div style={{ padding: "12px 14px", fontSize: 13, fontWeight: 650 }}>Subscription plans</div>
              <Table
                columns={["Plan", "Seats", "Price", "Notes", ""]}
                rows={PLANS.map(p => [
                  <span style={{ fontWeight: 600 }}>{p.name}</span>,
                  p.seats,
                  p.price === 0 ? <Pill tone="green">included</Pill> : `$${p.price} / user / month`,
                  <span style={{ color: MUTED }}>{p.note}</span>,
                  p.active ? <Pill tone="gold">current</Pill>
                           : <Button size="sm" onClick={() => flash("Billing is a phase two concern.")}>Switch</Button>,
                ])}
              />
            </Card>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 12 }}>Version</div>
                <Table
                  columns={["Surface", "Version", "Released"]}
                  rows={[
                    ["Server", "0.9.0", "17 Sep 2026"],
                    ["Web app", "0.9.0", "17 Sep 2026"],
                    ["Extension", "not released", "-"],
                    ["Android", "not started", "-"],
                    ["iOS", "not started", "-"],
                  ]}
                />
                <div style={{ marginTop: 12 }}>
                  <Button onClick={() => flash("Release notes published to everyone.")}>Publish release note</Button>
                </div>
              </Card>

              <Card>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 12 }}>Quick links shown to everyone</div>
                {["CMS ICD-10 lookup", "X12 denial codes", "Dolluz SOP library"].map(l => (
                  <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: `1px solid ${HAIRLINE}` }}>
                    <ExternalLink size={13} color={GOLD} />
                    <span style={{ fontSize: 12.5, flex: 1 }}>{l}</span>
                    <button onClick={() => flash("Link removed for everyone.")} aria-label={`Remove ${l}`}
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: MUTED, display: "flex" }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
                  <input placeholder="Label" aria-label="New quick link label" style={{ ...inputStyle, flex: 1 }} />
                  <Button tone="primary" onClick={() => flash("Link added for everyone.")}>Add</Button>
                </div>
              </Card>
            </div>
          </>
        )}
      </main>

      {toast && (
        <div style={{
          position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)",
          background: INK, color: "#fff", padding: "10px 18px", borderRadius: 9,
          fontSize: 12.5, zIndex: 80, boxShadow: "0 8px 24px rgba(16,24,40,0.28)", maxWidth: 480,
        }}>{toast}</div>
      )}
    </div>
  );
}
