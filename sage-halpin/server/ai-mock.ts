import type { CompletionRequest } from "./ai.js";

// Deterministic replies for tests and offline demos. Every reply says it is a
// mock, so it can never be mistaken for board advice.

const ANALYSIS_PERSONA = {
  executionNarrative: "Mock analysis: execution succeeds only if the owner, budget and success measure are agreed first.",
  consequences: ["Mock consequence: a measurable effect on cost within two quarters."],
  swot: {
    strengths: ["Mock strength"],
    weaknesses: ["Mock weakness"],
    opportunities: ["Mock opportunity"],
    threats: ["Mock threat"],
  },
};

const SEATS = ["dr_white", "cmdr_black", "ms_gold", "dr_green", "lt_red", "col_blue"];

const AGGREGATE = {
  decision: "DONT_DO",
  rationale: "Mock verdict: the evidence supplied is not sufficient to proceed. This is a mock response for testing.",
  difficulty: "Med",
  cost: "Med",
  time: "Med",
  risk: "High",
  personaActions: Object.fromEntries(SEATS.map((id) => [id, ["Mock action one", "Mock action two"]])),
};

const FUNCTION = {
  soWhat: "Mock: what this means for the function now.",
  whatIf: "Mock: acting versus not acting.",
  dataInputs: ["CRM: mock data point", "ERP: mock data point", "HRIS: mock data point"],
};

const FUNCTIONS = Object.fromEntries(
  ["sales", "finance", "hr", "product", "legal", "governance"].map((key) => [key, FUNCTION]),
);

export function mockCompletion(req: CompletionRequest): string {
  switch (req.purpose) {
    case "analysis-persona":
      return JSON.stringify(ANALYSIS_PERSONA);
    case "analysis-aggregate":
      return "```json\n" + JSON.stringify(AGGREGATE) + "\n```";
    case "analysis-functions":
      return JSON.stringify(FUNCTIONS);
    case "chat-chair":
      return "Mock response. Board alignment points: none yet. Board conflict points: none yet. RECOMMENDED RESOLUTION: gather evidence before deciding.";
    case "chat":
    default:
      return "Mock response. Critical unknowns: this is a mock reply for testing.";
  }
}
