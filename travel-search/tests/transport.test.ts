import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { estimateDrive } from "../server/providers/drive.js";
import { createMock } from "../server/providers/mock.js";
import { mapKiwiResults } from "../server/providers/kiwi.js";
import type { Provider, TransportOffer, TransportQuery } from "../server/providers/types.js";
import { interpretInstruction } from "../server/refine.js";
import { tripRequestSchema } from "../server/schema.js";
import { runSearch } from "../server/search.js";
import { MemoryStore, setStore } from "../server/store.js";
import { brief } from "./helpers.js";

beforeEach(() => setStore(new MemoryStore()));

const LONDON_HUBS = ["LHR", "LGW", "STN", "LTN", "LCY", "SEN", "London St Pancras International", "London King's Cross", "London Euston", "London Paddington", "London Victoria Coach Station", "LON"];

type Opt = { transport: { mode: string; outbound: { from: string; mode: string; modes: string[] }; inbound: { to: string }; co2KgPerPerson?: number; vehicles?: number }; summary: string; match: { reasons: string[]; watchOuts: string[] }; price: { total: number } };

const Q: TransportQuery = {
  originCode: "LON",
  originAirports: ["LHR", "LGW"],
  originHubs: LONDON_HUBS,
  destinationCode: "PAR",
  depart: "2027-05-10",
  return: "2027-05-14",
  travellers: { adults: 2, children: 3, infants: 0 },
  cabin: "economy",
  currency: "GBP",
  modes: ["flight", "train", "coach", "ferry", "car"],
};

describe("any way of travelling", () => {
  it("offers flights, trains, coaches and driving to a nearby city, each from a London hub", async () => {
    const res = await request(createApp()).post("/api/searches").send(brief({ destination: "Paris", vibe: "city", dislikes: [], budget: { amount: 3000, currency: "GBP" } })).expect(201);
    const modes = new Set(res.body.options.map((o: Opt) => o.transport.mode));
    expect(modes.size).toBeGreaterThanOrEqual(2);
    for (const o of res.body.options as Opt[]) {
      expect(LONDON_HUBS).toContain(o.transport.outbound.from);
      expect(LONDON_HUBS).toContain(o.transport.inbound.to);
      expect(o.transport.co2KgPerPerson).toBeGreaterThan(0);
    }
  });

  it("respects the modes the traveller allows", async () => {
    for (const mode of ["train", "coach", "car"]) {
      const res = await request(createApp())
        .post("/api/searches")
        .send(brief({ destination: "Paris", vibe: "city", dislikes: [], preferences: { modes: [mode] }, budget: { amount: 3000, currency: "GBP" } }))
        .expect(201);
      expect(res.body.options.length).toBeGreaterThan(0);
      for (const o of res.body.options as Opt[]) expect(o.transport.mode).toBe(mode);
    }
  });

  it("goes by sea where a ferry runs", async () => {
    const r = await runSearch(tripRequestSchema.parse(brief({ origin: "Barcelona", destination: "Mallorca", preferences: { modes: ["ferry"] } })));
    expect(r.options.length).toBeGreaterThan(0);
    for (const o of r.options) {
      expect(o.transport.mode).toBe("ferry");
      expect(o.transport.outbound.from).toBe("Port de Barcelona");
      expect(o.summary).toMatch(/By ferry/);
    }
  });

  it("only flies from a named airport: no trains from Gatwick", async () => {
    const r = await runSearch(tripRequestSchema.parse(brief({ origin: "LGW", destination: "Paris", vibe: "city" })));
    for (const o of r.options) {
      expect(o.transport.mode).toBe("flight");
      expect(o.transport.outbound.from).toBe("LGW");
    }
  });

  it("never drives or takes the train to an island or across an ocean", async () => {
    const r = await runSearch(tripRequestSchema.parse(brief({ destination: "Tenerife", preferences: { modes: ["train", "coach", "car"] } })));
    expect(r.options).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/No train or coach or car was found/);
  });

  it("'flight-free' in the brief rules flights out and says so", async () => {
    const res = await request(createApp()).post("/api/searches").send(brief({ vibe: "city, food", dislikes: [], keywords: ["flight-free"] })).expect(201);
    expect(res.body.options.length).toBeGreaterThan(0);
    for (const o of res.body.options as Opt[]) expect(o.transport.mode).not.toBe("flight");
    expect(res.body.keywords[0]).toMatchObject({ kind: "travel", effect: expect.stringMatching(/flights are ruled out/) });
  });

  it("a preference for a mode steers without constraining, and dislikes are flagged", async () => {
    const r = await runSearch(tripRequestSchema.parse(brief({ destination: "Paris", vibe: ["city"], keywords: ["by train"], dislikes: ["flying"], budget: { amount: 3000, currency: "GBP" } })));
    expect(r.options[0]!.transport.mode).toBe("train");
    const flying = r.options.find((o) => o.transport.mode === "flight");
    if (flying) expect(flying.match.watchOuts.join(" ")).toMatch(/travels by flight, which you said you'd rather avoid/);
  });

  it("refines by mode in plain English", () => {
    const req = tripRequestSchema.parse(brief());
    expect(interpretInstruction("train only", req).changes).toMatchObject({ preferences: { modes: ["train"] } });
    expect(interpretInstruction("no flying", req).changes).toMatchObject({ preferences: { modes: ["train", "coach", "ferry", "car"] } });
    expect(interpretInstruction("road trip", req).changes).toMatchObject({ preferences: { modes: ["car"] } });
    expect(interpretInstruction("avoid driving and no buses", req).changes).toMatchObject({ preferences: { modes: ["flight", "train", "ferry"] } });
    expect(interpretInstruction("direct flights only", req).changes).toEqual({ preferences: { maxStops: 0 } });
  });

  it("accepts the old maxFlightHours name and locks 'flight' as 'transport'", async () => {
    const req = tripRequestSchema.parse(brief({ preferences: { maxFlightHours: 4 } }));
    expect(req.preferences.maxTravelHours).toBe(4);
    const s = await request(createApp()).post("/api/searches").send(brief()).expect(201);
    const remix = await request(createApp()).post(`/api/searches/${s.body.id}/options/${s.body.options[0].id}/remix`).send({ lock: ["flight"] });
    expect(remix.status).toBe(200);
    expect(remix.body.remix.locked).toContain("transport");
  });
});

