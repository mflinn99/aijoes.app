import { scopedKey } from "./userScope";
import type { AgentId, Answer, DecisionMode, Position, QuestionnaireItem } from "../../shared/board";

// Client for board questions (consultations). The lead's browser keeps each
// question's id and admin token; the server keeps the question, the people
// invited and their answers, so people can reply from their own devices.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface Invitee {
  personId: string;
  name: string;
  role: string;
  email: string;
  invitedAt: string | null;
  emailStatus: "sent" | "manual" | "failed" | null;
  respondedAt: string | null;
}

export interface AgentOpinion {
  agentId: AgentId;
  seat: string;
  persona: string;
  content: string;
  position: Position | null;
  confidence: number | null;
}

export interface Synthesis {
  createdAt: string;
  content: string;
  responses: number;
}

export interface ConsultationView {
  id: string;
  status: "open" | "closed";
  createdAt: string;
  expiresAt: string;
  organisation: string;
  leadName: string;
  question: string;
  context: string;
  dueDate: string | null;
  questionnaire: QuestionnaireItem[];
  agents: AgentId[];
  emailProvider: "acs" | "manual";
  invitees: Invitee[];
  responses: Record<string, { answers: Answer[]; submittedAt: string }>;
  shadow: { createdAt: string; opinions: AgentOpinion[] } | null;
  challenge: { createdAt: string; opinions: AgentOpinion[] } | null;
  syntheses: { people: Synthesis | null; mixed: Synthesis | null };
  mode: DecisionMode;
  peopleWeight: number;
  shareWithPeople: boolean;
  linkedToWorkspace: boolean;
  decision: { decision: string; position: Position; rationale: string; decidedAt: string } | null;
  feedback: { agentId: AgentId; rating: "helpful" | "off_target"; note: string; at: string }[];
}

export interface SavedConsultation {
  id: string;
  adminToken: string;
  question: string;
  createdAt: string;
}

const INDEX = "consultations";
const LINKS = "consultation_links";

export function savedConsultations(): SavedConsultation[] {
  try {
    return JSON.parse(localStorage.getItem(scopedKey(INDEX)) ?? "[]") as SavedConsultation[];
  } catch {
    return [];
  }
}

function saveIndex(list: SavedConsultation[]) {
  localStorage.setItem(scopedKey(INDEX), JSON.stringify(list));
}

export function rememberConsultation(entry: SavedConsultation) {
  saveIndex([entry, ...savedConsultations().filter((c) => c.id !== entry.id)]);
}

export function forgetConsultation(id: string) {
  saveIndex(savedConsultations().filter((c) => c.id !== id));
  const links = savedLinks();
  delete links[id];
  localStorage.setItem(scopedKey(LINKS), JSON.stringify(links));
}

/** Questionnaire links issued in this browser, so the lead can send them by hand. */
function savedLinks(): Record<string, Record<string, string>> {
  try {
    return JSON.parse(localStorage.getItem(scopedKey(LINKS)) ?? "{}") as Record<string, Record<string, string>>;
  } catch {
    return {};
  }
}

export function linksFor(id: string): Record<string, string> {
  return savedLinks()[id] ?? {};
}

function rememberLinks(id: string, tokens: Record<string, string>) {
  const links = savedLinks();
  links[id] = { ...(links[id] ?? {}), ...tokens };
  localStorage.setItem(scopedKey(LINKS), JSON.stringify(links));
}

export function respondUrl(token: string): string {
  return `${window.location.origin}${BASE}/respond/${token}`;
}

