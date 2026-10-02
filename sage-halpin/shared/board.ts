// The board, as both the browser and the server understand it: the six AI
// agents and the personas they bring to a shadow board, and the questionnaire
// sent to the people around the table. No system prompts live here; those stay
// on the server.

export const AGENT_IDS = ["orion", "grimm", "solara", "zephyr", "mira", "aquila"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** The chair agent recommends a resolution after the others have spoken. */
export const CHAIR_AGENT: AgentId = "aquila";

export interface AgentPersona {
  id: AgentId;
  /** The seat, as the agent is always named: by role, never a human name. */
  seat: string;
  short: string;
  /** The persona the agent brings to a shadow board. */
  persona: string;
  archetype: string;
  temperament: string;
  asksFirst: string;
  watchesFor: string[];
  blindSpot: string;
  colour: string;
  symbol: string;
}

export const AGENT_PERSONAS: Record<AgentId, AgentPersona> = {
  orion: {
    id: "orion",
    seat: "Governance & Compliance agent",
    short: "Governance",
    persona: "The Auditor",
    archetype: "An independent non-executive who has chaired an audit committee through a restatement.",
    temperament: "Forensic, calm, unmoved by a good story.",
    asksFirst: "What is the evidence, and who has checked it?",
    watchesFor: ["Unvalidated assumptions", "Missing data", "Regulatory exposure", "Narrative drift"],
    blindSpot: "Can slow a decision that needs to be taken on incomplete information.",
    colour: "#475569",
    symbol: "○",
  },
  grimm: {
    id: "grimm",
    seat: "Risk & Resilience agent",
    short: "Risk",
    persona: "The Stress-Tester",
    archetype: "A risk director who has run the crisis room when a plan failed.",
    temperament: "Blunt, specific, downside first.",
    asksFirst: "How does this fail, and can we survive it if it does?",
    watchesFor: ["Single points of failure", "Cash and liquidity", "Low-likelihood, high-impact events", "Reversibility"],
    blindSpot: "Can under-weight the cost of not acting.",
    colour: "#1e293b",
    symbol: "◆",
  },
  solara: {
    id: "solara",
    seat: "Commercial Value agent",
    short: "Commercial",
    persona: "The Capital Allocator",
    archetype: "A strategy and investment committee member who has to show the return on every pound.",
    temperament: "Confident, numerate, grounded optimism.",
    asksFirst: "What is the return, and what else could this money and time do?",
    watchesFor: ["Return on capital", "Opportunity cost", "Customer and market evidence", "Pricing power"],
    blindSpot: "Can over-weight what is measurable.",
    colour: "#B45309",
    symbol: "◎",
  },
  zephyr: {
    id: "zephyr",
    seat: "Innovation & Sustainability agent",
    short: "Innovation",
    persona: "The Options Architect",
    archetype: "A transformation adviser who has seen the obvious answer turn out to be the wrong question.",
    temperament: "Curious, generative, resists early convergence.",
    asksFirst: "What options have we not considered, and is this the right question?",
    watchesFor: ["Alternatives", "Reframing", "Emerging technology and regulation", "Long-term sustainability"],
    blindSpot: "Can widen the field when the board needs to narrow it.",
    colour: "#3F6B4E",
    symbol: "◇",
  },
  mira: {
    id: "mira",
    seat: "Culture & Ethics agent",
    short: "Culture",
    persona: "The People Advocate",
    archetype: "A people committee member who has rebuilt trust after a change that went badly.",
    temperament: "Empathetic, execution-grounded, candid.",
    asksFirst: "How will people really respond, and is this the right thing to do?",
    watchesFor: ["Morale and retention", "Incentives and conduct", "Customer trust", "Execution friction"],
    blindSpot: "Can over-weight short-term discomfort.",
    colour: "#991B1B",
    symbol: "◉",
  },
  aquila: {
    id: "aquila",
    seat: "Performance & Strategy agent",
    short: "Performance",
    persona: "The Chair",
    archetype: "A chair who turns disagreement into a decision the board can own.",
    temperament: "Decisive, structured, synthesis-focused.",
    asksFirst: "Where do we agree, where do we genuinely differ, and what do we decide?",
    watchesFor: ["Decision quality", "Trade-offs accepted", "Ownership", "Kill conditions"],
    blindSpot: "Can force closure before a minority view is fully heard.",
    colour: "#1d4ed8",
    symbol: "◈",
  },
};

export const POSITIONS = ["support", "support_with_conditions", "oppose", "need_more_information"] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<Position, string> = {
  support: "Support",
  support_with_conditions: "Support with conditions",
  oppose: "Oppose",
  need_more_information: "Need more information",
};

export type QuestionType = "position" | "scale" | "text";

export interface QuestionnaireItem {
  id: string;
  type: QuestionType;
  prompt: string;
  required: boolean;
}

/** Every questionnaire opens with these, so people's views can be compared with the agents'. */
export const STANDARD_QUESTIONS: QuestionnaireItem[] = [
  { id: "position", type: "position", prompt: "What is your position on this decision?", required: true },
  { id: "confidence", type: "scale", prompt: "How confident are you in that position? (1 = not confident, 5 = very confident)", required: true },
];

export interface Answer {
  questionId: string;
  value: string;
}

/** A person at the table, as the lead enters them during onboarding. */
export interface BoardPerson {
  id: string;
  name: string;
  role: string;
  email: string;
  phone?: string;
  expertise?: string;
  cv?: string;
  /** A permanent member takes part in every decision that involves people. */
  permanent?: boolean;
  /** When they joined the board (YYYY-MM-DD). */
  joinedAt?: string;
}

export const LIMITS = {
  name: 120,
  role: 120,
  email: 254,
  organisation: 200,
  profile: 2000,
  question: 4000,
  context: 4000,
  expertise: 500,
  cv: 6000,
  brief: 500,
  people: 20,
  customQuestions: 10,
  prompt: 500,
  answer: 4000,
} as const;

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= LIMITS.email && EMAIL.test(value);
}

