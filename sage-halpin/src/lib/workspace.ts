import { loadOrganisation, saveOrganisation, type Organisation } from "./organisation";
import type { AgentId, Landscape, Lesson, LessonKind, Outcome, Position, Signal } from "../../shared/board";

// Client for the organisation's workspace on the server: agent development,
// decisions and outcomes, and horizon scanning. The browser holds its id and
// admin token alongside the organisation.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface WorkspaceSettings {
  id: string;
  name: string;
  sector: string;
  profile: string;
  watchTopics: string[];
  feeds: { url: string; label: string }[];
  webSearch: boolean;
  scanEveryHours: number;
  lastScanAt: string | null;
  lastScanStatus: "ok" | "partial" | "failed" | null;
  lastScanNote: string | null;
}

export interface TrackRecord {
  consultations: number;
  decisions: number;
  aligned: number;
  outcomesReviewed: number;
  calledRight: number;
}

export interface DecisionRecord {
  consultationId: string;
  question: string;
  mode: "people" | "agents" | "collaborative";
  decision: string;
  position: Position;
  rationale: string;
  decidedAt: string;
  agentPositions: Partial<Record<AgentId, Position | null>>;
  peoplePositions: (Position | null)[];
  outcome: { result: Outcome; note: string; recordedAt: string } | null;
}

export type WorkspaceLink = { id: string; adminToken: string };

async function call<T>(link: WorkspaceLink | null, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(link ? { Authorization: `Bearer ${link.adminToken}` } : {}), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** The organisation's workspace link, creating the workspace on first use. */
export async function ensureWorkspace(org: Organisation = loadOrganisation()): Promise<WorkspaceLink | null> {
  if (org.workspace) return org.workspace;
  if (!org.name.trim()) return null;
  const created = await call<{ id: string; adminToken: string }>(null, "/workspaces", {
    method: "POST",
    body: JSON.stringify({ name: org.name.trim(), sector: org.sector.trim(), profile: org.profile.trim() }),
  });
  const link = { id: created.id, adminToken: created.adminToken };
  saveOrganisation({ ...loadOrganisation(), workspace: link });
  return link;
}

/** Keeps the server's copy of the profile in step with the browser's. */
export async function syncProfile(org: Organisation): Promise<void> {
  const link = await ensureWorkspace(org);
  if (!link || !org.name.trim()) return;
  await call(link, `/workspaces/${link.id}`, {
    method: "PUT",
    body: JSON.stringify({ name: org.name.trim(), sector: org.sector.trim(), profile: org.profile.trim() }),
  });
}

export const workspaceApi = {
  remove: (l: WorkspaceLink) => call<void>(l, `/workspaces/${l.id}`, { method: "DELETE" }),
  settings: (l: WorkspaceLink) => call<WorkspaceSettings>(l, `/workspaces/${l.id}`),
  update: (l: WorkspaceLink, body: Partial<WorkspaceSettings>) => call<WorkspaceSettings>(l, `/workspaces/${l.id}`, { method: "PUT", body: JSON.stringify(body) }),

  agents: (l: WorkspaceLink) => call<{ agents: { id: AgentId; lessons: Lesson[]; record: TrackRecord }[] }>(l, `/workspaces/${l.id}/agents`),
  teach: (l: WorkspaceLink, agentId: AgentId, kind: LessonKind, text: string) =>
    call<Lesson>(l, `/workspaces/${l.id}/agents/${agentId}/lessons`, { method: "POST", body: JSON.stringify({ kind, text }) }),
  study: (l: WorkspaceLink, agentId: AgentId, title: string, text: string) =>
    call<{ proposed: Lesson[] }>(l, `/workspaces/${l.id}/agents/${agentId}/study`, { method: "POST", body: JSON.stringify({ title, text }) }),
  setLesson: (l: WorkspaceLink, lessonId: string, status: "active" | "retired", text?: string) =>
    call<Lesson>(l, `/workspaces/${l.id}/lessons/${lessonId}`, { method: "PATCH", body: JSON.stringify({ status, ...(text ? { text } : {}) }) }),

  decisions: (l: WorkspaceLink) => call<{ decisions: DecisionRecord[] }>(l, `/workspaces/${l.id}/decisions`),
  outcome: (l: WorkspaceLink, consultationId: string, result: Outcome, note: string) =>
    call<{ decision: DecisionRecord; proposed: Lesson[] }>(l, `/workspaces/${l.id}/decisions/${consultationId}/outcome`, {
      method: "POST",
      body: JSON.stringify({ result, note }),
    }),

  horizon: (l: WorkspaceLink) => call<{ settings: WorkspaceSettings; landscape: Landscape | null; signals: Signal[] }>(l, `/workspaces/${l.id}/horizon`),
  scan: (l: WorkspaceLink) => call<{ status: string; found: number; kept: number; note: string }>(l, `/workspaces/${l.id}/horizon/scan`, { method: "POST" }),
  teachSignal: (l: WorkspaceLink, signalId: string, agentIds?: AgentId[]) =>
    call<{ taught: Lesson[] }>(l, `/workspaces/${l.id}/horizon/signals/${signalId}/teach`, { method: "POST", body: JSON.stringify(agentIds ? { agentIds } : {}) }),
};
