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
