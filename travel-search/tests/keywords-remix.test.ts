import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { interpretKeywords } from "../server/keywords.js";
import { interpretInstruction } from "../server/refine.js";
import { tripRequestSchema } from "../server/schema.js";
import { runSearch } from "../server/search.js";
import { MemoryStore, setStore } from "../server/store.js";
import { brief } from "./helpers.js";

beforeEach(() => setStore(new MemoryStore()));

type Opt = { id: string; destination: { code: string; name: string }; dates: { depart: string; return: string }; flight: { offerId: string }; stay: { name: string }; locked: string[]; price: { total: number; ceiling: number } };

async function search(body: Record<string, unknown>) {
  return request(createApp()).post("/api/searches").send(body);
}

describe("keywords: anything that informs the search", () => {
  it("reads each keyword as a place, region, theme, vibe word or free text, and says so", () => {
    const { insights, profile } = interpretKeywords(["Christmas markets", "Greece", "Lisbon-ish", "foodie", "rooftop pool"], 12);
    expect(insights.map((i) => i.kind)).toEqual(["theme", "region", "place", "vibe", "text"]);
    expect(profile.boosts.PRG?.keyword).toBe("Christmas markets");
    expect(profile.boosts.JTR?.keyword).toBe("Greece");
    expect(profile.boosts.LIS?.weight).toBeGreaterThan(1);
    expect(profile.tags).toContain("food");
    expect(profile.text).toContain("rooftop pool");
  });

  it("knows when a theme is out of season and only lets it nudge", () => {
    const { insights, profile } = interpretKeywords(["northern lights"], 7);
    expect(insights[0]!.effect).toMatch(/out of season/);
    expect(profile.boosts.REK!.weight).toBeLessThan(1);
  });

  it("can drive a search on its own, with no vibe", async () => {
    const res = await search(brief({ vibe: [], likes: [], dislikes: [], keywords: "honeymoon, Maldives", budget: { amount: 9000, currency: "GBP" } }));
    expect(res.status).toBe(201);
    expect(res.body.keywords.map((k: { kind: string }) => k.kind)).toEqual(["theme", "place"]);
    expect(res.body.options[0].destination.code).toBe("MLE");
    expect(res.body.options[0].match.reasons[0]).toMatch(/Matches your keyword/);
  });

  it("steers but never constrains: a named place is favoured, others still offered", async () => {
    const res = await search(brief({ keywords: ["Corfu"] }));
    const codes = res.body.options.map((o: Opt) => o.destination.code);
    expect(codes[0]).toBe("CFU");
    expect(new Set(codes).size).toBe(3);
  });

  it("needs a vibe or keywords", async () => {
    const res = await search(brief({ vibe: [], keywords: [] }));
    expect(res.status).toBe(400);
    expect(res.body.issues[0].message).toMatch(/vibe.*or give some keywords/);
  });

  it("can be added during refinement", () => {
    const req = tripRequestSchema.parse(brief({ keywords: ["tapas"] }));
    const { changes, understood } = interpretInstruction("keywords: castles and beer", req);
    expect(changes.keywords).toEqual(["tapas", "castles", "beer"]);
    expect(understood[0]).toMatch(/keywords \+ castles, beer/);
  });

  it("appear on the printed brief", async () => {
    const res = await search(brief({ keywords: ["rooftop bar"] }));
    const html = await request(createApp()).get(`/api/searches/${res.body.id}/print?format=text`).expect(200);
    expect(html.text).toContain("Keywords: rooftop bar");
  });
});

