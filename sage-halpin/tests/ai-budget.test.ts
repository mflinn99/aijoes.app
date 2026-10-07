import { describe, it, expect, afterEach } from "vitest";
import { AIBudgetError, resetAIBudget, spendAICall } from "../server/ai.js";

// The daily ceiling on model calls per server.

describe("AI call budget", () => {
  const saved = process.env.AI_DAILY_CALL_LIMIT;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_DAILY_CALL_LIMIT;
    else process.env.AI_DAILY_CALL_LIMIT = saved;
    resetAIBudget();
  });

  it("refuses calls past the day's limit and starts again the next day", () => {
    process.env.AI_DAILY_CALL_LIMIT = "3";
    resetAIBudget();
    const day = new Date("2026-10-07T10:00:00Z");
    for (let i = 0; i < 3; i++) spendAICall(day);
    expect(() => spendAICall(day)).toThrow(AIBudgetError);
    expect(() => spendAICall(new Date("2026-10-08T00:00:01Z"))).not.toThrow();
  });
});
