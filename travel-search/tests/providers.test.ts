import { afterEach, describe, expect, it, vi } from "vitest";
import { createAmadeus, mapAmadeusFlights, mapAmadeusStays } from "../server/providers/amadeus.js";
import { mapDuffelOffers, mapDuffelStays } from "../server/providers/duffel.js";
import { createKiwi, mapKiwiResults } from "../server/providers/kiwi.js";
import { createMock } from "../server/providers/mock.js";
import { roomsFor, type FlightOffer, type FlightQuery, type Provider, type StayQuery } from "../server/providers/types.js";
import { runSearch } from "../server/search.js";
import { tripRequestSchema } from "../server/schema.js";
import { brief, future } from "./helpers.js";

const Q: FlightQuery = {
  originCode: "LON",
  originAirports: ["LHR", "LGW"],
  destinationCode: "BCN",
  destinationAirports: ["BCN"],
  depart: "2027-05-10",
  return: "2027-05-17",
  travellers: { adults: 2, children: 1, infants: 0 },
  cabin: "economy",
  currency: "GBP",
};

const SQ: StayQuery = {
  destinationCode: "BCN",
  destinationName: "Barcelona",
  lat: 41.39,
  lon: 2.17,
  checkIn: "2027-05-10",
  checkOut: "2027-05-17",
  travellers: { adults: 2, children: 1, infants: 0 },
  rooms: 1,
  currency: "GBP",
};

afterEach(() => vi.unstubAllGlobals());

describe("Amadeus adapter", () => {
  it("maps flight offers: legs, stops, carriers, price for the whole party", () => {
    const offers = mapAmadeusFlights(
      {
        data: [
          {
            id: "1",
            itineraries: [
              { duration: "PT2H15M", segments: [{ departure: { iataCode: "LGW", at: "2027-05-10T07:00:00" }, arrival: { iataCode: "BCN", at: "2027-05-10T10:15:00" }, carrierCode: "U2" }] },
              {
                duration: "PT5H5M",
                segments: [
                  { departure: { iataCode: "BCN", at: "2027-05-17T12:00:00" }, arrival: { iataCode: "MAD", at: "2027-05-17T13:20:00" }, carrierCode: "IB" },
                  { departure: { iataCode: "MAD", at: "2027-05-17T14:30:00" }, arrival: { iataCode: "LHR", at: "2027-05-17T16:05:00" }, carrierCode: "IB" },
                ],
              },
            ],
            price: { currency: "GBP", total: "410.00", grandTotal: "432.50" },
            travelerPricings: [{}, {}, {}],
          },
          { id: "broken", itineraries: [], price: { currency: "GBP", total: "1" } },
        ],
        dictionaries: { carriers: { U2: "easyJet", IB: "Iberia" } },
      },
      Q,
    );
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      provider: "amadeus",
      originAirport: "LGW",
      destinationAirport: "BCN",
      destinationCode: "BCN",
      totalPrice: 432.5,
      currency: "GBP",
      pricedPassengers: 3,
      outbound: { from: "LGW", to: "BCN", durationMinutes: 135, stops: 0, carriers: ["easyJet"] },
      inbound: { from: "BCN", to: "LHR", durationMinutes: 305, stops: 1, carriers: ["Iberia"] },
    });
  });

  it("maps hotel offers and skips unavailable hotels", () => {
    const stays = mapAmadeusStays(
      {
        data: [
          { available: true, hotel: { hotelId: "H1", name: "HOTEL ARTS BARCELONA" }, offers: [{ id: "o1", price: { currency: "EUR", total: "1400.00" }, guests: { adults: 3 } }] },
          { available: false, hotel: { hotelId: "H2", name: "SOLD OUT" }, offers: [{ id: "o2", price: { currency: "EUR", total: "100" } }] },
        ],
      },
      SQ,
      new Map([["H1", 5]]),
    );
    expect(stays).toEqual([
      expect.objectContaining({ name: "Hotel Arts Barcelona", stars: 5, totalPrice: 1400, currency: "EUR", nights: 7, rooms: 1, sleeps: 3 }),
    ]);
  });

  it("authenticates once, reuses the token, and asks for the whole party", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.endsWith("/v1/security/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 1799 }));
        return new Response(JSON.stringify({ data: [] }));
      }),
    );
    const p = createAmadeus({ host: "https://test.api.amadeus.com", clientId: "id", clientSecret: "secret" });
    await p.searchFlights!(Q, AbortSignal.timeout(1000));
    await p.searchFlights!({ ...Q, originAirports: ["LGW"] }, AbortSignal.timeout(1000));
    expect(calls.filter((c) => c.includes("oauth2")).length).toBe(1);
    const search = new URL(calls[1]!);
    expect(search.pathname).toBe("/v2/shopping/flight-offers");
    expect(search.searchParams.get("originLocationCode")).toBe("LON");
    expect(search.searchParams.get("adults")).toBe("2");
    expect(search.searchParams.get("children")).toBe("1");
    expect(search.searchParams.get("currencyCode")).toBe("GBP");
    // A single acceptable airport is searched as that airport, not the city.
    expect(new URL(calls[2]!).searchParams.get("originLocationCode")).toBe("LGW");
  });

  it("reports HTTP errors with the provider's message and no credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ errors: [{ detail: "Invalid client" }] }), { status: 401 })),
    );
    const p = createAmadeus({ host: "https://test.api.amadeus.com", clientId: "id", clientSecret: "s3cret" });
    const err = await p.searchFlights!(Q, AbortSignal.timeout(1000)).catch((e: Error) => e);
    expect((err as Error).message).toBe("amadeus: HTTP 401: Invalid client");
    expect((err as Error).message).not.toContain("s3cret");
  });
});

