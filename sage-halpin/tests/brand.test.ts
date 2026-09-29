import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { generateAlerts } from "../src/lib/store.js";
import { PERSONAS, ANALYSIS_PERSONAS } from "../server/personas/boardroom-personas.js";

describe("brand", () => {
  it("ships no Sixonic branding or roster wording", () => {
    expect(() => execFileSync("node", ["scripts/check-brand.mjs"], { stdio: "pipe" })).not.toThrow();
  });

  it("names every agent by role, never as a character or a person", () => {
    const names = [...Object.values(PERSONAS).map((p) => p.name), ...ANALYSIS_PERSONAS.map((p) => p.name)];
    for (const name of names) expect(name).toMatch(/ agent$/);
    const prompts = [...Object.values(PERSONAS), ...ANALYSIS_PERSONAS].map((p) => p.system).join("\n");
    expect(prompts).not.toMatch(/Orion|Grimm|Solara|Zephyr|Mira|Aquila|Dr White|Cmdr Black|Ms Gold|Dr Green|Lt Red|Col Blue/);
    expect(prompts).toMatch(/AI agent/);
  });

  it("labels alerts by perspective", () => {
    const alerts = generateAlerts({ cashRunway: 3, revenue: 100, revenuePrev: 120, churnRate: 12, pipelineCoverage: 1, burnMultiple: 3, updatedAt: "" });
    expect(new Set(alerts.map((a) => a.persona))).toEqual(new Set(["RISK", "GOVERNANCE", "COMMERCIAL"]));
  });
});
