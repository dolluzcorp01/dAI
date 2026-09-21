import React, { useState, useEffect, useRef } from "react";
import {
  Puzzle, Lock, ArrowRight, Check, Loader, X, Shield, Monitor,
  Smartphone, RefreshCw, LogOut, ChevronRight, Info, Plus, Globe
} from "lucide-react";

/* ==================================================================
   KODY - install and authentication flow, v11
   Simulated browser. Shows exactly what the user sees from
   "not installed" to "bubble live on every tab".
   ================================================================== */

const DOLLUZ_LOGO = "data:image/png;base64,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";

const INK = "#101828";
const MUTED = "#667085";
const HAIRLINE = "#E4E7EC";
const GOLD = "#C79A18";
const GOLD_SOFT = "#FBF3DC";
const GOLD_DEEP = "#9A7710";
const GREEN = "#12B76A";
const BLUE = "#2E90FA";

const STEPS = [
  { key: "store", label: "Web Store",
    note: "The user finds Kody in the Chrome Web Store. Edge, Brave and Opera all install from the same listing. Firefox and Safari need their own builds." },
  { key: "installed", label: "Installed",
    note: "The extension is installed but has no session. A badge on the toolbar icon prompts sign in. No bubble appears yet - an unauthenticated bubble would be noise." },
  { key: "popup", label: "Popup",
    note: "Clicking the toolbar icon opens the extension popup. It holds no login form. Its only job is to start the handoff, so the password never enters the extension." },
  { key: "auth", label: "Sign in",
    note: "The extension opens dai.dolluzcorp.com in a new tab with a one-time state parameter. This is your normal web login, so SSO, Google and Microsoft plug in here later without touching the extension." },
  { key: "handoff", label: "Handoff",
    note: "The site redirects to the extension's callback with a short-lived authorisation code. The background worker swaps that code for an access token and a refresh token, then stores them in extension storage. The tab closes itself." },
  { key: "live", label: "Bubble live",
    note: "The content script paints the bubble on every tab, present and future. The background worker holds the socket and refreshes the access token silently, so the user stays signed in for weeks." },
];

const TABS = [
  { id: 1, title: "Payer portal", host: "provider.uhc.com" },
  { id: 2, title: "Claim 88213-A", host: "pm.dolluzcorp.com" },
];

