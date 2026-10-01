import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";

const BG = "hsl(var(--background))";
const SURFACE = "hsl(var(--card))";
const BORDER = "hsl(var(--border))";
const TEXT = "hsl(var(--foreground))";
const TEXT_SECONDARY = "hsl(var(--muted-foreground))";
const TEXT_MUTED = "hsl(var(--muted-foreground))";
const ACCENT = "hsl(var(--primary))";

const PERSONAS = [
  { id: "orion", name: "GOVERNANCE", role: "Audit & Compliance", color: "#475569", icon: "○" },
  { id: "grimm", name: "RISK", role: "Risk & Resilience", color: "#1e293b", icon: "◆" },
  { id: "solara", name: "COMMERCIAL", role: "Value Creation", color: "#b45309", icon: "◎" },
  { id: "zephyr", name: "INNOVATION", role: "Options Architect", color: "#3F6B4E", icon: "◇" },
  { id: "mira", name: "CULTURE", role: "Ethics & People", color: "#991B1B", icon: "◉" },
  { id: "aquila", name: "PERFORMANCE", role: "Strategy & Outcomes", color: "#1d4ed8", icon: "◈" },
];

type PersonaResponse = { personaId: string; name: string; role: string; emoji: string; color: string; content: string };
type BoardMessage = { id: string; type: "user" | "board" | "error"; topic?: string; responses?: PersonaResponse[]; errorText?: string; timestamp: string };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const DISCUSSION_STARTERS = [
  { label: "Ethical incentives", topic: "How should we redesign incentives across sales and other teams to support performance without encouraging unethical behaviour?" },
  { label: "Culture & accountability", topic: "How can our board identify harmful leadership practices across the company and build a culture where people can speak up safely?" },
  { label: "Responsible operations", topic: "How should we evaluate an operational investment across financial returns, people, environmental impacts and governance, and what evidence do we need?" },
];

