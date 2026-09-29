import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Decision, store } from "@/lib/store";

const BG = "hsl(var(--background))";
const SURFACE = "hsl(var(--card))";
const BORDER = "hsl(var(--border))";
const TEXT = "hsl(var(--foreground))";
const TEXT_SECONDARY = "hsl(var(--muted-foreground))";
const TEXT_MUTED = "hsl(var(--muted-foreground))";

const STATUS_LABELS = { not_started: "Pending", in_progress: "Active", done: "Complete" };
const STATUS_COLORS = { not_started: "#8a98ae", in_progress: "#1d4ed8", done: "#16a34a" };
const STATUS_BG = { not_started: "#f8fafc", in_progress: "#eff6ff", done: "#f0fdf4" };

const IMPACT_COLORS: Record<string, string> = {
  revenue: "#d97706", cost: "#dc2626", people: "#db2777",
  product: "#1d4ed8", strategy: "#7c3aed", risk: "#46546c",
};

type Props = { decisions: Decision[]; onChange: (d: Decision[]) => void };

const BLANK: Omit<Decision, "id" | "createdAt"> = {
  title: "", owner: "", deadline: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
  status: "not_started", impactArea: "strategy", notes: "",
};

const inputStyle = {
  background: BG, border: "none", borderBottom: `1px solid ${BORDER}`,
  color: TEXT, fontSize: 10, letterSpacing: "0.04em", outline: "none",
  padding: "4px 0", width: "100%",
};

export function DecisionsPanel({ decisions, onChange }: Props) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [expanded, setExpanded] = useState<string | null>(null);

  function addDecision() {
    if (!draft.title.trim()) return;
    const updated = [{ ...draft, id: `d${Date.now()}`, createdAt: new Date().toISOString() }, ...decisions];
    store.setDecisions(updated);
    onChange(updated);
    setCreating(false);
    setDraft(BLANK);
  }

  function cycleStatus(id: string) {
    const cycle: Decision["status"][] = ["not_started", "in_progress", "done"];
    const updated = decisions.map((d) => d.id === id ? { ...d, status: cycle[(cycle.indexOf(d.status) + 1) % 3] } : d);
    store.setDecisions(updated);
    onChange(updated);
  }

  function remove(id: string) {
    const updated = decisions.filter((d) => d.id !== id);
    store.setDecisions(updated);
    onChange(updated);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ color: "#13232B", fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600 }}>
          Decisions Board
        </span>
        <button
          onClick={() => { setCreating(true); setDraft(BLANK); }}
          style={{ background: "none", border: `1px solid ${BORDER}`, color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 4, cursor: "pointer", transition: "all 0.18s" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#13232B"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#D9C4A3"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = TEXT_MUTED; (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER; }}
        >
          + Add
        </button>
      </div>

      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: "hidden", marginBottom: 10, background: "#F3EBDD", border: "1px solid #D9C4A3", borderRadius: 7, padding: 14 }}
          >
            <input style={{ ...inputStyle, background: "#F3EBDD", fontSize: 11, marginBottom: 8, color: TEXT, fontWeight: 500 }} placeholder="Decision title…" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addDecision()} autoFocus />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input style={{ ...inputStyle, background: "#F3EBDD" }} placeholder="Owner" value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))} />
              <input style={{ ...inputStyle, background: "#F3EBDD" }} type="date" value={draft.deadline} onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))} />
            </div>
            <select value={draft.impactArea} onChange={(e) => setDraft((d) => ({ ...d, impactArea: e.target.value as Decision["impactArea"] }))} style={{ ...inputStyle, background: "#F3EBDD", marginBottom: 8, cursor: "pointer" }}>
              {["revenue", "cost", "people", "product", "strategy", "risk"].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <input style={{ ...inputStyle, background: "#F3EBDD", marginBottom: 10 }} placeholder="Notes (optional)" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addDecision} style={{ background: "#13232B", border: "none", color: "#fff", fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", padding: "5px 14px", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>Add</button>
              <button onClick={() => setCreating(false)} style={{ background: "none", border: `1px solid ${BORDER}`, color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", padding: "5px 10px", borderRadius: 4, cursor: "pointer" }}>Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {decisions.length === 0 && !creating && (
          <div style={{ textAlign: "center", color: TEXT_MUTED, fontSize: 10, letterSpacing: "0.1em", padding: "20px 0" }}>No decisions logged</div>
        )}
        <AnimatePresence>
          {decisions.map((d, i) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 4, height: 0 }}
              transition={{ delay: i * 0.03 }}
              style={{ border: `1px solid ${BORDER}`, borderRadius: 7, overflow: "hidden" }}
            >
              <div
                style={{ padding: "9px 12px", display: "flex", alignItems: "center", gap: 9, cursor: "pointer", background: expanded === d.id ? BG : SURFACE }}
                onClick={() => setExpanded(expanded === d.id ? null : d.id)}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); cycleStatus(d.id); }}
                  style={{ background: STATUS_BG[d.status], border: `1px solid ${STATUS_COLORS[d.status]}40`, borderRadius: 4, color: STATUS_COLORS[d.status], fontSize: 7, letterSpacing: "0.15em", textTransform: "uppercase", padding: "2px 7px", cursor: "pointer", flexShrink: 0, fontWeight: 600 }}
                >
                  {STATUS_LABELS[d.status]}
                </button>
                <span style={{ color: TEXT, fontSize: 10, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
                <span style={{ background: `${IMPACT_COLORS[d.impactArea]}15`, color: IMPACT_COLORS[d.impactArea], fontSize: 7, letterSpacing: "0.14em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 4, flexShrink: 0, fontWeight: 500 }}>
                  {d.impactArea}
                </span>
              </div>

              <AnimatePresence>
                {expanded === d.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    style={{ overflow: "hidden", borderTop: `1px solid ${BORDER}`, padding: "10px 12px", background: BG }}
                  >
                    <div style={{ display: "flex", gap: 16, marginBottom: 6 }}>
                      {d.owner && <span style={{ color: TEXT_MUTED, fontSize: 9, letterSpacing: "0.1em" }}>OWNER <span style={{ color: TEXT_SECONDARY }}>{d.owner}</span></span>}
                      {d.deadline && <span style={{ color: TEXT_MUTED, fontSize: 9, letterSpacing: "0.1em" }}>DUE <span style={{ color: TEXT_SECONDARY }}>{new Date(d.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span></span>}
                    </div>
                    {d.notes && <p style={{ color: TEXT_SECONDARY, fontSize: 9, letterSpacing: "0.03em", lineHeight: 1.55, margin: 0, marginBottom: 8 }}>{d.notes}</p>}
                    <button onClick={() => remove(d.id)} style={{ background: "none", border: "none", color: "#fca5a5", fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", cursor: "pointer", padding: 0, transition: "color 0.18s" }} onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#dc2626")} onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#fca5a5")}>
                      Remove
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
