import { useEffect, useState } from "react";
import { Link } from "wouter";
import { loadOrganisation } from "@/lib/organisation";
import { savedConsultations } from "@/lib/consultations";
import { workspaceApi } from "@/lib/workspace";
import { scopedKey } from "@/lib/userScope";
import { hasContactDetails } from "@/lib/missing";

// Getting started: the onboarding guide's steps, ticked off from what the
// organisation has actually done, each linking to where it happens. Only the
// contact details are required; any other step can be skipped, and what is
// missing is then pointed out where it is used (MissingData).

const SEEN_SHADOW_BOARD = "seen_shadow_board";
const SKIPPED = "skipped_onboarding";

function readSkipped(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(scopedKey(SKIPPED)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeSkipped(keys: string[]) {
  try {
    localStorage.setItem(scopedKey(SKIPPED), JSON.stringify(keys));
  } catch {
    // Storage unavailable: skipping lasts until the page reloads.
  }
}

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
  key: string;
  /** Contact details can't be skipped; everything else can. */
  required?: boolean;
  title: string;
  detail: string;
  href: string;
  action: string;
  done: boolean;
}

export function GettingStarted() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [openChoice, setOpen] = useState<boolean | null>(null);
  const [skipped, setSkippedState] = useState<string[]>(readSkipped);
  const setSkipped = (keys: string[]) => {
    writeSkipped(keys);
    setSkippedState(keys);
  };

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
      key: "contact",
      required: true,
      title: "Add your contact details",
      detail: "The organisation's name, your name and your email. The only step that can't be skipped.",
      href: "/organisation#contact",
      action: "Add them",
      done: hasContactDetails(org),
    },
    {
      key: "about",
      title: "Describe the organisation",
      detail: "Its sector and a paragraph about it: size, markets, stage, priorities. The agents read this before they advise.",
      href: "/organisation#about",
      action: "Describe it",
      done: !!(org.sector.trim() && org.profile.trim()),
    },
    {
      key: "people",
      title: "Add the people and mark permanent members",
      detail: `Name, role, work email and CV for each, and who must be in every decision. ${org.people.length} added, ${permanent} permanent.`,
      href: "/organisation#people",
      action: "Add people",
      done: org.people.length > 0 && permanent > 0,
    },
    {
      key: "meet",
      title: "Meet the shadow board",
      detail: "Six AI agents, each with its own persona and lens. See what each looks for and has learned.",
      href: "/agents",
      action: "Open Agents",
      done: seen,
    },
    {
      key: "teach",
      title: "Teach the agents",
      detail: `Give each agent three to five lessons about your strategy and red lines. ${p.lessons} lessons across ${p.agentsTaught} of 6 agents so far.`,
      href: "/agents",
      action: "Teach",
      done: p.lessons > 0,
    },
    {
      key: "horizon",
      title: "Switch on horizon scanning",
      detail: "Add watch topics and the news feeds the board trusts, and choose how often to scan.",
      href: "/horizon",
      action: "Open Horizon",
      done: p.horizonSet,
    },
    {
      key: "question",
      title: "Run the first board question",
      detail: `Choose how it is decided, invite the people, convene the shadow board, then record the decision and plan. ${asked} asked, ${p.decided} decided.`,
      href: asked ? "/questions" : "/questions/new",
      action: asked ? "Board questions" : "Ask a question",
      done: p.decided > 0,
    },
    {
      key: "checkpoint",
      title: "Publish the first checkpoint",
      detail: "Add the last three years' major events and publish the organisation on a page.",
      href: "/checkpoint",
      action: "Open Checkpoint",
      done: p.checkpoints > 0,
    },
  ];
  const isSkipped = (s: Step) => !s.required && !s.done && skipped.includes(s.key);
  const doneCount = steps.filter((s) => s.done).length;
  const skippedCount = steps.filter(isSkipped).length;
  const next = steps.findIndex((s) => !s.done && !isSkipped(s));
  const remaining = steps.filter((s) => !s.done && !s.required && !isSkipped(s));
  // Open while there is something to do; folded away once everything is done or skipped.
  const open = openChoice ?? next !== -1;

  if (next === -1 && !open) {
    return (
      <p className="mb-6 rounded-md border border-border bg-card px-4 py-3 text-sm" data-testid="getting-started" data-complete="true">
        <span className="font-semibold">You're set up.</span>{" "}
        {skippedCount
          ? `${skippedCount} step${skippedCount === 1 ? "" : "s"} skipped: Sentinel points out what's missing where it's used. `
          : "All the onboarding steps are done. Publish a new checkpoint after each major decision, or at least each quarter. "}
        {skippedCount > 0 && (
          <button type="button" className="font-semibold underline underline-offset-4" onClick={() => setOpen(true)}>
            Show skipped steps
          </button>
        )}
      </p>
    );
  }
  if (next === -1 && skippedCount === 0) {
    return (
      <p className="mb-6 rounded-md border border-border bg-card px-4 py-3 text-sm" data-testid="getting-started" data-complete="true">
        <span className="font-semibold">You're set up.</span> All the onboarding steps are done. Publish a new checkpoint after each major decision, or at least each quarter.
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
            {doneCount} of {steps.length} steps done{skippedCount ? `, ${skippedCount} skipped` : ""}
            {progress === null ? " (checking…)" : ""}. Only your contact details are required; skip anything else and come back to it later.
          </p>
        </div>
        <div className="flex gap-3">
          {remaining.length > 0 && (
            <button
              type="button"
              className="text-xs font-semibold underline underline-offset-4"
              onClick={() => setSkipped([...new Set([...skipped, ...remaining.map((s) => s.key)])])}
              data-testid="button-skip-rest"
            >
              Skip the rest
            </button>
          )}
          <button type="button" className="text-xs font-semibold underline underline-offset-4" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide steps" : "Show steps"}
          </button>
        </div>
      </div>
      {open && (
        <ol className="divide-y divide-border">
          {steps.map((s, i) => {
            const skip = isSkipped(s);
            return (
              <li key={s.key} className="flex items-start gap-3 px-4 py-3" data-testid={`onboarding-step-${i + 1}`} data-done={s.done} data-skipped={skip}>
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    s.done ? "bg-[#3F7556] text-white" : skip ? "border border-dashed border-amber-500 text-amber-700" : i === next ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
                  }`}
                >
                  {s.done ? "✓" : skip ? "–" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${s.done ? "text-muted-foreground line-through decoration-1" : ""}`}>
                    <span className="sr-only">{s.done ? "Done: " : skip ? "Skipped: " : "To do: "}</span>
                    {s.title}
                    {s.required && !s.done && <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive">Required</span>}
                    {skip && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900">Skipped</span>}
                  </p>
                  {!s.done && <p className="text-xs text-muted-foreground">{skip ? "Skipped for now. Sentinel will point out what's missing where it's used." : s.detail}</p>}
                </div>
                {!s.done && (
                  <div className="flex shrink-0 items-center gap-2">
                    {!s.required &&
                      (skip ? (
                        <button type="button" className="text-xs underline" onClick={() => setSkipped(skipped.filter((k) => k !== s.key))} data-testid={`button-unskip-${s.key}`}>
                          Undo skip
                        </button>
                      ) : (
                        <button type="button" className="text-xs underline" onClick={() => setSkipped([...skipped, s.key])} data-testid={`button-skip-${s.key}`}>
                          Skip
                        </button>
                      ))}
                    <Link
                      href={s.href}
                      className={`rounded px-3 py-1.5 text-xs font-semibold no-underline ${i === next ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}
                    >
                      {s.action}
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
