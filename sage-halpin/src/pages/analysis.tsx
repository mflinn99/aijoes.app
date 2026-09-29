import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import TraditionalView, { type TraditionalViewData } from "../components/TraditionalView";
import { appendToLog, type DecisionLogEntry } from "@/lib/decisionLog";
import { scopedKey } from "@/lib/userScope";

// The bespoke-challenge waitlist link appears only when an enquiry address is
// configured at build time; there is no default address.
const ENQUIRY_EMAIL = import.meta.env.VITE_ENQUIRY_EMAIL as string | undefined;

const BG = "#F5F1E9";
const SURFACE = "#ffffff";
const BORDER = "#DCD6CA";
const BORDER_BRIGHT = "#C9C1B2";
const TEXT = "#13232B";
const TEXT_SEC = "#4F5D63";
const TEXT_MUTED = "#65737A";

const CHALLENGES = [
  { id: "reduce_payroll", label: "Reduce Payroll", description: "Cut workforce costs through headcount reduction or restructuring", icon: "💼", persona: "Risk Advisor" },
  { id: "improve_margins", label: "Improve Margins", description: "Increase gross or net margins through pricing, efficiency, or supplier terms", icon: "📊", persona: "Commercial Lead" },
  { id: "increase_sales", label: "Increase Sales", description: "Accelerate revenue growth through sales, marketing, or channel expansion", icon: "🚀", persona: "Commercial Lead" },
  { id: "build_product", label: "Build New Product", description: "Invest in new product development or a major platform extension", icon: "🏗", persona: "Innovation Lead" },
  { id: "recruit_smt", label: "Recruit Senior Leader", description: "Hire a new senior management team member to drive a strategic agenda", icon: "🤝", persona: "Culture Lead" },
  { id: "identify_redundancies", label: "Identify Redundancies", description: "Audit roles, processes, and spend to surface duplication and structural inefficiency", icon: "🔍", persona: "Governance Lead" },
];

const PERSONA_META: Record<string, { color: string; icon: string; hat: string }> = {
  dr_white:   { color: "#475569", icon: "○", hat: "GOVERNANCE & COMPLIANCE" },
  cmdr_black: { color: "#1e293b", icon: "◆", hat: "RISK & RESILIENCE" },
  ms_gold:    { color: "#b45309", icon: "◎", hat: "COMMERCIAL VALUE" },
  dr_green:   { color: "#3F6B4E", icon: "◇", hat: "INNOVATION & SUSTAINABILITY" },
  lt_red:     { color: "#991B1B", icon: "◉", hat: "CULTURE & ETHICS" },
  col_blue:   { color: "#1d4ed8", icon: "◈", hat: "PERFORMANCE & STRATEGY" },
};

const PERSONA_ORDER = ["dr_white", "cmdr_black", "ms_gold", "dr_green", "lt_red", "col_blue"];

const BOARD_STATEMENTS = [
  "Governance is mediating a difference of opinion.",
  "Risk has raised a second structural objection.",
  "Performance is calling the room back to order.",
  "Commercial is stress-testing the return assumptions.",
  "Innovation is proposing an alternative framing — the board is listening.",
  "Culture is surfacing an execution concern that needs to be heard.",
  "The chair is weighing a divergence between risk appetite and strategic ambition.",
  "Governance has requested additional data validation before convergence.",
  "All six perspectives are being given equal weight — no shortcuts.",
  "The deliberation is proceeding with unusual rigour.",
  "Risk and Commercial are in structured disagreement — Performance is mediating.",
  "Culture has flagged a human factor the strategy does not yet account for.",
  "Innovation has reframed the problem — the board is reconsidering.",
  "The chair is enforcing decision discipline. A verdict is forming.",
  "Commercial is recalculating the capital efficiency case.",
];

// Credible, never-alarming error messages keyed by failure type
const ERROR_MSGS: Record<string, string> = {
  timeout: "The board's deliberation extended beyond the session window. The secretariat has preserved your calibration — please reconvene.",
  server_500: "The analysis channel encountered interference before the report could be compiled. Your setup is intact — please reconvene.",
  server_400: "The board challenge parameters were not recognised. Please review your setup and try again.",
  rate_limited: "The board has convened several times in quick succession. Please wait a few minutes before reconvening.",
  network: "The boardroom connection was interrupted before the analysis could complete. Your calibration has been preserved — please reconvene.",
  parse: "The board's report was received but could not be compiled — a formatting issue in the channel. Please reconvene for a fresh session.",
  unknown: "The board session was disrupted by an unexpected signal. Your setup has been preserved — please reconvene.",
};

type Calibration = { risk: number; ambition: number; time: number; cost: number };

