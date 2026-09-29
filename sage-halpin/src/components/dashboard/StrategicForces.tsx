import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GrowthLever, Risk, store } from "@/lib/store";

const BG = "hsl(var(--background))";
const BORDER = "hsl(var(--border))";
const TEXT = "hsl(var(--foreground))";
const TEXT_MUTED = "hsl(var(--muted-foreground))";

const CONFIDENCE_COLORS = { low: "#dc2626", medium: "#d97706", high: "#16a34a" };
const SEVERITY_COLORS = { low: "#8a98ae", medium: "#d97706", high: "#dc2626" };
const SEVERITY_BORDER = { low: "#d6deec", medium: "#fde68a", high: "#fecaca" };
const SEVERITY_BG = { low: "#f8fafc", medium: "#fffbeb", high: "#fef2f2" };

type Props = {
  levers: GrowthLever[];
  risks: Risk[];
  onLeversChange: (l: GrowthLever[]) => void;
  onRisksChange: (r: Risk[]) => void;
};

const BLANK_LEVER = { name: "", expectedImpact: "", confidence: "medium" as GrowthLever["confidence"], owner: "" };
const BLANK_RISK = { name: "", severity: "medium" as Risk["severity"], category: "operational" as Risk["category"], owner: "" };

const inputStyle = {
  background: BG, border: "none", borderBottom: `1px solid ${BORDER}`,
  color: TEXT, fontSize: 10, letterSpacing: "0.04em", outline: "none", padding: "4px 0", width: "100%",
};

