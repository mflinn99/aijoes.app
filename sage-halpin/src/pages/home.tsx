import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { Boardroom } from "@/components/Boardroom";
import { scopedKey } from "@/lib/userScope";

const BG = "hsl(var(--background))";
const TEXT_PRIMARY = "hsl(var(--foreground))";
const TEXT_SECONDARY = "hsl(var(--muted-foreground))";
const PRIMARY = "hsl(var(--primary))";

export default function Home() {
  const [hasSession, setHasSession] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    setHasSession(!!localStorage.getItem(scopedKey("analysis_session")));
  }, []);

  return (
    <div
      className="relative w-full min-h-screen flex flex-col"
      style={{ background: BG }}
      data-testid="home-page"
    >
      {/* Top nav */}
      <motion.header
        className="w-full flex flex-wrap items-center justify-between gap-5 px-6 sm:px-10 py-6"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      >
        <div className="flex flex-col shrink-0">
          <span
            style={{
              color: TEXT_PRIMARY,
              fontSize: 15,
              letterSpacing: "0.2em",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            SIXONIC
          </span>
          <span
            style={{
              color: TEXT_SECONDARY,
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginTop: 2,
            }}
          >
            Executive Boardroom Intelligence
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-3" aria-label="Workspace access">
          <PrimaryButton label="Enter Workspace" onClick={() => setLocation("/dashboard")} primary testId="button-enter-workspace" />
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground bg-muted px-3 py-1.5 rounded-sm">
            Saved in this browser
          </div>
        </nav>
      </motion.header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative z-10 w-full max-w-6xl mx-auto">
        <motion.div
          className="w-full flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-24"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
        >
          {/* Left: Copy & Context */}
          <div className="flex-1 flex flex-col items-start max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 border border-border bg-card shadow-sm rounded-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="text-[10px] font-semibold tracking-widest uppercase text-foreground">
                Whole-Company Intelligence
              </span>
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-foreground leading-[1.1] mb-6">
              Better decisions.<br />Responsible performance.
            </h1>
            
            <p className="text-base text-muted-foreground leading-relaxed mb-8 max-w-lg">
              Boardroom intelligence for the whole company. Six perspectives connect commercial ambition with ethical leadership, organisational culture and long-term value.
            </p>

            <div className="flex flex-wrap items-center gap-4 mb-12">
              <PrimaryButton label={hasSession ? "Resume Scenario" : "Start New Scenario"} onClick={() => setLocation("/analysis")} primary testId="button-start-scenario" />
              <PrimaryButton label="Ask the Board" onClick={() => setLocation("/boardroom")} testId="button-ask-board" />
            </div>

            {/* SIXONIC point of view */}
            <div className="bg-card border border-border p-6 rounded-md shadow-sm w-full relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
              <h3 className="text-sm font-semibold text-foreground mb-1">
                Six perspectives. One accountable decision.
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                SIXONIC brings governance, risk, commercial value, innovation, culture and performance into one boardroom view—so growth is considered alongside the people and systems that sustain it.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Evidence</span><span>Accountability</span><span>Long-term value</span>
              </div>
            </div>
          </div>

          {/* Right: Boardroom Visual */}
          <div className="flex-1 w-full max-w-xl flex items-center justify-center relative">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent rounded-full blur-3xl opacity-50" />
            <motion.div
              className="relative w-full z-10"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.0, ease: "easeOut", delay: 0.2 }}
              data-testid="boardroom-container"
            >
              <Boardroom />
            </motion.div>
          </div>
        </motion.div>
      </main>
      
      {/* Footer */}
      <footer className="w-full px-6 py-6 text-center text-xs text-muted-foreground tracking-wide mt-12 z-10">
        <p className="mb-3">Governance · People & culture · Responsible growth</p>
        © {new Date().getFullYear()} SIXONIC. All rights reserved.
      </footer>
    </div>
  );
}

function PrimaryButton({ label, onClick, primary, testId }: { label: string; onClick: () => void; primary?: boolean; testId: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`text-xs tracking-widest uppercase font-semibold transition-all duration-200 rounded-sm ${
        primary ? "shadow-md" : "shadow-sm"
      }`}
      style={{
        background: primary
          ? hovered ? "hsl(var(--foreground))" : PRIMARY
          : hovered ? "hsl(var(--muted))" : "hsl(var(--card))",
        border: primary ? "1px solid transparent" : "1px solid hsl(var(--border))",
        color: primary ? "#ffffff" : "hsl(var(--foreground))",
        padding: "12px 24px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
