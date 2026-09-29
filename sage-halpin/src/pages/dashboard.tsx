import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { store, generateAlerts, KPIData, Decision, GrowthLever, Risk, Alert } from "@/lib/store";
import { KPISnapshot } from "@/components/dashboard/KPISnapshot";
import { AlertStrip } from "@/components/dashboard/AlertStrip";
import { DecisionsPanel } from "@/components/dashboard/DecisionsPanel";
import { StrategicForces } from "@/components/dashboard/StrategicForces";

const BG = "hsl(var(--background))";
const SURFACE = "hsl(var(--card))";
const BORDER = "hsl(var(--border))";
const TEXT_PRIMARY = "hsl(var(--foreground))";
const TEXT_SECONDARY = "hsl(var(--muted-foreground))";
const TEXT_MUTED = "hsl(var(--muted-foreground))";
const ACCENT = "hsl(var(--primary))";

export { BG, SURFACE, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, ACCENT };

export default function Dashboard() {
  const [, setLocation] = useLocation();

  const [kpis, setKpis] = useState<KPIData>(store.getKPIs);
  const [decisions, setDecisions] = useState<Decision[]>(store.getDecisions);
  const [levers, setLevers] = useState<GrowthLever[]>(store.getLevers);
  const [risks, setRisks] = useState<Risk[]>(store.getRisks);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    setAlerts(generateAlerts(kpis));
  }, [kpis]);

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  return (
    <div
      style={{ background: BG, minHeight: "100vh" }}
      data-testid="dashboard-page"
    >
      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 32px",
          borderBottom: `1px solid ${BORDER}`,
          background: "hsl(var(--background) / 0.95)",
          backdropFilter: "blur(8px)",
        }}
        data-testid="dashboard-topbar"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <button
            onClick={() => setLocation("/")}
            style={{ background: "none", border: "none", color: TEXT_MUTED, fontSize: 13, letterSpacing: "0.28em", textTransform: "uppercase", cursor: "pointer", transition: "color 0.2s", fontWeight: 700 }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = ACCENT)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = TEXT_MUTED)}
          >
            SIXONIC
          </button>
          <span style={{ color: BORDER, fontSize: 12 }}>|</span>
          <span style={{ color: TEXT_SECONDARY, fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 500 }}>
            Executive Workspace
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {criticalCount > 0 && (
            <motion.div
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{ background: "hsl(var(--destructive) / 0.1)", border: "1px solid hsl(var(--destructive) / 0.2)", borderRadius: 4, padding: "3px 9px", color: "hsl(var(--destructive))", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}
            >
              {criticalCount} Critical
            </motion.div>
          )}
          {warningCount > 0 && criticalCount === 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, padding: "3px 9px", color: "#d97706", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase" }}>
              {warningCount} Warning
            </div>
          )}

          <button
            onClick={() => setLocation("/analysis")}
            style={{ background: ACCENT, border: "none", borderRadius: 4, color: "#fff", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", padding: "8px 16px", cursor: "pointer", fontWeight: 600, transition: "background 0.18s", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "hsl(161 68% 14%)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = ACCENT)}
            data-testid="button-run-analysis"
          >
            New Analysis
          </button>
          <button
            onClick={() => setLocation("/boardroom")}
            style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT_SECONDARY, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", padding: "8px 16px", cursor: "pointer", transition: "all 0.18s", fontWeight: 600 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "hsl(var(--muted))"; (e.currentTarget as HTMLButtonElement).style.color = TEXT_PRIMARY; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none"; (e.currentTarget as HTMLButtonElement).style.color = TEXT_SECONDARY; }}
            data-testid="button-enter-boardroom"
          >
            Open Boardroom
          </button>
        </div>
      </motion.div>

      {/* Grid */}
      <div
        style={{ maxWidth: 1400, margin: "0 auto", padding: "32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}
        data-testid="dashboard-grid"
      >
        {[
          { component: <KPISnapshot kpis={kpis} onChange={setKpis} />, testId: "panel-kpi", delay: 0.05 },
          { component: <AlertStrip alerts={alerts} />, testId: "panel-alerts", delay: 0.10 },
          { component: <DecisionsPanel decisions={decisions} onChange={setDecisions} />, testId: "panel-decisions", delay: 0.15 },
          {
            component: (
              <StrategicForces levers={levers} risks={risks} onLeversChange={setLevers} onRisksChange={setRisks} />
            ),
            testId: "panel-strategic",
            delay: 0.20,
          },
        ].map(({ component, testId, delay }) => (
          <motion.div
            key={testId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay }}
            style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}
            data-testid={testId}
          >
            {component}
          </motion.div>
        ))}

        {/* Boardroom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          style={{ gridColumn: "1 / -1" }}
        >
          <button
            onClick={() => setLocation("/boardroom")}
            style={{ width: "100%", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "24px 32px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", transition: "all 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = ACCENT;
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.05)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER;
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.02)";
            }}
          >
            <div style={{ textAlign: "left" }}>
              <div style={{ color: TEXT_PRIMARY, fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
                AI Boardroom — Whole-Company Intelligence
              </div>
              <p style={{ color: TEXT_MUTED, fontSize: 11, letterSpacing: "0.05em", margin: 0, lineHeight: 1.6, fontWeight: 500 }}>
                Convene Governance · Risk · Commercial · Innovation · Culture · Performance — board-grade analysis on any strategic challenge.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 24 }}>
              <div style={{ display: "flex", gap: 4 }}>
                {["○", "◆", "◎", "◇", "◉", "◈"].map((icon, i) => (
                  <motion.span key={i} style={{ fontSize: 14, color: TEXT_MUTED }} animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.3 }}>
                    {icon}
                  </motion.span>
                ))}
              </div>
              <span style={{ color: ACCENT, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", marginLeft: 16, fontWeight: 700 }}>
                Convene →
              </span>
            </div>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
