import { scopedKey } from "./userScope";
import { AGENT_IDS, CHAIR_AGENT, type AgentId, type BoardPerson } from "../../shared/board";

// The organisation the lead onboards: who they are, the real people at the
// table (with their CVs) and how the shadow board of AI agents is seated.
// Like the rest of the workspace, it is saved in this browser only. People's
// details leave the browser only when a question is put to the board.

export interface SeatedAgent {
  id: AgentId;
  seated: boolean;
  /** The lead's focus for this agent, for this organisation. */
  brief: string;
}

export interface Organisation {
  name: string;
  sector: string;
  profile: string;
  leadName: string;
  leadEmail: string;
  people: BoardPerson[];
  agents: SeatedAgent[];
  updatedAt: string;
  /** The organisation's workspace on the server: agent learning and horizon scanning. */
  workspace?: { id: string; adminToken: string } | null;
}

export const EMPTY_ORGANISATION: Organisation = {
  name: "",
  sector: "",
  profile: "",
  leadName: "",
  leadEmail: "",
  people: [],
  agents: AGENT_IDS.map((id) => ({ id, seated: true, brief: "" })),
  updatedAt: "",
};

const KEY = "organisation";

export function loadOrganisation(): Organisation {
  try {
    const raw = localStorage.getItem(scopedKey(KEY));
    if (!raw) return EMPTY_ORGANISATION;
    const saved = JSON.parse(raw) as Partial<Organisation>;
    // Keep every agent present and in seat order, whatever was saved.
    const agents = AGENT_IDS.map((id) => {
      const found = saved.agents?.find((a) => a.id === id);
      return { id, seated: id === CHAIR_AGENT ? true : found?.seated ?? true, brief: found?.brief ?? "" };
    });
    return { ...EMPTY_ORGANISATION, ...saved, people: saved.people ?? [], agents };
  } catch {
    return EMPTY_ORGANISATION;
  }
}

export function saveOrganisation(org: Organisation): Organisation {
  const next = { ...org, updatedAt: new Date().toISOString() };
  localStorage.setItem(scopedKey(KEY), JSON.stringify(next));
  return next;
}

export function clearOrganisation(): void {
  localStorage.removeItem(scopedKey(KEY));
}

export function newPersonId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `person-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** What the board's AI steps are told about the organisation. Sent per request, never stored on the server. */
export function boardContext(org: Organisation, personIds?: string[]) {
  const people = org.people.filter((p) => !personIds || personIds.includes(p.id));
  return {
    organisationProfile: [org.sector && `Sector: ${org.sector}.`, org.profile].filter(Boolean).join(" ").slice(0, 2000),
    people: people.map((p) => ({ name: p.name, role: p.role, expertise: p.expertise ?? "", cv: p.cv ?? "" })),
    agentBriefs: Object.fromEntries(org.agents.filter((a) => a.brief.trim()).map((a) => [a.id, a.brief.trim()])),
  };
}
