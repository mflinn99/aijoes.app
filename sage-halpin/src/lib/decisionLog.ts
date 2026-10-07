import { scopedKey } from "./userScope";

const LOG_SUFFIX = "decision_log";

export interface DecisionLogEntry {
  id: string;
  lockedAt: string;
  challenge: string;
  challengeLabel: string;
  calibration: { risk: number; ambition: number; time: number; cost: number };
  decision: "DO" | "DONT_DO";
  rationale: string;
  feedbackRound: number;
  outcome?: string | null;
}

export function loadDecisionLog(): DecisionLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(scopedKey(LOG_SUFFIX)) ?? "[]") as DecisionLogEntry[];
  } catch {
    return [];
  }
}

export function appendToLog(entry: DecisionLogEntry): void {
  const log = loadDecisionLog();
  log.unshift(entry);
  localStorage.setItem(scopedKey(LOG_SUFFIX), JSON.stringify(log));
}

export function saveLog(entries: DecisionLogEntry[]): void {
  localStorage.setItem(scopedKey(LOG_SUFFIX), JSON.stringify(entries));
}

// ─── Saving to the workspace ────────────────────────────────────────────────
//
// The decision log lives on the server with the organisation's workspace, so
// it is kept, shared across devices and read by the board's agents. Decisions
// locked in the scenario analysis are sent there; any still held only in this
// browser (from before, or made before the workspace existed) are sent once.

const IMPORTED_SUFFIX = "decision_log_imported";

function importedIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(scopedKey(IMPORTED_SUFFIX)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function markImported(id: string): void {
  const ids = importedIds();
  ids.add(id);
  try {
    localStorage.setItem(scopedKey(IMPORTED_SUFFIX), JSON.stringify([...ids]));
  } catch {
    // Storage unavailable: it may be sent again, which only duplicates an entry.
  }
}

const LOCAL_STATUS: Record<string, string> = {
  implemented: "Implemented",
  not_implemented: "Not implemented",
  succeeded: "Succeeded",
  failed: "Failed",
};

/** The scenario-analysis entries not yet saved to the workspace. */
export function unsavedLocalDecisions(): DecisionLogEntry[] {
  const done = importedIds();
  return loadDecisionLog().filter((e) => !done.has(e.id));
}

/** Sends one scenario-analysis decision to the workspace's decision log. */
export async function saveAnalysisDecision(entry: DecisionLogEntry): Promise<boolean> {
  const { ensureWorkspace, workspaceApi } = await import("./workspace");
  const link = await ensureWorkspace().catch(() => null);
  if (!link) return false;
  const status = entry.outcome ? LOCAL_STATUS[entry.outcome] : "";
  await workspaceApi.logDecision(link, {
    source: "analysis",
    question: entry.challengeLabel || entry.challenge || "Scenario analysis",
    decision: entry.decision === "DO" ? "Do it" : "Don't do it",
    position: entry.decision === "DO" ? "support" : "oppose",
    rationale: `${entry.rationale}${status ? `\n\nStatus: ${status}` : ""}`.slice(0, 2000),
    decidedAt: entry.lockedAt.slice(0, 10),
    calibration: entry.calibration,
  });
  markImported(entry.id);
  return true;
}

/** Sends every entry still held only in this browser; returns how many were saved. */
export async function saveLocalDecisions(): Promise<number> {
  let saved = 0;
  for (const entry of unsavedLocalDecisions()) {
    if (!(await saveAnalysisDecision(entry).catch(() => false))) break;
    saved += 1;
  }
  return saved;
}
