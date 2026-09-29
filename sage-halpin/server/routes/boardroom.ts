import { Router } from "express";
import OpenAI from "openai";
import {
  type PersonaId,
  PERSONAS,
  ANALYSIS_PERSONAS,
} from "../personas/boardroom-personas.js";

const router = Router();

const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  apiKey: process.env.OPENAI_API_KEY,
});

interface ChatMessage {
  role: "user" | "assistant";
  personaId?: PersonaId;
  content: string;
}

interface BoardroomRequest {
  topic: string;
  context?: string;
  sessionHistory?: ChatMessage[];
  mode?: "full_board" | "single";
  personaId?: PersonaId;
  board?: string;
}

router.post("/boardroom/chat", async (req, res) => {
  const { topic, context, sessionHistory = [], mode = "full_board", personaId } = req.body as BoardroomRequest;

  if (!topic?.trim()) {
    res.status(400).json({ error: "topic required" });
    return;
  }

  const PERSONA_SET = PERSONAS;

  const userContent = context
    ? `CEO Statement: ${topic}\n\nContext: ${context}`
    : `CEO Statement: ${topic}`;

  try {
    if (mode === "single" && personaId && PERSONA_SET[personaId]) {
      const persona = PERSONA_SET[personaId];
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: persona.system },
        ...sessionHistory.slice(-8).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: userContent },
      ];

      const completion = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-5.1",
        messages,
        max_completion_tokens: 350,
        temperature: 0.7,
      });

      res.json({
        mode: "single",
        response: {
          personaId,
          name: persona.name,
          role: persona.role,
          emoji: persona.emoji,
          color: persona.color,
          content: completion.choices[0]?.message?.content ?? "",
        },
      });
      return;
    }

    // Full board — all 6 personas in parallel
    const personaOrder: PersonaId[] = ["orion", "grimm", "solara", "zephyr", "mira", "aquila"];

    const allResponses = await Promise.all(
      personaOrder.map(async (pid) => {
        const persona = PERSONA_SET[pid];
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: "system", content: persona.system },
          ...sessionHistory.slice(-6).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user", content: userContent },
        ];

        const completion = await client.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-5.1",
          messages,
          max_completion_tokens: pid === "aquila" ? 600 : 300,
          temperature: pid === "aquila" ? 0.5 : 0.75,
        });

        return {
          personaId: pid,
          name: persona.name,
          role: persona.role,
          emoji: persona.emoji,
          color: persona.color,
          content: completion.choices[0]?.message?.content ?? "",
        };
      })
    );

    res.json({ mode: "full_board", responses: allResponses });
  } catch (err: unknown) {
    req.log.error({ err }, "boardroom chat error");
    res.status(500).json({ error: "Board session failed. Check AI integration." });
  }
});

// ─── ANALYSIS ENGINE ────────────────────────────────────────────────────────