describe("lock an element and remix the rest", () => {
  async function start(overrides: Record<string, unknown> = {}) {
    const res = await search(brief(overrides));
    expect(res.status).toBe(201);
    return res.body as { id: string; options: Opt[]; actions: { remixOption: { href: string } } };
  }
  const remix = (id: string, optionId: string, lock: unknown) => request(createApp()).post(`/api/searches/${id}/options/${optionId}/remix`).send({ lock });

  it("advertises the remix action", async () => {
    const s = await start();
    expect(s.actions.remixOption.href).toBe(`/api/searches/${s.id}/options/{optionId}/remix`);
  });

  it("lock the destination: three new trips there, each changing the flight and stay", async () => {
    const s = await start();
    const from = s.options[0]!;
    const res = await remix(s.id, from.id, ["destination"]).expect(200);
    expect(res.body.version).toBe(2);
    expect(res.body.change).toMatchObject({ kind: "remix", remixOf: from.id, locked: ["destination"] });
    expect(res.body.remix).toEqual({ from: from.id, locked: ["destination"], remixed: ["dates", "flight", "stay"] });
    expect(res.body.options).toHaveLength(3);
    for (const o of res.body.options as Opt[]) {
      expect(o.destination.code).toBe(from.destination.code);
      expect(o.id).not.toBe(from.id);
      expect(o.locked).toEqual(["destination"]);
      expect(o.flight.offerId !== from.flight.offerId || o.stay.name !== from.stay.name).toBe(true);
    }
    expect(res.body.notes[0]).toMatch(/^Remixed .+: kept the destination; new dates, flight, stay\.$/);
  });

  it("lock the flight: same flight, dates and destination; new stays", async () => {
    const s = await start({ budget: { amount: 8000, currency: "GBP" } });
    const from = s.options[0]!;
    const res = await remix(s.id, from.id, ["flight"]).expect(200);
    expect(res.body.remix.locked).toEqual(expect.arrayContaining(["flight", "destination", "dates"]));
    expect(res.body.options.length).toBeGreaterThan(0);
    for (const o of res.body.options as Opt[]) {
      expect(o.flight.offerId).toBe(from.flight.offerId);
      expect(o.dates).toMatchObject({ depart: from.dates.depart, return: from.dates.return });
      expect(o.stay.name).not.toBe(from.stay.name);
    }
  });

  it("lock the stay: same hotel and dates; new flights", async () => {
    const s = await start({ budget: { amount: 8000, currency: "GBP" } });
    const from = s.options[0]!;
    const res = await remix(s.id, from.id, ["stay"]).expect(200);
    expect(res.body.options.length).toBeGreaterThan(0);
    for (const o of res.body.options as Opt[]) {
      expect(o.stay.name).toBe(from.stay.name);
      expect(o.flight.offerId).not.toBe(from.flight.offerId);
    }
  });

  it("lock the dates on an open search: three different places on those exact dates", async () => {
    const s = await start();
    const from = s.options[0]!;
    const res = await remix(s.id, from.id, ["dates"]).expect(200);
    const opts = res.body.options as Opt[];
    expect(opts).toHaveLength(3);
    for (const o of opts) {
      expect(o.dates).toMatchObject({ depart: from.dates.depart, return: from.dates.return });
      expect(o.destination.code).not.toBe(from.destination.code);
    }
    expect(new Set(opts.map((o) => o.destination.code)).size).toBe(3);
  });

  it("says plainly when nothing else fits with what is locked", async () => {
    const first = await runSearch(tripRequestSchema.parse(brief({ budget: { amount: 900, currency: "GBP" } })));
    const cheapest = [...first.options].sort((a, b) => a.price.total - b.price.total)[0]!;
    const r = await runSearch(tripRequestSchema.parse(brief({ budget: { amount: cheapest.price.total, currency: "GBP" } })), { locks: { from: cheapest, elements: ["flight"] }, rejectIds: [cheapest.id] });
    for (const o of r.options) expect(o.price.total).toBeLessThanOrEqual(cheapest.price.total);
    if (r.options.length < 3) expect(r.notes.join(" ")).toMatch(/With the flight, destination, dates locked/);
  });

  it("remixes still obey the budget", async () => {
    const s = await start({ budget: { amount: 1500, currency: "GBP" } });
    const res = await remix(s.id, s.options[0]!.id, ["destination"]).expect(200);
    for (const o of res.body.options as Opt[]) expect(o.price.total).toBeLessThanOrEqual(1500);
  });

  it("can be chained, and every remix is a version", async () => {
    const s = await start();
    const r1 = await remix(s.id, s.options[0]!.id, ["destination"]).expect(200);
    const r2 = await remix(s.id, r1.body.options[0].id, ["flight"]).expect(200);
    expect(r2.body.version).toBe(3);
    expect(r2.body.history.map((h: { kind: string }) => h.kind)).toEqual(["initial", "remix", "remix"]);
  });

  it("refuses a lock with nothing left to remix, an unknown element, or an option not on screen", async () => {
    const s = await start();
    const id = s.options[0]!.id;
    expect((await remix(s.id, id, ["flight", "stay"])).status).toBe(422);
    expect((await remix(s.id, id, ["weather"])).status).toBe(400);
    expect((await remix(s.id, id, [])).status).toBe(400);
    expect((await remix(s.id, "nope", ["destination"])).status).toBe(422);
  });

  it("a locked stay that no longer sleeps the party is not quietly swapped for an estimate", async () => {
    const req = tripRequestSchema.parse(brief());
    const first = await runSearch(req);
    const from = first.options[0]!;
    const bigger = tripRequestSchema.parse(brief({ travellers: 5 }));
    const r = await runSearch(bigger, { locks: { from, elements: ["stay"] } });
    expect(r.options).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/no longer sleeps your party/);
  });

  it("a locked flight goes back through the non-negotiable checks", async () => {
    const first = await runSearch(tripRequestSchema.parse(brief()));
    const from = first.options[0]!;
    const r = await runSearch(tripRequestSchema.parse(brief({ travellers: 3 })), { locks: { from, elements: ["flight"] } });
    expect(r.options).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/locked flight no longer meets your requirements/);
  });
});
