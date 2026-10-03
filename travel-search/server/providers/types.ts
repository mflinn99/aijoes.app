import type { Travellers } from "../schema.js";

// The contract every aggregator adapter meets. Adapters translate; they do not
// judge. Policing the non-negotiables (start point, party size, budget, dates)
// happens once, centrally, in search.ts, whatever a provider sends back.

export interface Leg {
  from: string;
  to: string;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  stops: number;
  carriers: string[];
}

export interface FlightQuery {
  /** City code (e.g. LON) when every airport is acceptable, used by providers that take one code. */
  originCode: string;
  /** The acceptable departure airports. Anything else is discarded. */
  originAirports: string[];
  /** Absent means "anywhere", only sent to providers that support it. */
  destinationCode?: string;
  destinationAirports?: string[];
  depart: string;
  return: string;
  /** For providers that search a date range natively: the traveller's whole window. */
  window?: { departFrom: string; departTo: string; returnFrom: string; returnTo: string; minNights: number; maxNights: number };
  travellers: Travellers;
  cabin: "economy" | "premium_economy" | "business" | "first";
  maxStops?: number;
  currency: string;
}

export interface FlightOffer {
  provider: string;
  id: string;
  originAirport: string;
  destinationAirport: string;
  /** City code of the destination, used to match the catalogue. */
  destinationCode: string;
  destinationName?: string;
  destinationCountry?: string;
  outbound: Leg;
  inbound: Leg;
  /** Total for the whole party. */
  totalPrice: number;
  currency: string;
  /** How many passengers the price covers, as the provider reports it. */
  pricedPassengers: number;
  bookingUrl?: string;
  /** True for estimates rather than live, bookable fares. */
  indicative?: boolean;
}

export interface StayQuery {
  destinationCode: string;
  destinationName: string;
  lat?: number;
  lon?: number;
  checkIn: string;
  checkOut: string;
  travellers: Travellers;
  rooms: number;
  minStars?: number;
  currency: string;
}

export interface StayOffer {
  provider: string;
  id: string;
  name: string;
  stars?: number;
  /** Guest review score out of 10, when known. */
  reviewScore?: number;
  totalPrice: number;
  currency: string;
  nights: number;
  rooms: number;
  /** How many people the booked rooms sleep, as quoted. */
  sleeps: number;
  address?: string;
  amenities: string[];
  refundable?: boolean;
  bookingUrl?: string;
  indicative?: boolean;
}

export interface Provider {
  name: string;
  /** Live providers quote bookable prices; the mock does not. */
  live: boolean;
  searchFlights?(q: FlightQuery, signal: AbortSignal): Promise<FlightOffer[]>;
  searchStays?(q: StayQuery, signal: AbortSignal): Promise<StayOffer[]>;
  /** Can search with no destination ("anywhere"). */
  anywhere?: boolean;
  /** Searches the whole date window in one call. */
  dateRange?: boolean;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

/** ISO 8601 duration (PT2H35M) to minutes. */
export function isoDurationMinutes(d: string | undefined): number {
  if (!d) return 0;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
}

/** Rooms needed: two adults to a room, a family of four can share. */
export function roomsFor(t: Travellers): number {
  const seated = t.adults + t.children;
  return Math.max(Math.ceil(t.adults / 2), Math.ceil(seated / 4), 1);
}