export function mailtoFor(invitee: Pick<Invitee, "name" | "email" | "role">, c: Pick<ConsultationView, "leadName" | "organisation" | "question" | "dueDate">, link: string): string {
  const subject = `${c.leadName} would like your input: ${c.question.length > 80 ? `${c.question.slice(0, 77)}…` : c.question}`;
  const body = `Dear ${invitee.name},

I would value your input, as ${invitee.role}, on a board question at ${c.organisation}:

"${c.question}"

Please answer a short questionnaire: ${link}
${c.dueDate ? `\nPlease reply by ${c.dueDate}.\n` : ""}
Your answers come to me. They are compared with the views of our board's AI agents and summarised with AI to support the decision, which the people accountable for ${c.organisation} make.

${c.leadName}`;
  return `mailto:${encodeURIComponent(invitee.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${BASE}/api${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  draftQuestionnaire: (question: string, context: string, roles: string[]) =>
    call<{ source: "ai" | "template"; items: QuestionnaireItem[]; standard: QuestionnaireItem[] }>("/consultations/questionnaire", {
      method: "POST",
      body: JSON.stringify({ question, context, roles }),
    }),

  create: (body: {
    mode: DecisionMode;
    peopleWeight: number;
    shareWithPeople: boolean;
    workspace: { id: string; token: string } | null;
    organisation: string;
    leadName: string;
    question: string;
    context: string;
    dueDate: string;
    questions: string[];
    agents: AgentId[];
    people: { id: string; name: string; role: string; email: string }[];
  }) => call<{ id: string; adminToken: string; expiresAt: string }>("/consultations", { method: "POST", body: JSON.stringify(body) }),

  get: (s: SavedConsultation) => call<ConsultationView>(`/consultations/${s.id}`, { token: s.adminToken }),

  invite: async (s: SavedConsultation, personIds?: string[]) => {
    const res = await call<{ provider: "acs" | "manual"; invitations: { personId: string; token: string; emailStatus: Invitee["emailStatus"] }[] }>(
      `/consultations/${s.id}/invitations`,
      { method: "POST", token: s.adminToken, body: JSON.stringify(personIds ? { personIds } : {}) },
    );
    rememberLinks(s.id, Object.fromEntries(res.invitations.map((i) => [i.personId, i.token])));
    return res;
  },

  shadowBoard: (s: SavedConsultation, context: object) =>
    call<ConsultationView["shadow"]>(`/consultations/${s.id}/shadow-board`, { method: "POST", token: s.adminToken, body: JSON.stringify(context) }),

  synthesis: (s: SavedConsultation, view: "people" | "mixed", context: object) =>
    call<Synthesis>(`/consultations/${s.id}/synthesis`, { method: "POST", token: s.adminToken, body: JSON.stringify({ view, ...context }) }),

  challenge: (s: SavedConsultation, context: object) =>
    call<ConsultationView["challenge"]>(`/consultations/${s.id}/challenge`, { method: "POST", token: s.adminToken, body: JSON.stringify(context) }),

  decide: (s: SavedConsultation, body: { decision: string; position: Position; rationale: string }) =>
    call<ConsultationView["decision"]>(`/consultations/${s.id}/decision`, { method: "POST", token: s.adminToken, body: JSON.stringify(body) }),

  feedback: (s: SavedConsultation, body: { agentId: AgentId; rating: "helpful" | "off_target"; note: string }) =>
    call<{ lesson: unknown }>(`/consultations/${s.id}/feedback`, { method: "POST", token: s.adminToken, body: JSON.stringify(body) }),

  close: (s: SavedConsultation) => call<{ status: string }>(`/consultations/${s.id}/close`, { method: "POST", token: s.adminToken }),

  remove: (s: SavedConsultation) => call<void>(`/consultations/${s.id}`, { method: "DELETE", token: s.adminToken }),

  openQuestionnaire: (token: string) =>
    call<{
      organisation: string;
      leadName: string;
      question: string;
      context: string;
      dueDate: string | null;
      status: "open" | "closed";
      questionnaire: QuestionnaireItem[];
      respondent: { name: string; role: string };
      response: { answers: Answer[]; submittedAt: string } | null;
      boardView: {
        agents: { persona: string; seat: string; position: Position | null; confidence: number | null }[];
        recommendation: string | null;
      } | null;
    }>(`/respond/${encodeURIComponent(token)}`),

  answer: (token: string, answers: Answer[]) =>
    call<{ answers: Answer[]; submittedAt: string }>(`/respond/${encodeURIComponent(token)}`, { method: "POST", body: JSON.stringify({ answers }) }),
};

export { ApiError };
