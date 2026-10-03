import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { MemoryStore, setStore } from "../server/store.js";
import { brief, future } from "./helpers.js";

const LONDON = ["LHR", "LGW", "STN", "LTN", "LCY", "SEN"];

beforeEach(() => setStore(new MemoryStore()));

async function search(body: Record<string, unknown> = brief()) {
  const res = await request(createApp()).post("/api/searches").send(body);
  return res;
}

describe("health", () => {
  it("reports liveness and the configured providers", async () => {
    await request(createApp()).get("/api/healthz").expect(200, { status: "ok" });
    const ready = await request(createApp()).get("/api/readyz").expect(200);
    expect(ready.body.providers).toEqual([{ name: "mock", live: false, flights: true, stays: true, anywhere: false }]);
  });

  it("returns JSON 404 for unknown routes and sends security headers", async () => {
    const res = await request(createApp()).get("/api/nope").expect(404, { error: "Not found" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("POST /api/searches: inputs", () => {
  it("rejects a request missing the non-negotiables, naming each field", async () => {
    const res = await search({ vibe: "beach" });
    expect(res.status).toBe(400);
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["travellers", "dates", "origin", "budget"]));
  });

  it("rejects a return before departure and an empty vibe", async () => {
    const res = await search(brief({ dates: { depart: future(20), return: future(10) }, vibe: "" }));
    expect(res.status).toBe(400);
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["dates.return", "vibe"]));
  });

  it("will not guess a starting point it does not recognise", async () => {
    const res = await search(brief({ origin: "Lodnon Gatwik" }));
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("origin");
  });

  it("offers suggestions for a near miss", async () => {
    const res = await search(brief({ origin: "Manch" }));
    expect(res.status).toBe(422);
    expect(res.body.suggestions).toContain("Manchester");
  });

  it("refuses dates in the past", async () => {
    const res = await search(brief({ dates: { depart: future(-10), return: future(-3) } }));
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("dates.depart");
  });

  it("accepts travellers as a number or a breakdown, and infants need an adult", async () => {
    expect((await search(brief({ travellers: { adults: 2, children: 2 } }))).status).toBe(201);
    expect((await search(brief({ travellers: { adults: 1, infants: 2 } }))).status).toBe(400);
  });
});

describe("POST /api/searches: three options", () => {
  it("returns three labelled options with summaries and the save and print actions", async () => {
    const res = await search();
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/searches/${res.body.id}`);
    expect(res.body.options).toHaveLength(3);
    for (const o of res.body.options) {
      expect(o.label).toMatch(/Best match|Best value|Something different|Upgrade/);
      expect(o.summary).toContain(o.destination.name);
      expect(o.flight.outbound.from).toBeTruthy();
      expect(o.stay.name).toBeTruthy();
    }
    expect(res.body.actions.save).toEqual({ method: "POST", href: `/api/searches/${res.body.id}/save`, body: { version: 1 } });
    expect(res.body.actions.print.href).toBe(`/api/searches/${res.body.id}/print?version=1`);
    expect(res.body.actions.refine.href).toBe(`/api/searches/${res.body.id}/refine`);
  });

  it("holds every non-negotiable: start point, travellers, budget, dates", async () => {
    const body = brief({ travellers: { adults: 2, children: 1 }, budget: { amount: 3000, currency: "GBP", flexibilityPercent: 10 } });
    const res = await search(body);
    expect(res.body.options.length).toBeGreaterThan(0);
    for (const o of res.body.options) {
      expect(LONDON).toContain(o.flight.outbound.from);
      expect(LONDON).toContain(o.flight.inbound.to);
      expect(o.price.travellers).toBe(3);
      expect(o.stay.sleeps).toBeGreaterThanOrEqual(3);
      expect(o.price.total).toBeLessThanOrEqual(3300);
      expect(o.price.total).toBeCloseTo(o.price.flights + o.price.stay, 1);
      expect(o.dates.depart >= future(38) && o.dates.depart <= future(42)).toBe(true);
      expect(o.dates.return >= future(45) && o.dates.return <= future(49)).toBe(true);
    }
  });

  it("only flies from the airport given when the start point is a specific airport", async () => {
    const res = await search(brief({ origin: "LGW" }));
    expect(res.body.resolved.origin.airports).toEqual(["LGW"]);
    for (const o of res.body.options) {
      expect(o.flight.outbound.from).toBe("LGW");
      expect(o.flight.inbound.to).toBe("LGW");
    }
  });

  it("with no destination, offers three different places", async () => {
    const res = await search();
    const places = res.body.options.map((o: { destination: { code: string } }) => o.destination.code);
    expect(new Set(places).size).toBe(3);
    expect(places).not.toContain("LON");
  });

  it("with a destination, every option goes there, with different stays", async () => {
    const res = await search(brief({ destination: "Tenerife" }));
    expect(res.body.resolved.destination.code).toBe("TFS");
    expect(res.body.options).toHaveLength(3);
    for (const o of res.body.options) expect(o.destination.code).toBe("TFS");
    const shapes = res.body.options.map((o: { stay: { name: string }; flight: { offerId: string }; dates: { depart: string } }) => `${o.stay.name}|${o.flight.offerId}|${o.dates.depart}`);
    expect(new Set(shapes).size).toBe(3);
    expect(new Set(res.body.options.map((o: { stay: { name: string } }) => o.stay.name)).size).toBeGreaterThanOrEqual(2);
  });

  it("matches the vibe: a ski brief in the season finds mountains", async () => {
    const year = new Date().getUTCFullYear() + 1;
    const res = await search(brief({ vibe: ["skiing", "mountains"], likes: [], dislikes: [], dates: { depart: `${year}-01-17`, return: `${year}-01-24` }, budget: { amount: 4000, currency: "GBP" } }));
    expect(res.status).toBe(201);
    expect(["GVA", "INN"]).toContain(res.body.options[0].destination.code);
  });

  it("returns fewer than three, and says why, rather than break the budget", async () => {
    const res = await search(brief({ budget: { amount: 700, currency: "GBP" } }));
    expect(res.status).toBe(201);
    expect(res.body.options.length).toBeLessThan(3);
    for (const o of res.body.options) expect(o.price.total).toBeLessThanOrEqual(700);
    expect(res.body.notes.join(" ")).toMatch(/budget of £700/);
    expect(res.body.notes.join(" ")).toMatch(/cheapest trip over it was/);
  });

  it("says when even the flights alone are over budget", async () => {
    const res = await search(brief({ budget: { amount: 60, currency: "GBP" } }));
    expect(res.body.options).toEqual([]);
    expect(res.body.notes.join(" ")).toMatch(/cheapest flights alone were/);
  });

  it("prices a per-person budget for the whole party", async () => {
    const res = await search(brief({ travellers: 4, budget: { amount: 600, currency: "GBP", per: "person" } }));
    for (const o of res.body.options) {
      expect(o.price.ceiling).toBe(2400);
      expect(o.price.total).toBeLessThanOrEqual(2400);
    }
  });

  it("quotes in the traveller's currency", async () => {
    const res = await search(brief({ budget: { amount: 3000, currency: "EUR" } }));
    expect(res.body.options.length).toBeGreaterThan(0);
    for (const o of res.body.options) {
      expect(o.price.currency).toBe("EUR");
      expect(o.summary).toContain("€");
    }
  });
});

describe("refine, as many times as needed", () => {
  it("applies a plain-English instruction and records what it understood", async () => {
    const first = await search();
    const res = await request(createApp()).post(`/api/searches/${first.body.id}/refine`).send({ instruction: "cheaper, direct flights only" }).expect(200);
    expect(res.body.version).toBe(2);
    expect(res.body.change.understood).toEqual(expect.arrayContaining(["direct flights only"]));
    expect(res.body.request.budget.amount).toBe(2125);
    expect(res.body.request.preferences.maxStops).toBe(0);
    for (const o of res.body.options) {
      expect(o.flight.outbound.stops).toBe(0);
      expect(o.flight.inbound.stops).toBe(0);
      expect(o.price.total).toBeLessThanOrEqual(2125 * 1.05 + 0.01);
    }
  });

  it("applies structured changes, nested fields merged", async () => {
    const first = await search();
    const res = await request(createApp())
      .post(`/api/searches/${first.body.id}/refine`)
      .send({ changes: { travellers: { adults: 3 }, budget: { amount: 4000 } } })
      .expect(200);
    expect(res.body.request.travellers).toEqual({ adults: 3, children: 0, infants: 0 });
    expect(res.body.request.budget).toMatchObject({ amount: 4000, currency: "GBP", flexibilityPercent: 5 });
    for (const o of res.body.options) expect(o.price.travellers).toBe(3);
  });

  it("swaps out one option, keeps the other two and rules out its destination", async () => {
    const first = await search();
    const [a, b, c] = first.body.options;
    const res = await request(createApp()).post(`/api/searches/${first.body.id}/options/${b.id}/replace`).expect(200);
    const ids = res.body.options.map((o: { id: string }) => o.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(c.id);
    expect(ids).not.toContain(b.id);
    expect(res.body.options).toHaveLength(3);
    expect(res.body.options.map((o: { destination: { code: string } }) => o.destination.code)).not.toContain(b.destination.code);
    expect(res.body.request.excludeDestinations).toContain(b.destination.code);
    expect(res.body.change.replaced).toEqual([b.id]);
  });

  it("'somewhere else' gives three new destinations", async () => {
    const first = await search();
    const before = first.body.options.map((o: { destination: { code: string } }) => o.destination.code);
    const res = await request(createApp()).post(`/api/searches/${first.body.id}/refine`).send({ instruction: "somewhere else" }).expect(200);
    for (const o of res.body.options) expect(before).not.toContain(o.destination.code);
  });

  it("keeps a chosen option across a change only while it still meets the non-negotiables", async () => {
    const first = await search();
    const keep = first.body.options[0];
    const ok = await request(createApp()).post(`/api/searches/${first.body.id}/refine`).send({ keep: [keep.id], instruction: "more food" }).expect(200);
    expect(ok.body.options.map((o: { id: string }) => o.id)).toContain(keep.id);

    const bigger = await request(createApp()).post(`/api/searches/${first.body.id}/refine`).send({ keep: [ok.body.options[0].id], changes: { travellers: 4 } }).expect(200);
    expect(bigger.body.options.map((o: { id: string }) => o.id)).not.toContain(keep.id);
    expect(bigger.body.notes.join(" ")).toMatch(/could not be kept: it was priced for a different number of travellers/);
  });

  it("keeps every version and can show any of them", async () => {
    const first = await search();
    const id = first.body.id;
    await request(createApp()).post(`/api/searches/${id}/refine`).send({ instruction: "add a child" }).expect(200);
    await request(createApp()).post(`/api/searches/${id}/refine`).send({ instruction: "5 star" }).expect(200);
    const history = await request(createApp()).get(`/api/searches/${id}/versions`).expect(200);
    expect(history.body.map((h: { version: number }) => h.version)).toEqual([1, 2, 3]);
    const v1 = await request(createApp()).get(`/api/searches/${id}?version=1`).expect(200);
    expect(v1.body.options.map((o: { id: string }) => o.id)).toEqual(first.body.options.map((o: { id: string }) => o.id));
    expect(v1.body.latestVersion).toBe(3);
    await request(createApp()).get(`/api/searches/${id}?version=9`).expect(404);
  });

  it("says so when it cannot understand an instruction", async () => {
    const first = await search();
    const res = await request(createApp()).post(`/api/searches/${first.body.id}/refine`).send({ instruction: "hmm" }).expect(422);
    expect(res.body.error).toMatch(/couldn't work out/);
  });

  it("rejects option ids that are not in the current results, and unknown searches", async () => {
    const first = await search();
    await request(createApp()).post(`/api/searches/${first.body.id}/refine`).send({ replace: ["nope"] }).expect(422);
    await request(createApp()).post(`/api/searches/doesnotexist/refine`).send({ instruction: "cheaper" }).expect(404);
  });
});

describe("save and print, always available", () => {
  it("saves a version as an immutable trip that can be reopened and printed", async () => {
    const first = await search();
    const id = first.body.id;
    const saved = await request(createApp()).post(`/api/searches/${id}/save`).send({ name: "Winter sun" }).expect(201);
    expect(saved.body.name).toBe("Winter sun");
    expect(saved.body.options).toHaveLength(3);
    expect(saved.body.from).toEqual({ search: id, version: 1 });

    // Refining afterwards does not change what was saved.
    await request(createApp()).post(`/api/searches/${id}/refine`).send({ instruction: "somewhere else" }).expect(200);
    const again = await request(createApp()).get(`/api/saved/${saved.body.id}`).expect(200);
    expect(again.body.options.map((o: { id: string }) => o.id)).toEqual(first.body.options.map((o: { id: string }) => o.id));

    const html = await request(createApp()).get(saved.body.actions.print.href).expect(200);
    expect(html.headers["content-type"]).toMatch(/text\/html/);
    expect(html.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(html.text).toContain("<title>Winter sun</title>");
    expect(html.text).toContain("@page");
    expect(html.text).not.toContain("<script");
    for (const o of first.body.options) expect(html.text).toContain(o.destination.name);

    const text = await request(createApp()).get(saved.body.actions.print.text).expect(200);
    expect(text.headers["content-type"]).toMatch(/text\/plain/);
    expect(text.text).toMatch(/^Winter sun\n==========/);
  });

  it("saves just the options chosen, from any version", async () => {
    const first = await search();
    const pick = first.body.options[1].id;
    await request(createApp()).post(`/api/searches/${first.body.id}/refine`).send({ instruction: "cheaper" }).expect(200);
    const saved = await request(createApp()).post(`/api/searches/${first.body.id}/save`).send({ version: 1, optionIds: [pick] }).expect(201);
    expect(saved.body.options.map((o: { id: string }) => o.id)).toEqual([pick]);
    expect(saved.body.name).toMatch(/^London to /);
    await request(createApp()).post(`/api/searches/${first.body.id}/save`).send({ optionIds: ["nope"] }).expect(422);
  });

  it("prints any version of a search, and offers a download", async () => {
    const first = await search();
    const res = await request(createApp()).get(`/api/searches/${first.body.id}/print?version=1&download=1`).expect(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename=".+\.html"/);
    expect(res.text).toContain("Trip options from London");
  });

  it("escapes everything a traveller typed", async () => {
    const first = await search(brief({ vibe: ["beach", "<script>alert(1)</script>"] }));
    const saved = await request(createApp()).post(`/api/searches/${first.body.id}/save`).send({ name: "<img src=x onerror=alert(1)>" }).expect(201);
    const html = await request(createApp()).get(`/api/saved/${saved.body.id}/print`).expect(200);
    expect(html.text).not.toContain("<script>alert(1)");
    expect(html.text).not.toContain("<img src=x");
    expect(html.text).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("404s for an unknown saved trip", async () => {
    await request(createApp()).get("/api/saved/nope").expect(404);
    await request(createApp()).get("/api/saved/nope/print").expect(404);
  });
});
