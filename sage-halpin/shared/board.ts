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
