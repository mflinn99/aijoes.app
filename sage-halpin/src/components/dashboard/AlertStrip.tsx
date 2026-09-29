import { motion, AnimatePresence } from "framer-motion";
import { Alert } from "@/lib/store";

const PERSONA_COLORS: Record<string, string> = {
  ORION: "#475569",
  "DR WHITE": "#475569",
  GRIMM: "#1e293b",
  "CMDR BLACK": "#1e293b",
  SOLARA: "#b45309",
  "MS GOLD": "#b45309",
  ZEPHYR: "#065F46",
  "DR GREEN": "#065F46",
  MIRA: "#991B1B",
  "LT RED": "#991B1B",
  AQUILA: "#1d4ed8",
  "COL BLUE": "#1d4ed8",
};

const SEVERITY_COLORS = {
  critical: "#dc2626",
  warning: "#d97706",
  info: "#1d4ed8",
};

const SEVERITY_BG = {
  critical: "#fef2f2",
  warning: "#fffbeb",
  info: "#eff6ff",
};

const SEVERITY_ICONS = { critical: "●", warning: "◆", info: "▸" };

type Props = { alerts: Alert[] };

export function AlertStrip({ alerts }: Props) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ color: "#1d4ed8", fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600 }}>
          Alert Engine
        </span>
        {alerts.length > 0 && (
          <span style={{
            background: alerts.some((a) => a.severity === "critical") ? "#fef2f2" : "#fffbeb",
            color: alerts.some((a) => a.severity === "critical") ? "#dc2626" : "#d97706",
            fontSize: 8, letterSpacing: "0.18em", textTransform: "uppercase",
            padding: "2px 8px", borderRadius: 4, fontWeight: 600,
            border: `1px solid ${alerts.some((a) => a.severity === "critical") ? "#fecaca" : "#fde68a"}`,
          }}>
            {alerts.filter((a) => a.severity === "critical").length > 0
              ? `${alerts.filter((a) => a.severity === "critical").length} Critical`
              : `${alerts.length} Warning`}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <AnimatePresence>
          {alerts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ padding: "14px 16px", border: "1px solid #bbf7d0", borderRadius: 7, background: "#f0fdf4", display: "flex", alignItems: "center", gap: 8 }}
            >
              <span style={{ color: "#16a34a", fontSize: 9 }}>●</span>
              <span style={{ color: "#4b7c58", fontSize: 10, letterSpacing: "0.04em" }}>
                All metrics within healthy thresholds.
              </span>
            </motion.div>
          ) : (
            alerts.map((alert, i) => (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.04 }}
                style={{
                  padding: "10px 14px",
                  border: `1px solid ${SEVERITY_COLORS[alert.severity]}30`,
                  borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity]}`,
                  borderRadius: "0 7px 7px 0",
                  background: SEVERITY_BG[alert.severity],
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <span style={{ color: SEVERITY_COLORS[alert.severity], fontSize: 7, marginTop: 2, flexShrink: 0 }}>
                  {SEVERITY_ICONS[alert.severity]}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 3 }}>
                    <span style={{ color: PERSONA_COLORS[alert.persona] || "#64748b", fontSize: 7, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700 }}>
                      {alert.persona}
                    </span>
                  </div>
                  <p style={{ color: "#4a5568", fontSize: 10, lineHeight: 1.55, margin: 0 }}>
                    {alert.message}
                  </p>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