describe("Duffel adapter", () => {
  it("maps offers, using the IATA city code for the destination", () => {
    const offers = mapDuffelOffers(
      [
        {
          id: "off_1",
          total_amount: "512.20",
          total_currency: "GBP",
          passengers: [{}, {}, {}],
          slices: [
            {
              duration: "PT2H5M",
              origin: { iata_code: "LHR" },
              destination: { iata_code: "BCN", iata_city_code: "BCN", city_name: "Barcelona" },
              segments: [{ departing_at: "2027-05-10T09:00:00", arriving_at: "2027-05-10T12:05:00", origin: { iata_code: "LHR" }, destination: { iata_code: "BCN" }, marketing_carrier: { name: "British Airways" } }],
            },
            {
              duration: "PT2H20M",
              origin: { iata_code: "BCN" },
              destination: { iata_code: "LHR" },
              segments: [{ departing_at: "2027-05-17T18:00:00", arriving_at: "2027-05-17T19:20:00", origin: { iata_code: "BCN" }, destination: { iata_code: "LHR" }, marketing_carrier: { name: "British Airways" } }],
            },
          ],
        },
      ],
      Q,
    );
    expect(offers[0]).toMatchObject({ provider: "duffel", destinationCode: "BCN", destinationName: "Barcelona", totalPrice: 512.2, pricedPassengers: 3, outbound: { durationMinutes: 125, stops: 0 } });
  });

  it("maps stays search results for the whole party", () => {
    const stays = mapDuffelStays(
      [{ id: "srr_1", cheapest_rate_total_amount: "980.00", cheapest_rate_currency: "GBP", accommodation: { id: "acc_1", name: "Casa Bonay", rating: 4, review_score: 8.9, amenities: [{ type: "spa", description: "Spa" }] } }],
      SQ,
    );
    expect(stays[0]).toMatchObject({ name: "Casa Bonay", stars: 4, reviewScore: 8.9, totalPrice: 980, sleeps: 3, amenities: ["spa"] });
  });
});

