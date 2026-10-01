import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AGENT_IDS,
  LESSON_LIMITS,
  direction,
  outcomeWasRight,
  type AgentId,
  type DecisionMode,
  type Landscape,
  type Lesson,
  type LessonKind,
  type LessonSource,
  type Outcome,
  type Position,
  type Signal,
} from "../shared/board.js";
import type { Store } from "./store.js";

// The organisation's workspace on the server: what the platform needs to keep
// learning when no one is signed in. It holds the organisation's profile, what
// each agent has learned in the company, the decisions taken and their
// outcomes, and what the horizon scanner has found outside. People's details
// and CVs are not here; they stay in the lead's browser.

export interface Feed {
  url: string;
  label: string;
}

export interface Workspace {
  id: string;
  createdAt: string;
  adminTokenHash: string;
  name: string;
  sector: string;
  profile: string;
  watchTopics: string[];
  feeds: Feed[];
  webSearch: boolean;
  scanEveryHours: number;
  lastScanAt: string | null;
  lastScanStatus: "ok" | "partial" | "failed" | null;
  lastScanNote: string | null;
}

export interface DecisionRecord {
  consultationId: string;
  question: string;
  mode: DecisionMode;
  decision: string;
  position: Position;
  rationale: string;
  decidedAt: string;
  /** Each agent's final position on the question (after any challenge round). */
  agentPositions: Partial<Record<AgentId, Position | null>>;
  peoplePositions: (Position | null)[];
  outcome: { result: Outcome; note: string; recordedAt: string } | null;
}

export interface TrackRecord {
  consultations: number;
  decisions: number;
  aligned: number;
  outcomesReviewed: number;
  calledRight: number;
}

const META = "meta";
export const workspacePartition = (id: string) => `w-${id}`;
const lessonRow = (id: string) => `lesson-${id}`;
export const signalRow = (id: string) => `signal-${id}`;
export const seenRow = (id: string) => `seen-${id}`;
const decisionRow = (consultationId: string) => `decision-${consultationId}`;
const LANDSCAPE = "landscape";
const ID = /^[A-Za-z0-9_-]{8,64}$/;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newId = (bytes = 12) => randomBytes(bytes).toString("base64url");

export function tokenMatches(token: string, expectedHash: string): boolean {
  return token.length > 0 && timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(expectedHash, "hex"));
}

export async function loadWorkspace(store: Store, id: string): Promise<Workspace | null> {
  if (!ID.test(id)) return null;
  return store.get<Workspace>(workspacePartition(id), META);
}

export async function saveWorkspace(store: Store, ws: Workspace): Promise<void> {
  await store.put(workspacePartition(ws.id), META, ws);
}

/** Workspace for a request carrying its admin token, or null. */
export async function authorisedWorkspace(store: Store, id: string, token: string): Promise<Workspace | null> {
  const ws = await loadWorkspace(store, id);
  return ws && tokenMatches(token, ws.adminTokenHash) ? ws : null;
}

export async function listWorkspaces(store: Store): Promise<Workspace[]> {
  return (await store.listByRow<Workspace>(META)).filter((r) => r.partition.startsWith("w-")).map((r) => r.value);
}

// ─── Lessons ────────────────────────────────────────────────────────────────

async function rowsWithPrefix<T>(store: Store, wsId: string, prefix: string): Promise<T[]> {
  return (await store.list<T>(workspacePartition(wsId))).filter((r) => r.row.startsWith(prefix)).map((r) => r.value);
}