type PersonaOutput = {
  id: string; name: string; hat: string; color: string;
  executionNarrative: string; consequences: string[];
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
};

type AggregatedOutput = {
  decision: "DO" | "DONT_DO"; rationale: string;
  difficulty: string; cost: string; time: string; risk: string;
  personaActions: Record<string, string[]>;
};

type AnalysisResult = {
  personaOutputs: PersonaOutput[]; aggregatedOutput: AggregatedOutput;
  traditionalView?: TraditionalViewData;
  feedbackRound: number; challenge: string; calibration: Calibration; timestamp: string;
};

type Step = "challenge" | "calibrate" | "running" | "results" | "locked";

const STORAGE_KEY = () => scopedKey("analysis_session");

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const DEFAULT_CALIBRATION: Calibration = { risk: 0.5, ambition: 0.5, time: 0.5, cost: 0.5 };

export default function Analysis() {
  const [, setLocation] = useLocation();

  // Always start completely fresh — never restore from localStorage
  const [step, setStep] = useState<Step>("calibrate");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<Calibration>(DEFAULT_CALIBRATION);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [feedbackRound, setFeedbackRound] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackCalib, setFeedbackCalib] = useState<Calibration>(DEFAULT_CALIBRATION);
  const [showFeedback, setShowFeedback] = useState(false);
  const [resultsView, setResultsView] = useState<"boardroom" | "traditional">("boardroom");
  const [expandedPersona, setExpandedPersona] = useState<string | null>(null);
  const [runningMsg, setRunningMsg] = useState("Convening the board…");
  const [elapsed, setElapsed] = useState(0);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userCancelledRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Wipe any previous session on every mount — nothing ever carries forward
  useEffect(() => {
    localStorage.removeItem(STORAGE_KEY());
  }, []);

  useEffect(() => {
    if (step !== "running") { setElapsed(0); return; }
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [step]);

  function persist(_update: Partial<{ step: Step; challenge: string | null; calibration: Calibration; result: AnalysisResult | null; feedbackRound: number }>) {
    // No-op: session state is never persisted to localStorage.
    // Nothing carries forward between visits.
  }

  async function runAnalysis(calib: Calibration, fbRound = 0, fbComment = "") {
    setAnalysisError(null);
    userCancelledRef.current = false;
    setStep("running");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const msgs = ["Convening the board…", "Governance reviewing facts…", "Risk stress-testing exposure…", "Commercial evaluating value…", "Innovation exploring alternatives…", "Culture reading the room…", "Performance synthesising decision…", "Aggregating board positions…", "Finalising recommendation…"];
    let mi = 0;
    setRunningMsg(msgs[0]);
    const interval = setInterval(() => { mi = (mi + 1) % msgs.length; setRunningMsg(msgs[mi]); }, 2200);

    const timeout = setTimeout(() => {
      userCancelledRef.current = false;
      controller.abort();
    }, 90_000);

    try {
      const res = await fetch(`${BASE}/api/boardroom/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge, calibration: calib, feedbackRound: fbRound, feedbackComment: fbComment }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const key = res.status === 429 ? "rate_limited" : res.status >= 500 ? "server_500" : res.status >= 400 ? "server_400" : "unknown";
        throw Object.assign(new Error(`http_${res.status}`), { errorKey: key });
      }

      let data: Record<string, unknown>;
      try {
        data = await res.json() as Record<string, unknown>;
      } catch {
        throw Object.assign(new Error("parse_error"), { errorKey: "parse" });
      }

      const analysisResult: AnalysisResult = { ...data as Omit<AnalysisResult, "timestamp">, timestamp: new Date().toISOString(), feedbackRound: fbRound };

      if (!Array.isArray(analysisResult.personaOutputs) || analysisResult.personaOutputs.length === 0) {
        throw Object.assign(new Error("empty_output"), { errorKey: "parse" });
      }

      setResult(analysisResult);
      setFeedbackRound(fbRound);
      setCalibration(calib);
      setStep("results");
      persist({ step: "results", result: analysisResult, calibration: calib, feedbackRound: fbRound });

    } catch (err: unknown) {
      if (userCancelledRef.current) {
        setStep("calibrate");
        return;
      }

      const key = (err as { errorKey?: string }).errorKey;
      if (key) {
        setAnalysisError(ERROR_MSGS[key] ?? ERROR_MSGS.unknown);
      } else if (err instanceof Error && err.name === "AbortError") {
        setAnalysisError(ERROR_MSGS.timeout);
      } else if (err instanceof TypeError && err.message.includes("fetch")) {
        setAnalysisError(ERROR_MSGS.network);
      } else {
        setAnalysisError(ERROR_MSGS.unknown);
      }
      setStep("calibrate");
    } finally {
      clearInterval(interval);
      clearTimeout(timeout);
    }
  }

  function handleFeedback() {
    const nextRound = feedbackRound + 1;
    setShowFeedback(false);
    runAnalysis(feedbackCalib, nextRound, feedbackComment);
    setFeedbackComment("");
  }

  function lockDecision() {
    setStep("locked");
    persist({ step: "locked" });
    if (result) {
      const label = CHALLENGES.find((c) => c.id === challenge)?.label ?? challenge ?? "";
      appendToLog({
        id: new Date().toISOString(),
        lockedAt: new Date().toISOString(),
        challenge: challenge ?? "",
        challengeLabel: label,
        calibration,
        decision: result.aggregatedOutput.decision,
        rationale: result.aggregatedOutput.rationale,
        feedbackRound: result.feedbackRound,
        outcome: null,
      });
    }
  }

  function reopen() {
    localStorage.removeItem(STORAGE_KEY());
    setStep("calibrate");
    setChallenge(null);
    setResult(null);
    setFeedbackRound(0);
    setCalibration({ risk: 0.5, ambition: 0.5, time: 0.5, cost: 0.5 });
    setShowFeedback(false);
  }

  const challengeLabel = CHALLENGES.find((c) => c.id === challenge)?.label ?? "";
  const canFeedback = feedbackRound < 2 && step === "results";

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "var(--font-sans)", color: TEXT }} data-testid="analysis-page">
      {/* Top bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 32px", borderBottom: `1px solid ${BORDER}`, background: "hsl(var(--background) / 0.95)", backdropFilter: "blur(8px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <button onClick={() => setLocation("/")} style={{ background: "none", border: "none", color: TEXT_SEC, fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--primary))")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = TEXT_SEC)}>
            ← SAGE HALPIN
          </button>
          <span style={{ color: BORDER_BRIGHT, fontSize: 12 }}>|</span>
          <span style={{ color: TEXT, fontSize: 11, letterSpacing: "0.3em", fontWeight: 500, textTransform: "uppercase" }}>Analysis Engine</span>
          <button onClick={() => setLocation("/log")} style={{ background: "none", border: "none", color: TEXT_MUTED, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", cursor: "pointer", fontWeight: 600 }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--primary))")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = TEXT_MUTED)}>
            Decision Log
          </button>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {(["calibrate", "results", "locked"] as Step[]).map((s, i) => {
            const ORDER = ["calibrate", "results", "locked"];
            const past = ORDER.indexOf(step) > i;
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: step === s ? "#13232B" : (past ? "rgba(19,35,43,0.4)" : BORDER_BRIGHT), transition: "background 0.3s" }} />
                <span style={{ color: step === s ? TEXT : TEXT_MUTED, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", transition: "color 0.3s" }}>
                  {s === "calibrate" ? "Setup" : s === "results" ? "Board Output" : "Locked"}
                </span>
              </div>
            );
          })}
        </div>
        {step === "locked" && (
          <button onClick={reopen} style={{ background: "none", border: `1px solid ${BORDER_BRIGHT}`, borderRadius: 5, color: TEXT_SEC, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", padding: "5px 12px", cursor: "pointer" }}>
            Reopen
          </button>
        )}
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 32px 80px" }}>
        <AnimatePresence mode="wait">

          {/* ── SETUP: Challenge selection + Calibration (combined) ── */}
          {step === "calibrate" && (
            <motion.div key="calibrate" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <h2 style={{ color: TEXT_SEC, fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Convene the Board</h2>
              <h1 style={{ fontSize: "clamp(20px, 2.5vw, 32px)", fontWeight: 300, letterSpacing: "0.04em", color: TEXT, marginBottom: 28 }}>Select your challenge and calibrate</h1>

              {/* Custom question — coming soon */}
              <div style={{ position: "relative", marginBottom: 32 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ color: TEXT_SEC, fontSize: 8, letterSpacing: "0.24em", textTransform: "uppercase", fontWeight: 600 }}>Bespoke Challenge</div>
                  <span style={{ background: "rgba(255,215,64,0.1)", border: "1px solid rgba(255,215,64,0.3)", borderRadius: 4, color: "#b45309", fontSize: 7, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, padding: "3px 10px" }}>Coming Soon</span>
                </div>
                <div style={{ position: "relative" }}>
                  <textarea
                    placeholder="Describe your specific board challenge — e.g. 'We are considering a joint venture with a European distributor to accelerate expansion…'"
                    rows={3}
                    disabled
                    style={{ width: "100%", background: "#EEE9DF", border: `1px solid ${BORDER}`, borderRadius: 9, color: TEXT_MUTED, fontSize: 11, padding: "14px 16px", outline: "none", resize: "none", fontFamily: "var(--font-sans)", boxSizing: "border-box", letterSpacing: "0.03em", lineHeight: 1.6, cursor: "not-allowed", opacity: 0.7 }}
                  />
                  <div style={{ position: "absolute", bottom: 12, right: 14, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: TEXT_MUTED, fontSize: 9, letterSpacing: "0.1em" }}>Unlimited bespoke challenges — coming in the next release.</span>
                    {ENQUIRY_EMAIL && <a
                      href={`mailto:${ENQUIRY_EMAIL}?subject=${encodeURIComponent("Sage Halpin bespoke challenge waitlist")}&body=${encodeURIComponent("Please add me to the waitlist for bespoke challenge analysis.")}`}
                      style={{ background: "#b45309", border: "none", borderRadius: 5, color: "#ffffff", fontSize: 8, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, padding: "6px 14px", cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap" }}
                    >
                      Join Waitlist
                    </a>}
                  </div>
                </div>
              </div>

              {/* Challenge cards */}
              <div style={{ marginBottom: 8, color: TEXT_SEC, fontSize: 8, letterSpacing: "0.24em", textTransform: "uppercase", fontWeight: 600 }}>Board Challenge</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginBottom: 32 }}>
                {CHALLENGES.map((c, i) => (
                  <motion.button
                    key={c.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => { setChallenge(c.id); persist({ challenge: c.id }); }}
                    style={{ background: challenge === c.id ? "rgba(19,35,43,0.14)" : SURFACE, border: `1px solid ${challenge === c.id ? "#13232B70" : BORDER}`, borderRadius: 9, padding: "16px 18px", cursor: "pointer", textAlign: "left", transition: "all 0.18s", outline: "none" }}
                    onMouseEnter={(e) => { if (challenge !== c.id) { (e.currentTarget as HTMLButtonElement).style.borderColor = "#13232B40"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(19,35,43,0.07)"; } }}
                    onMouseLeave={(e) => { if (challenge !== c.id) { (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER; (e.currentTarget as HTMLButtonElement).style.background = SURFACE; } }}
                    data-testid={`challenge-${c.id}`}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{c.icon}</span>
                      <div>
                        <div style={{ color: challenge === c.id ? "#13232B" : TEXT, fontSize: 12, fontWeight: 600, letterSpacing: "0.02em", marginBottom: 2, transition: "color 0.18s" }}>{c.label}</div>
                        <div style={{ color: TEXT_MUTED, fontSize: 10, lineHeight: 1.45 }}>{c.description}</div>
                      </div>
                      {challenge === c.id && (
                        <span style={{ marginLeft: "auto", color: "#13232B", fontSize: 14, flexShrink: 0 }}>✓</span>
                      )}
                    </div>
                  </motion.button>
                ))}
              </div>

              {/* Calibration sliders */}
              <div style={{ marginBottom: 8, color: TEXT_SEC, fontSize: 8, letterSpacing: "0.24em", textTransform: "uppercase", fontWeight: 600 }}>Board Calibration</div>
              <p style={{ color: TEXT_MUTED, fontSize: 10, letterSpacing: "0.06em", marginBottom: 18, lineHeight: 1.6 }}>Higher values shift the board's recommendations toward speed, risk, and ambition.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 700, marginBottom: 24 }}>
                {([
                  { key: "risk" as const, label: "Risk Appetite", low: "Risk-Averse", high: "Risk-Seeking", color: "#dc2626" },
                  { key: "ambition" as const, label: "Ambition Level", low: "Conservative", high: "Aggressive", color: "#b45309" },
                  { key: "time" as const, label: "Time Sensitivity", low: "Flexible", high: "Urgent", color: "#047857" },
                  { key: "cost" as const, label: "Cost Sensitivity", low: "Flexible", high: "Constrained", color: "#1d4ed8" },
                ] as const).map((slider) => (
                  <div key={slider.key} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 9, padding: "16px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <span style={{ color: TEXT, fontSize: 11, fontWeight: 500 }}>{slider.label}</span>
                      <span style={{ color: slider.color, fontSize: 15, fontWeight: 700 }}>{Math.round(calibration[slider.key] * 10)}<span style={{ fontSize: 9, color: TEXT_SEC }}>/10</span></span>
                    </div>
                    <input
                      type="range" min={0} max={10} step={1}
                      value={Math.round(calibration[slider.key] * 10)}
                      onChange={(e) => setCalibration((c) => ({ ...c, [slider.key]: parseInt(e.target.value) / 10 }))}
                      style={{ width: "100%", accentColor: slider.color, cursor: "pointer" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
                      <span style={{ color: TEXT_MUTED, fontSize: 7, letterSpacing: "0.14em", textTransform: "uppercase" }}>{slider.low}</span>
                      <span style={{ color: TEXT_MUTED, fontSize: 7, letterSpacing: "0.14em", textTransform: "uppercase" }}>{slider.high}</span>
                    </div>
                  </div>
                ))}
              </div>

              {analysisError && (
                <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10, background: "rgba(255,23,68,0.1)", border: "1px solid #dc262640", borderRadius: 7, padding: "10px 16px", maxWidth: 500 }}>
                  <span style={{ color: "#dc2626", fontSize: 14 }}>⚠</span>
                  <span style={{ color: "#dc2626", fontSize: 11 }}>{analysisError}</span>
                </div>
              )}

              <button
                onClick={() => challenge && runAnalysis(calibration)}
                disabled={!challenge}
                data-testid="button-run-analysis"
                style={{ background: challenge ? "#13232B" : "rgba(19,35,43,0.25)", border: "none", borderRadius: 8, color: challenge ? "#fff" : "#94a3b8", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, padding: "13px 32px", cursor: challenge ? "pointer" : "not-allowed", boxShadow: challenge ? "0 4px 18px rgba(19,35,43,0.4)" : "none", transition: "all 0.2s" }}
                onMouseEnter={(e) => { if (challenge) (e.currentTarget as HTMLButtonElement).style.background = "#0B161C"; }}
                onMouseLeave={(e) => { if (challenge) (e.currentTarget as HTMLButtonElement).style.background = "#13232B"; }}
              >
                {challenge ? "Convene →" : "Select a challenge to convene"}
              </button>
            </motion.div>
          )}

          {/* ── RUNNING ── */}
          {step === "running" && (() => {
            const timerPhase = elapsed < 20 ? 0 : elapsed < 35 ? 1 : 2;
            const statIdx = timerPhase === 2 ? Math.floor((elapsed - 35) / 8) % BOARD_STATEMENTS.length : 0;
            const phaseMsg = timerPhase === 1
              ? "Governance is mediating a difference of opinion."
              : timerPhase === 2
              ? (elapsed < 43 ? "Break for coffee — the board is still deliberating." : BOARD_STATEMENTS[statIdx])
              : null;
            return (
              <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 28 }}>
                <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
                  <div style={{ display: "flex", gap: 14, justifyContent: "center" }}>
                    {PERSONA_ORDER.map((pid, i) => {
                      const meta = PERSONA_META[pid];
                      return (
                        <motion.div key={pid} animate={{ opacity: [0.3, 0.9, 0.3] }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.35 }}
                          style={{ width: 44, height: 44, borderRadius: "50%", border: `1.5px solid ${meta.color}60`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, background: `${meta.color}12`, boxShadow: `0 0 16px ${meta.color}40` }}>
                          {meta.icon}
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>

                <div style={{ textAlign: "center" }}>
                  <p style={{ color: TEXT_SEC, fontSize: 13, letterSpacing: "0.14em", marginBottom: 8 }}>{runningMsg}</p>
                  <p style={{ color: TEXT_MUTED, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 10 }}>Six-persona structured analysis in progress</p>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(19,35,43,0.1)", border: "1px solid #13232B30", borderRadius: 20, padding: "4px 14px" }}>
                    <motion.div style={{ width: 5, height: 5, borderRadius: "50%", background: "#13232B" }} animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }} />
                    <span style={{ color: "#13232B", fontSize: 10, letterSpacing: "0.12em", fontVariantNumeric: "tabular-nums" }}>{elapsed}s elapsed — the board is deliberating</span>
                  </div>
                </div>

                {/* Phase-based popup message — appears at 20s, evolves at 35s */}
                <AnimatePresence mode="wait">
                  {phaseMsg && (
                    <motion.div
                      key={timerPhase === 1 ? "phase1" : `phase2-${statIdx}`}
                      initial={{ opacity: 0, y: 10, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }}
                      transition={{ duration: 0.5 }}
                      style={{
                        background: timerPhase === 1 ? "rgba(255,215,64,0.08)" : "rgba(19,35,43,0.08)",
                        border: `1px solid ${timerPhase === 1 ? "rgba(255,215,64,0.3)" : "rgba(19,35,43,0.25)"}`,
                        borderRadius: 10,
                        padding: "14px 22px",
                        maxWidth: 480,
                        textAlign: "center",
                      }}
                    >
                      <div style={{ color: timerPhase === 1 ? "#b45309" : "#13232B", fontSize: 8, letterSpacing: "0.24em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
                        {timerPhase === 1 ? "Board Secretariat" : "Session Update"}
                      </div>
                      <p style={{ color: TEXT_SEC, fontSize: 12, letterSpacing: "0.05em", lineHeight: 1.6, margin: 0 }}>{phaseMsg}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div style={{ display: "flex", gap: 6 }}>
                  {[0, 1, 2].map((i) => (
                    <motion.div key={i} animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3 }}
                      style={{ width: 5, height: 5, borderRadius: "50%", background: "#13232B" }} />
                  ))}
                </div>
                <button
                  onClick={() => { userCancelledRef.current = true; abortRef.current?.abort(); setStep("calibrate"); }}
                  style={{ background: "none", border: "none", color: TEXT_MUTED, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", marginTop: 4 }}
                >
                  Cancel — return to setup
                </button>
              </motion.div>
            );
          })()}

          {/* ── RESULTS: null guard ── */}
          {(step === "results" || step === "locked") && !result && (
            <motion.div key="no-result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "50vh", gap: 20 }}>
              <div style={{ background: "rgba(19,35,43,0.08)", border: "1px solid #13232B25", borderRadius: 10, padding: "28px 36px", maxWidth: 420, textAlign: "center" }}>
                <div style={{ color: "#13232B", fontSize: 9, letterSpacing: "0.24em", textTransform: "uppercase", fontWeight: 700, marginBottom: 10 }}>Session Notice</div>
                <p style={{ color: TEXT_SEC, fontSize: 12, lineHeight: 1.7, marginBottom: 20 }}>The board reached quorum but the session output was not preserved. This can occur when the browser session was refreshed mid-deliberation.</p>
                <button onClick={() => { setResult(null); setStep("calibrate"); }} style={{ background: "#13232B", border: "none", borderRadius: 7, color: "#fff", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, padding: "10px 22px", cursor: "pointer" }}>
                  Reconvene the Board
                </button>
              </div>
            </motion.div>
          )}

          {/* ── RESULTS ── */}
          {(step === "results" || step === "locked") && result && (
            <motion.div key="results" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>

              {/* Decision banner */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 32, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ color: TEXT_SEC, fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase" }}>{step === "locked" ? "Your Decision" : "Board Recommendation · for your decision"}</span>
                    {step === "locked" && <span style={{ background: "#13232B20", border: "1px solid #13232B40", borderRadius: 4, color: "#13232B", fontSize: 7, letterSpacing: "0.18em", textTransform: "uppercase", padding: "2px 8px", fontWeight: 700 }}>Locked</span>}
                    {feedbackRound > 0 && <span style={{ background: "rgba(255,215,64,0.12)", border: "1px solid #b4530940", borderRadius: 4, color: "#b45309", fontSize: 7, letterSpacing: "0.16em", textTransform: "uppercase", padding: "2px 8px" }}>Round {feedbackRound} Calibration</span>}
                  </div>
                  <h1 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 700, letterSpacing: "0.02em", color: result.aggregatedOutput.decision === "DO" ? "#047857" : "#dc2626", marginBottom: 10, textShadow: `0 0 30px ${result.aggregatedOutput.decision === "DO" ? "#04785760" : "#dc262660"}` }}>
                    {result.aggregatedOutput.decision === "DO" ? "✓ DO IT" : "✕ DON'T DO IT"}
                  </h1>
                  <p style={{ color: TEXT_SEC, fontSize: 12, lineHeight: 1.7, maxWidth: 600 }}>{result.aggregatedOutput.rationale}</p>
                </div>

                {/* Summary table */}
                <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 9, padding: "14px 18px", minWidth: 220 }}>
                  <div style={{ color: TEXT_SEC, fontSize: 8, letterSpacing: "0.24em", textTransform: "uppercase", marginBottom: 12, fontWeight: 600 }}>Board Assessment</div>
                  {([
                    { label: "Difficulty", value: result.aggregatedOutput.difficulty, colors: { Low: "#047857", Med: "#b45309", High: "#dc2626" } },
                    { label: "Cost", value: result.aggregatedOutput.cost, colors: { Low: "#047857", Med: "#b45309", High: "#dc2626" } },
                    { label: "Time", value: result.aggregatedOutput.time, colors: { Short: "#047857", Med: "#b45309", Long: "#dc2626" } },
                    { label: "Risk", value: result.aggregatedOutput.risk, colors: { Low: "#047857", Med: "#b45309", High: "#dc2626" } },
                  ] as { label: string; value: string; colors: Record<string, string> }[]).map((row) => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ color: TEXT_MUTED, fontSize: 10, letterSpacing: "0.08em" }}>{row.label}</span>
                      <span style={{ color: row.colors[row.value] ?? TEXT_SEC, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em" }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* View toggle */}
              <div style={{ display: "flex", gap: 0, marginBottom: 24, border: `1px solid ${BORDER}`, borderRadius: 7, overflow: "hidden", width: "fit-content" }}>
                {(["boardroom", "traditional"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setResultsView(v)}
                    style={{
                      background: resultsView === v ? "#13232B" : "transparent",
                      border: "none",
                      color: resultsView === v ? "#fff" : TEXT_SEC,
                      fontSize: 9,
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      fontWeight: resultsView === v ? 700 : 400,
                      padding: "8px 20px",
                      cursor: "pointer",
                      transition: "all 0.18s",
                    }}
                  >
                    {v === "boardroom" ? "Experts" : "Traditional"}
                  </button>
                ))}
              </div>

              {/* ── TRADITIONAL VIEW ── */}
              {resultsView === "traditional" && result.traditionalView && (
                <TraditionalView data={result.traditionalView} />
              )}
              {resultsView === "traditional" && !result.traditionalView && (
                <div style={{ color: TEXT_MUTED, fontSize: 11, padding: "24px 0" }}>Traditional view not available — re-run the analysis to generate it.</div>
              )}

              {/* ── BOARDROOM VIEW ── */}
              {resultsView === "boardroom" && (
                <>
              <div style={{ marginBottom: 8, color: TEXT_SEC, fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600 }}>Expert Analysis</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
                {PERSONA_ORDER.map((pid) => {
                  const output = result.personaOutputs.find((p) => p.id === pid);
                  if (!output) return null;
                  const meta = PERSONA_META[pid];
                  const isExpanded = expandedPersona === pid;
                  return (
                    <motion.div key={pid} layout style={{ background: SURFACE, border: `1px solid ${isExpanded ? `${meta.color}40` : BORDER}`, borderLeft: `3px solid ${meta.color}`, borderRadius: "0 9px 9px 0", overflow: "hidden", transition: "border-color 0.2s" }}>
                      {/* Header */}
                      <button onClick={() => setExpandedPersona(isExpanded ? null : pid)} style={{ width: "100%", background: "none", border: "none", padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{meta.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: meta.color, fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", textShadow: `0 0 10px ${meta.color}60` }}>{output.name}</div>
                          <div style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase" }}>{output.hat}</div>
                        </div>
                        <p style={{ color: TEXT_SEC, fontSize: 11, flex: 2, lineHeight: 1.5, margin: 0 }}>{output.executionNarrative}</p>
                        <span style={{ color: TEXT_MUTED, fontSize: 12, flexShrink: 0, marginLeft: 10 }}>{isExpanded ? "▴" : "▾"}</span>
                      </button>

                      {/* Expanded detail */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: "hidden", borderTop: `1px solid ${BORDER}` }}>
                            <div style={{ padding: "18px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                              {/* Consequences */}
                              <div>
                                <div style={{ color: meta.color, fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, marginBottom: 10 }}>Consequences</div>
                                {(output.consequences ?? []).length === 0
                                  ? <div style={{ color: TEXT_MUTED, fontSize: 10 }}>No consequences identified.</div>
                                  : (output.consequences ?? []).map((c, i) => (
                                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 7 }}>
                                    <span style={{ color: meta.color, fontSize: 9, flexShrink: 0, marginTop: 1 }}>▸</span>
                                    <span style={{ color: TEXT_SEC, fontSize: 11, lineHeight: 1.5 }}>{c}</span>
                                  </div>
                                ))}
                              </div>

                              {/* SWOT */}
                              <div>
                                <div style={{ color: meta.color, fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, marginBottom: 10 }}>SWOT</div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                  {([
                                    { key: "strengths" as const, label: "Strengths", color: "#047857" },
                                    { key: "weaknesses" as const, label: "Weaknesses", color: "#dc2626" },
                                    { key: "opportunities" as const, label: "Opportunities", color: "#b45309" },
                                    { key: "threats" as const, label: "Threats", color: "#475569" },
                                  ]).map((quadrant) => (
                                    <div key={quadrant.key} style={{ background: `${quadrant.color}08`, border: `1px solid ${quadrant.color}25`, borderRadius: 6, padding: "8px 10px" }}>
                                      <div style={{ color: quadrant.color, fontSize: 8, letterSpacing: "0.18em", fontWeight: 700, marginBottom: 5 }}>{quadrant.label}</div>
                                      {(output.swot?.[quadrant.key] ?? []).length === 0
                                        ? <div style={{ color: TEXT_MUTED, fontSize: 9 }}>None identified.</div>
                                        : (output.swot?.[quadrant.key] ?? []).map((item, i) => (
                                        <div key={i} style={{ color: TEXT_SEC, fontSize: 10, lineHeight: 1.45, marginBottom: 3 }}>· {item}</div>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Actions */}
                            {result.aggregatedOutput.personaActions[pid]?.length > 0 && (
                              <div style={{ padding: "0 20px 16px", borderTop: `1px solid ${BORDER}` }}>
                                <div style={{ color: meta.color, fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8, paddingTop: 14 }}>Required Actions</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {result.aggregatedOutput.personaActions[pid].map((action, i) => (
                                    <span key={i} style={{ background: `${meta.color}12`, border: `1px solid ${meta.color}30`, borderRadius: 5, color: meta.color, fontSize: 10, padding: "4px 10px" }}>{action}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
                </>
              )}

              {/* Feedback + Lock controls */}
              {step === "results" && (
                <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 24 }}>
                  {!showFeedback ? (
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      {canFeedback && (
                        <button onClick={() => { setFeedbackCalib(calibration); setShowFeedback(true); }}
                          style={{ background: SURFACE, border: `1px solid ${BORDER_BRIGHT}`, borderRadius: 7, color: TEXT_SEC, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", padding: "10px 18px", cursor: "pointer" }}>
                          Recalibrate ({2 - feedbackRound} round{2 - feedbackRound !== 1 ? "s" : ""} remaining)
                        </button>
                      )}
                      <button onClick={lockDecision} data-testid="button-lock"
                        style={{ background: "#13232B", border: "none", borderRadius: 7, color: "#fff", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 700, padding: "10px 22px", cursor: "pointer", boxShadow: "0 3px 14px rgba(19,35,43,0.35)" }}>
                        Lock Decision
                      </button>
                      {feedbackRound >= 2 && <span style={{ color: TEXT_MUTED, fontSize: 9, letterSpacing: "0.12em" }}>Maximum feedback rounds reached.</span>}
                    </div>
                  ) : (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ background: SURFACE, border: `1px solid ${BORDER_BRIGHT}`, borderRadius: 10, padding: "22px 24px" }}>
                      <div style={{ color: TEXT_SEC, fontSize: 9, letterSpacing: "0.26em", textTransform: "uppercase", fontWeight: 600, marginBottom: 16 }}>Round {feedbackRound + 1} Recalibration</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
                        {([
                          { key: "risk" as const, label: "Risk Appetite", color: "#dc2626" },
                          { key: "ambition" as const, label: "Ambition Level", color: "#b45309" },
                          { key: "time" as const, label: "Time Sensitivity", color: "#047857" },
                          { key: "cost" as const, label: "Cost Sensitivity", color: "#1d4ed8" },
                        ] as const).map((s) => (
                          <div key={s.key}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                              <span style={{ color: TEXT, fontSize: 11 }}>{s.label}</span>
                              <span style={{ color: s.color, fontSize: 12, fontWeight: 700 }}>{Math.round(feedbackCalib[s.key] * 10)}/10</span>
                            </div>
                            <input type="range" min={0} max={10} step={1} value={Math.round(feedbackCalib[s.key] * 10)} onChange={(e) => setFeedbackCalib((c) => ({ ...c, [s.key]: parseInt(e.target.value) / 10 }))} style={{ width: "100%", accentColor: s.color }} />
                          </div>
                        ))}
                      </div>
                      <textarea placeholder="Optional: add feedback or context for the board…" value={feedbackComment} onChange={(e) => setFeedbackComment(e.target.value)} rows={2} style={{ width: "100%", background: BG, border: `1px solid ${BORDER}`, borderRadius: 6, color: TEXT_SEC, fontSize: 11, padding: "10px 12px", outline: "none", resize: "none", fontFamily: "var(--font-sans)", boxSizing: "border-box", marginBottom: 14 }} />
                      <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={handleFeedback} style={{ background: "#13232B", border: "none", borderRadius: 6, color: "#fff", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 700, padding: "9px 20px", cursor: "pointer", boxShadow: "0 2px 10px rgba(19,35,43,0.35)" }}>Re-run Analysis</button>
                        <button onClick={() => setShowFeedback(false)} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, color: TEXT_MUTED, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", padding: "9px 14px", cursor: "pointer" }}>Cancel</button>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {step === "locked" && (
                <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 20, display: "flex", gap: 14, alignItems: "center" }}>
                  <span style={{ color: "#13232B", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>Decision locked on {new Date(result.timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                  <button onClick={reopen} style={{ background: "none", border: `1px solid ${BORDER_BRIGHT}`, borderRadius: 6, color: TEXT_SEC, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", padding: "6px 14px", cursor: "pointer" }}>New Analysis</button>
                </div>
              )}

              <div ref={bottomRef} />
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