export default function KodyAuthFlow() {
  const [step, setStep] = useState("store");
  const [tabs, setTabs] = useState(TABS);
  const [activeTab, setActiveTab] = useState(1);
  const [popupOpen, setPopupOpen] = useState(false);
  const [email, setEmail] = useState("shoban@dolluzcorp.com");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(null);
  const [showNotes, setShowNotes] = useState(true);
  const [tokenAge, setTokenAge] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [bubblePos, setBubblePos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ on: false, dx: 0, dy: 0 });
  const stageRef = useRef(null);

  const live = step === "live";

  useEffect(() => {
    const el = stageRef.current;
    if (el) setBubblePos({ x: el.clientWidth - 92, y: el.clientHeight - 104 });
  }, [live]);

  /* access token ages, then the background worker refreshes it silently */
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTokenAge(a => {
      if (a >= 12) {
        setRefreshing(true);
        setTimeout(() => setRefreshing(false), 1100);
        return 0;
      }
      return a + 1;
    }), 1000);
    return () => clearInterval(t);
  }, [live]);

  const onDown = (e) => {
    dragRef.current = { on: true, dx: e.clientX - bubblePos.x, dy: e.clientY - bubblePos.y };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!dragRef.current.on) return;
    const el = stageRef.current;
    if (!el) return;
    setBubblePos({
      x: Math.max(6, Math.min(el.clientWidth - 58, e.clientX - dragRef.current.dx)),
      y: Math.max(6, Math.min(el.clientHeight - 58, e.clientY - dragRef.current.dy)),
    });
  };
  const onUp = () => { dragRef.current.on = false; setDragging(false); };

  const install = () => {
    setBusy("install");
    setTimeout(() => { setBusy(null); setStep("installed"); }, 1100);
  };

  const signIn = () => {
    if (!pw.trim()) return;
    setBusy("auth");
    setTimeout(() => {
      setBusy(null);
      setStep("handoff");
      setTimeout(() => {
        setTabs(TABS);
        setActiveTab(1);
        setStep("live");
      }, 1700);
    }, 1200);
  };

  const openAuthTab = () => {
    setPopupOpen(false);
    setTabs(t => [...t, { id: 99, title: "Sign in to Kody", host: "dai.dolluzcorp.com", auth: true }]);
    setActiveTab(99);
    setStep("auth");
  };

  const reset = () => {
    setStep("store"); setTabs(TABS); setActiveTab(1);
    setPopupOpen(false); setPw(""); setTokenAge(0);
  };

  const signOut = () => {
    setStep("installed"); setTabs(TABS); setActiveTab(1); setPw(""); setTokenAge(0);
  };

  const stepIdx = STEPS.findIndex(s => s.key === step);
  const current = STEPS[stepIdx] || STEPS[0];
  const tab = tabs.find(t => t.id === activeTab) || tabs[0];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#EDEFF3", overflow: "auto",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      color: INK, padding: 14, boxSizing: "border-box",
    }} onPointerMove={onMove} onPointerUp={onUp}>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform: translateY(8px);} to {opacity:1;transform:none;} }
        .spin { animation: spin 1s linear infinite; }
        .fade { animation: fadeUp 240ms ease-out; }
        .kscroll::-webkit-scrollbar { width:6px; }
        .kscroll::-webkit-scrollbar-thumb { background:#D6DAE1; border-radius:3px; }
      `}</style>

      {/* step rail */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 20,
              background: i < stepIdx ? GOLD_SOFT : i === stepIdx ? INK : "#fff",
              color: i < stepIdx ? GOLD_DEEP : i === stepIdx ? "#fff" : MUTED,
              border: `1px solid ${i <= stepIdx ? "transparent" : HAIRLINE}`,
              fontSize: 11.5, fontWeight: i === stepIdx ? 600 : 500,
            }}>
              {i < stepIdx ? <Check size={12} /> : <span style={{
                width: 15, height: 15, borderRadius: "50%", fontSize: 9, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: i === stepIdx ? "rgba(255,255,255,0.22)" : "#F2F4F7",
                color: i === stepIdx ? "#fff" : MUTED,
              }}>{i + 1}</span>}
              {s.label}
            </div>
            {i < STEPS.length - 1 && <ChevronRight size={12} color="#C4CAD4" />}
          </React.Fragment>
        ))}
        <button onClick={reset} style={{
          marginLeft: "auto", border: `1px solid ${HAIRLINE}`, background: "#fff",
          borderRadius: 7, padding: "5px 11px", fontSize: 11.5, cursor: "pointer", color: MUTED,
        }}>Replay</button>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>

        {/* ---------------- browser ---------------- */}
        <div style={{
          flex: "1 1 520px", minWidth: 340, background: "#fff", borderRadius: 12,
          border: `1px solid ${HAIRLINE}`, overflow: "hidden",
          boxShadow: "0 8px 26px rgba(16,24,40,0.10)",
        }}>
          {/* tab strip */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 10px 0", background: "#F2F4F7" }}>
            <span style={{ display: "flex", gap: 5, marginRight: 6 }}>
              {["#F04438", "#F79009", "#12B76A"].map(c => (
                <span key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />
              ))}
            </span>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 11px",
                borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", maxWidth: 190,
                background: activeTab === t.id ? "#fff" : "rgba(255,255,255,0.45)",
                color: activeTab === t.id ? INK : MUTED, fontSize: 11.5,
              }}>
                {t.auth ? <Logo size={12} /> : <Globe size={11} color={MUTED} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
              </button>
            ))}
            <Plus size={13} color={MUTED} style={{ marginLeft: 3 }} />
          </div>

          {/* address bar + toolbar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
            background: "#fff", borderBottom: `1px solid ${HAIRLINE}`,
          }}>
            <div style={{
              flex: 1, display: "flex", alignItems: "center", gap: 7, padding: "6px 11px",
              background: "#F4F5F7", borderRadius: 20, fontSize: 11.5, color: MUTED,
            }}>
              <Lock size={11} color={GREEN} />
              {tab ? tab.host : ""}
            </div>
            <Puzzle size={16} color={MUTED} />

            {/* the Kody toolbar icon appears only once installed */}
            {step !== "store" && (
              <button onClick={() => setPopupOpen(p => !p)} title="Kody" style={{
                position: "relative", width: 28, height: 28, borderRadius: 7, cursor: "pointer",
                border: popupOpen ? `1px solid ${GOLD}` : "1px solid transparent",
                background: popupOpen ? GOLD_SOFT : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{
                  width: 20, height: 20, borderRadius: "50%", background: "#111417",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}><Logo size={13} /></span>
                {step === "installed" && (
                  <span style={{
                    position: "absolute", top: -2, right: -2, background: "#F04438", color: "#fff",
                    fontSize: 7.5, fontWeight: 700, borderRadius: 4, padding: "1px 3px",
                  }}>1</span>
                )}
                {live && (
                  <span style={{
                    position: "absolute", bottom: 1, right: 1, width: 7, height: 7,
                    borderRadius: "50%", background: GREEN, border: "1.5px solid #fff",
                  }} />
                )}
              </button>
            )}
          </div>

          {/* page area */}
          <div ref={stageRef} style={{
            position: "relative", height: 430, background: "#FBFBFC", overflow: "hidden",
          }}>
            {/* extension popup */}
            {popupOpen && (
              <div className="fade" style={{
                position: "absolute", top: 8, right: 10, width: 258, background: "#fff",
                borderRadius: 12, border: `1px solid ${HAIRLINE}`, zIndex: 20,
                boxShadow: "0 16px 40px rgba(16,24,40,0.24)", overflow: "hidden",
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "9px 12px", background: "#111417",
                }}>
                  <Logo size={15} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#E6C765", letterSpacing: "0.05em" }}>KODY</span>
                  <button onClick={() => setPopupOpen(false)} aria-label="Close popup" style={{
                    marginLeft: "auto", border: "none", background: "transparent",
                    cursor: "pointer", color: "#7A8087", display: "flex",
                  }}><X size={13} /></button>
                </div>
                {live ? (
                  <div style={{ padding: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
                      <span style={{
                        width: 32, height: 32, borderRadius: "50%", background: GOLD,
                        color: "#fff", fontSize: 12, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>SB</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Shoban Balasubramanian</div>
                        <div style={{ fontSize: 10.5, color: MUTED }}>{email}</div>
                      </div>
                    </div>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "7px 9px",
                      borderRadius: 8, background: "#F0FDF4", fontSize: 11, color: "#05603A", marginBottom: 8,
                    }}>
                      <Check size={12} /> Signed in. Bubble active on all tabs.
                    </div>
                    <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
                      Access token {refreshing ? "refreshing..." : `${tokenAge * 75}s old`}
                      <br />Refresh token valid 30 days
                    </div>
                    <button onClick={signOut} style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      width: "100%", padding: "8px 0", borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${HAIRLINE}`, background: "#fff", fontSize: 12, color: INK,
                    }}><LogOut size={13} /> Sign out</button>
                  </div>
                ) : (
                  <div style={{ padding: 13 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Sign in to Kody</div>
                    <p style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.55, margin: "0 0 12px" }}>
                      Kody signs you in on the Dolluz site. Your password is never typed into the extension.
                    </p>
                    <button onClick={openAuthTab} style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                      width: "100%", padding: "9px 0", borderRadius: 8, border: "none",
                      background: GOLD, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    }}>Continue to Dolluz <ArrowRight size={14} /></button>
                  </div>
                )}
              </div>
            )}

            {/* --- store page --- */}
            {step === "store" && (
              <div className="fade" style={{ padding: 22 }}>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>chrome.google.com/webstore</div>
                <div style={{
                  display: "flex", gap: 14, padding: 18, background: "#fff",
                  border: `1px solid ${HAIRLINE}`, borderRadius: 12, maxWidth: 470,
                }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 12, background: "#111417", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}><Logo size={30} /></div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 650 }}>Kody by Dolluz Corp</div>
                    <div style={{ fontSize: 11.5, color: MUTED, margin: "3px 0 9px" }}>
                      Your work companion. Healthcare RCM, Agile, cybersecurity and development.
                    </div>
                    <button onClick={install} disabled={busy === "install"} style={{
                      display: "flex", alignItems: "center", gap: 7, padding: "8px 16px",
                      borderRadius: 8, border: "none", cursor: "pointer",
                      background: busy === "install" ? "#98A2B3" : BLUE, color: "#fff",
                      fontSize: 12.5, fontWeight: 600,
                    }}>
                      {busy === "install"
                        ? <><Loader size={14} className="spin" /> Adding...</>
                        : <>Add to Chrome</>}
                    </button>
                  </div>
                </div>
                <div style={{
                  display: "flex", gap: 7, marginTop: 14, flexWrap: "wrap", maxWidth: 470,
                }}>
                  {["Chrome", "Edge", "Brave", "Opera"].map(b => (
                    <span key={b} style={{
                      fontSize: 10.5, padding: "3px 9px", borderRadius: 20,
                      background: GOLD_SOFT, color: GOLD_DEEP,
                    }}>{b} - same build</span>
                  ))}
                  {["Firefox", "Safari"].map(b => (
                    <span key={b} style={{
                      fontSize: 10.5, padding: "3px 9px", borderRadius: 20,
                      background: "#F2F4F7", color: MUTED,
                    }}>{b} - separate build</span>
                  ))}
                </div>
              </div>
            )}

            {/* --- installed, no session --- */}
            {step === "installed" && (
              <div className="fade" style={{ padding: 22 }}>
                <MockPage />
                <div style={{
                  position: "absolute", top: 46, right: 14, width: 230, padding: "11px 13px",
                  background: "#111417", color: "#fff", borderRadius: 10, fontSize: 11.5, lineHeight: 1.55,
                }}>
                  Kody is installed. Click the toolbar icon to sign in.
                  <div style={{
                    position: "absolute", top: -6, right: 16, width: 12, height: 12,
                    background: "#111417", transform: "rotate(45deg)",
                  }} />
                </div>
              </div>
            )}

            {/* --- auth tab --- */}
            {step === "auth" && (
              <div className="fade" style={{
                padding: 22, height: "100%", display: "flex",
                alignItems: "center", justifyContent: "center", background: "#F7F8FA",
              }}>
                <div style={{
                  width: 300, background: "#fff", borderRadius: 14, padding: 22,
                  border: `1px solid ${HAIRLINE}`, boxShadow: "0 8px 26px rgba(16,24,40,0.08)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      width: 30, height: 30, borderRadius: 8, background: "#111417",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}><Logo size={17} /></span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 650 }}>Sign in to Kody</div>
                      <div style={{ fontSize: 10.5, color: MUTED }}>dai.dolluzcorp.com</div>
                    </div>
                  </div>

                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, margin: "12px 0",
                    padding: "7px 9px", borderRadius: 7, background: GOLD_SOFT,
                    fontSize: 10.5, color: GOLD_DEEP, lineHeight: 1.45,
                  }}>
                    <Shield size={12} style={{ flexShrink: 0 }} />
                    Authorising the Kody browser extension
                  </div>

                  <label style={{ fontSize: 11, color: MUTED, display: "block", marginBottom: 4 }}>Work email</label>
                  <input value={email} onChange={e => setEmail(e.target.value)} style={{
                    width: "100%", padding: "9px 11px", borderRadius: 8, fontSize: 12.5,
                    border: `1px solid ${HAIRLINE}`, outline: "none", boxSizing: "border-box",
                    marginBottom: 10, fontFamily: "inherit",
                  }} />
                  <label style={{ fontSize: 11, color: MUTED, display: "block", marginBottom: 4 }}>Password</label>
                  <input type="password" value={pw} onChange={e => setPw(e.target.value)}
                    placeholder="Type anything to continue"
                    onKeyDown={e => { if (e.key === "Enter") signIn(); }}
                    style={{
                      width: "100%", padding: "9px 11px", borderRadius: 8, fontSize: 12.5,
                      border: `1px solid ${HAIRLINE}`, outline: "none", boxSizing: "border-box",
                      marginBottom: 12, fontFamily: "inherit",
                    }} />

                  <button onClick={signIn} disabled={!pw.trim() || busy === "auth"} style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
                    background: pw.trim() ? GOLD : "#E7EAEE", color: "#fff",
                    fontSize: 13, fontWeight: 600, cursor: pw.trim() ? "pointer" : "default",
                  }}>
                    {busy === "auth" ? <><Loader size={14} className="spin" /> Signing in...</> : "Sign in"}
                  </button>

                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, margin: "13px 0 11px",
                  }}>
                    <span style={{ flex: 1, height: 1, background: HAIRLINE }} />
                    <span style={{ fontSize: 10, color: MUTED }}>or</span>
                    <span style={{ flex: 1, height: 1, background: HAIRLINE }} />
                  </div>
                  {["Continue with Microsoft", "Continue with Google"].map(l => (
                    <button key={l} style={{
                      width: "100%", padding: "8px 0", borderRadius: 8, marginBottom: 6,
                      border: `1px solid ${HAIRLINE}`, background: "#fff",
                      fontSize: 12, cursor: "pointer", color: INK,
                    }}>{l}</button>
                  ))}
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 8, textAlign: "center" }}>
                    SSO drops in here later without changing the extension
                  </div>
                </div>
              </div>
            )}

            {/* --- handoff --- */}
            {step === "handoff" && (
              <div className="fade" style={{
                height: "100%", display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 14, background: "#F7F8FA",
              }}>
                <Loader size={26} color={GOLD} className="spin" />
                <div style={{ fontSize: 13, fontWeight: 600 }}>Authorising Kody</div>
                <div style={{
                  width: 320, background: "#fff", borderRadius: 10, padding: 13,
                  border: `1px solid ${HAIRLINE}`, fontSize: 11, color: MUTED, lineHeight: 1.75,
                }}>
                  <div>Site returns a one-time code to the extension callback</div>
                  <div>Background worker exchanges the code for tokens</div>
                  <div>Access token 15 min, refresh token 30 days</div>
                  <div>Stored in extension storage, not in the page</div>
                  <div>This tab closes itself</div>
                </div>
              </div>
            )}

            {/* --- live --- */}
            {live && (
              <>
                <div style={{ padding: 22 }}><MockPage /></div>
                <div
                  onPointerDown={onDown}
                  role="button" tabIndex={0} aria-label="Kody bubble"
                  style={{
                    position: "absolute", left: bubblePos.x, top: bubblePos.y,
                    width: 50, height: 50, borderRadius: "50%", background: "#111417",
                    border: `2px solid ${GOLD}`, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    cursor: dragging ? "grabbing" : "grab", touchAction: "none", zIndex: 14,
                    boxShadow: dragging ? "0 12px 26px rgba(16,24,40,0.28)" : "0 4px 14px rgba(16,24,40,0.18)",
                    transform: dragging ? "scale(1.06)" : "scale(1)",
                    transition: dragging ? "none" : "transform 140ms, box-shadow 140ms",
                    userSelect: "none",
                  }}>
                  <Logo size={25} />
                  <span style={{
                    position: "absolute", right: -1, bottom: -1, width: 11, height: 11,
                    borderRadius: "50%", background: GREEN, border: "2px solid #111417",
                  }} />
                </div>
                {refreshing && (
                  <div className="fade" style={{
                    position: "absolute", bottom: 12, left: 12, display: "flex",
                    alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 20,
                    background: "#111417", color: "#fff", fontSize: 10.5,
                  }}>
                    <RefreshCw size={11} className="spin" /> Background worker refreshed the token silently
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ---------------- explanation ---------------- */}
        <div style={{ flex: "0 1 300px", minWidth: 270 }}>
          <div style={{
            background: "#fff", borderRadius: 12, border: `1px solid ${HAIRLINE}`,
            padding: 14, marginBottom: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <Info size={14} color={GOLD} />
              <span style={{ fontSize: 12.5, fontWeight: 650 }}>Step {stepIdx + 1}: {current.label}</span>
              <button onClick={() => setShowNotes(s => !s)} style={{
                marginLeft: "auto", border: "none", background: "transparent",
                cursor: "pointer", fontSize: 11, color: MUTED,
              }}>{showNotes ? "Hide" : "Show"}</button>
            </div>
            {showNotes && (
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.65, color: "#475467" }}>{current.note}</p>
            )}
          </div>

          <div style={{
            background: "#fff", borderRadius: 12, border: `1px solid ${HAIRLINE}`, padding: 14, marginBottom: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
              <Monitor size={14} color={MUTED} />
              <span style={{ fontSize: 12.5, fontWeight: 650 }}>Surfaces</span>
            </div>
            {[
              ["Chrome, Edge, Brave, Opera", "One MV3 build, Chrome Web Store", true],
              ["Firefox", "MV3 with differences, own listing", true],
              ["Safari", "Wrapped in a Mac app via Xcode", true],
              ["Web app", "Same login, no extension needed", true],
              ["Android", "Floating bubble is possible", true],
              ["iOS", "No floating bubble. App plus share sheet", false],
            ].map(([a, b, ok]) => (
              <div key={a} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: `1px solid ${HAIRLINE}` }}>
                <span style={{ marginTop: 3 }}>
                  {ok ? <Check size={12} color={GREEN} /> : <X size={12} color="#F04438" />}
                </span>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 600 }}>{a}</div>
                  <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.45 }}>{b}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: "#fff", borderRadius: 12, border: `1px solid ${HAIRLINE}`, padding: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
              <Smartphone size={14} color={MUTED} />
              <span style={{ fontSize: 12.5, fontWeight: 650 }}>One session, every surface</span>
            </div>
            <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.65, color: "#475467" }}>
              The same login page issues tokens for the extension, the web app, the desktop app
              and both mobile apps. Revoking a session in the admin console kills all of them at once.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Logo({ size = 18 }) {
  return <img src={DOLLUZ_LOGO} alt="Dolluz" style={{ height: size, width: "auto", display: "block" }} />;
}

function MockPage() {
  return (
    <div style={{ maxWidth: 430 }}>
      <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 9 }}>Claim 88213-A</div>
      <div style={{ background: "#fff", border: `1px solid ${HAIRLINE}`, borderRadius: 10, padding: "14px 16px" }}>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: "#475467" }}>
          Line 2 denied with CARC CO-97. Allowed amount 148.00 against a billed amount of 210.00.
          Provider listed as out of network for this plan year.
        </p>
      </div>
    </div>
  );
}