export async function listLessons(store: Store, wsId: string): Promise<Lesson[]> {
  const lessons = await rowsWithPrefix<Lesson>(store, wsId, "lesson-");
  return lessons.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getLesson(store: Store, wsId: string, lessonId: string): Promise<Lesson | null> {
  return ID.test(lessonId) ? store.get<Lesson>(workspacePartition(wsId), lessonRow(lessonId)) : null;
}

export async function saveLesson(store: Store, wsId: string, lesson: Lesson): Promise<void> {
  await store.put(workspacePartition(wsId), lessonRow(lesson.id), lesson);
}

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Adds a lesson unless the agent already holds (or was already offered) the
 * same one. Lessons the chair writes are active at once; everything the
 * platform proposes waits for the chair.
 */
export async function addLesson(
  store: Store,
  wsId: string,
  input: { agentId: AgentId; kind: LessonKind; text: string; source: LessonSource; ref?: string | null; status: "proposed" | "active" },
): Promise<Lesson | null> {
  const text = input.text.trim().slice(0, LESSON_LIMITS.text);
  if (!text) return null;
  const existing = await listLessons(store, wsId);
  if (existing.some((l) => l.agentId === input.agentId && normalise(l.text) === normalise(text))) return null;
  const now = new Date().toISOString();
  const lesson: Lesson = {
    id: newId(9),
    agentId: input.agentId,
    kind: input.kind,
    text,
    source: input.source,
    status: input.status,
    createdAt: now,
    decidedAt: input.status === "active" ? now : null,
    ref: input.ref ?? null,
  };
  await saveLesson(store, wsId, lesson);
  await enforceActiveLimit(store, wsId, input.agentId);
  return lesson;
}

/** Keeps each agent's active memory to a bounded set: the oldest active lessons retire first. */
export async function enforceActiveLimit(store: Store, wsId: string, agentId: AgentId): Promise<void> {
  const active = (await listLessons(store, wsId)).filter((l) => l.agentId === agentId && l.status === "active");
  for (const old of active.slice(LESSON_LIMITS.activePerAgent)) {
    await saveLesson(store, wsId, { ...old, status: "retired", decidedAt: new Date().toISOString() });
  }
}

// ─── Decisions and track records ────────────────────────────────────────────

export async function listDecisions(store: Store, wsId: string): Promise<DecisionRecord[]> {
  const list = await rowsWithPrefix<DecisionRecord>(store, wsId, "decision-");
  return list.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
}

export async function getDecision(store: Store, wsId: string, consultationId: string): Promise<DecisionRecord | null> {
  return ID.test(consultationId) ? store.get<DecisionRecord>(workspacePartition(wsId), decisionRow(consultationId)) : null;
}

export async function saveDecision(store: Store, wsId: string, record: DecisionRecord): Promise<void> {
  await store.put(workspacePartition(wsId), decisionRow(record.consultationId), record);
}

/**
 * How each agent's views have compared with what the board decided, and
 * with how those decisions turned out. An agent "called it right" when it
 * agreed with a decision that worked, or disagreed with one that did not.
 */
export function trackRecords(decisions: DecisionRecord[]): Record<AgentId, TrackRecord> {
  const out = Object.fromEntries(
    AGENT_IDS.map((id) => [id, { consultations: 0, decisions: 0, aligned: 0, outcomesReviewed: 0, calledRight: 0 }]),
  ) as Record<AgentId, TrackRecord>;
  for (const d of decisions) {
    for (const [agentId, position] of Object.entries(d.agentPositions) as [AgentId, Position | null][]) {
      const r = out[agentId];
      if (!r) continue;
      r.consultations += 1;
      const agent = direction(position);
      if (!agent) continue;
      r.decisions += 1;
      const aligned = agent === direction(d.position);
      if (aligned) r.aligned += 1;
      if (d.outcome) {
        r.outcomesReviewed += 1;
        const right = outcomeWasRight(d.outcome.result);
        if ((aligned && right) || (!aligned && !right)) r.calledRight += 1;
      }
    }
  }
  return out;
}

// ─── The outside view ───────────────────────────────────────────────────────

export async function listSignals(store: Store, wsId: string): Promise<Signal[]> {
  const list = await rowsWithPrefix<Signal>(store, wsId, "signal-");
  return list.sort((a, b) => (b.publishedAt ?? b.foundAt).localeCompare(a.publishedAt ?? a.foundAt));
}

export async function getLandscape(store: Store, wsId: string): Promise<Landscape | null> {
  return store.get<Landscape>(workspacePartition(wsId), LANDSCAPE);
}

export async function saveLandscape(store: Store, wsId: string, landscape: Landscape): Promise<void> {
  await store.put(workspacePartition(wsId), LANDSCAPE, landscape);
}

/**
 * What an agent brings to a question from this organisation: the lessons the
 * chair has approved for it, the current external landscape, and the recent
 * external signals that bear on its remit. Returned as tagged data, to be
 * weighed, never obeyed.
 */
export async function agentKnowledge(store: Store, wsId: string, agentId: AgentId): Promise<string> {
  const lessons = (await listLessons(store, wsId)).filter((l) => l.agentId === agentId && l.status === "active");
  const landscape = await getLandscape(store, wsId);
  const cutoff = Date.now() - 90 * 864e5;
  const signals = (await listSignals(store, wsId))
    .filter((s) => s.agents.includes(agentId) && s.impact !== "low" && Date.parse(s.publishedAt ?? s.foundAt) >= cutoff)
    .slice(0, 6);

  const parts: string[] = [];
  if (lessons.length) {
    parts.push(
      `<what_you_have_learned_here>\nApproved by the chair for this organisation. Apply these unless the evidence in front of you contradicts them, and say when it does.\n${lessons
        .map((l) => `- [${l.kind}] ${l.text}`)
        .join("\n")}\n</what_you_have_learned_here>`,
    );
  }
  if (landscape?.briefing) {
    parts.push(`<external_landscape updated="${landscape.updatedAt.slice(0, 10)}">\n${landscape.briefing}\n</external_landscape>`);
  }
  if (signals.length) {
    parts.push(
      `<external_signals>\n${signals
        .map((s) => `- ${s.title} (${s.category}, ${s.impact} impact, ${s.publishedAt?.slice(0, 10) ?? "recent"}): ${s.implication}`)
        .join("\n")}\n</external_signals>`,
    );
  }
  return parts.join("\n\n");
}

export async function deleteWorkspace(store: Store, wsId: string): Promise<void> {
  for (const { row } of await store.list(workspacePartition(wsId))) await store.remove(workspacePartition(wsId), row);
}
