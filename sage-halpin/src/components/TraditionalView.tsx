import { motion } from "framer-motion";

const BG = "hsl(var(--background))";
const SURFACE = "hsl(var(--card))";
const BORDER = "hsl(var(--border))";
const TEXT = "hsl(var(--foreground))";
const TEXT_SEC = "hsl(var(--muted-foreground))";
const TEXT_MUTED = "hsl(var(--muted-foreground))";

export type VerticalData = {
  soWhat: string;
  whatIf: string;
  dataInputs: string[];
};

export type TraditionalViewData = {
  sales: VerticalData;
  finance: VerticalData;
  hr: VerticalData;
  product: VerticalData;
  legal: VerticalData;
  governance: VerticalData;
};

const VERTICALS: {
  key: keyof TraditionalViewData;
  label: string;
  icon: string;
  color: string;
  sub: string;
}[] = [
  { key: "sales",      label: "Sales",      icon: "◎", color: "#b45309", sub: "Revenue & Growth" },
  { key: "finance",    label: "Finance",    icon: "◈", color: "#1d4ed8", sub: "Capital & Returns" },
  { key: "hr",         label: "HR",         icon: "◉", color: "#991B1B", sub: "People & Culture" },
  { key: "product",    label: "Product",    icon: "◇", color: "#065F46", sub: "Build & Roadmap" },
  { key: "legal",      label: "Legal",      icon: "◆", color: "#1e293b", sub: "Risk & Compliance" },
  { key: "governance", label: "Governance", icon: "○", color: "#475569", sub: "Board & Oversight" },
];

export default function TraditionalView({ data }: { data: TraditionalViewData }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ color: TEXT_SEC, fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 6, fontWeight: 600 }}>
          Traditional View
        </div>
        <p style={{ color: TEXT_MUTED, fontSize: 11, letterSpacing: "0.08em", lineHeight: 1.6, maxWidth: 700 }}>
          The expert analysis expressed through traditional business functions. Each vertical shows the immediate implication, the what-if consequence, and the back-office data needed to calibrate this for your specific business.
        </p>
      </div>

      {/* Vertical cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14, marginBottom: 32 }}>
        {VERTICALS.map((v, i) => {
          const d = data[v.key];
          return (
            <motion.div
              key={v.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              style={{
                background: SURFACE,
                border: `1px solid ${BORDER}`,
                borderTop: `3px solid ${v.color}`,
                borderRadius: "0 0 10px 10px",
                overflow: "hidden",
              }}
            >
              {/* Card header */}
              <div style={{ padding: "16px 18px 12px", borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
                  <span style={{ fontSize: 18 }}>{v.icon}</span>
                  <div>
                    <div style={{ color: v.color, fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", textShadow: `0 0 10px ${v.color}50` }}>{v.label}</div>
                    <div style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase" }}>{v.sub}</div>
                  </div>
                </div>
              </div>

              {/* So What */}
              <div style={{ padding: "14px 18px 0" }}>
                <div style={{ color: v.color, fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>So What</div>
                <p style={{ color: TEXT, fontSize: 11, lineHeight: 1.65, margin: 0 }}>{d.soWhat || "—"}</p>
              </div>

              {/* What If */}
              <div style={{ padding: "12px 18px 0" }}>
                <div style={{ color: TEXT_SEC, fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>What If</div>
                <p style={{ color: TEXT_SEC, fontSize: 11, lineHeight: 1.65, margin: 0 }}>{d.whatIf || "—"}</p>
              </div>

              {/* Data Calibration */}
              <div style={{ padding: "12px 18px 16px", marginTop: 12, borderTop: `1px solid ${BORDER}` }}>
                <div style={{ color: TEXT_MUTED, fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>
                  Data Needed to Calibrate
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {(d.dataInputs ?? []).map((item, idx) => {
                    const colonIdx = item.indexOf(":");
                    const system = colonIdx > -1 ? item.slice(0, colonIdx).trim() : "";
                    const point = colonIdx > -1 ? item.slice(colonIdx + 1).trim() : item;
                    return (
                      <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ color: v.color, fontSize: 9, flexShrink: 0, marginTop: 1 }}>▸</span>
                        <span style={{ color: TEXT_SEC, fontSize: 10, lineHeight: 1.5 }}>
                          {system && (
                            <span style={{ color: v.color, fontWeight: 600, fontSize: 9, letterSpacing: "0.08em" }}>[{system}]</span>
                          )}{" "}
                          {point}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Summary callout */}
      <div style={{ background: `${BG}cc`, border: `1px solid #d6deec`, borderRadius: 9, padding: "16px 20px", display: "flex", gap: 14, alignItems: "flex-start" }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>🔌</span>
        <div>
          <div style={{ color: TEXT_SEC, fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, marginBottom: 5 }}>
            Back-Office Integration
          </div>
          <p style={{ color: TEXT_MUTED, fontSize: 11, lineHeight: 1.65, margin: 0 }}>
            Connect your CRM, ERP, HRIS, Finance, and BI systems to replace the generic data points above with live figures from your business — turning the board's analysis into a precision instrument calibrated to your actuals.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
