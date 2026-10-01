import Anthropic from "@anthropic-ai/sdk";
import { AnthropicFoundry } from "@anthropic-ai/foundry-sdk";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { mockCompletion } from "./ai-mock.js";

// One place that talks to the model. Production runs Claude on Microsoft
// Foundry; local development can use the Claude API directly; tests and
// offline demos use a deterministic mock, which is refused in production.

export type Provider = "foundry" | "anthropic" | "mock";

export type Effort = "low" | "medium" | "high";

/** Which call is being made. The mock uses it to shape its reply. */
export type Purpose =
  | "chat"
  | "chat-chair"
  | "analysis-persona"
  | "analysis-aggregate"
  | "analysis-functions"
  | "questionnaire"
  | "shadow"
  | "shadow-chair"
  | "synthesis-people"
  | "synthesis-mixed";

export interface CompletionRequest {
  purpose: Purpose;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  effort: Effort;
}

export class AIRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`Model declined the request${category ? ` (${category})` : ""}`);
  }
}

export class AIConfigError extends Error {}

const DEFAULT_MODEL = "claude-opus-5-5";
const FOUNDRY_SCOPE = "https://ai.azure.com/.default";

export function aiProvider(): Provider {
  const raw = (process.env.AI_PROVIDER ?? "foundry").toLowerCase();
  if (raw !== "foundry" && raw !== "anthropic" && raw !== "mock") {
    throw new AIConfigError(`AI_PROVIDER must be foundry, anthropic or mock (got "${raw}")`);
  }
  return raw;
}

export function aiModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

/** Throws AIConfigError describing what is missing, so startup can fail fast. */
export function assertAIConfigured(): void {
  const provider = aiProvider();
  if (provider === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new AIConfigError("AI_PROVIDER=mock is not allowed in production");
    }
    return;
  }
  if (provider === "foundry") {
    if (!process.env.ANTHROPIC_FOUNDRY_RESOURCE && !process.env.ANTHROPIC_FOUNDRY_BASE_URL) {
      throw new AIConfigError("Set ANTHROPIC_FOUNDRY_RESOURCE (or ANTHROPIC_FOUNDRY_BASE_URL) for Claude on Microsoft Foundry");
    }
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AIConfigError("Set ANTHROPIC_API_KEY for AI_PROVIDER=anthropic");
  }
}

// Both clients expose the same Messages API; Foundry omits only batches.
type MessagesClient = { messages: Pick<Anthropic["messages"], "create"> };

let client: MessagesClient | null = null;

function getClient(): MessagesClient {
  if (client) return client;
  if (aiProvider() === "foundry") {
    // Prefer Microsoft Entra ID (the Container App's managed identity) and
    // fall back to a key only when one is configured.
    client = process.env.ANTHROPIC_FOUNDRY_API_KEY
      ? new AnthropicFoundry()
      : new AnthropicFoundry({
          azureADTokenProvider: getBearerTokenProvider(new DefaultAzureCredential(), FOUNDRY_SCOPE),
        });
  } else {
    client = new Anthropic();
  }
  return client;
}

/**
 * Anthropic requires the conversation to open with a user turn and every turn
 * to carry text, so trim anything that would be rejected.
 */
function normaliseMessages(messages: CompletionRequest["messages"]): CompletionRequest["messages"] {
  const nonEmpty = messages.filter((m) => m.content.trim().length > 0);
  const firstUser = nonEmpty.findIndex((m) => m.role === "user");
  return firstUser === -1 ? [] : nonEmpty.slice(firstUser);
}

export async function complete(req: CompletionRequest): Promise<string> {
  if (aiProvider() === "mock") return mockCompletion(req);

  const response = await getClient().messages.create({
    model: aiModel(),
    max_tokens: req.maxTokens,
    system: req.system,
    messages: normaliseMessages(req.messages),
    output_config: { effort: req.effort },
  });

  if (response.stop_reason === "refusal") {
    throw new AIRefusalError(response.stop_details?.category ?? null);
  }

  return response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}
