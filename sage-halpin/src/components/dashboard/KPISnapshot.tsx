import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { KPIData, KPIStatus, kpiStatus, store } from "@/lib/store";

const STATUS_COLORS: Record<KPIStatus, string> = {
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
};

const STATUS_BG: Record<KPIStatus, string> = {
  green: "#f0fdf4",
  amber: "#fffbeb",
  red: "#fef2f2",
};

const STATUS_BORDER: Record<KPIStatus, string> = {
  green: "#bbf7d0",
  amber: "#fde68a",
  red: "#fecaca",
};

type KPIField = {
  key: keyof KPIData;
  label: string;
  format: (v: number, kpis: KPIData) => string;
  statusKey: string;
  statusValue: (kpis: KPIData) => number;
  unit: string;
  description: string;
};

const KPIS: KPIField[] = [
  {
    key: "cashRunway",
    label: "Cash Runway",
    format: (v) => `${v}mo`,
    statusKey: "cashRunway",
    statusValue: (k) => k.cashRunway,
    unit: "months",
    description: "Months of operating capital remaining at current burn rate.",
  },
  {
    key: "revenue",
    label: "Revenue MoM",
    format: (_, k) => {
      const g = k.revenuePrev > 0 ? ((k.revenue - k.revenuePrev) / k.revenuePrev) * 100 : 0;
      return `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`;
    },
    statusKey: "revenueGrowth",
    statusValue: (k) => k.revenuePrev > 0 ? ((k.revenue - k.revenuePrev) / k.revenuePrev) * 100 : 0,
    unit: "%",
    description: "Month-on-month revenue growth rate.",
  },
  {
    key: "churnRate",
    label: "Churn Rate",
    format: (v) => `${v}%`,
    statusKey: "churnRate",
    statusValue: (k) => k.churnRate,
    unit: "%",
    description: "Percentage of ARR lost monthly. Healthy: below 7%.",
  },
  {
    key: "pipelineCoverage",
    label: "Pipeline Cover",
    format: (v) => `${v}x`,
    statusKey: "pipelineCoverage",
    statusValue: (k) => k.pipelineCoverage,
    unit: "x",
    description: "Qualified pipeline vs quota. Target: 3x or above.",
  },
  {
    key: "burnMultiple",
    label: "Burn Multiple",
    format: (v) => `${v}x`,
    statusKey: "burnMultiple",
    statusValue: (k) => k.burnMultiple,
    unit: "x",
    description: "Net burn ÷ net new ARR. Target: below 1.5x.",
  },
];

type Props = { kpis: KPIData; onChange: (k: KPIData) => void };

export function KPISnapshot({ kpis, onChange }: Props) {
  const [editing, setEditing] = useState<keyof KPIData | null>(null);
  const [draft, setDraft] = useState<string>("");

  function startEdit(key: keyof KPIData) {
    setEditing(key);
    setDraft(String(kpis[key] as number));
  }

  function commitEdit() {
    if (!editing) return;
    const val = parseFloat(draft);
    if (!isNaN(val) && val >= 0) {
      const updated = { ...kpis, [editing]: val, updatedAt: new Date().toISOString() };
      store.setKPIs(updated);
      onChange(updated);
    }
    setEditing(null);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ color: "hsl(var(--primary))", fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600 }}>
          Reality Snapshot
        </span>
        <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 8, letterSpacing: "0.12em" }}>
          {new Date(kpis.updatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {KPIS.map((kpi, i) => {
          const status = kpiStatus(kpi.statusKey, kpi.statusValue(kpis));
          const color = STATUS_COLORS[status];
          const bg = STATUS_BG[status];
          const border = STATUS_BORDER[status];
          const isEditing = editing === kpi.key;
          const isLast = i === KPIS.length - 1;

          return (
            <motion.div
              key={kpi.key}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              style={{
                gridColumn: isLast ? "1 / -1" : undefined,
                background: bg,
                border: `1px solid ${border}`,
                borderRadius: 7,
                padding: "12px 14px",
                cursor: "pointer",
                position: "relative",
              }}
              title={kpi.description}
              onClick={() => !isEditing && startEdit(kpi.key)}
            >
              <div style={{ position: "absolute", top: 9, right: 9, width: 6, height: 6, borderRadius: "50%", background: color }} />
              <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 5, fontWeight: 500 }}>
                {kpi.label}
              </div>

              <AnimatePresence mode="wait">
                {isEditing ? (
                  <motion.input
                    key="input"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    autoFocus
                    type="number"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(null); }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ background: "transparent", border: "none", borderBottom: `1.5px solid ${color}`, color, fontSize: 22, fontWeight: 300, width: "80%", outline: "none" }}
                  />
                ) : (
                  <motion.div key="value" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    style={{ color, fontSize: 22, fontWeight: 300 }}
                  >
                    {kpi.format(kpis[kpi.key] as number, kpis)}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
