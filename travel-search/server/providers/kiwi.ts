import { fetchJson } from "./http.js";
import type { FlightOffer, FlightQuery, Leg, Provider } from "./types.js";

// Kiwi.com Tequila: virtual interlining across carriers, and the one aggregator
// here that searches "anywhere" and whole date ranges in a single call. That is
// what powers open searches when the traveller has no destination in mind.
//   KIWI_API_KEY (Tequila partner key)

const BASE = "https://api.tequila.kiwi.com";

const CABINS: Record<FlightQuery["cabin"], string> = { economy: "M", premium_economy: "W", business: "C", first: "F" };

interface KiwiRoute {
  flyFrom: string;
  flyTo: string;
  local_departure: string;
  local_arrival: string;
  utc_departure?: string;
  utc_arrival?: string;
  airline: string;
  return: 0 | 1;
}

interface KiwiResult {
  id: string;
  flyFrom: string;
  flyTo: string;
  cityTo: string;
  cityCodeTo: string;
  countryTo?: { name: string };
  price: number;
  deep_link?: string;
  route: KiwiRoute[];
}

export function kiwiFromEnv(env = process.env): Provider | null {
  if (!env.KIWI_API_KEY) return null;
  return createKiwi({ apiKey: env.KIWI_API_KEY });
}

/** 2026-10-18 → 18/10/2026, the format Tequila wants. */
function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function createKiwi(opts: { apiKey: string; base?: string }): Provider {
  const NAME = "kiwi";
  const base = opts.base ?? BASE;
  return {
    name: NAME,
    live: true,
    anywhere: true,
    dateRange: true,

    async searchFlights(q, signal) {
      const w = q.window ?? { departFrom: q.depart, departTo: q.depart, returnFrom: q.return, returnTo: q.return, minNights: 1, maxNights: 60 };
      const params = new URLSearchParams({
        fly_from: q.originAirports.map((a) => `airport:${a}`).join(","),
        date_from: dmy(w.departFrom),
        date_to: dmy(w.departTo),
        return_from: dmy(w.returnFrom),
        return_to: dmy(w.returnTo),
        nights_in_dst_from: String(w.minNights),
        nights_in_dst_to: String(w.maxNights),
        flight_type: "round",
        adults: String(q.travellers.adults),
        children: String(q.travellers.children),
        infants: String(q.travellers.infants),
        selected_cabins: CABINS[q.cabin],
        curr: q.currency,
        sort: "price",
        limit: q.destinationCode ? "25" : "100",
      });
      if (q.destinationCode) {
        params.set("fly_to", q.destinationAirports?.length ? q.destinationAirports.map((a) => `airport:${a}`).join(",") : `city:${q.destinationCode}`);
      } else {
        // Anywhere: the cheapest per destination city, so results are varied.
        params.set("one_for_city", "1");
      }
      if (q.maxStops !== undefined) params.set("max_stopovers", String(q.maxStops));
      const res = await fetchJson<{ currency?: string; data?: KiwiResult[] }>(NAME, `${base}/v2/search?${params}`, {
        headers: { apikey: opts.apiKey },
        signal,
      });
      return mapKiwiResults(res.data ?? [], res.currency ?? q.currency, q);
    },
  };
}

export function mapKiwiResults(results: KiwiResult[], currency: string, q: FlightQuery): FlightOffer[] {
  const out: FlightOffer[] = [];
  const passengers = q.travellers.adults + q.travellers.children + q.travellers.infants;
  for (const r of results) {
    const outRoutes = r.route.filter((x) => x.return === 0);
    const inRoutes = r.route.filter((x) => x.return === 1);
    if (outRoutes.length === 0 || inRoutes.length === 0) continue;
    const leg = (rs: KiwiRoute[]): Leg => {
      const first = rs[0]!;
      const last = rs[rs.length - 1]!;
      const start = first.utc_departure ?? first.local_departure;
      const end = last.utc_arrival ?? last.local_arrival;
      return {
        from: first.flyFrom,
        to: last.flyTo,
        departAt: stripZone(first.local_departure),
        arriveAt: stripZone(last.local_arrival),
        durationMinutes: Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000)),
        stops: rs.length - 1,
        carriers: [...new Set(rs.map((x) => x.airline))],
      };
    };
    out.push({
      provider: "kiwi",
      id: `kiwi:${r.id}`,
      originAirport: r.flyFrom,
      destinationAirport: r.flyTo,
      destinationCode: r.cityCodeTo,
      destinationName: r.cityTo,
      destinationCountry: r.countryTo?.name,
      outbound: leg(outRoutes),
      inbound: leg(inRoutes),
      // Tequila's price is for all passengers in the search.
      totalPrice: r.price,
      currency,
      pricedPassengers: passengers,
      bookingUrl: r.deep_link,
    });
  }
  return out;
}

function stripZone(s: string): string {
  return s.replace(/\.\d+Z$|Z$/, "");
}
