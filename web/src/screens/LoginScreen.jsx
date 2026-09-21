import React, { useState, useRef, useEffect } from "react";
import { errorText } from "../api/adapters.js";

/**
 * Login screen. Implements the flow frozen in kody_auth_flow_v11.jsx.
 *
 * Two modes:
 *   web       - signs in and returns tokens directly.
 *   authorize - the extension handoff. The extension opened this page with a
 *               state value and a redirect URI. We mint a one-time code and
 *               hand it back through the redirect. NO TOKENS travel this path,
 *               because a redirect URL can land in history, logs or a referrer
 *               header.
 *
 * Read the state and redirect_uri from the query string:
 *   const params = new URLSearchParams(location.search);
 *   <LoginScreen mode={params.get("state") ? "authorize" : "web"} ... />
 */

const INK = "#101828";
const MUTED = "#667085";
const HAIRLINE = "#E4E7EC";
const GOLD = "#C79A18";
const GOLD_SOFT = "#FBF3DC";
const GOLD_DEEP = "#9A7710";
const RED = "#F04438";

export default function LoginScreen({
  api,
  mode = "web",
  state,
  redirectUri,
  logoSrc,
  onSignedIn,
  onAuthorized,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [locked, setLocked] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const canSubmit = email.trim().length > 3 && password.length > 0 && !busy && !locked;

  async function submit(e) {
    if (e) e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    try {
      if (mode === "authorize") {
        const out = await api.auth.authorize(email.trim(), password, state, redirectUri);
        // Hand the code back through the redirect the extension registered.
        if (onAuthorized) onAuthorized(out);
        else {
          const url = new URL(redirectUri);
          url.searchParams.set("code", out.code);
          url.searchParams.set("state", out.state);
          window.location.assign(url.toString());
        }
      } else {
        const out = await api.auth.login(email.trim(), password);
        if (onSignedIn) onSignedIn(out);
      }
    } catch (err) {
      // Never reveal whether the email exists. The server already returns the
      // same code for both, so just render what it sent.
      setError(errorText(err));
      if (err.code === "account_locked") setLocked(true);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#F7F8FA", padding: 20, boxSizing: "border-box",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      color: INK,
    }}>
      <form onSubmit={submit} style={{
        width: "100%", maxWidth: 340, background: "#fff", borderRadius: 14,
        padding: 24, border: `1px solid ${HAIRLINE}`,
        boxShadow: "0 8px 26px rgba(16,24,40,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 9, background: "#111417",
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
          }}>
            {logoSrc
              ? <img src={logoSrc} alt="Dolluz" style={{ height: 20, width: "auto" }} />
              : <span style={{ color: "#E6C765", fontWeight: 700, fontSize: 15 }}>K</span>}
          </span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em" }}>Sign in to Kody</div>
            <div style={{ fontSize: 11, color: MUTED }}>Dolluz Corp</div>
          </div>
        </div>

        {mode === "authorize" && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 7, margin: "14px 0",
            padding: "8px 10px", borderRadius: 8, background: GOLD_SOFT,
            fontSize: 11, color: GOLD_DEEP, lineHeight: 1.5,
          }}>
            <span aria-hidden="true">&#9679;</span>
            <span>
              Authorising the Kody browser extension. Your password is sent to Dolluz only,
              never to the extension.
            </span>
          </div>
        )}

        <label htmlFor="kody-email" style={labelStyle}>Work email</label>
        <input
          id="kody-email" ref={emailRef} type="email" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} disabled={busy || locked}
          placeholder="you@dolluzcorp.com" style={inputStyle}
        />

        <label htmlFor="kody-password" style={labelStyle}>Password</label>
        <input
          id="kody-password" type="password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} disabled={busy || locked}
          style={inputStyle}
        />

        {error && (
          <div role="alert" style={{
            display: "flex", gap: 7, padding: "9px 11px", borderRadius: 8, marginBottom: 12,
            background: "#FFFBFA", border: `1px solid ${RED}33`, fontSize: 12,
            color: "#B42318", lineHeight: 1.5,
          }}>{error}</div>
        )}

        <button type="submit" disabled={!canSubmit} style={{
          width: "100%", padding: "11px 0", borderRadius: 9, border: "none",
          background: canSubmit ? GOLD : "#E7EAEE", color: "#fff",
          fontSize: 13.5, fontWeight: 600, cursor: canSubmit ? "pointer" : "default",
          transition: "background 140ms",
        }}>
          {busy ? "Signing in..." : mode === "authorize" ? "Authorise Kody" : "Sign in"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "16px 0 12px" }}>
          <span style={{ flex: 1, height: 1, background: HAIRLINE }} />
          <span style={{ fontSize: 10.5, color: MUTED }}>or</span>
          <span style={{ flex: 1, height: 1, background: HAIRLINE }} />
        </div>

        {/* SSO lands here in a later module. The extension never changes for it,
            because it only ever opens this page. */}
        {["Continue with Microsoft", "Continue with Google"].map(label => (
          <button key={label} type="button" disabled title="Available once SSO is configured"
            style={{
              width: "100%", padding: "9px 0", borderRadius: 9, marginBottom: 7,
              border: `1px solid ${HAIRLINE}`, background: "#fff",
              fontSize: 12.5, color: "#98A2B3", cursor: "not-allowed",
            }}>{label}</button>
        ))}

        <p style={{ margin: "14px 0 0", fontSize: 10.5, color: MUTED, textAlign: "center", lineHeight: 1.5 }}>
          Trouble signing in? Contact your Dolluz administrator.
        </p>
      </form>
    </div>
  );
}

const labelStyle = {
  display: "block", fontSize: 11, color: MUTED, marginBottom: 5, marginTop: 2,
};

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: 9, fontSize: 13.5,
  border: `1px solid ${HAIRLINE}`, outline: "none", boxSizing: "border-box",
  marginBottom: 12, fontFamily: "inherit", color: INK,
};