describe("Kiwi adapter", () => {
  it("maps results, splitting outbound and return legs", () => {
    const offers = mapKiwiResults(
      [
        {
          id: "k1",
          flyFrom: "STN",
          flyTo: "BCN",
          cityTo: "Barcelona",
          cityCodeTo: "BCN",
          countryTo: { name: "Spain" },
          price: 301,
          deep_link: "https://www.kiwi.com/deep?x=1",
          route: [
            { flyFrom: "STN", flyTo: "BCN", local_departure: "2027-05-10T06:00:00.000Z", local_arrival: "2027-05-10T09:10:00.000Z", utc_departure: "2027-05-10T05:00:00.000Z", utc_arrival: "2027-05-10T07:10:00.000Z", airline: "FR", return: 0 },
            { flyFrom: "BCN", flyTo: "STN", local_departure: "2027-05-17T20:00:00.000Z", local_arrival: "2027-05-17T21:15:00.000Z", utc_departure: "2027-05-17T18:00:00.000Z", utc_arrival: "2027-05-17T20:15:00.000Z", airline: "FR", return: 1 },
          ],
        },
      ],
      "GBP",
      Q,
    );
    expect(offers[0]).toMatchObject({
      provider: "kiwi",
      destinationCode: "BCN",
      destinationCountry: "Spain",
      totalPrice: 301,
      pricedPassengers: 3,
      bookingUrl: "https://www.kiwi.com/deep?x=1",
      outbound: { from: "STN", to: "BCN", departAt: "2027-05-10T06:00:00", durationMinutes: 130, stops: 0 },
      inbound: { from: "BCN", to: "STN", durationMinutes: 135 },
    });
  });

  it("searches anywhere and the whole date window in one call", async () => {
    let seen = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen = url;
        return new Response(JSON.stringify({ currency: "GBP", data: [] }));
      }),
    );
    const p = createKiwi({ apiKey: "k" });
    expect(p.anywhere && p.dateRange).toBe(true);
    await p.searchFlights!(
      { ...Q, destinationCode: undefined, destinationAirports: undefined, window: { departFrom: "2027-05-08", departTo: "2027-05-12", returnFrom: "2027-05-15", returnTo: "2027-05-19", minNights: 5, maxNights: 9 } },
      AbortSignal.timeout(1000),
    );
    const u = new URL(seen);
    expect(u.searchParams.get("fly_from")).toBe("airport:LHR,airport:LGW");
    expect(u.searchParams.get("fly_to")).toBeNull();
    expect(u.searchParams.get("one_for_city")).toBe("1");
    expect(u.searchParams.get("date_from")).toBe("08/05/2027");
    expect(u.searchParams.get("return_to")).toBe("19/05/2027");
    expect(u.searchParams.get("children")).toBe("1");
  });
});

describe("rooms", () => {
  it("puts two adults to a room and lets a family of four share", () => {
    expect(roomsFor({ adults: 1, children: 0, infants: 0 })).toBe(1);
    expect(roomsFor({ adults: 2, children: 2, infants: 1 })).toBe(1);
    expect(roomsFor({ adults: 3, children: 0, infants: 0 })).toBe(2);
    expect(roomsFor({ adults: 2, children: 3, infants: 0 })).toBe(2);
  });
});