const BOARD_TRUTHS: Record<string, { label: string; context: string; patterns: string[] }> = {
  reduce_payroll: {
    label: "Reduce Payroll",
    context: "Reducing headcount or payroll costs through redundancy, restructuring, or hours reduction.",
    patterns: [
      "Short-term cost reduction is real and immediate",
      "Morale risk is severe and often underestimated — survivors disengage",
      "Productivity typically drops 15-30% post-cut due to loss of institutional knowledge",
      "Rehiring costs average 1.5-2x annual salary per role within 18 months",
      "Legal exposure: unfair dismissal, TUPE, discrimination risk",
      "Alternatives: voluntary redundancy, hours reduction, contractor transition, attrition",
      "Brand damage for future talent acquisition is long-lasting",
      "The cut that saves the business vs the cut that breaks it differ by 5-10% of headcount",
    ],
  },
  improve_margins: {
    label: "Improve Margins",
    context: "Increasing gross or net margins through pricing, supplier renegotiation, or operational efficiency.",
    patterns: [
      "Pricing power is the highest-leverage margin lever if demand is inelastic",
      "1% price increase = 10-15% profit improvement for most businesses",
      "Supplier renegotiation typically yields 3-8% cost reduction",
      "Operational efficiency gains of 2-5% are achievable in 6-12 months",
      "Customer churn risk increases sharply above 5-7% price increases",
      "Product mix optimisation (drop low-margin SKUs) is often overlooked",
      "Margin improvement programmes require management bandwidth; distraction risk is high",
      "Quick wins: eliminate bottom 20% revenue by margin contribution",
    ],
  },
  increase_sales: {
    label: "Increase Sales",
    context: "Accelerating revenue growth through sales capacity, marketing, or channel expansion.",
    patterns: [
      "The core diagnostic: is the constraint supply (salespeople) or demand (leads)?",
      "Marketing spend efficiency must be established before scaling",
      "Sales capability gaps are more common than pipeline gaps",
      "Average B2B sales cycle is 3-6 months; revenue lag is significant",
      "New sales hires take 6-9 months to reach full productivity",
      "Conversion rate improvement of 1-2% outperforms adding headcount",
      "Wrong ICP targeting wastes 40-60% of sales effort",
      "Channel partnerships can be fastest route to sales scale if trust exists",
    ],
  },
  build_product: {
    label: "Build New Product",
    context: "Investing in new product development or a major platform extension.",
    patterns: [
      "Average SaaS product takes 12 months to build, 18 to achieve PMF",
      "Scope creep adds 40% to budget in 80% of projects",
      "Capital burn during development with zero revenue is existential for sub-18mo runway",
      "PMF is not assumed — it must be validated; most products fail to achieve it",
      "Early customer involvement reduces failure rate by 60%",
      "Build vs Buy vs Partner is always the first question",
      "Technical debt accumulated in MVP phase costs 3-5x to correct later",
      "Speed to first paying customer is the only metric that matters in Phase 1",
    ],
  },
  recruit_smt: {
    label: "Recruit Senior Leader",
    context: "Hiring a new senior management team member to drive a strategic agenda.",
    patterns: [
      "Total cost of senior hire: £150k-£500k+ (salary, NI, benefits, recruitment, onboarding)",
      "Time to effective contribution: 6-12 months in most organisations",
      "Wrong senior hire costs 10-15x annual salary to correct",
      "Culture disruption risk is highest from external C-level appointments",
      "Promote vs external hire: internal is 40% faster, 60% lower culture risk",
      "Interim route allows 90-day validation before commitment",
      "Leadership leverage: right hire multiplies team output; wrong hire divides it",
      "The hardest question: is this a people problem or a process problem?",
    ],
  },
  identify_redundancies: {
    label: "Identify Redundancies",
    context: "Auditing roles, processes, systems, and spend to surface duplication, structural inefficiency, and waste without triggering headcount cuts prematurely.",
    patterns: [
      "Redundancy ≠ headcount reduction — structural waste includes systems, processes, and management layers, not just people",
      "Span of control analysis: healthy ratio is 6-8 direct reports per manager; below 4 is a structural red flag",
      "The typical organisation has 15-25% of roles that duplicate or overlap a neighbouring function",
      "Process redundancy is harder to find than role redundancy — it lives in handoffs and sign-off chains",
      "Technology stack duplication (e.g. two CRMs, three project tools) adds 10-20% to SaaS spend needlessly",
      "Management layer audit: more than 5 layers from CEO to front line creates systemic delay and information loss",
      "Survivor bias risk: visible roles look redundant; invisible roles (institutional knowledge holders) are cut first",
      "Restructuring from a redundancy audit fails if root-cause demand is not addressed first — the redundancy returns",
      "The right sequence: map demand → map delivery → identify gap → identify duplication → act",
      "Cost of misidentifying a critical role as redundant: 2-5x the annual salary to recover capability",
    ],
  },
};


/** Extract JSON from a model response that may be wrapped in markdown code fences */
function extractJSON(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  // Strip markdown code fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    // Last resort: find the first { ... } block
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { /* fall through */ }
    }
    return {};
  }
}

interface AnalysisRequest {
  challenge: string;
  calibration: { risk: number; ambition: number; time: number; cost: number };
  feedbackRound?: number;
  feedbackComment?: string;
  board?: string;
}

