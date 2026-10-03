import { describe, expect, it } from "vitest";
import { datePairs, withinWindow } from "../server/dates.js";
import { convert, FX_BUFFER } from "../server/money.js";
import { resolvePlace } from "../server/places.js";
import { interpretInstruction, mergeRequest } from "../server/refine.js";
import { budgetCeiling, tripRequestSchema } from "../server/schema.js";
import { interpret, profile, scoreVibe } from "../server/vibe.js";
import { PLACES } from "../server/places.js";
import { brief } from "./helpers.js";

const place = (code: string) => PLACES.find((p) => p.code === code)!;

describe("places", () => {
  it("resolves cities, aliases and airport codes; an airport narrows to that airport", () => {
    expect(resolvePlace("London")!.airports).toContain("LHR");
    expect(resolvePlace("lgw")).toMatchObject({ code: "LON", airports: ["LGW"] });
    expect(resolvePlace("MAN")).toMatchObject({ code: "MAN", airports: ["MAN"] });
    expect(resolvePlace("Majorca")!.code).toBe("PMI");
    expect(resolvePlace("Paris, France")!.code).toBe("PAR");
    expect(resolvePlace("Atlantis")).toBeNull();
  });
});

describe("vibe", () => {
  it("maps everyday words to tags and keeps what it cannot map", () => {
    const i = interpret(["chilled beach with tapas", "good street food"]);
    expect(i.tags).toEqual(expect.arrayContaining(["relax", "beach", "food"]));
    expect(i.keywords).toContain("tapas");
  });

  it("scores sun by season: Tenerife is a winter-sun answer, Mallorca is not", () => {
    const p = profile(["beach", "sunshine"], [], []);
    expect(scoreVibe(p, place("TFS"), 1).score).toBeGreaterThan(scoreVibe(p, place("PMI"), 1).score);
    expect(scoreVibe(p, place("PMI"), 7).score).toBeGreaterThanOrEqual(scoreVibe(p, place("TFS"), 7).score - 0.01);
  });

  it("penalises dislikes hard and flags them", () => {
    const party = profile(["beach"], [], ["nightlife", "party"]);
    const ibiza = scoreVibe(party, place("IBZ"), 7);
    expect(ibiza.conflicts).toEqual(expect.arrayContaining(["nightlife", "party"]));
    expect(ibiza.score).toBeLessThan(scoreVibe(party, place("CFU"), 7).score);
  });

  it("counts the hotel too: a spa answers a spa", () => {
    const p = profile(["relax"], ["spa"], []);
    expect(scoreVibe(p, place("LIS"), 5, "Retreat & Spa spa yoga").score).toBeGreaterThan(scoreVibe(p, place("LIS"), 5).score);
  });
});

describe("dates", () => {
  const d = { depart: "2027-06-10", return: "2027-06-17", flexibilityDays: 2 };

  it("starts with the requested dates and keeps every pair inside the window", () => {
    const pairs = datePairs(d, "2027-01-01");
    expect(pairs[0]).toEqual({ depart: "2027-06-10", return: "2027-06-17", nights: 7 });
    for (const p of pairs) {
      expect(withinWindow(p, d)).toBe(true);
      expect(Math.abs(p.nights - 7)).toBeLessThanOrEqual(2);
    }
  });

  it("with no flexibility searches only the dates given", () => {
    expect(datePairs({ ...d, flexibilityDays: 0 }, "2027-01-01")).toHaveLength(1);
  });

  it("never offers a departure in the past", () => {
    expect(datePairs(d, "2027-06-10").every((p) => p.depart > "2027-06-10")).toBe(true);
  });
});

describe("money", () => {
  it("converts pessimistically, and refuses currencies it has no rate for", () => {
    expect(convert(100, "GBP", "GBP")).toBe(100);
    expect(convert(117, "EUR", "GBP")).toBeCloseTo(100 * (1 + FX_BUFFER), 1);
    expect(convert(100, "XXX", "GBP")).toBeNull();
  });

  it("works out the ceiling: per person, plus flexibility", () => {
    expect(budgetCeiling(tripRequestSchema.parse(brief({ travellers: 3, budget: { amount: 500, per: "person", flexibilityPercent: 10 } })))).toBe(1650);
  });
});

describe("refine instructions", () => {
  const req = tripRequestSchema.parse(brief({ travellers: { adults: 2, children: 1 } }));

  it.each([
    ["cheaper", { budget: { amount: 2125 } }],
    ["budget £3,000", { budget: { amount: 3000, currency: "GBP" } }],
    ["up to 4k", { budget: { amount: 4000 } }],
    ["direct flights only", { preferences: { maxStops: 0 } }],
    ["no long flights", { preferences: { maxTravelHours: 5 } }],
    ["4 star", { preferences: { minHotelStars: 4 } }],
    ["3 adults and 2 kids", { travellers: { adults: 3, children: 2, infants: 0 } }],
    ["add a child", { travellers: { adults: 2, children: 2, infants: 0 } }],
    ["3 days either side", { dates: { flexibilityDays: 3 } }],
    ["fly to Lisbon", { destination: "Lisbon" }],
    ["surprise me", { destination: null }],
    ["from Manchester", { origin: "Manchester" }],
    ["business class", { preferences: { cabin: "business" } }],
  ])("understands %j", (text, expected) => {
    const { changes, understood } = interpretInstruction(text, req);
    expect(changes).toMatchObject(expected);
    expect(understood.length).toBeGreaterThan(0);
  });

  it("does not mistake hours or stars for money", () => {
    const { changes } = interpretInstruction("under 5 hours, max 4 star", req);
    expect(changes.budget).toBeUndefined();
    expect(changes.preferences).toMatchObject({ maxTravelHours: 5, minHotelStars: 4 });
  });

  it("adds to the vibe and the dislikes", () => {
    const { changes } = interpretInstruction("more culture, no crowds", req);
    expect(changes.vibe).toEqual(expect.arrayContaining(["relaxed beach", "sunshine", "culture"]));
    expect(changes.dislikes).toEqual(expect.arrayContaining(["nightlife", "crowds"]));
  });

  it("understands 'somewhere else' and nothing from noise", () => {
    expect(interpretInstruction("show me somewhere else", req).somewhereElse).toBe(true);
    expect(interpretInstruction("hmm", req).understood).toEqual([]);
  });

  it("merges nested changes and re-validates", () => {
    const merged = mergeRequest(req, { budget: { amount: 900 }, destination: "Rome" });
    expect(merged.budget).toMatchObject({ amount: 900, currency: "GBP", flexibilityPercent: 5 });
    expect(merged.destination).toBe("Rome");
    expect(() => mergeRequest(req, { travellers: { adults: 0 } })).toThrow();
    const strict = mergeRequest(req, { preferences: { minHotelStars: 4 } });
    expect(mergeRequest(strict, { preferences: { minHotelStars: null } }).preferences.minHotelStars).toBeUndefined();
  });
});
