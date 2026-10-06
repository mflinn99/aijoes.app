import { describe, it, expect } from "vitest";
import { jsonArray, repairJson, assessed } from "../server/horizon.js";

// Real model answers are not always valid JSON, especially after a web search.
// These are shaped on an answer Claude gave during a live horizon scan.

const MISSING_COMMA = `\`\`\`json
[
  {
    "title": "Ofwat consults on using smart-meter data in leakage reporting",
    "url": "https://www.watermagazine.co.uk/2026/09/01/leakage/",
    "category": "legal",
    "impact": "high",
    "summary": "Ofwat is consulting on using more smart-meter data (AMP8, 2025–30)."
    "implication": "Could favour Northfield's meters.",
    "agents": ["orion", "zephyr", "solara"]
  },
  {
    "title": "Ofwat sets 2027-28 charging rules",
    "url": "https://www.watermagazine.co.uk/2026/10/02/charging/",
    "category": "legal",
    "agents": ["solara"],
  }
]
\`\`\``;

describe("reading model answers", () => {
  it("mends a missing comma and a trailing comma", () => {
    const items = jsonArray(MISSING_COMMA) as { title: string; agents: string[] }[];
    expect(items.map((i) => i.title)).toEqual(["Ofwat consults on using smart-meter data in leakage reporting", "Ofwat sets 2027-28 charging rules"]);
    expect(items[0].agents).toEqual(["orion", "zephyr", "solara"]);
  });

  it("keeps the items that parse when one is beyond repair", () => {
    const raw = `[{"title": "Good one", "url": "https://a.example/1"}, {"title": "Broken {{ one", "url": undefined}, {"title": "Another good one"}]`;
    expect((jsonArray(raw) as { title: string }[]).map((i) => i.title)).toEqual(["Good one", "Another good one"]);
  });

  it("leaves valid JSON untouched", () => {
    const valid = `[{"a": "line one", "b": [1, 2]}, {"c": null}]`;
    expect(repairJson(valid)).toBe(valid);
    expect(jsonArray(valid)).toEqual([{ a: "line one", b: [1, 2] }, { c: null }]);
  });

  it("returns nothing, not an error, when there is no array", () => {
    expect(jsonArray("Sorry, I could not find anything.")).toEqual([]);
  });
});

describe("who a signal concerns", () => {
  it("accepts agents by id, name or persona", () => {
    expect(assessed({ category: "legal", agents: ["orion", "Risk", "The Capital Allocator", "Culture & Ethics agent", "nobody"] }).agents).toEqual([
      "orion",
      "grimm",
      "solara",
      "mira",
    ]);
  });

  it("always names someone, so the chair can teach every signal", () => {
    expect(assessed({ category: "legal" }).agents).toEqual(["orion", "grimm"]);
    expect(assessed({ category: "technological", agents: [] }).agents).toEqual(["zephyr"]);
    expect(assessed({ category: "not-a-category", agents: "" }).agents.length).toBeGreaterThan(0);
  });
});