// ─── Who decides ────────────────────────────────────────────────────────────

/** The chair chooses, per question, whose input the decision rests on. */
export const DECISION_MODES = ["people", "agents", "collaborative"] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

export const DECISION_MODE_LABELS: Record<DecisionMode, string> = {
  people: "People",
  agents: "Agents",
  collaborative: "Collaborative",
};

export const DECISION_MODE_DESCRIPTIONS: Record<DecisionMode, string> = {
  people: "The people asked decide. They answer a questionnaire; no AI opinion is added.",
  agents: "The shadow board of AI agents forms the view, through their personas. The chair adopts or rejects it.",
  collaborative:
    "People and agents deliberate in two rounds: both give independent views, then the agents challenge the people's answers and the people can revise theirs. The chair sets how much weight each side carries.",
};

/** Positions grouped by what they mean for the decision. */
export function direction(p: Position | null): "for" | "against" | "defer" | null {
  if (p === "support" || p === "support_with_conditions") return "for";
  if (p === "oppose") return "against";
  if (p === "need_more_information") return "defer";
  return null;
}

/**
 * The combined weight behind each position: the people's share of their votes
 * times their weight, plus the agents' share times theirs. Weights are
 * percentages; people + agents = 100.
 */
export function weightedTally(people: (Position | null)[], agents: (Position | null)[], peopleWeight: number) {
  const share = (list: (Position | null)[], p: Position) => {
    const stated = list.filter(Boolean);
    return stated.length ? stated.filter((x) => x === p).length / stated.length : 0;
  };
  const w = Math.min(100, Math.max(0, peopleWeight)) / 100;
  const hasPeople = people.some(Boolean);
  const hasAgents = agents.some(Boolean);
  // If one side has not spoken, the other carries the whole weight.
  const wp = hasPeople && hasAgents ? w : hasPeople ? 1 : 0;
  const wa = hasPeople && hasAgents ? 1 - w : hasAgents ? 1 : 0;
  return POSITIONS.map((p) => ({ position: p, score: Math.round((share(people, p) * wp + share(agents, p) * wa) * 100) }));
}

// ─── How agents learn ───────────────────────────────────────────────────────

