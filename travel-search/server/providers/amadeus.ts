import { fetchJson } from "./http.js";
import { isoDurationMinutes, ProviderError, type FlightOffer, type FlightQuery, type Leg, type Provider, type StayOffer, type StayQuery } from "./types.js";

// Amadeus for Developers (Self-Service APIs): Flight Offers Search for fares
// from hundreds of airlines, Hotel List + Hotel Search for rooms.
//   AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET, AMADEUS_ENV=test|production
// The test environment returns cached, partial data; use production for real prices.

const CABINS: Record<FlightQuery["cabin"], string> = {
  economy: "ECONOMY",
  premium_economy: "PREMIUM_ECONOMY",
  business: "BUSINESS",
  first: "FIRST",
};

interface AmadeusSegment {
  departure: { iataCode: string; at: string };
  arrival: { iataCode: string; at: string };
  carrierCode: string;
}

interface AmadeusFlightOffer {
  id: string;
  itineraries: { duration?: string; segments: AmadeusSegment[] }[];
  price: { currency: string; grandTotal?: string; total: string };
  travelerPricings?: unknown[];
}

interface AmadeusFlightResponse {
  data?: AmadeusFlightOffer[];
  dictionaries?: { carriers?: Record<string, string> };
}

interface AmadeusHotelListResponse {
  data?: { hotelId: string; name: string; rating?: number | string }[];
}

interface AmadeusHotelOffersResponse {
  data?: {
    available?: boolean;
    hotel: { hotelId: string; name: string; rating?: string; cityCode?: string; address?: { lines?: string[] }; amenities?: string[] };
    offers?: {
      id: string;
      price: { currency: string; total: string };
      guests?: { adults?: number };
      policies?: { refundable?: { cancellationRefund?: string }; cancellations?: { amount?: string }[] };
    }[];
  }[];
}

export function amadeusFromEnv(env = process.env): Provider | null {
  if (!env.AMADEUS_CLIENT_ID || !env.AMADEUS_CLIENT_SECRET) return null;
  const host = (env.AMADEUS_ENV ?? "test") === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com";
  return createAmadeus({ host, clientId: env.AMADEUS_CLIENT_ID, clientSecret: env.AMADEUS_CLIENT_SECRET });
}