describe("driving estimate", () => {
  it("sizes the fleet to the party and adds the crossing, tolls and parking", () => {
    const [car] = estimateDrive(Q, { fuel: 0.13, maxKm: 1500 });
    expect(car).toMatchObject({ mode: "car", vehicles: 1, originHub: "LON", destinationHub: "PAR", indicative: true, pricedPassengers: 5 });
    expect(car!.outbound.modes).toEqual(["car", "train", "car"]);
    expect(car!.outbound.carriers[0]).toMatch(/Channel Tunnel/);
    const [two] = estimateDrive({ ...Q, travellers: { adults: 4, children: 3, infants: 0 } }, { fuel: 0.13, maxKm: 1500 });
    expect(two!.vehicles).toBe(2);
    expect(two!.totalPrice).toBeCloseTo(car!.totalPrice * 2, 0);
  });

  it("will not drive somewhere it can't, too far, or from a named airport", () => {
    expect(estimateDrive({ ...Q, destinationCode: "PMI" }, { fuel: 0.13, maxKm: 1500 })).toEqual([]);
    expect(estimateDrive({ ...Q, destinationCode: "ATH" }, { fuel: 0.13, maxKm: 1500 })).toEqual([]);
    expect(estimateDrive({ ...Q, originSpecific: true }, { fuel: 0.13, maxKm: 1500 })).toEqual([]);
  });

  it("is flagged as an estimate for your own car", async () => {
    const r = await runSearch(tripRequestSchema.parse(brief({ destination: "Amsterdam", vibe: "city", preferences: { modes: ["car"] }, budget: { amount: 3000, currency: "GBP" } })));
    expect(r.options.length).toBeGreaterThan(0);
    for (const o of r.options) {
      expect(o.match.watchOuts.join(" ")).toMatch(/estimates for your own car; rental is not included/);
      expect(o.summary).toMatch(/^.+Driving about \d/);
    }
  });
});

describe("Kiwi rail and bus", () => {
  it("maps vehicle types to modes, mixed legs included", () => {
    const [o] = mapKiwiResults(
      [
        {
          id: "t1",
          flyFrom: "QQS",
          flyTo: "XPG",
          cityCodeFrom: "LON",
          cityTo: "Paris",
          cityCodeTo: "PAR",
          price: 220,
          route: [
            { flyFrom: "QQS", flyTo: "XPG", cityCodeFrom: "LON", cityCodeTo: "PAR", local_departure: "2027-05-10T09:01:00.000Z", local_arrival: "2027-05-10T12:20:00.000Z", airline: "9F", vehicle_type: "train", return: 0 },
            { flyFrom: "XPG", flyTo: "QQS", cityCodeFrom: "PAR", cityCodeTo: "LON", local_departure: "2027-05-14T17:13:00.000Z", local_arrival: "2027-05-14T18:30:00.000Z", airline: "9F", vehicle_type: "train", return: 1 },
          ],
        },
      ],
      "GBP",
      Q,
    );
    expect(o).toMatchObject({ mode: "train", originHub: "QQS", originCity: "LON", returnCity: "LON", outbound: { mode: "train", modes: ["train"] } });
  });

  it("accepts a station the provider names only when its city is the start point and we don't know it as somewhere else", async () => {
    const mock = createMock();
    const kiwiLike: Provider = {
      name: "kiwi-like",
      live: true,
      modes: ["train"],
      async searchTransport(q, s) {
        const base = (await mock.searchTransport!({ ...q, modes: ["train"] }, s))[0];
        if (!base) return [];
        const unknownStation: TransportOffer = { ...base, id: "kl:unknown", originHub: "QQS", outbound: { ...base.outbound, from: "QQS" }, inbound: { ...base.inbound, to: "QQS" }, originCity: "LON", returnCity: "LON" };
        const elsewhere: TransportOffer = { ...base, id: "kl:manchester", originHub: "Manchester Piccadilly", outbound: { ...base.outbound, from: "Manchester Piccadilly" }, inbound: { ...base.inbound, to: "Manchester Piccadilly" }, originCity: "LON", returnCity: "LON" };
        return [unknownStation, elsewhere];
      },
    };
    const r = await runSearch(tripRequestSchema.parse(brief({ destination: "Paris", vibe: "city" })), { providers: [kiwiLike, createMock()] });
    const ids = r.options.map((o) => o.transport.offerId);
    expect(ids).not.toContain("kl:manchester");
  });
});
