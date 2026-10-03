import { fetchJson } from "./http.js";
import { isoDurationMinutes, ProviderError, type FlightOffer, type FlightQuery, type Leg, type Provider, type StayOffer, type StayQuery } from "./types.js";

// Duffel: NDC and GDS fares from 300+ airlines in one API, and Duffel Stays
// for accommodation (Stays needs Duffel to enable it on the account).
//   DUFFEL_ACCESS_TOKEN, DUFFEL_STAYS=on

const BASE = "https://api.duffel.com";
/** Duffel prices children by age; we do not ask for ages, so price as a typical 2-11 year old. */
const ASSUMED_CHILD_AGE = 8;

interface DuffelSegment {
  departing_at: string;
  arriving_at: string;
  origin: { iata_code: string };
  destination: { iata_code: string };
  marketing_carrier?: { name?: string; iata_code?: string };
}

interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  passengers?: unknown[];
  slices: {
    duration?: string;
    origin: { iata_code: string; city_name?: string };
    destination: { iata_code: string; iata_city_code?: string; city_name?: string };
    segments: DuffelSegment[];
  }[];
}

interface DuffelStaysResult {
  id: string;
  cheapest_rate_total_amount: string;
  cheapest_rate_currency: string;
  accommodation: {
    id: string;
    name: string;
    rating?: number | null;
    review_score?: number | null;
    location?: { address?: { line_one?: string; city_name?: string } };
    amenities?: { type?: string; description?: string }[] | null;
  };
}

export function duffelFromEnv(env = process.env): Provider | null {
  if (!env.DUFFEL_ACCESS_TOKEN) return null;
  return createDuffel({ token: env.DUFFEL_ACCESS_TOKEN, stays: (env.DUFFEL_STAYS ?? "off").toLowerCase() === "on" });
}

export function createDuffel(opts: { token: string; stays: boolean; base?: string }): Provider {
  const NAME = "duffel";
  const base = opts.base ?? BASE;
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    "Duffel-Version": "v2",
    "Content-Type": "application/json",
  };

  const provider: Provider = {
    name: NAME,
    live: true,

    async searchFlights(q, signal) {
      if (!q.destinationCode) throw new ProviderError(NAME, "needs a destination");
      const origin = q.originAirports.length === 1 ? q.originAirports[0]! : q.originCode;
      const destination = q.destinationAirports?.length === 1 ? q.destinationAirports[0]! : q.destinationCode;
      const passengers = [
        ...Array.from({ length: q.travellers.adults }, () => ({ type: "adult" })),
        ...Array.from({ length: q.travellers.children }, () => ({ age: ASSUMED_CHILD_AGE })),
        ...Array.from({ length: q.travellers.infants }, () => ({ type: "infant_without_seat" })),
      ];
      const res = await fetchJson<{ data: { offers?: DuffelOffer[] } }>(NAME, `${base}/air/offer_requests?return_offers=true&supplier_timeout=15000`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          data: {
            slices: [
              { origin, destination, departure_date: q.depart },
              { origin: destination, destination: origin, departure_date: q.return },
            ],
            passengers,
            cabin_class: q.cabin,
            ...(q.maxStops !== undefined ? { max_connections: q.maxStops } : {}),
          },
        }),
        signal,
      });
      return mapDuffelOffers(res.data.offers ?? [], q);
    },
  };

  if (opts.stays) {
    provider.searchStays = async (q, signal) => {
      if (q.lat === undefined || q.lon === undefined) return [];
      const guests = [
        ...Array.from({ length: q.travellers.adults }, () => ({ type: "adult" })),
        ...Array.from({ length: q.travellers.children }, () => ({ type: "child", age: ASSUMED_CHILD_AGE })),
      ];
      const res = await fetchJson<{ data: { results?: DuffelStaysResult[] } }>(NAME, `${base}/stays/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          data: {
            rooms: q.rooms,
            guests,
            check_in_date: q.checkIn,
            check_out_date: q.checkOut,
            location: { radius: 10, geographic_coordinates: { latitude: q.lat, longitude: q.lon } },
          },
        }),
        signal,
      });
      return mapDuffelStays(res.data.results ?? [], q);
    };
  }

  return provider;
}

export function mapDuffelOffers(offers: DuffelOffer[], q: FlightQuery): FlightOffer[] {
  const out: FlightOffer[] = [];
  for (const offer of offers) {
    const [outb, inb] = offer.slices;
    if (!outb || !inb || outb.segments.length === 0 || inb.segments.length === 0) continue;
    const leg = (s: DuffelOffer["slices"][number]): Leg => {
      const first = s.segments[0]!;
      const last = s.segments[s.segments.length - 1]!;
      return {
        from: first.origin.iata_code,
        to: last.destination.iata_code,
        departAt: first.departing_at,
        arriveAt: last.arriving_at,
        durationMinutes: isoDurationMinutes(s.duration),
        stops: s.segments.length - 1,
        carriers: [...new Set(s.segments.map((seg) => seg.marketing_carrier?.name ?? seg.marketing_carrier?.iata_code ?? "?"))],
      };
    };
    const o = leg(outb);
    out.push({
      provider: "duffel",
      id: `duffel:${offer.id}`,
      originAirport: o.from,
      destinationAirport: o.to,
      destinationCode: outb.destination.iata_city_code ?? q.destinationCode ?? o.to,
      destinationName: outb.destination.city_name,
      outbound: o,
      inbound: leg(inb),
      totalPrice: Number(offer.total_amount),
      currency: offer.total_currency,
      pricedPassengers: offer.passengers?.length ?? q.travellers.adults + q.travellers.children + q.travellers.infants,
    });
  }
  return out;
}

export function mapDuffelStays(results: DuffelStaysResult[], q: StayQuery): StayOffer[] {
  const nights = Math.round((Date.parse(q.checkOut) - Date.parse(q.checkIn)) / 86_400_000);
  return results.map((r) => ({
    provider: "duffel",
    id: `duffel:${r.id}`,
    name: r.accommodation.name,
    stars: r.accommodation.rating ?? undefined,
    reviewScore: r.accommodation.review_score ?? undefined,
    totalPrice: Number(r.cheapest_rate_total_amount),
    currency: r.cheapest_rate_currency,
    nights,
    rooms: q.rooms,
    // The search was made for the whole party, so the quoted rate sleeps them all.
    sleeps: q.travellers.adults + q.travellers.children,
    address: [r.accommodation.location?.address?.line_one, r.accommodation.location?.address?.city_name].filter(Boolean).join(", ") || undefined,
    amenities: (r.accommodation.amenities ?? []).map((a) => (a.description ?? a.type ?? "").toLowerCase()).filter(Boolean),
  }));
}