router.post("/boardroom/analysis", async (req, res) => {
  const { challenge, calibration, feedbackRound = 0, feedbackComment = "" } = req.body as AnalysisRequest;
  const ANALYSIS_SET = ANALYSIS_PERSONAS;

  if (!challenge || !BOARD_TRUTHS[challenge]) {
    res.status(400).json({ error: "Invalid challenge" });
    return;
  }
  if (!calibration || typeof calibration.risk !== "number") {
    res.status(400).json({ error: "calibration required" });
    return;
  }

  const boardTruth = BOARD_TRUTHS[challenge];
  const calibText = [
    `Risk Appetite: ${Math.round(calibration.risk * 10)}/10 (${calibration.risk < 0.4 ? "Risk-Averse" : calibration.risk > 0.7 ? "Risk-Seeking" : "Balanced"})`,
    `Ambition Level: ${Math.round(calibration.ambition * 10)}/10 (${calibration.ambition < 0.4 ? "Conservative" : calibration.ambition > 0.7 ? "Aggressive" : "Moderate"})`,
    `Time Sensitivity: ${Math.round(calibration.time * 10)}/10 (${calibration.time < 0.4 ? "Flexible" : calibration.time > 0.7 ? "Urgent" : "Moderate"})`,
    `Cost Sensitivity: ${Math.round(calibration.cost * 10)}/10 (${calibration.cost < 0.4 ? "Flexible" : calibration.cost > 0.7 ? "Constrained" : "Moderate"})`,
  ].join("\n");

  const feedbackNote = feedbackRound > 0 && feedbackComment
    ? `\n\nFEEDBACK ROUND ${feedbackRound}: CEO has provided the following feedback to incorporate: "${feedbackComment}". Adjust your analysis accordingly.`
    : "";

  const challengePrompt = `BOARD CHALLENGE: ${boardTruth.label}
CHALLENGE CONTEXT: ${boardTruth.context}

KNOWN BOARD TRUTHS (established patterns — treat as validated intelligence):
${boardTruth.patterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}

CALIBRATION SETTINGS (these MUST influence your analysis):
${calibText}${feedbackNote}

Your task: Analyse this challenge from your unique hat's perspective with rigour and critical independence. Be concise — short sentences only. Do not soften concerns. Weaknesses and Threats must be specific and substantive, not generic. Return ONLY valid JSON matching this schema exactly:
{
  "executionNarrative": "1-2 short sentences on how you would approach this — be specific about what must be true for execution to succeed",
  "consequences": ["consequence 1 — be specific, quantify where possible", "consequence 2"],
  "swot": {
    "strengths": ["strength 1 — only list if genuinely present"],
    "weaknesses": ["weakness 1 — be direct, do not understate"],
    "opportunities": ["opportunity 1 — only if realistic, not aspirational"],
    "threats": ["threat 1 — be specific about failure mode"]
  }
}

Calibration influence rules:
- High risk appetite → consider bolder paths only if backed by evidence, not assumption
- Low risk appetite → give full weight to downside and failure scenarios
- High cost sensitivity → flag specific cost exposures and whether the business can absorb them
- High time sensitivity → assess whether the timeline is genuinely achievable or optimistic
- High ambition → broaden scope but stress-test whether the org can deliver at that scale`;

  try {
    async function callPersona(persona: (typeof ANALYSIS_PERSONAS)[number]) {
      const completion = await client.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: persona.system },
          { role: "user", content: challengePrompt },
        ],
        max_completion_tokens: 700,
        temperature: 0.6,
        response_format: { type: "json_object" },
      });
      const rawContent = completion.choices[0]?.message?.content ?? "";
      const parsed = extractJSON(rawContent) as {
        executionNarrative?: string;
        consequences?: string[];
        swot?: { strengths?: string[]; weaknesses?: string[]; opportunities?: string[]; threats?: string[] };
      };
      return {
        id: persona.id, name: persona.name, hat: persona.hat, color: persona.color,
        executionNarrative: parsed.executionNarrative ?? "Analysis unavailable.",
        consequences: parsed.consequences ?? [],
        swot: {
          strengths: parsed.swot?.strengths ?? [],
          weaknesses: parsed.swot?.weaknesses ?? [],
          opportunities: parsed.swot?.opportunities ?? [],
          threats: parsed.swot?.threats ?? [],
        },
      };
    }

    // Run all 6 personas in parallel
    const personaResults = await Promise.all(ANALYSIS_SET.map(callPersona));

    // Build aggregation prompt from persona outputs
    const personaSummaries = personaResults
      .map((p) => `${p.name}: ${p.executionNarrative.slice(0, 130)}`)
      .join("\n");

    const aggregationPrompt = `BOARD CHALLENGE: ${boardTruth.label}

CALIBRATION:
${calibText}

PERSONA ANALYSES RECEIVED:
${personaSummaries}

As Board Chair (${ANALYSIS_SET[5].name}), synthesise the board's analysis and deliver a balanced, evidence-based verdict.

DECISION FRAMEWORK: Weigh the persona inputs objectively. A DO verdict is appropriate when the evidence supports it — strong strategic value, manageable risk, credible execution path, and clear financial case. A DONT_DO verdict is appropriate when material risks, execution gaps, or unclear returns outweigh the opportunity. Both outcomes are equally valid — the verdict must follow the evidence, not a default position. State clearly in the rationale which factors drove the decision.

Return ONLY valid JSON:
{
  "decision": "DO" or "DONT_DO",
  "rationale": "3-4 sentences. State clearly why the threshold was met or not met. Be direct — do not soften the verdict.",
  "difficulty": "Low" or "Med" or "High",
  "cost": "Low" or "Med" or "High",
  "time": "Short" or "Med" or "Long",
  "risk": "Low" or "Med" or "High",
  "personaActions": {
    "dr_white": ["action 1", "action 2"],
    "cmdr_black": ["action 1", "action 2"],
    "ms_gold": ["action 1", "action 2"],
    "dr_green": ["action 1", "action 2"],
    "lt_red": ["action 1", "action 2"],
    "col_blue": ["action 1", "action 2"]
  }
}`;

    const traditionalPrompt = `BOARD CHALLENGE: ${boardTruth.label}
CHALLENGE CONTEXT: ${boardTruth.context}

CALIBRATION:
${calibText}

BOARD PERSONA ANALYSES:
${personaResults.map((p) => `${p.name} (${p.hat}): ${p.executionNarrative}`).join("\n")}

TASK: Translate this board analysis into 6 traditional business function views. For each function write:
- soWhat: What does this analysis mean for this function right now? (1-2 concise sentences)
- whatIf: What happens in this function if the decision is acted on vs not acted on? (1-2 concise sentences)
- dataInputs: Exactly 3 specific back-office data points (name the system e.g. CRM, ERP, HRIS, Finance, BI) that would calibrate the so what and what if for this specific business

Return ONLY valid JSON:
{
  "sales":      { "soWhat": "...", "whatIf": "...", "dataInputs": ["[System]: data point", "[System]: data point", "[System]: data point"] },
  "finance":    { "soWhat": "...", "whatIf": "...", "dataInputs": ["[System]: data point", "[System]: data point", "[System]: data point"] },
  "hr":         { "soWhat": "...", "whatIf": "...", "dataInputs": ["[System]: data point", "[System]: data point", "[System]: data point"] },
  "product":    { "soWhat": "...", "whatIf": "...", "dataInputs": ["[System]: data point", "[System]: data point", "[System]: data point"] },
  "legal":      { "soWhat": "...", "whatIf": "...", "dataInputs": ["[System]: data point", "[System]: data point", "[System]: data point"] },
  "governance": { "soWhat": "...", "whatIf": "...", "dataInputs": ["[System]: data point", "[System]: data point", "[System]: data point"] }
}`;

    // Run aggregation and traditional view in parallel
    const [aggregationCompletion, traditionalCompletion] = await Promise.all([
      client.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: ANALYSIS_SET[5].system },
          { role: "user", content: aggregationPrompt },
        ],
        max_completion_tokens: 800,
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
      client.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: "You are a business strategy analyst. You translate board-level decisions into functional business implications with precision and brevity." },
          { role: "user", content: traditionalPrompt },
        ],
        max_completion_tokens: 1100,
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    ]);

    const aggregated = extractJSON(aggregationCompletion.choices[0]?.message?.content) as {
      decision?: string; rationale?: string; difficulty?: string;
      cost?: string; time?: string; risk?: string;
      personaActions?: Record<string, string[]>;
    };

    type VerticalData = { soWhat?: string; whatIf?: string; dataInputs?: string[] };
    const traditional = extractJSON(traditionalCompletion.choices[0]?.message?.content) as {
      sales?: VerticalData; finance?: VerticalData; hr?: VerticalData;
      product?: VerticalData; legal?: VerticalData; governance?: VerticalData;
    };

    const defaultVertical = (v: VerticalData | undefined) => ({
      soWhat: v?.soWhat ?? "",
      whatIf: v?.whatIf ?? "",
      dataInputs: v?.dataInputs ?? [],
    });

    res.json({
      challenge,
      calibration,
      feedbackRound,
      personaOutputs: personaResults,
      aggregatedOutput: {
        decision: (aggregated.decision === "DO" || aggregated.decision === "DONT_DO") ? aggregated.decision as "DO" | "DONT_DO" : (() => { throw new Error(`Invalid decision value from model: ${aggregated.decision}`); })(),
        rationale: aggregated.rationale ?? "Board analysis complete.",
        difficulty: aggregated.difficulty ?? "Med",
        cost: aggregated.cost ?? "Med",
        time: aggregated.time ?? "Med",
        risk: aggregated.risk ?? "Med",
        personaActions: aggregated.personaActions ?? {},
      },
      traditionalView: {
        sales: defaultVertical(traditional.sales),
        finance: defaultVertical(traditional.finance),
        hr: defaultVertical(traditional.hr),
        product: defaultVertical(traditional.product),
        legal: defaultVertical(traditional.legal),
        governance: defaultVertical(traditional.governance),
      },
    });
  } catch (err: unknown) {
    req.log.error({ err }, "analysis engine error");
    res.status(500).json({ error: "Analysis engine failed." });
  }
});

export default router;