export const LESSON_KINDS = ["principle", "fact", "preference", "correction", "context"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const LESSON_KIND_LABELS: Record<LessonKind, string> = {
  principle: "Principle",
  fact: "Fact about us",
  preference: "Board preference",
  correction: "Correction",
  context: "External context",
};

/** Where a lesson came from: the four ways an agent learns in the company. */
export const LESSON_SOURCES = ["chair", "study", "feedback", "outcome", "horizon"] as const;
export type LessonSource = (typeof LESSON_SOURCES)[number];

export const LESSON_SOURCE_LABELS: Record<LessonSource, string> = {
  chair: "Taught by the chair",
  study: "From material it studied",
  feedback: "From feedback on its opinions",
  outcome: "From decision outcomes",
  horizon: "From horizon scanning",
};

export interface Lesson {
  id: string;
  agentId: AgentId;
  kind: LessonKind;
  text: string;
  source: LessonSource;
  /** Proposed lessons wait for the chair; only active lessons reach the agent. */
  status: "proposed" | "active" | "retired";
  createdAt: string;
  decidedAt: string | null;
  /** What it came from: a question, a document title or a signal. */
  ref: string | null;
}

export const LESSON_LIMITS = { text: 500, activePerAgent: 30, studyText: 20000, studyTitle: 200 } as const;

export const OUTCOMES = ["better", "as_expected", "worse", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  better: "Better than expected",
  as_expected: "As expected",
  worse: "Worse than expected",
  failed: "It failed",
};

/** Whether an outcome shows the decision was right. */
export const outcomeWasRight = (o: Outcome) => o === "better" || o === "as_expected";

// ─── Looking outward ────────────────────────────────────────────────────────

export const SIGNAL_CATEGORIES = ["political", "economic", "social", "technological", "legal", "environmental", "competitive"] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

export const SIGNAL_IMPACTS = ["high", "medium", "low"] as const;
export type SignalImpact = (typeof SIGNAL_IMPACTS)[number];

export const SIGNAL_HORIZONS = ["now", "next_12_months", "long_term"] as const;
export type SignalHorizon = (typeof SIGNAL_HORIZONS)[number];

export const SIGNAL_HORIZON_LABELS: Record<SignalHorizon, string> = {
  now: "Now",
  next_12_months: "Next 12 months",
  long_term: "Longer term",
};

export interface Signal {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  foundAt: string;
  category: SignalCategory;
  impact: SignalImpact;
  horizon: SignalHorizon;
  summary: string;
  implication: string;
  agents: AgentId[];
  via: "feed" | "web";
}

export interface Landscape {
  updatedAt: string;
  briefing: string;
  trends: { title: string; direction: "rising" | "steady" | "falling"; detail: string }[];
  signalCount: number;
}

export const SCAN_INTERVALS_HOURS = [6, 12, 24, 72, 168] as const;

export const HORIZON_LIMITS = { feeds: 12, watchTopics: 12, topic: 80, feedLabel: 80, url: 500 } as const;

// ─── The checkpoint: the organisation on a page ─────────────────────────────

export const CHECKPOINT_KINDS = ["decision", "plan", "outcome", "achievement", "event", "joined", "left", "agent", "signal"] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export const CHECKPOINT_KIND_LABELS: Record<CheckpointKind, string> = {
  decision: "Decision",
  plan: "Plan",
  outcome: "Outcome",
  achievement: "Achievement",
  event: "Event",
  joined: "Joined",
  left: "Left",
  agent: "Agent learned",
  signal: "External signal",
};

/** Kinds the lead records by hand; the rest come from the platform's own records. */
export const LOGGED_KINDS = ["event", "achievement", "joined", "left"] as const;
export type LoggedKind = (typeof LOGGED_KINDS)[number];

export interface CheckpointEntry {
  id: string;
  date: string; // YYYY-MM-DD
  kind: CheckpointKind;
  title: string;
  detail: string;
  /** Where it came from, for tracing: a question, a lesson, a signal, or the lead. */
  source: string;
}

export interface Checkpoint {
  n: number;
  createdAt: string;
  publishedBy: string;
  entryCount: number;
  summary: string;
  insights: { title: string; detail: string }[];
  /** The entries it contained, so later entries can be shown as new. */
  entryIds?: string[];
}

export const CHECKPOINT_YEARS = 3;

const KIND_ORDER: CheckpointKind[] = ["event", "signal", "joined", "achievement", "decision", "plan", "outcome", "agent", "left"];

/** Oldest first; on the same day, a decision is followed by its plan and outcome. */
export function compareEntries(a: CheckpointEntry, b: CheckpointEntry): number {
  return a.date.localeCompare(b.date) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id);
}
