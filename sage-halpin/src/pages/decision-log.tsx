import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { loadDecisionLog, saveLog, type DecisionLogEntry } from "@/lib/decisionLog";

const BG = "hsl(var(--background))";
const SURFACE = "hsl(var(--card))";
const BORDER = "hsl(var(--border))";
const BORDER_BRIGHT = "hsl(var(--input))";
const TEXT = "hsl(var(--foreground))";
const TEXT_SEC = "hsl(var(--muted-foreground))";
const TEXT_MUTED = "hsl(var(--muted-foreground))";

const OUTCOME_OPTIONS = [
  { value: "implemented", label: "Implemented", color: "#1d4ed8" },
  { value: "not_implemented", label: "Not Implemented", color: "#475569" },
  { value: "succeeded", label: "Succeeded", color: "#047857" },
  { value: "failed", label: "Failed", color: "#dc2626" },
];

const CALIB_LABELS: { key: keyof DecisionLogEntry["calibration"]; label: string; color: string }[] = [
  { key: "risk", label: "Risk", color: "#dc2626" },
  { key: "ambition", label: "Ambition", color: "#b45309" },
  { key: "time", label: "Time", color: "#047857" },
  { key: "cost", label: "Cost", color: "#1d4ed8" },
];

export default function DecisionLog() {
  const [, setLocation] = useLocation();
  const [entries, setEntries] = useState<DecisionLogEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setEntries(loadDecisionLog());
  }, []);

  function setOutcome(id: string, outcome: string | null) {
    const updated = entries.map((e) => (e.id === id ? { ...e, outcome } : e));
    setEntries(updated);
    saveLog(updated);
  }

  function deleteEntry(id: string) {
    const updated = entries.filter((e) => e.id !== id);
    setEntries(updated);
    saveLog(updated);
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", fontFamily: "Inter, sans-serif", color: TEXT }}>
      {/* Top bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 40, display: "flex", alignItems: "center", gap: 20, padding: "16px 32px", borderBottom: `1px solid ${BORDER}`, background: "hsl(var(--background) / 0.95)", backdropFilter: "blur(8px)" }}>
        <button
          onClick={() => setLocation("/analysis")}
          style={{ background: "none", border: "none", color: TEXT_SEC, fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase", cursor: "pointer", fontWeight: 700 }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--primary))")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = TEXT_SEC)}
        >
          ← Analysis Engine
        </button>
        <span style={{ color: BORDER_BRIGHT, fontSize: 12 }}>|</span>
        <span style={{ color: TEXT, fontSize: 11, letterSpacing: "0.3em", fontWeight: 500, textTransform: "uppercase" }}>Decision Log</span>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 32px 80px" }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ color: TEXT_SEC, fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Board Record</div>
          <h1 style={{ fontSize: "clamp(18px, 2.2vw, 28px)", fontWeight: 300, letterSpacing: "0.04em", color: TEXT, marginBottom: 10 }}>Decision Log</h1>
          <p style={{ color: TEXT_MUTED, fontSize: 11, letterSpacing: "0.06em", lineHeight: 1.6, maxWidth: 560 }}>
            All locked board decisions are recorded here. Update each decision's outcome as real-world results emerge to build an institutional track record.
          </p>
        </div>

        {/* Stats strip */}
        {entries.length > 0 && (
          <div style={{ display: "flex", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
            {[
              { label: "Total Decisions", value: entries.length, color: TEXT },
              { label: "DO", value: entries.filter((e) => e.decision === "DO").length, color: "#047857" },
              { label: "DON'T DO", value: entries.filter((e) => e.decision === "DONT_DO").length, color: "#dc2626" },
              { label: "Succeeded", value: entries.filter((e) => e.outcome === "succeeded").length, color: "#047857" },
              { label: "Failed", value: entries.filter((e) => e.outcome === "failed").length, color: "#dc2626" },
              { label: "Awaiting Outcome", value: entries.filter((e) => !e.outcome).length, color: TEXT_SEC },
            ].map((stat) => (
              <div key={stat.label} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 18px", minWidth: 100 }}>
                <div style={{ color: stat.color, fontSize: 18, fontWeight: 700, letterSpacing: "0.01em", marginBottom: 3 }}>{stat.value}</div>
                <div style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase" }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {entries.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontSize: 32, marginBottom: 16, opacity: 0.4 }}>◇</div>
            <div style={{ color: TEXT_SEC, fontSize: 13, letterSpacing: "0.06em", marginBottom: 6 }}>No decisions logged yet.</div>
            <div style={{ color: TEXT_MUTED, fontSize: 10, letterSpacing: "0.06em", marginBottom: 24 }}>Run an analysis and lock a decision to begin building your board record.</div>
            <button
              onClick={() => setLocation("/analysis")}
              style={{ background: "#1d4ed8", border: "none", borderRadius: 7, color: "#fff", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 700, padding: "10px 22px", cursor: "pointer" }}
            >
              Open Analysis Engine
            </button>
          </div>
        )}

        {/* Decision entries */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {entries.map((entry) => {
            const isExpanded = expanded === entry.id;
            const isGo = entry.decision === "DO";
            const decisionColor = isGo ? "#047857" : "#dc2626";
            const lockedDate = new Date(entry.lockedAt).toLocaleDateString("en-GB", {
              day: "2-digit", month: "short", year: "numeric",
            });
            const outcome = OUTCOME_OPTIONS.find((o) => o.value === entry.outcome);

            return (
              <div
                key={entry.id}
                style={{ background: SURFACE, border: `1px solid ${isExpanded ? BORDER_BRIGHT : BORDER}`, borderRadius: 10, overflow: "hidden", transition: "border-color 0.2s" }}
              >
                {/* Entry header — always visible */}
                <div
                  onClick={() => setExpanded(isExpanded ? null : entry.id)}
                  style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", cursor: "pointer" }}
                >
                  {/* Decision badge */}
                  <div style={{ flexShrink: 0, background: `${decisionColor}18`, border: `1px solid ${decisionColor}40`, borderRadius: 6, padding: "5px 12px", minWidth: 90, textAlign: "center" }}>
                    <div style={{ color: decisionColor, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em" }}>
                      {isGo ? "✓ DO" : "✕ DON'T"}
                    </div>
                  </div>

                  {/* Challenge + date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: TEXT, fontSize: 12, fontWeight: 500, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.challengeLabel}</div>
                    <div style={{ color: TEXT_MUTED, fontSize: 9, letterSpacing: "0.14em" }}>Locked {lockedDate} · Round {entry.feedbackRound + 1}</div>
                  </div>

                  {/* Outcome tag */}
                  <div style={{ flexShrink: 0 }}>
                    {outcome ? (
                      <span style={{ background: `${outcome.color}18`, border: `1px solid ${outcome.color}40`, borderRadius: 4, color: outcome.color, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", padding: "3px 10px", fontWeight: 600 }}>
                        {outcome.label}
                      </span>
                    ) : (
                      <span style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase" }}>Pending</span>
                    )}
                  </div>

                  {/* Expand chevron */}
                  <div style={{ color: TEXT_MUTED, fontSize: 10, transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }}>▼</div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${BORDER}`, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
                    {/* Rationale */}
                    <div>
                      <div style={{ color: TEXT_SEC, fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Board Rationale</div>
                      <p style={{ color: TEXT_SEC, fontSize: 11, lineHeight: 1.6, margin: 0 }}>{entry.rationale}</p>
                    </div>

                    {/* Calibration */}
                    <div>
                      <div style={{ color: TEXT_SEC, fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>Calibration at Decision</div>
                      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                        {CALIB_LABELS.map(({ key, label, color }) => (
                          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 60 }}>
                            <div style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase" }}>{label}</div>
                            <div style={{ color, fontSize: 14, fontWeight: 700 }}>{Math.round(entry.calibration[key] * 10)}<span style={{ color: TEXT_MUTED, fontSize: 9 }}>/10</span></div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Outcome selection */}
                    <div>
                      <div style={{ color: TEXT_SEC, fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>Record Outcome</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {OUTCOME_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setOutcome(entry.id, entry.outcome === opt.value ? null : opt.value)}
                            style={{
                              background: entry.outcome === opt.value ? `${opt.color}22` : "transparent",
                              border: `1px solid ${entry.outcome === opt.value ? opt.color : BORDER_BRIGHT}`,
                              borderRadius: 5,
                              color: entry.outcome === opt.value ? opt.color : TEXT_SEC,
                              fontSize: 9,
                              letterSpacing: "0.16em",
                              textTransform: "uppercase",
                              padding: "6px 14px",
                              cursor: "pointer",
                              transition: "all 0.15s",
                              fontWeight: entry.outcome === opt.value ? 700 : 400,
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Delete */}
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => deleteEntry(entry.id)}
                        style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 5, color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", padding: "5px 12px", cursor: "pointer" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#dc2626"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#dc262640"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = TEXT_MUTED; (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER; }}
                      >
                        Remove from log
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