describe("the non-negotiables are policed centrally, whatever a provider returns", () => {
  function rogue(): Provider {
    const mock = createMock();
    return {
      name: "rogue",
      live: true,
      async searchFlights(q, signal) {
        const good = await mock.searchFlights!(q, signal);
        if (!good.length) return [];
        const g = good[0]!;
        const bad: FlightOffer[] = [
          { ...g, id: "rogue:wrong-origin", originAirport: "MAN", outbound: { ...g.outbound, from: "MAN" }, totalPrice: 1 },
          { ...g, id: "rogue:returns-elsewhere", inbound: { ...g.inbound, to: "MAN" }, totalPrice: 1 },
          { ...g, id: "rogue:wrong-party", pricedPassengers: 1, totalPrice: 1 },
          { ...g, id: "rogue:outside-dates", outbound: { ...g.outbound, departAt: `${future(80)}T08:00` }, totalPrice: 1 },
          { ...g, id: "rogue:unknown-currency", currency: "XXX", totalPrice: 1 },
        ];
        return [...bad, ...good];
      },
      searchStays: (q, signal) => mock.searchStays!(q, signal),
    };
  }

  it("discards fares from the wrong airport, for the wrong party, outside the dates, or in an unknown currency", async () => {
    const req = tripRequestSchema.parse(brief());
    const r = await runSearch(req, { providers: [rogue()] });
    expect(r.options).toHaveLength(3);
    for (const o of r.options) expect(o.flight.offerId.startsWith("rogue:")).toBe(false);
    expect(r.notes.join(" ")).toMatch(/not priced for all 2 travellers/);
  });

  it("discards rooms that do not sleep the whole party", async () => {
    const mock = createMock();
    const cramped: Provider = { name: "cramped", live: true, searchStays: async (q, s) => (await mock.searchStays!(q, s)).map((x) => ({ ...x, id: `cramped:${x.id}`, sleeps: 1, totalPrice: 1 })) };
    const r = await runSearch(tripRequestSchema.parse(brief()), { providers: [mock, cramped] });
    for (const o of r.options) expect(o.stay.provider).toBe("mock");
  });

  it("keeps going when one aggregator fails, and says which", async () => {
    const broken: Provider = {
      name: "broken",
      live: true,
      searchFlights: async () => {
        throw new Error("broken: HTTP 503");
      },
    };
    const r = await runSearch(tripRequestSchema.parse(brief()), { providers: [broken, createMock()] });
    expect(r.options).toHaveLength(3);
    expect(r.providers.find((p) => p.provider === "broken")).toMatchObject({ kind: "flights", offers: 0, errors: ["broken: HTTP 503"] });
    expect(r.notes.join(" ")).toMatch(/broken \(flights\) did not respond usefully/);
  });

  it("estimates accommodation, clearly marked, when no provider quotes rooms", async () => {
    const mock = createMock();
    const flightsOnly: Provider = { name: "flights-only", live: true, searchFlights: (q, s) => mock.searchFlights!(q, s) };
    const r = await runSearch(tripRequestSchema.parse(brief()), { providers: [flightsOnly] });
    expect(r.options.length).toBeGreaterThan(0);
    for (const o of r.options) {
      expect(o.stay.estimated).toBe(true);
      expect(o.indicative).toBe(true);
      expect(o.match.watchOuts.join(" ")).toMatch(/accommodation is an estimate/);
    }
    expect(r.notes.join(" ")).toMatch(/typical-rate estimate/);
  });

  it("uses an anywhere-capable aggregator for open searches, policing what it finds", async () => {
    const mock = createMock();
    const seen: (string | undefined)[] = [];
    const anywhere: Provider = {
      name: "anywhere",
      live: true,
      anywhere: true,
      dateRange: true,
      async searchFlights(q, s) {
        seen.push(q.destinationCode);
        if (q.destinationCode) return [];
        // Pretend the aggregator found Krakow, which the vibe ranking alone would not have asked about.
        return (await mock.searchFlights!({ ...q, destinationCode: "KRK" }, s)).map((f) => ({ ...f, provider: "anywhere", id: `anywhere:${f.id}` }));
      },
    };
    const r = await runSearch(tripRequestSchema.parse(brief({ vibe: ["city", "history"], dislikes: [], budget: { amount: 5000, currency: "GBP" } })), { providers: [anywhere, mock] });
    expect(seen).toContain(undefined);
    expect(r.providers.find((p) => p.provider === "anywhere")!.offers).toBeGreaterThan(0);
    expect(r.options.length).toBe(3);
  });
});
