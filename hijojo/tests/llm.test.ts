// The Claude client on each platform, against a fake SDK client that records
// the exact request. No API is called.

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { AnthropicLlm, LlmRefused, llmFromEnv } from "../server/llm/client";

function fakeClient(reply: any | ((params: any) => any)) {
  const calls: { path: "messages" | "beta"; params: any }[] = [];
  const respond = (path: "messages" | "beta") => async (params: any) => {
    calls.push({ path, params });
    return typeof reply === "function" ? reply(params) : reply;
  };
  return { calls, client: { messages: { create: respond("messages") }, beta: { messages: { create: respond("beta") } } } as any };
}

const json = (obj: unknown) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] });
const schema = z.object({ answer: z.string() });

describe("Claude client", () => {
  it("on the Claude API, asks for server-side fallbacks and the newest web search", async () => {
    const f = fakeClient(json({ answer: "ok" }));
    const llm = new AnthropicLlm({ client: f.client, platform: "anthropic", model: "claude-opus-5-5" });
    expect(await llm.run({ task: "t", system: "s", prompt: "p", schema })).toEqual({ answer: "ok" });
    expect(f.calls[0].path).toBe("beta");
    expect(f.calls[0].params).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(f.calls[0].params.output_config.format).toBeDefined();

    const s = fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "done" }] });
    await new AnthropicLlm({ client: s.client, platform: "anthropic" }).webSearch({ task: "w", system: "s", prompt: "p", maxUses: 3 });
    expect(s.calls[0].params.tools[0].type).toBe("web_search_20260209");
  });

  it("on Microsoft Foundry, sends no fallbacks or beta headers and uses the basic web search", async () => {
    const f = fakeClient(json({ answer: "ok" }));
    const llm = new AnthropicLlm({ client: f.client, platform: "foundry", model: "claude-opus-5-5" });
    await llm.run({ task: "t", system: "s", prompt: "p", schema });
    expect(f.calls[0].path).toBe("messages");
    expect(f.calls[0].params.fallbacks).toBeUndefined();
    expect(f.calls[0].params.betas).toBeUndefined();
    expect(f.calls[0].params.output_config.format).toBeDefined();

    const s = fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "done" }] });
    await new AnthropicLlm({ client: s.client, platform: "foundry" }).webSearch({ task: "w", system: "s", prompt: "p", maxUses: 3 });
    expect(s.calls[0].params.tools[0]).toEqual({ type: "web_search_20250305", name: "web_search", max_uses: 3 });
  });

  it("collects only URLs the search tool actually returned, across a paused turn", async () => {
    let n = 0;
    const f = fakeClient(() =>
      n++ === 0
        ? { stop_reason: "pause_turn", content: [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.test/x", title: "A" }] }] }
        : { stop_reason: "end_turn", content: [{ type: "text", text: "see https://made-up.test" }] },
    );
    const r = await new AnthropicLlm({ client: f.client, platform: "foundry" }).webSearch({ task: "w", system: "s", prompt: "p", maxUses: 3 });
    expect(r.urls).toEqual([{ url: "https://a.test/x", title: "A" }]);
    expect(f.calls).toHaveLength(2);
  });

  it("raises on a refusal or a truncated answer rather than inventing output", async () => {
    const refused = fakeClient({ stop_reason: "refusal", content: [] });
    await expect(new AnthropicLlm({ client: refused.client, platform: "foundry" }).run({ task: "t", system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(LlmRefused);
    const cut = fakeClient({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"ans' }] });
    await expect(new AnthropicLlm({ client: cut.client, platform: "foundry" }).run({ task: "t", system: "s", prompt: "p", schema })).rejects.toThrow(/truncated/);
  });

  it("chooses the provider from the environment and says what is missing", () => {
    expect(llmFromEnv({ HIJOJO_AI_PROVIDER: "foundry", ANTHROPIC_FOUNDRY_RESOURCE: "aigogo-foundry" }).status).toMatchObject({ configured: true, detail: expect.stringMatching(/Foundry.*aigogo-foundry/) });
    expect(llmFromEnv({ HIJOJO_AI_PROVIDER: "foundry" }).status).toMatchObject({ configured: false, detail: expect.stringMatching(/ANTHROPIC_FOUNDRY_RESOURCE/) });
    expect(llmFromEnv({ ANTHROPIC_FOUNDRY_RESOURCE: "r" }).llm.name).toMatch(/^foundry:/);
    expect(llmFromEnv({ ANTHROPIC_API_KEY: "k" }).llm.name).toMatch(/^anthropic:/);
    expect(llmFromEnv({}).status.configured).toBe(false);
  });
});
