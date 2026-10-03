import { distanceKm, placeByCode } from "../places.js";
import { convert } from "../money.js";
import { minutesBetween, type FlightOffer, type FlightQuery, type Leg, type Provider, type StayOffer, type StayQuery } from "./types.js";

// A deterministic stand-in for the aggregators, for development, demos and
// tests. Fares come from distance, season and day of week; hotels from the
// catalogue's typical nightly rates. The same query always gives the same
// answer. Everything it returns is marked indicative, and it is refused in
// production (see providers/index.ts).

const CABIN_FACTOR: Record<FlightQuery["cabin"], number> = { economy: 1, premium_economy: 1.7, business: 3.6, first: 6 };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function seasonFactor(iso: string): number {
  const month = Number(iso.slice(5, 7));
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const season = [7, 8].includes(month) ? 1.35 : [6, 12].includes(month) ? 1.2 : [4, 5, 9, 10].includes(month) ? 1.05 : 0.9;
  return season * (dow === 5 || dow === 6 ? 1.1 : 1);
}

function at(iso: string, minutesFromMidnight: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMinutes(minutesFromMidnight);
  return d.toISOString().slice(0, 16);
}

const CARRIERS = ["British Airways", "easyJet", "Ryanair", "Jet2", "TUI", "Iberia", "KLM", "Emirates", "Lufthansa", "Turkish Airlines", "Qatar Airways", "Virgin Atlantic"];

export function createMock(): Provider {
  return {
    name: "mock",
    live: false,

    async searchFlights(q) {
      if (!q.destinationCode) return [];
      const from = placeByCode(q.originCode) ?? placeByCode(q.originAirports[0]!);
      const to = placeByCode(q.destinationCode);
      if (!from || !to || from.code === to.code) return [];
      const km = distanceKm(from, to);
      const offers: FlightOffer[] = [];
      for (let i = 0; i < 3; i++) {
        const stops = km > 9000 ? 1 : km > 4500 ? (i === 2 ? 1 : 0) : i === 2 ? 1 : 0;
        if (q.maxStops !== undefined && stops > q.maxStops) continue;
        const originAirport = q.originAirports[i % q.originAirports.length]!;
        const destinationAirport = to.airports[0]!;
        const seed = `${originAirport}${destinationAirport}${q.depart}${q.return}${i}`;
        const perAdultGBP = (35 + km * 0.085) * seasonFactor(q.depart) * (0.85 + hash(seed) * 0.4) * (stops > 0 ? 0.8 : 1) * CABIN_FACTOR[q.cabin];
        const t = q.travellers;
        const totalGBP = perAdultGBP * (t.adults + t.children * 0.8 + t.infants * 0.1);
        const flightMinutes = Math.round((km / 780) * 60 + 35 + stops * 110);
        const outDep = 6 * 60 + Math.floor(hash(seed + "o") * 13) * 60;
        const inDep = 8 * 60 + Math.floor(hash(seed + "i") * 12) * 60;
        const carrier = CARRIERS[Math.floor(hash(seed + "c") * CARRIERS.length)]!;
        const leg = (fromA: string, toA: string, date: string, dep: number): Leg => {
          const departAt = at(date, dep);
          const arriveAt = at(date, dep + flightMinutes);
          return { from: fromA, to: toA, departAt, arriveAt, durationMinutes: minutesBetween(departAt, arriveAt), stops, carriers: [carrier] };
        };
        const total = convert(totalGBP, "GBP", q.currency) ?? totalGBP;
        offers.push({
          provider: "mock",
          id: `mock:${seed}`,
          originAirport,
          destinationAirport,
          destinationCode: to.code,
          destinationName: to.name,
          destinationCountry: to.country,
          outbound: leg(originAirport, destinationAirport, q.depart, outDep),
          inbound: leg(destinationAirport, originAirport, q.return, inDep),
          totalPrice: Math.round(total * 100) / 100,
          currency: q.currency,
          pricedPassengers: t.adults + t.children + t.infants,
          indicative: true,
        });
      }
      return offers;
    },

    async searchStays(q) {
      const place = placeByCode(q.destinationCode);
      if (!place?.nightlyGBP) return [];
      const nights = Math.round((Date.parse(q.checkOut) - Date.parse(q.checkIn)) / 86_400_000);
      const tags = new Set(place.tags ?? []);
      const templates: { name: string; stars: number; factor: number; amenities: string[] }[] = [
        { name: `${place.name} Central Hotel`, stars: 3, factor: 0.75, amenities: ["wifi", "breakfast"] },
        { name: `The ${place.name} House`, stars: 4, factor: 1, amenities: ["wifi", "bar", "restaurant"] },
        { name: `Grand ${place.name}`, stars: 5, factor: 1.9, amenities: ["wifi", "spa", "pool", "restaurant", "gym"] },
        { name: `${place.name} Boutique Suites`, stars: 4, factor: 1.25, amenities: ["wifi", "rooftop bar", "design"] },
      ];
      if (tags.has("beach")) templates.push({ name: `${place.name} Beach Resort`, stars: 4, factor: 1.3, amenities: ["pool", "beachfront", "kids club", "all inclusive option"] });
      if (tags.has("budget") || tags.has("nightlife")) templates.push({ name: `${place.name} Social Hostel & Rooms`, stars: 2, factor: 0.45, amenities: ["wifi", "bar", "nightlife"] });
      if (tags.has("wellness") || tags.has("relax")) templates.push({ name: `${place.name} Retreat & Spa`, stars: 5, factor: 1.6, amenities: ["spa", "yoga", "quiet", "adults only"] });
      const seated = q.travellers.adults + q.travellers.children;
      return templates
        .filter((t) => !q.minStars || t.stars >= q.minStars)
        .map((t, i) => {
          const seed = `${place.code}${q.checkIn}${q.checkOut}${i}`;
          const nightly = place.nightlyGBP! * t.factor * seasonFactor(q.checkIn) * (0.9 + hash(seed) * 0.2);
          const totalGBP = nightly * nights * q.rooms;
          const total = convert(totalGBP, "GBP", q.currency) ?? totalGBP;
          const offer: StayOffer = {
            provider: "mock",
            id: `mock:${seed}`,
            name: t.name,
            stars: t.stars,
            reviewScore: Math.round((7 + hash(seed + "r") * 2.6) * 10) / 10,
            totalPrice: Math.round(total * 100) / 100,
            currency: q.currency,
            nights,
            rooms: q.rooms,
            sleeps: seated,
            amenities: t.amenities,
            refundable: hash(seed + "f") > 0.4,
            indicative: true,
          };
          return offer;
        });
    },
  };
}