export function StrategicForces({ levers, risks, onLeversChange, onRisksChange }: Props) {
  const [addingLever, setAddingLever] = useState(false);
  const [addingRisk, setAddingRisk] = useState(false);
  const [draftLever, setDraftLever] = useState(BLANK_LEVER);
  const [draftRisk, setDraftRisk] = useState(BLANK_RISK);

  function saveLever() {
    if (!draftLever.name.trim()) return;
    const updated = [...levers, { ...draftLever, id: `l${Date.now()}` }];
    store.setLevers(updated); onLeversChange(updated); setAddingLever(false); setDraftLever(BLANK_LEVER);
  }

  function removeLever(id: string) {
    const updated = levers.filter((l) => l.id !== id); store.setLevers(updated); onLeversChange(updated);
  }

  function saveRisk() {
    if (!draftRisk.name.trim()) return;
    const updated = [...risks, { ...draftRisk, id: `r${Date.now()}` }];
    store.setRisks(updated); onRisksChange(updated); setAddingRisk(false); setDraftRisk(BLANK_RISK);
  }

  function removeRisk(id: string) {
    const updated = risks.filter((r) => r.id !== id); store.setRisks(updated); onRisksChange(updated);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {/* Growth Levers */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ color: "#1d4ed8", fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600 }}>Growth Levers</span>
          <button onClick={() => { setAddingLever(true); setDraftLever(BLANK_LEVER); }} style={{ background: "none", border: "none", color: TEXT_MUTED, fontSize: 16, cursor: "pointer", lineHeight: 1 }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#16a34a")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = TEXT_MUTED)}>+</button>
        </div>

        <AnimatePresence>
          {addingLever && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              style={{ overflow: "hidden", marginBottom: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 7, padding: 10 }}>
              <input style={{ ...inputStyle, background: "#f0fdf4", marginBottom: 6 }} placeholder="Lever name…" autoFocus value={draftLever.name} onChange={(e) => setDraftLever((d) => ({ ...d, name: e.target.value }))} />
              <input style={{ ...inputStyle, background: "#f0fdf4", marginBottom: 6 }} placeholder="Expected impact" value={draftLever.expectedImpact} onChange={(e) => setDraftLever((d) => ({ ...d, expectedImpact: e.target.value }))} />
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input style={{ ...inputStyle, flex: 1, background: "#f0fdf4" }} placeholder="Owner" value={draftLever.owner} onChange={(e) => setDraftLever((d) => ({ ...d, owner: e.target.value }))} />
                <select value={draftLever.confidence} onChange={(e) => setDraftLever((d) => ({ ...d, confidence: e.target.value as GrowthLever["confidence"] }))} style={{ ...inputStyle, width: "auto", background: "#f0fdf4", cursor: "pointer" }}>
                  <option value="low">Low</option><option value="medium">Med</option><option value="high">High</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={saveLever} style={{ background: "#16a34a", border: "none", color: "#fff", fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>Add</button>
                <button onClick={() => setAddingLever(false)} style={{ background: "none", border: `1px solid ${BORDER}`, color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", padding: "4px 9px", borderRadius: 4, cursor: "pointer" }}>×</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {levers.length === 0 && <span style={{ color: TEXT_MUTED, fontSize: 9, letterSpacing: "0.1em" }}>No levers defined</span>}
          <AnimatePresence>
            {levers.map((l, i) => (
              <motion.div key={l.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 4 }} transition={{ delay: i * 0.04 }}
                style={{ background: "#ffffff", border: `1px solid ${BORDER}`, borderRadius: 7, padding: "9px 10px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: TEXT, fontSize: 10, flex: 1, lineHeight: 1.4 }}>{l.name}</span>
                  <button onClick={() => removeLever(l.id)} style={{ background: "none", border: "none", color: "#fca5a5", fontSize: 12, cursor: "pointer", padding: "0 0 0 6px", transition: "color 0.18s" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#dc2626")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#fca5a5")}>×</button>
                </div>
                {l.expectedImpact && <div style={{ color: "#16a34a", fontSize: 9, letterSpacing: "0.06em", marginBottom: 3, fontWeight: 500 }}>{l.expectedImpact}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: CONFIDENCE_COLORS[l.confidence], fontSize: 7, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700 }}>{l.confidence}</span>
                  {l.owner && <span style={{ color: TEXT_MUTED, fontSize: 8 }}>{l.owner}</span>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Risk Register */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ color: "#1d4ed8", fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600 }}>Risk Register</span>
          <button onClick={() => { setAddingRisk(true); setDraftRisk(BLANK_RISK); }} style={{ background: "none", border: "none", color: TEXT_MUTED, fontSize: 16, cursor: "pointer", lineHeight: 1 }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#dc2626")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = TEXT_MUTED)}>+</button>
        </div>

        <AnimatePresence>
          {addingRisk && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              style={{ overflow: "hidden", marginBottom: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: 10 }}>
              <input style={{ ...inputStyle, background: "#fef2f2", marginBottom: 6 }} placeholder="Risk name…" autoFocus value={draftRisk.name} onChange={(e) => setDraftRisk((d) => ({ ...d, name: e.target.value }))} />
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input style={{ ...inputStyle, flex: 1, background: "#fef2f2" }} placeholder="Owner" value={draftRisk.owner} onChange={(e) => setDraftRisk((d) => ({ ...d, owner: e.target.value }))} />
                <select value={draftRisk.severity} onChange={(e) => setDraftRisk((d) => ({ ...d, severity: e.target.value as Risk["severity"] }))} style={{ ...inputStyle, width: "auto", background: "#fef2f2", cursor: "pointer" }}>
                  <option value="low">Low</option><option value="medium">Med</option><option value="high">High</option>
                </select>
              </div>
              <select value={draftRisk.category} onChange={(e) => setDraftRisk((d) => ({ ...d, category: e.target.value as Risk["category"] }))} style={{ ...inputStyle, background: "#fef2f2", marginBottom: 8, cursor: "pointer" }}>
                {["cash", "sales", "product", "people", "legal", "operational"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={saveRisk} style={{ background: "#dc2626", border: "none", color: "#fff", fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>Add</button>
                <button onClick={() => setAddingRisk(false)} style={{ background: "none", border: `1px solid ${BORDER}`, color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", padding: "4px 9px", borderRadius: 4, cursor: "pointer" }}>×</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {risks.length === 0 && <span style={{ color: TEXT_MUTED, fontSize: 9, letterSpacing: "0.1em" }}>No risks logged</span>}
          <AnimatePresence>
            {risks.map((r, i) => (
              <motion.div key={r.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 4 }} transition={{ delay: i * 0.04 }}
                style={{ background: SEVERITY_BG[r.severity], border: `1px solid ${SEVERITY_BORDER[r.severity]}`, borderLeft: `3px solid ${SEVERITY_COLORS[r.severity]}`, borderRadius: "0 7px 7px 0", padding: "9px 10px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: TEXT, fontSize: 10, flex: 1, lineHeight: 1.4 }}>{r.name}</span>
                  <button onClick={() => removeRisk(r.id)} style={{ background: "none", border: "none", color: "#fca5a5", fontSize: 12, cursor: "pointer", padding: "0 0 0 6px", transition: "color 0.18s" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#dc2626")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#fca5a5")}>×</button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: SEVERITY_COLORS[r.severity], fontSize: 7, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700 }}>{r.severity}</span>
                  <span style={{ color: TEXT_MUTED, fontSize: 7, letterSpacing: "0.12em", textTransform: "uppercase" }}>{r.category}</span>
                  {r.owner && <span style={{ color: TEXT_MUTED, fontSize: 8 }}>{r.owner}</span>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