export default function Boardroom() {
  const [, setLocation] = useLocation();
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [activePersona, setActivePersona] = useState<string | null>(null);
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function runBoard() {
    const t = topic.trim();
    if (!t || loading) return;

    const userMsg: BoardMessage = { id: `u${Date.now()}`, type: "user", topic: t, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setTopic(""); setContext(""); setShowContext(false);
    setLoading(true); setActivePersona("orion");

    const sessionHistory = messages.flatMap<{ role: "user" | "assistant"; content: string }>((m) =>
      m.type === "user" ? [{ role: "user", content: m.topic ?? "" }] :
      m.responses?.map((r) => ({ role: "assistant", content: `[${r.name}]: ${r.content}` })) ?? []
    );

    try {
      const res = await fetch(`${BASE}/api/boardroom/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t, context: context.trim() || undefined, sessionHistory, mode: "full_board" }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const boardMsg: BoardMessage = { id: `b${Date.now()}`, type: "board", responses: data.responses, timestamp: new Date().toISOString() };
      setMessages((prev) => [...prev, boardMsg]);
      setExpandedMsg(boardMsg.id);
    } catch {
      setMessages((prev) => [...prev, { id: `e${Date.now()}`, type: "error", errorText: "Boardroom session failed to connect.", timestamp: new Date().toISOString() }]);
    } finally {
      setLoading(false); setActivePersona(null);
    }
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "var(--font-sans)" }} data-testid="boardroom-page">
      {/* Top bar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 32px", borderBottom: `1px solid ${BORDER}`, background: "hsl(var(--background) / 0.97)", backdropFilter: "blur(8px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <button onClick={() => setLocation("/dashboard")} style={{ background: "none", border: "none", color: TEXT_MUTED, fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase", cursor: "pointer", transition: "color 0.18s", fontWeight: 700 }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = ACCENT)} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = TEXT_MUTED)}>
            ← Workspace
          </button>
          <span style={{ color: BORDER, fontSize: 12 }}>|</span>
          <span style={{ color: TEXT, fontSize: 11, letterSpacing: "0.3em", fontWeight: 500, textTransform: "uppercase" }}>SHADOW BOARD</span>
        </div>

        {/* Persona chips */}
        <div className="boardroom-persona-chips" style={{ display: "flex", gap: 8 }}>
          {PERSONAS.map((p) => (
            <motion.div
              key={p.id}
              animate={{ opacity: loading && activePersona !== p.id ? 0.3 : 1 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
            >
              <div style={{ width: 28, height: 28, borderRadius: "50%", border: `1.5px solid ${activePersona === p.id ? p.color : BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, background: activePersona === p.id ? `${p.color}12` : SURFACE, transition: "all 0.3s", boxShadow: activePersona === p.id ? `0 0 10px ${p.color}40` : "none" }}>
                {p.icon}
              </div>
              <span style={{ color: activePersona === p.id ? p.color : TEXT_MUTED, fontSize: 6, letterSpacing: "0.14em", textTransform: "uppercase", transition: "color 0.3s" }}>{p.name}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Transcript */}
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 90, paddingBottom: 180 }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 32px" }}>
          {messages.length === 0 && !loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: "center", paddingTop: "14vh" }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>◈</div>
              <p style={{ color: TEXT_SECONDARY, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8 }}>The shadow board is assembled</p>
              <p style={{ color: TEXT_MUTED, fontSize: 10, letterSpacing: "0.1em", lineHeight: 1.8 }}>State your decision, challenge, or strategic question.<br />All six AI agents will respond independently.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {DISCUSSION_STARTERS.map((starter) => (
                  <button
                    key={starter.label}
                    onClick={() => setTopic(starter.topic)}
                    className="rounded border border-border bg-card px-4 py-3 text-xs font-medium text-primary transition-colors hover:bg-muted"
                  >
                    {starter.label}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">AI perspectives support judgement; they do not replace board oversight.</p>
              <p className="mt-2 text-xs text-muted-foreground">
                For a decision that needs your people's input too,{" "}
                <button onClick={() => setLocation("/questions/new")} className="font-semibold text-primary underline underline-offset-4">
                  ask a board question
                </button>
                : your people answer by questionnaire and you see their view, the agents' view, and both together.
              </p>
            </motion.div>
          )}

          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 28 }}>
                {msg.type === "user" && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                    <div style={{ maxWidth: "70%", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "10px 10px 2px 10px", padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
                      <div style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 5 }}>You · CEO</div>
                      <p style={{ color: TEXT, fontSize: 12, lineHeight: 1.6, margin: 0 }}>{msg.topic}</p>
                    </div>
                  </div>
                )}

                {msg.type === "error" && (
                  <div style={{ textAlign: "center", color: "#dc2626", fontSize: 10, letterSpacing: "0.1em", padding: "12px 0" }}>{msg.errorText}</div>
                )}

                {msg.type === "board" && msg.responses && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }} onClick={() => setExpandedMsg(expandedMsg === msg.id ? null : msg.id)}>
                      <div style={{ flex: 1, height: 1, background: BORDER }} />
                      <span style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase" }}>
                        Board Response {expandedMsg === msg.id ? "▴" : "▾"}
                      </span>
                      <div style={{ flex: 1, height: 1, background: BORDER }} />
                    </div>

                    <AnimatePresence>
                      {expandedMsg === msg.id && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {msg.responses.map((r, ri) => {
                              const persona = PERSONAS.find((p) => p.id === r.personaId);
                              const isAquila = r.personaId === "aquila";
                              return (
                                <motion.div key={r.personaId} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: ri * 0.06 }}
                                  style={{ border: `1px solid ${r.color}25`, borderLeft: `3px solid ${r.color}`, borderRadius: "0 8px 8px 0", padding: isAquila ? "16px 18px" : "12px 16px", background: isAquila ? `${r.color}06` : SURFACE }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                    <span style={{ fontSize: 14 }}>{persona?.icon}</span>
                                    <div>
                                      <div style={{ color: r.color, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 700 }}>{r.name}</div>
                                      <div style={{ color: TEXT_MUTED, fontSize: 7, letterSpacing: "0.14em", textTransform: "uppercase" }}>AI agent · {r.role}</div>
                                    </div>
                                    {isAquila && <span style={{ marginLeft: "auto", background: "#F3EBDD", color: "#13232B", fontSize: 7, letterSpacing: "0.14em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 4, fontWeight: 700, border: "1px solid #D9C4A3" }}>Recommended resolution</span>}
                                  </div>
                                  <p style={{ color: TEXT_SECONDARY, fontSize: 11, lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>{r.content}</p>
                                </motion.div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1, height: 1, background: BORDER }} />
                <span style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase" }}>Board deliberating</span>
                <div style={{ flex: 1, height: 1, background: BORDER }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {PERSONAS.map((p, i) => (
                  <motion.div key={p.id} initial={{ opacity: 0 }} animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.22 }}
                    style={{ height: 36, border: `1px solid ${p.color}20`, borderLeft: `3px solid ${p.color}60`, borderRadius: "0 6px 6px 0", background: `${p.color}06`, display: "flex", alignItems: "center", padding: "0 14px", gap: 8 }}>
                    <span style={{ fontSize: 12 }}>{p.icon}</span>
                    <span style={{ color: p.color, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.7 }}>{p.name} — analysing</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "18px 32px 22px", background: "rgba(245,241,233,0.97)", borderTop: `1px solid ${BORDER}`, backdropFilter: "blur(8px)" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <AnimatePresence>
            {showContext && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ marginBottom: 8 }}>
                <input placeholder="Context (company stage, sector, constraints…)" value={context} onChange={(e) => setContext(e.target.value)}
                  style={{ width: "100%", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 6, color: TEXT_SECONDARY, fontSize: 10, letterSpacing: "0.04em", padding: "8px 12px", outline: "none", boxSizing: "border-box" }} />
              </motion.div>
            )}
          </AnimatePresence>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runBoard(); } }}
                placeholder="State your strategic challenge, decision, or question…"
                rows={2}
                disabled={loading}
                style={{ width: "100%", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT, fontSize: 12, letterSpacing: "0.03em", padding: "12px 14px", outline: "none", resize: "none", fontFamily: "var(--font-sans)", lineHeight: 1.5, boxSizing: "border-box", opacity: loading ? 0.6 : 1, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <button onClick={() => setShowContext((s) => !s)} style={{ background: showContext ? "#F3EBDD" : SURFACE, border: `1px solid ${showContext ? "#D9C4A3" : BORDER}`, borderRadius: 6, color: showContext ? ACCENT : TEXT_MUTED, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", padding: "7px 10px", cursor: "pointer" }}>
                Context
              </button>
              <button onClick={runBoard} disabled={!topic.trim() || loading} style={{ background: !topic.trim() || loading ? SURFACE : ACCENT, border: `1px solid ${!topic.trim() || loading ? BORDER : ACCENT}`, borderRadius: 6, color: !topic.trim() || loading ? TEXT_MUTED : "#ffffff", fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", padding: "7px 14px", cursor: !topic.trim() || loading ? "default" : "pointer", fontWeight: 600, transition: "all 0.18s", boxShadow: !topic.trim() || loading ? "none" : "0 2px 8px rgba(19,35,43,0.22)" }}>
                {loading ? "..." : "Convene"}
              </button>
            </div>
          </div>
          <p style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 6, textAlign: "center" }}>
            Return to convene · Shift+Return for new line
          </p>
        </div>
      </div>
    </div>
  );
}
