import { useEffect, useState } from "react";
import { Link } from "wouter";
import { loadOrganisation } from "@/lib/organisation";
import { savedConsultations } from "@/lib/consultations";
import { workspaceApi } from "@/lib/workspace";
import { scopedKey } from "@/lib/userScope";

// Getting started: the onboarding guide's seven steps, ticked off from what
// the organisation has actually done, each linking to where it happens.

const SEEN_SHADOW_BOARD = "seen_shadow_board";

/** Called by the Agents page: the lead has met the shadow board (Step 2). */
export function markShadowBoardSeen() {
  try {
    localStorage.setItem(scopedKey(SEEN_SHADOW_BOARD), "1");
  } catch {
    // Storage unavailable: the step simply stays open.
  }
}

interface Progress {
  lessons: number;
  agentsTaught: number;
  horizonSet: boolean;
  decided: number;
  checkpoints: number;
}

const NONE: Progress = { lessons: 0, agentsTaught: 0, horizonSet: false, decided: 0, checkpoints: 0 };

async function loadProgress(): Promise<Progress> {
  const link = loadOrganisation().workspace;
  if (!link) return NONE;
  const [agents, horizon, decisions, checkpoint] = await Promise.all([
    workspaceApi.agents(link).catch(() => null),
    workspaceApi.horizon(link).catch(() => null),
    workspaceApi.decisions(link).catch(() => null),
    workspaceApi.checkpoint(link).catch(() => null),
  ]);
  const active = (agents?.agents ?? []).map((a) => a.lessons.filter((l) => l.status === "active").length);
  return {
    lessons: active.reduce((sum, n) => sum + n, 0),
    agentsTaught: active.filter((n) => n > 0).length,
    horizonSet: !!horizon && (horizon.settings.watchTopics.length > 0 || horizon.settings.feeds.length > 0),
    decided: decisions?.decisions.length ?? 0,
    checkpoints: checkpoint?.checkpoints.length ?? 0,
  };
}

interface Step {
  title: string;
  detail: string;
  href: string;
  action: string;
  done: boolean;
}

export function GettingStarted() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let live = true;
    const refresh = () => loadProgress().then((p) => live && setProgress(p));
    void refresh();
    window.addEventListener("checkpoint-updated", refresh);
    return () => {
      live = false;
      window.removeEventListener("checkpoint-updated", refresh);
    };
  }, []);

  const org = loadOrganisation();
  const p = progress ?? NONE;
  let seen = false;
  try {
    seen = localStorage.getItem(scopedKey(SEEN_SHADOW_BOARD)) === "1";
  } catch {
    seen = false;
  }
  const asked = savedConsultations().length;
  const permanent = org.people.filter((x) => x.permanent).length;

  const steps: Step[] = [
    {
      title: "Set up the organisation",
      detail: "Its name, a paragraph about it and your name as the lead. The agents read this before they advise.",
      href: "/organisation",
      action: "Your board",
      done: !!(org.name.trim() && org.profile.trim() && org.leadName.trim()),
    },
    {
      title: "Add the people and mark permanent members",
      detail: `Name, role, work email and CV for each, and who must be in every decision. ${org.people.length} added, ${permanent} permanent.`,
      href: "/organisation",
      action: "Add people",
      done: org.people.length > 0 && permanent > 0,
    },
    {
      title: "Meet the shadow board",
      detail: "Six AI agents, each with its own persona and lens. See what each looks for and has learned.",
      href: "/agents",
      action: "Open Agents",
      done: seen,
    },
    {
      title: "Teach the agents",
      detail: `Give each agent three to five lessons about your strategy and red lines. ${p.lessons} lessons across ${p.agentsTaught} of 6 agents so far.`,
      href: "/agents",
      action: "Teach",
      done: p.lessons > 0,
    },
    {
      title: "Switch on horizon scanning",
      detail: "Add watch topics and the news feeds the board trusts, and choose how often to scan.",
      href: "/horizon",
      action: "Open Horizon",
      done: p.horizonSet,
    },
    {
      title: "Run the first board question",
      detail: `Choose how it is decided, invite the people, convene the shadow board, then record the decision and plan. ${asked} asked, ${p.decided} decided.`,
      href: asked ? "/questions" : "/questions/new",
      action: asked ? "Board questions" : "Ask a question",
      done: p.decided > 0,
    },
    {
      title: "Publish the first checkpoint",
      detail: "Add the last three years' major events and publish the organisation on a page.",
      href: "/checkpoint",
      action: "Open Checkpoint",
      done: p.checkpoints > 0,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);

  if (doneCount === steps.length) {
    return (
      <p className="mb-6 rounded-md border border-border bg-card px-4 py-3 text-sm" data-testid="getting-started" data-complete="true">
        <span className="font-semibold">You're set up.</span> All seven onboarding steps are done. Publish a new checkpoint after each major decision, or at least each quarter.
      </p>
    );
  }

  return (
    <section className="mb-8 rounded-md border border-border bg-card" aria-labelledby="getting-started-title" data-testid="getting-started">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="getting-started-title" className="text-sm font-bold uppercase tracking-[0.14em]">
            Getting started
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="getting-started-progress">
            {doneCount} of {steps.length} steps done{progress === null ? " (checking…)" : ""}
          </p>
        </div>
        <button type="button" className="text-xs font-semibold underline underline-offset-4" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide steps" : "Show steps"}
        </button>
      </div>
      {open && (
        <ol className="divide-y divide-border">
          {steps.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3 px-4 py-3" data-testid={`onboarding-step-${i + 1}`} data-done={s.done}>
              <span
                aria-hidden
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  s.done ? "bg-[#3F7556] text-white" : i === next ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
                }`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${s.done ? "text-muted-foreground line-through decoration-1" : ""}`}>
                  <span className="sr-only">{s.done ? "Done: " : "To do: "}</span>
                  {s.title}
                </p>
                {!s.done && <p className="text-xs text-muted-foreground">{s.detail}</p>}
              </div>
              {!s.done && (
                <Link href={s.href} className={`shrink-0 rounded px-3 py-1.5 text-xs font-semibold no-underline ${i === next ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}>
                  {s.action}
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