export function createAmadeus(opts: { host: string; clientId: string; clientSecret: string }): Provider {
  const NAME = "amadeus";
  let token: { value: string; expiresAt: number } | null = null;

  async function auth(signal: AbortSignal): Promise<string> {
    if (token && token.expiresAt > Date.now() + 30_000) return token.value;
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: opts.clientId, client_secret: opts.clientSecret });
    const res = await fetchJson<{ access_token: string; expires_in: number }>(NAME, `${opts.host}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    token = { value: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 };
    return token.value;
  }

  async function get<T>(path: string, params: Record<string, string | number | undefined>, signal: AbortSignal): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    const bearer = await auth(signal);
    return fetchJson<T>(NAME, `${opts.host}${path}?${qs}`, { headers: { Authorization: `Bearer ${bearer}` }, signal });
  }

  return {
    name: NAME,
    live: true,

    async searchFlights(q, signal) {
      if (!q.destinationCode) throw new ProviderError(NAME, "needs a destination");
      const origin = q.originAirports.length === 1 ? q.originAirports[0] : q.originCode;
      const res = await get<AmadeusFlightResponse>(
        "/v2/shopping/flight-offers",
        {
          originLocationCode: origin,
          destinationLocationCode: q.destinationCode,
          departureDate: q.depart,
          returnDate: q.return,
          adults: q.travellers.adults,
          children: q.travellers.children || undefined,
          infants: q.travellers.infants || undefined,
          travelClass: CABINS[q.cabin],
          nonStop: q.maxStops === 0 ? "true" : undefined,
          currencyCode: q.currency,
          max: 25,
        },
        signal,
      );
      return mapAmadeusFlights(res, q);
    },

    async searchStays(q, signal) {
      const ratings = q.minStars ? [1, 2, 3, 4, 5].filter((r) => r >= q.minStars!).join(",") : undefined;
      const list = await get<AmadeusHotelListResponse>("/v1/reference-data/locations/hotels/by-city", { cityCode: q.destinationCode, ratings, radius: 15, radiusUnit: "KM" }, signal);
      const hotels = (list.data ?? []).slice(0, 40);
      if (hotels.length === 0) return [];
      const stars = new Map(hotels.map((h) => [h.hotelId, Number(h.rating) || undefined]));
      const seated = q.travellers.adults + q.travellers.children;
      const res = await get<AmadeusHotelOffersResponse>(
        "/v3/shopping/hotel-offers",
        {
          hotelIds: hotels.map((h) => h.hotelId).join(","),
          // Amadeus takes adults per room. Children are counted as adults so
          // every quoted room really sleeps the whole party.
          adults: Math.ceil(seated / q.rooms),
          roomQuantity: q.rooms,
          checkInDate: q.checkIn,
          checkOutDate: q.checkOut,
          currency: q.currency,
          bestRateOnly: "true",
        },
        signal,
      );
      return mapAmadeusStays(res, q, stars);
    },
  };
}

export function mapAmadeusFlights(res: AmadeusFlightResponse, q: FlightQuery): FlightOffer[] {
  const carriers = res.dictionaries?.carriers ?? {};
  const out: FlightOffer[] = [];
  for (const offer of res.data ?? []) {
    const [outb, inb] = offer.itineraries;
    if (!outb || !inb || outb.segments.length === 0 || inb.segments.length === 0) continue;
    const leg = (it: { duration?: string; segments: AmadeusSegment[] }): Leg => {
      const first = it.segments[0]!;
      const last = it.segments[it.segments.length - 1]!;
      return {
        from: first.departure.iataCode,
        to: last.arrival.iataCode,
        departAt: first.departure.at,
        arriveAt: last.arrival.at,
        durationMinutes: isoDurationMinutes(it.duration),
        stops: it.segments.length - 1,
        carriers: [...new Set(it.segments.map((s) => carriers[s.carrierCode] ?? s.carrierCode))],
      };
    };
    const o = leg(outb);
    out.push({
      provider: "amadeus",
      id: `amadeus:${offer.id}`,
      originAirport: o.from,
      destinationAirport: o.to,
      destinationCode: q.destinationCode ?? o.to,
      outbound: o,
      inbound: leg(inb),
      totalPrice: Number(offer.price.grandTotal ?? offer.price.total),
      currency: offer.price.currency,
      pricedPassengers: offer.travelerPricings?.length ?? q.travellers.adults + q.travellers.children + q.travellers.infants,
    });
  }
  return out;
}

export function mapAmadeusStays(res: AmadeusHotelOffersResponse, q: StayQuery, stars: Map<string, number | undefined>): StayOffer[] {
  const nights = Math.round((Date.parse(q.checkOut) - Date.parse(q.checkIn)) / 86_400_000);
  const out: StayOffer[] = [];
  for (const h of res.data ?? []) {
    if (h.available === false) continue;
    const offer = h.offers?.[0];
    if (!offer) continue;
    const perRoom = offer.guests?.adults ?? Math.ceil((q.travellers.adults + q.travellers.children) / q.rooms);
    out.push({
      provider: "amadeus",
      id: `amadeus:${offer.id}`,
      name: titleCase(h.hotel.name),
      stars: Number(h.hotel.rating) || stars.get(h.hotel.hotelId),
      totalPrice: Number(offer.price.total),
      currency: offer.price.currency,
      nights,
      rooms: q.rooms,
      sleeps: perRoom * q.rooms,
      address: h.hotel.address?.lines?.join(", "),
      amenities: (h.hotel.amenities ?? []).map((a) => a.toLowerCase().replace(/_/g, " ")),
      refundable: offer.policies?.refundable?.cancellationRefund ? offer.policies.refundable.cancellationRefund !== "NON_REFUNDABLE" : undefined,
    });
  }
  return out;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
