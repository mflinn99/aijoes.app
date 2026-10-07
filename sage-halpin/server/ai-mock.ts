import { textOf, type CompletionRequest } from "./ai.js";

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
    case "file-review": {
      // Says what it was given, so tests can see which content reached the model.
      const content = req.messages.at(-1)?.content ?? "";
      const attached = typeof content === "string" ? [] : content.filter((b) => b.type !== "text").map((b) => b.type);
      return `## Response\nMock: Sentinel has read the file${attached.length ? ` (${attached.join(", ")} attached)` : ""} and followed the instruction. This is a mock reply for testing.\n\n## Board digest\nMock digest: the key points of this file for the board.`;
    }
    case "analysis-persona":
      return JSON.stringify(ANALYSIS_PERSONA);
    case "analysis-aggregate":
      return "```json\n" + JSON.stringify(AGGREGATE) + "\n```";
    case "analysis-functions":
      return JSON.stringify(FUNCTIONS);
    case "questionnaire":
      return JSON.stringify([
        "Mock question: what evidence would change your view?",
        "Mock question: what is the main risk you see?",
        "Mock question: what would you need to be true to support this?",
      ]);
    case "shadow":
      return "Mock shadow board opinion. Critical unknowns: this is a mock reply for testing.\nPOSITION: need_more_information\nCONFIDENCE: 3";
    case "shadow-chair":
      return "Mock chair view. Board alignment points: none yet. RECOMMENDED RESOLUTION: gather evidence before deciding.\nPOSITION: support_with_conditions\nCONFIDENCE: 3";
    case "synthesis-people":
      return "Mock summary of the people's input. This is a mock reply for testing.";
    case "synthesis-mixed":
      return "Mock combined view of people and agents. RECOMMENDED RESOLUTION: mock. This is a mock reply for testing.";
    case "shadow-challenge":
      return "Mock challenge of the people's answers. This is a mock reply for testing.\nPOSITION: support_with_conditions\nCONFIDENCE: 4";
    case "agent-study":
      return JSON.stringify([{ kind: "fact", text: "Mock lesson from the material studied." }]);
    case "agent-reflection":
      return JSON.stringify([{ agentId: "grimm", text: "Mock lesson from the outcome of a decision." }]);
    case "horizon-triage": {
      // Keep every item the scanner offered, so tests can count them.
      const count = (textOf(req.messages.at(-1)?.content ?? "").match(/<item index=/g) ?? []).length;
      return JSON.stringify(
        Array.from({ length: count }, (_, index) => ({
          index,
          category: "economic",
          impact: "high",
          horizon: "now",
          summary: "Mock summary of an external development.",
          implication: "Mock implication for the organisation.",
          agents: ["solara", "grimm"],
        })),
      );
    }
    case "horizon-search":
      return JSON.stringify([
        {
          title: "Mock development found by web search",
          url: "https://example.com/mock-development",
          publishedAt: "2026-09-30",
          category: "legal",
          impact: "medium",
          horizon: "next_12_months",
          summary: "Mock summary.",
          implication: "Mock implication.",
          agents: ["orion"],
        },
      ]);
    case "horizon-landscape":
      return JSON.stringify({
        briefing: "Mock landscape briefing. This is a mock reply for testing.",
        trends: [{ title: "Mock trend", direction: "rising", detail: "Mock detail." }],
        lessons: [{ agentId: "solara", text: "Mock lesson from horizon scanning." }],
      });
    case "checkpoint-insights":
      return JSON.stringify({
        summary: "Mock checkpoint summary. This is a mock reply for testing.",
        insights: [
          { title: "Mock insight about momentum", detail: "Mock detail." },
          { title: "Mock insight about people", detail: "Mock detail." },
        ],
      });
    case "chat-chair":
      return "Mock response. Board alignment points: none yet. Board conflict points: none yet. RECOMMENDED RESOLUTION: gather evidence before deciding.";
    case "chat":
    default:
      return "Mock response. Critical unknowns: this is a mock reply for testing.";
  }
}
