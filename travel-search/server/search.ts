import { createHash } from "node:crypto";
import { datePairs, monthOf, nightsBetween, todayIso, withinWindow, addDays, type DatePair } from "./dates.js";
import { convert, formatMoney } from "./money.js";
import { destinationCatalogue, distanceKm, placeByCode, resolvePlace, suggestPlaces, type Place, type ResolvedPlace } from "./places.js";
import { getProviders } from "./providers/index.js";
import { roomsFor, TRANSPORT_MODES, type TransportMode, type TransportOffer, type TransportQuery, type Leg, type Provider, type StayOffer } from "./providers/types.js";
import { CO2_PER_KM, hubOwner, hubsOf } from "./ground.js";
import { budgetCeiling, budgetTarget, partySize, round2, seatedTravellers, type TripRequest } from "./schema.js";
import { summarise, partyLabel } from "./summary.js";
import { profile, scoreVibe, type VibeMatch, type VibeProfile } from "./vibe.js";
import { FLIGHT_FREE, interpretKeywords, type KeywordInsight } from "./keywords.js";

// The search itself. Every aggregator is asked in parallel; whatever comes
// back is policed against the traveller's non-negotiables in this order:
//
//   1. starting point — out from, and back to, the origin (its airports,
//                       stations and ports, or the front door for a car)
//   2. travellers     — priced for the whole party, rooms that sleep them all
//   3. budget         — transport + accommodation inside the ceiling
//                       (target plus the flexibility the traveller allowed)
//
// and only then ranked on what is important but negotiable: vibe, likes and
// dislikes, value, convenience, carbon. Destination is a constraint only when
// given. Transport is any mode the traveller allows: flight, train, coach,
// ferry or car.
// If fewer than three options survive we return fewer and say why; we never
// bend a non-negotiable to fill a slot.

export class SearchInputError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly suggestions: string[] = [],
  ) {
    super(message);
  }
}

export interface ProviderReport {
  provider: string;
  kind: "transport" | "stays";
  calls: number;
  offers: number;
  errors: string[];
}

export interface TripOption {
  id: string;
  label: string;
  destination: { code: string; name: string; country: string };
  dates: { depart: string; return: string; nights: number; shiftedFromRequested: boolean };
  transport: {
    mode: TransportMode;
    provider: string;
    offerId: string;
    outbound: Leg;
    inbound: Leg;
    totalPrice: number;
    quoted?: { amount: number; currency: string };
    bookingUrl?: string;
    indicative: boolean;
    /** For a car: how many vehicles. */
    vehicles?: number;
    /** The start point it was checked against (city code). */
    originCity: string;
    /** Estimated return-trip emissions per traveller, kg CO2e. */
    co2KgPerPerson?: number;
  };
  stay: {
    provider: string;
    offerId?: string;
    name: string;
    stars?: number;
    reviewScore?: number;
    nights: number;
    rooms: number;
    sleeps: number;
    totalPrice: number;
    quoted?: { amount: number; currency: string };
    amenities: string[];
    address?: string;
    refundable?: boolean;
    bookingUrl?: string;
    /** No provider quoted a room; this is the catalogue's typical rate. */
    estimated: boolean;
    indicative: boolean;
  };
  price: {
    currency: string;
    total: number;
    perPerson: number;
    /** How many travellers the total covers. */
    travellers: number;
    transport: number;
    stay: number;
    budget: number;
    ceiling: number;
    /** Budget target minus total; negative means using the flexibility. */
    headroom: number;
    /** Indicative per-person spend on the ground, not included in the total. */
    dailySpendPerPerson?: number;
  };
  match: { score: number; vibe: VibeMatch; reasons: string[]; watchOuts: string[] };
  scores: { overall: number; match: number; value: number; convenience: number; quality: number; green: number };
  summary: string;
  sources: string[];
  /** True if any part of the price is an estimate rather than a live quote. */
  indicative: boolean;
  /** Elements carried over unchanged from the option this one was remixed from. */
  locked: LockElement[];
}

/** The parts of an option a traveller can lock while the rest is remixed. */
export const LOCK_ELEMENTS = ["destination", "dates", "transport", "stay"] as const;
export type LockElement = (typeof LOCK_ELEMENTS)[number];

export interface Locks {
  from: TripOption;
  elements: LockElement[];
}

export interface SearchResult {
  request: TripRequest;
  resolved: { origin: PlaceRef; destination?: PlaceRef };
  options: TripOption[];
  notes: string[];
  /** How each keyword was read and what it did. */
  keywords: KeywordInsight[];
  /** Set when these options remix a locked option. */
  remix?: { from: string; locked: LockElement[]; remixed: LockElement[] };
  providers: ProviderReport[];
  searchedAt: string;
}

export interface PlaceRef {
  code: string;
  name: string;
  country: string;
  airports: string[];
}

export interface SearchOptions {
  /** Option ids the traveller wants kept, if they still meet the request. */
  keep?: TripOption[];
  /** Option ids the traveller has rejected. */
  rejectIds?: string[];
  /** Lock parts of one option and remix the rest. */
  locks?: Locks;
  /** How this traveller rated places after earlier trips, by city code. */
  history?: Record<string, { rating: number; name: string }>;
  providers?: Provider[];
  now?: Date;
}

const LABELS = { match: "Best match", value: "Best value", both: "Best match and best value", upgrade: "Upgrade", different: "Something different" } as const;

export function resolveRequestPlaces(req: TripRequest): { origin: ResolvedPlace; destination?: ResolvedPlace } {
  const origin = resolvePlace(req.origin);
  if (!origin) {
    throw new SearchInputError(`We don't recognise "${req.origin}" as a starting point. Try a city or a 3-letter airport code.`, "origin", suggestPlaces(req.origin));
  }
  let destination: ResolvedPlace | undefined;
  if (req.destination) {
    destination = resolvePlace(req.destination) ?? undefined;
    if (!destination && /^[A-Za-z]{3}$/.test(req.destination)) {
      // An airport we don't have in the catalogue: search it as given.
      const code = req.destination.toUpperCase();
      destination = { code, name: code, country: "", airports: [code] };
    }
    if (!destination) {
      throw new SearchInputError(`We don't recognise "${req.destination}" as a destination. Try a city or a 3-letter airport code, or leave it empty to search everywhere.`, "destination", suggestPlaces(req.destination));
    }
    if (destination.code === origin.code) throw new SearchInputError("Destination is the same as the starting point.", "destination");
  }
  return { origin, destination };
}

function ref(p: ResolvedPlace): PlaceRef {
  return { code: p.code, name: p.name, country: p.country, airports: p.airports };
}

const MAX_OPEN_CANDIDATES = Number(process.env.TRAVEL_OPEN_CANDIDATES ?? 8);
const PROVIDER_TIMEOUT_MS = Number(process.env.TRAVEL_PROVIDER_TIMEOUT_MS ?? 20_000);
const CONCURRENCY = 6;

export async function runSearch(req: TripRequest, opts: SearchOptions = {}): Promise<SearchResult> {
  const now = opts.now ?? new Date();
  const providers = opts.providers ?? getProviders();
  const resolved = resolveRequestPlaces(req);
  const origin = resolved.origin;
  let destination = resolved.destination;

  // Locks: a locked transport or stay brings its destination and dates with it.
  const lock = opts.locks;
  const locked = new Set<LockElement>(lock?.elements ?? []);
  if (locked.has("transport") || locked.has("stay")) {
    locked.add("destination");
    locked.add("dates");
  }
  if (lock && locked.has("transport") && locked.has("stay")) {
    throw new SearchInputError("With both the transport and the stay locked there is nothing left to remix. Unlock one of them.", "lock");
  }
  if (lock && locked.has("destination")) destination = placeFromOption(lock.from);

  let pairs = datePairs(req.dates, todayIso(now), destination ? 5 : 3);
  if (lock && locked.has("dates")) {
    const d = lock.from.dates;
    if (!withinWindow(d, req.dates)) throw new SearchInputError("The locked dates are outside your current dates. Unlock them or widen your dates.", "lock");
    pairs = d.depart > todayIso(now) ? [{ depart: d.depart, return: d.return, nights: d.nights }] : [];
  }
  if (pairs.length === 0) throw new SearchInputError("Those dates have passed. Choose dates in the future.", "dates.depart");

  const month = monthOf(req.dates.depart);
  const keywordRead = interpretKeywords(req.keywords, month);
  const taste = modeTaste(req);
  const vp = profile(req.vibe, req.likes, req.dislikes, keywordRead.profile);
  const currency = req.budget.currency;
  const ceiling = budgetCeiling(req);
  const target = budgetTarget(req);
  const party = partySize(req.travellers);
  const seated = seatedTravellers(req.travellers);
  const rooms = roomsFor(req.travellers);
  const notes: string[] = [];
  const reports = new Map<string, ProviderReport>();
  const report = (provider: string, kind: "transport" | "stays") => {
    const key = `${provider}:${kind}`;
    let r = reports.get(key);
    if (!r) reports.set(key, (r = { provider, kind, calls: 0, offers: 0, errors: [] }));
    return r;
  };

  const transportProviders = providers.filter((p) => p.searchTransport);
  const stayProviders = providers.filter((p) => p.searchStays);
  if (transportProviders.length === 0) throw new Error("No transport providers configured");
  // "Flight-free" anywhere in the brief is meant literally.
  const flightFree = FLIGHT_FREE.test([...req.vibe, ...req.keywords, ...req.likes].join(" ").toLowerCase());
  const modes = flightFree && req.preferences.modes.some((m) => m !== "flight") ? req.preferences.modes.filter((m) => m !== "flight") : req.preferences.modes;
  const offersMode = (p: Provider) => (p.modes ?? ["flight"]).some((m) => modes.includes(m));

  // --- candidate destinations ------------------------------------------------
  const excluded = new Set(req.excludeDestinations.map((d) => resolvePlace(d)?.code ?? d.toUpperCase()));
  let candidates: ResolvedPlace[];
  if (destination) {
    candidates = [destination];
  } else {
    candidates = destinationCatalogue()
      .filter((p) => p.code !== origin.code && !excluded.has(p.code))
      .map((p) => ({ p, s: scoreVibe(vp, p, month) }))
      .filter(({ s }) => s.conflicts.length === 0 || s.score > 0.4)
      .sort((a, b) => b.s.score - a.s.score)
      // The best matches, plus any place a keyword points straight at.
      .filter(({ p }, i) => i < MAX_OPEN_CANDIDATES || (vp.keywords.boosts[p.code]?.weight ?? 0) >= 1)
      .slice(0, MAX_OPEN_CANDIDATES + 4)
      .map(({ p }) => ({ code: p.code, name: p.name, country: p.country, airports: p.airports, lat: p.lat, lon: p.lon, place: p }));
  }

  // --- transport -----------------------------------------------------------------
  const window = {
    departFrom: addDays(req.dates.depart, -req.dates.flexibilityDays),
    departTo: addDays(req.dates.depart, req.dates.flexibilityDays),
    returnFrom: addDays(req.dates.return, -req.dates.flexibilityDays),
    returnTo: addDays(req.dates.return, req.dates.flexibilityDays),
    minNights: Math.max(1, nightsBetween(req.dates.depart, req.dates.return) - req.dates.flexibilityDays),
    maxNights: nightsBetween(req.dates.depart, req.dates.return) + req.dates.flexibilityDays,
  };
  // The start point, by any mode: a named airport means only that airport.
  const originHubs = new Set(origin.specific || !origin.place ? [...origin.airports, ...(origin.place ? [] : [origin.code])] : hubsOf(origin.place));
  const base = (pair: DatePair): Omit<TransportQuery, "destinationCode" | "destinationAirports"> => ({
    originCode: origin.code,
    originAirports: origin.airports,
    originHubs: [...originHubs],
    originSpecific: origin.specific,
    modes,
    depart: pair.depart,
    return: pair.return,
    window,
    travellers: req.travellers,
    cabin: req.preferences.cabin,
    maxStops: req.preferences.maxStops,
    currency,
  });

  const transportTasks: (() => Promise<void>)[] = [];
  const journeys: TransportOffer[] = [];
  const call = <T,>(p: Provider, kind: "transport" | "stays", fn: (signal: AbortSignal) => Promise<T[]>, sink: T[]) => async () => {
    const r = report(p.name, kind);
    r.calls++;
    try {
      const got = await fn(AbortSignal.timeout(PROVIDER_TIMEOUT_MS));
      r.offers += got.length;
      sink.push(...got);
    } catch (err) {
      const message = (err as Error).message;
      if (r.errors.length < 3 && !r.errors.includes(message)) r.errors.push(message);
    }
  };
  for (const p of locked.has("transport") ? [] : transportProviders.filter(offersMode)) {
    const first = pairs[0]!;
    if (!destination && p.anywhere) {
      transportTasks.push(call(p, "transport", (s) => p.searchTransport!(base(first), s), journeys));
    }
    for (const c of candidates) {
      const q = (pair: DatePair): TransportQuery => ({ ...base(pair), destinationCode: c.code, destinationAirports: c.airports });
      if (p.dateRange) {
        // Range-capable providers search the whole window in one call.
        transportTasks.push(call(p, "transport", (s) => p.searchTransport!(q(first), s), journeys));
      } else {
        for (const pair of pairs) transportTasks.push(call(p, "transport", (s) => p.searchTransport!(q(pair), s), journeys));
      }
    }
  }
  await pool(transportTasks, CONCURRENCY);
  if (lock && locked.has("transport")) journeys.push(transportFromOption(lock.from));

  // --- police the non-negotiables on every journey ----------------------------
  // Out from the start point and back to it. A provider's own city code counts
  // (stations it names that we don't), unless the traveller named one airport.
  // A hub we know belongs to somewhere else is never accepted, whatever city the provider claims.
  const atOrigin = (hub: string, city?: string) => originHubs.has(hub) || (!origin.specific && city === origin.code && !hubOwner(hub));
  const rejections = { origin: 0, party: 0, dates: 0, prefs: 0, currency: 0, destination: 0 };
  interface PricedTransport { offer: TransportOffer; total: number; place: ResolvedPlace; pair: DatePair }
  const priced: PricedTransport[] = [];
  for (const f of journeys) {
    if (!atOrigin(f.originHub, f.originCity) || !atOrigin(f.inbound.to, f.returnCity ?? f.originCity) || f.outbound.from !== f.originHub) {
      rejections.origin++;
      continue;
    }
    if (f.pricedPassengers !== party) {
      rejections.party++;
      continue;
    }
    const pair = { depart: f.outbound.departAt.slice(0, 10), return: f.inbound.departAt.slice(0, 10) };
    if (!withinWindow(pair, req.dates)) {
      rejections.dates++;
      continue;
    }
    const maxStops = req.preferences.maxStops;
    const maxMins = req.preferences.maxTravelHours ? req.preferences.maxTravelHours * 60 : Infinity;
    if (!modes.includes(f.mode) || (maxStops !== undefined && (f.outbound.stops > maxStops || f.inbound.stops > maxStops)) || f.outbound.durationMinutes > maxMins || f.inbound.durationMinutes > maxMins) {
      rejections.prefs++;
      continue;
    }
    const place = placeFor(f, destination);
    if (!place || (destination && place.code !== destination.code) || place.code === origin.code || excluded.has(place.code)) {
      rejections.destination++;
      continue;
    }
    const total = convert(f.totalPrice, f.currency, currency);
    if (total === null) {
      rejections.currency++;
      continue;
    }
    priced.push({ offer: f, total, place, pair: { ...pair, nights: nightsBetween(pair.depart, pair.return) } });
  }

  // Keep the three cheapest, the quickest and the best of each mode per destination and dates.
  const groups = new Map<string, PricedTransport[]>();
  for (const pf of priced) {
    const key = `${pf.place.code}|${pf.pair.depart}|${pf.pair.return}`;
    const list = groups.get(key) ?? [];
    list.push(pf);
    groups.set(key, list);
  }
  for (const [key, list] of groups) {
    const byPrice = [...list].sort((a, b) => a.total - b.total).slice(0, 3);
    const quickest = [...list].sort((a, b) => a.offer.outbound.durationMinutes + a.offer.inbound.durationMinutes - (b.offer.outbound.durationMinutes + b.offer.inbound.durationMinutes))[0];
    const perMode = TRANSPORT_MODES.map((m) => [...list].filter((pf) => pf.offer.mode === m).sort((a, b) => a.total - b.total)[0]).filter((x): x is PricedTransport => !!x);
    groups.set(key, [...new Set([...byPrice, ...(quickest ? [quickest] : []), ...perMode])]);
  }

  // Only look for rooms where the cheapest journey leaves something for them,
  // best vibe first, so live stay providers are not asked about hopeless trips.
  const groupKeys = [...groups.keys()]
    .filter((k) => groups.get(k)!.some((pf) => pf.total < ceiling))
    .sort((a, b) => placeScore(groups.get(b)![0]!.place) - placeScore(groups.get(a)![0]!.place) || cheapest(a) - cheapest(b))
    .slice(0, destination ? 10 : 24);
  function placeScore(p: ResolvedPlace): number {
    return p.place ? scoreVibe(vp, p.place, month).score : 0.2;
  }
  function cheapest(k: string): number {
    return Math.min(...groups.get(k)!.map((pf) => pf.total));
  }

  // --- stays ---------------------------------------------------------------------
  const stays = new Map<string, StayOffer[]>();
  const stayTasks: (() => Promise<void>)[] = [];
  for (const key of groupKeys) {
    const sample = groups.get(key)![0]!;
    const sink: StayOffer[] = [];
    stays.set(key, sink);
    if (lock && locked.has("stay")) {
      // An estimated stay is re-estimated below; a quoted one is carried over as it was.
      if (!lock.from.stay.estimated) sink.push(stayFromOption(lock.from));
      continue;
    }
    for (const p of stayProviders) {
      stayTasks.push(
        call(
          p,
          "stays",
          (s) =>
            p.searchStays!(
              {
                destinationCode: sample.place.code,
                destinationName: sample.place.name,
                lat: sample.place.lat,
                lon: sample.place.lon,
                checkIn: sample.pair.depart,
                checkOut: sample.pair.return,
                travellers: req.travellers,
                rooms,
                minStars: req.preferences.minHotelStars,
                currency,
              },
              s,
            ),
          sink,
        ),
      );
    }
  }
  await pool(stayTasks, CONCURRENCY);

  // --- packages ------------------------------------------------------------------
  const packages: TripOption[] = [];
  let cheapestOver: { total: number; where: string } | null = null;
  let estimatedStays = 0;
  let lockBroken: string | null = lock && locked.has("transport") && priced.length === 0 ? "the locked transport no longer meets your requirements" : null;
  for (const key of groupKeys) {
    const fl = groups.get(key)!;
    const sample = fl[0]!;
    const nights = sample.pair.nights;
    let roomOffers: { offer: StayOffer | null; total: number }[] = [];
    for (const s of stays.get(key) ?? []) {
      if (s.sleeps < seated || s.rooms < rooms || s.nights !== nights) continue;
      if (req.preferences.minHotelStars && (s.stars ?? 0) < req.preferences.minHotelStars) continue;
      const total = convert(s.totalPrice, s.currency, currency);
      if (total === null || total <= 0) continue;
      roomOffers.push({ offer: s, total });
    }
    if (roomOffers.length === 0 && lock && locked.has("stay") && !lock.from.stay.estimated) {
      lockBroken = `${lock.from.stay.name} no longer sleeps your party or fits your dates`;
      continue;
    }
    if (roomOffers.length === 0) {
      // No quote: fall back to the catalogue's typical rate, clearly marked as
      // an estimate. With no typical rate either, we cannot vouch for the budget.
      const nightly = sample.place.place?.nightlyGBP;
      const est = nightly ? convert(nightly * nights * rooms * (req.preferences.minHotelStars && req.preferences.minHotelStars >= 5 ? 1.8 : 1), "GBP", currency) : null;
      if (est === null) continue;
      roomOffers = [{ offer: null, total: est }];
      estimatedStays++;
    }
    // Cheapest, best reviewed and most characterful few.
    roomOffers = pickStays(roomOffers, vp);

    for (const pf of fl) {
      for (const ro of roomOffers) {
        const total = round2(pf.total + ro.total);
        if (total > ceiling) {
          if (!cheapestOver || total < cheapestOver.total) cheapestOver = { total, where: pf.place.name };
          continue;
        }
        packages.push(buildOption(req, pf.offer, pf.total, pf.place, pf.pair, ro.offer, ro.total, { vp, month, target, ceiling, party, rooms, seated, origin, modeTaste: taste, history: opts.history ?? {} }));
      }
    }
  }

  // --- choose three ---------------------------------------------------------------
  const rejected = new Set(opts.rejectIds ?? []);
  const kept: TripOption[] = [];
  for (const k of opts.keep ?? []) {
    const why = stillValid(k, req, origin, ceiling, excluded, destination);
    if (why) notes.push(`"${k.destination.name}" could not be kept: ${why}.`);
    else kept.push(k);
  }
  const pool_ = packages.filter((p) => !rejected.has(p.id));
  let options: TripOption[];
  const remixed = LOCK_ELEMENTS.filter((e) => !locked.has(e));
  if (lock) {
    // Remix: change every unlocked element where possible, at least one always.
    const changes = (p: TripOption) => remixed.filter((e) => differsIn(e, p, lock.from)).length;
    const strict = pool_.filter((p) => changes(p) === remixed.length);
    options = choose(strict, kept, !destination);
    if (options.length < 3) options = choose(pool_.filter((p) => changes(p) > 0), options, !destination);
    options = options.map((o) => ({ ...o, locked: [...locked] }));
    notes.unshift(`Remixed ${lock.from.destination.name}: kept the ${[...locked].join(", ")}; new ${remixed.join(", ")}.`);
    if (lockBroken) notes.push(`Nothing to remix: ${lockBroken}. Unlock it to search again.`);
  } else {
    options = choose(pool_, kept, !destination);
  }
  options.forEach((o) => (o.summary = summarise(o, req)));

  // --- explain -------------------------------------------------------------------
  if (options.length < 3) {
    const shortBy = 3 - options.length;
    if (lock && cheapestOver) {
      notes.push(
        `With the ${[...locked].join(", ")} locked, ${options.length === 0 ? "nothing else" : `only ${options.length} alternative${options.length === 1 ? "" : "s"}`} fit${options.length === 1 ? "s" : ""} your budget of ${formatMoney(ceiling, currency)}. The cheapest over it was ${formatMoney(cheapestOver.total, currency)}. Lock less to widen the remix.`,
      );
    } else if (cheapestOver) {
      notes.push(
        `${options.length === 0 ? "Nothing" : `Only ${options.length} option${options.length === 1 ? "" : "s"}`} fit${options.length === 1 ? "s" : ""} inside your budget of ${formatMoney(ceiling, currency)} for ${partyLabel(req.travellers)}. The cheapest trip over it was ${formatMoney(cheapestOver.total, currency)} (${cheapestOver.where}). Raising the budget or its flexibility, or widening the dates, would open up more.`,
      );
    } else if (priced.length > 0 && Math.min(...priced.map((pf) => pf.total)) >= ceiling) {
      const low = [...priced].sort((a, b) => a.total - b.total)[0]!;
      notes.push(
        `Nothing fits inside your budget of ${formatMoney(ceiling, currency)} for ${partyLabel(req.travellers)}: the cheapest transport alone was ${formatMoney(low.total, currency)} (${low.place.name}), before accommodation. Raising the budget, or widening the dates, would open up more.`,
      );
    } else if (priced.length === 0) {
      notes.push(`No ${modes.length === TRANSPORT_MODES.length ? "transport" : modes.join(" or ")} was found from ${origin.name} for ${partyLabel(req.travellers)} on those dates${destination ? ` to ${destination.name}` : ""}. Try more date flexibility${req.preferences.maxStops === 0 ? ", allowing a stop" : ""}${modes.length < TRANSPORT_MODES.length ? ", other ways of travelling" : ""}${destination ? " or leaving the destination open" : ""}.`);
    } else {
      notes.push(`Found ${shortBy === 1 ? "one fewer" : `${shortBy} fewer`} option${shortBy === 1 ? "" : "s"} than usual: there were not enough distinct trips that meet every requirement.`);
    }
  }
  if (estimatedStays > 0 && options.some((o) => o.stay.estimated)) {
    notes.push("Where no provider quoted a room, accommodation is a typical-rate estimate and is marked as such. Check the live price before booking.");
  }
  if (options.some((o) => o.indicative)) {
    if (providers.every((p) => !p.live)) notes.push("Prices are indicative (demonstration data), not live quotes.");
  }
  if (rejections.party > 0) notes.push(`${rejections.party} fare(s) were discarded because they were not priced for all ${party} travellers.`);
  const failed = [...reports.values()].filter((r) => r.errors.length > 0 && r.offers === 0);
  for (const r of failed) notes.push(`${r.provider} (${r.kind}) did not respond usefully: ${r.errors[0]}`);

  return {
    request: req,
    resolved: { origin: ref(origin), destination: destination ? ref(destination) : undefined },
    options,
    notes,
    keywords: keywordRead.insights,
    ...(lock ? { remix: { from: lock.from.id, locked: [...locked], remixed } } : {}),
    providers: [...reports.values()],
    searchedAt: now.toISOString(),
  };
}

function placeFor(f: TransportOffer, destination?: ResolvedPlace): ResolvedPlace | null {
  if (destination && (destination.airports.includes(f.destinationHub) || destination.code === f.destinationCode)) return destination;
  const p: Place | undefined = placeByCode(f.destinationCode) ?? placeByCode(f.destinationHub);
  if (p) return { code: p.code, name: p.name, country: p.country, airports: p.airports, lat: p.lat, lon: p.lon, place: p };
  if (destination) return null;
  // A destination an aggregator found that we have no character data for.
  return { code: f.destinationCode, name: f.destinationName ?? f.destinationCode, country: f.destinationCountry ?? "", airports: [f.destinationHub] };
}

function differsIn(e: LockElement, a: TripOption, b: TripOption): boolean {
  switch (e) {
    case "destination":
      return a.destination.code !== b.destination.code;
    case "dates":
      return a.dates.depart !== b.dates.depart || a.dates.return !== b.dates.return;
    case "transport":
      return a.transport.offerId !== b.transport.offerId;
    case "stay":
      return a.stay.name !== b.stay.name;
  }
}

function placeFromOption(o: TripOption): ResolvedPlace {
  const p = placeByCode(o.destination.code);
  if (p) return { code: p.code, name: p.name, country: p.country, airports: p.airports, lat: p.lat, lon: p.lon, place: p };
  return { code: o.destination.code, name: o.destination.name, country: o.destination.country, airports: o.transport.mode === "flight" ? [o.transport.outbound.to] : [] };
}

/** Locked transport goes back through the same checks as any live fare. */
function transportFromOption(o: TripOption): TransportOffer {
  return {
    provider: o.transport.provider,
    id: o.transport.offerId,
    mode: o.transport.mode,
    vehicles: o.transport.vehicles,
    originCity: o.transport.originCity,
    returnCity: o.transport.originCity,
    originHub: o.transport.outbound.from,
    destinationHub: o.transport.outbound.to,
    destinationCode: o.destination.code,
    destinationName: o.destination.name,
    destinationCountry: o.destination.country,
    outbound: o.transport.outbound,
    inbound: o.transport.inbound,
    totalPrice: o.transport.quoted?.amount ?? o.transport.totalPrice,
    currency: o.transport.quoted?.currency ?? o.price.currency,
    pricedPassengers: o.price.travellers,
    bookingUrl: o.transport.bookingUrl,
    indicative: o.transport.indicative,
  };
}

function stayFromOption(o: TripOption): StayOffer {
  const st = o.stay;
  return {
    provider: st.provider,
    id: st.offerId ?? `${st.provider}:${st.name}`,
    name: st.name,
    stars: st.stars,
    reviewScore: st.reviewScore,
    totalPrice: st.quoted?.amount ?? st.totalPrice,
    currency: st.quoted?.currency ?? o.price.currency,
    nights: st.nights,
    rooms: st.rooms,
    sleeps: st.sleeps,
    address: st.address,
    amenities: st.amenities,
    refundable: st.refundable,
    bookingUrl: st.bookingUrl,
    indicative: st.indicative,
  };
}

function pickStays(list: { offer: StayOffer | null; total: number }[], vp: VibeProfile): { offer: StayOffer | null; total: number }[] {
  if (list.length <= 4) return list;
  const wantsLuxury = vp.vibe.tags.includes("luxury") || vp.likes.tags.includes("luxury");
  const byPrice = [...list].sort((a, b) => a.total - b.total);
  const byReview = [...list].sort((a, b) => (b.offer?.reviewScore ?? 0) - (a.offer?.reviewScore ?? 0));
  const byStars = [...list].sort((a, b) => (b.offer?.stars ?? 0) - (a.offer?.stars ?? 0) || a.total - b.total);
  const picks = [byPrice[0], byPrice[1], byReview[0], wantsLuxury ? byStars[0] : byPrice[2], byStars[0]];
  return [...new Set(picks.filter((x): x is { offer: StayOffer | null; total: number } => !!x))];
}

interface Ctx {
  vp: VibeProfile;
  origin: ResolvedPlace;
  modeTaste: ModeTaste;
  history: Record<string, { rating: number; name: string }>;
  month: number;
  target: number;
  ceiling: number;
  party: number;
  rooms: number;
  seated: number;
}

/** What the brief says about ways of travelling: steers, never constrains (that is preferences.modes). */
export interface ModeTaste {
  eco: boolean;
  liked: TransportMode[];
  disliked: TransportMode[];
}

const MODE_WORDS: [TransportMode, RegExp][] = [
  ["flight", /\b(fly|flying|flights?|planes?|airports?)\b/],
  ["train", /\b(trains?|rail|railway|sleeper)\b/],
  ["coach", /\b(coach|coaches|bus|buses)\b/],
  ["ferry", /\b(ferry|ferries|crossing by sea)\b/],
  ["car", /\b(road ?trip|drive|driving|car|own car)\b/],
];

export function modeTaste(req: TripRequest): ModeTaste {
  const positive = [...req.vibe, ...req.keywords, ...req.likes].join(" ").toLowerCase();
  const negative = req.dislikes.join(" ").toLowerCase();
  const eco = /\b(eco|low[- ]carbon|sustainab\w*|green travel|flight[- ]?free|no[- ]fly|slow travel|carbon)\b/.test(positive);
  const liked = MODE_WORDS.filter(([m, re]) => re.test(positive) && !(m === "flight" && /\b(flight[- ]?free|no[- ]fly)\b/.test(positive))).map(([m]) => m);
  const disliked = MODE_WORDS.filter(([, re]) => re.test(negative)).map(([m]) => m);
  if (/\b(flight[- ]?free|no[- ]fly)\b/.test(positive)) disliked.push("flight");
  return { eco, liked, disliked: [...new Set(disliked)] };
}

/** Time from the front door, roughly: getting to and through an airport takes longer. */
const OVERHEAD_HOURS: Record<TransportMode, number> = { flight: 2.5, train: 0.5, coach: 0.5, ferry: 1, car: 0 };
const STOP_PENALTY: Record<TransportMode, number> = { flight: 0.2, train: 0.07, coach: 0.1, ferry: 0.1, car: 0.02 };

export function co2PerPerson(f: TransportOffer, party: number, origin?: ResolvedPlace, place?: ResolvedPlace): number | undefined {
  const km =
    (f.outbound.km ?? 0) + (f.inbound.km ?? 0) ||
    (origin?.lat !== undefined && place?.lat !== undefined ? 2 * distanceKm({ lat: origin.lat, lon: origin.lon! }, { lat: place.lat, lon: place.lon! }) * (f.mode === "flight" ? 1 : 1.3) : 0);
  if (!km) return undefined;
  const kg = f.mode === "car" ? (CO2_PER_KM.car * km * (f.vehicles ?? 1)) / Math.max(1, party) : CO2_PER_KM[f.mode] * km;
  return Math.round(kg);
}

const MODE_WORD: Record<TransportMode, string> = { flight: "flights", train: "trains", coach: "coaches", ferry: "ferries", car: "driving" };

function buildOption(req: TripRequest, f: TransportOffer, transportTotal: number, place: ResolvedPlace, pair: DatePair, stay: StayOffer | null, stayTotal: number, ctx: Ctx): TripOption {
  const currency = req.budget.currency;
  const extra = stay ? `${stay.name} ${stay.amenities.join(" ")}` : "";
  const vibe: VibeMatch = place.place
    ? scoreVibe(ctx.vp, place.place, ctx.month, extra)
    : { score: 0.25, matched: [], missed: ctx.vp.vibe.tags, conflicts: [] };
  const total = round2(transportTotal + stayTotal);

  const value = Math.max(0, Math.min(1, 1 - total / ctx.ceiling + 0.15));
  const hours = (f.outbound.durationMinutes + f.inbound.durationMinutes) / 120 + OVERHEAD_HOURS[f.mode];
  // Every hour past three costs a little; past eight, a lot more.
  const convenience = Math.max(0, 1 - STOP_PENALTY[f.mode] * (f.outbound.stops + f.inbound.stops) - Math.max(0, hours - 3) * 0.04 - Math.max(0, hours - 8) * 0.06);
  const co2 = co2PerPerson(f, ctx.party, ctx.origin, place);
  const green = co2 === undefined ? 0.5 : Math.max(0, 1 - co2 / 500);
  const taste = ctx.modeTaste;
  const modeBonus = (taste.liked.includes(f.mode) ? 0.08 : 0) - (taste.disliked.includes(f.mode) ? 0.15 : 0) + (taste.eco ? 0.15 * green : 0);
  const stars = stay?.stars ?? 3;
  const quality = Math.max(0, Math.min(1, (stars / 5) * 0.6 + ((stay?.reviewScore ?? 7.5) / 10) * 0.4));

  const wantsLuxury = ctx.vp.vibe.tags.includes("luxury") || ctx.vp.likes.tags.includes("luxury");
  const wantsBudget = ctx.vp.vibe.tags.includes("budget") || ctx.vp.likes.tags.includes("budget");
  const w = wantsLuxury ? { m: 0.45, v: 0.1, c: 0.15, q: 0.3 } : wantsBudget ? { m: 0.4, v: 0.4, c: 0.1, q: 0.1 } : { m: 0.5, v: 0.22, c: 0.14, q: 0.14 };
  const shiftDays = Math.abs(nightsBetween(req.dates.depart, pair.depart)) + Math.abs(nightsBetween(req.dates.return, pair.return));
  // A place the traveller named in their keywords gets a clear lead, not just a nudge.
  // Your own reviews of earlier trips: somewhere you disliked drops back, somewhere you loved gets a nudge.
  const past = ctx.history[place.code];
  // Naming the place again this time wins over an old review.
  const pastBonus = past ? (past.rating <= 2 ? (vibe.named ? 0 : -0.25) : past.rating >= 4 ? 0.05 : 0) : 0;
  const overall = round3(w.m * vibe.score + w.v * value + w.c * convenience + w.q * quality - 0.015 * shiftDays + (vibe.named ? 0.25 : 0) + modeBonus + pastBonus);

  const reasons: string[] = [];
  if (vibe.keyword) reasons.push(`Matches your keyword ${quote(vibe.keyword)}.`);
  if (vibe.matched.length) reasons.push(`Ticks off ${vibe.matched.slice(0, 5).join(", ")} from your ${quote([...req.vibe, ...req.keywords].join(", "))} brief.`);
  if (f.outbound.stops === 0 && f.inbound.stops === 0 && f.mode !== "car") reasons.push(f.outbound.modes.length > 1 ? `No changes: ${f.outbound.modes.join(" + ")} through.` : `Direct ${MODE_WORD[f.mode]} both ways.`);
  if (f.mode === "car") reasons.push("Door to door in your own car, with room for luggage.");
  if (f.mode !== "flight" && co2 !== undefined && (taste.eco || co2 < 60)) reasons.push(`Low carbon: about ${co2} kg CO2e per person return.`);
  if (past && past.rating >= 4) reasons.push(`You rated ${place.name} ${past.rating}/5 after your last trip.`);
  if (taste.liked.includes(f.mode)) reasons.push(`Travelling by ${f.mode === "car" ? "car" : f.mode}, as you'd like.`);
  if (stay?.reviewScore && stay.reviewScore >= 8.5) reasons.push(`${stay.name} is very well reviewed (${stay.reviewScore}/10).`);
  const watchOuts: string[] = [];
  const missedVibe = vibe.missed.filter((m) => ctx.vp.vibe.tags.includes(m));
  if (missedVibe.length) watchOuts.push(`less of: ${missedVibe.join(", ")}${missedVibe.some((m) => m === "beach" || m === "warm") ? " at this time of year" : ""}`);
  if (vibe.conflicts.length) watchOuts.push(`known for ${vibe.conflicts.join(", ")}, which you said you'd rather avoid`);
  if (shiftDays > 0) watchOuts.push(`dates moved within your flexibility (${pair.depart} to ${pair.return})`);
  const stops = f.outbound.stops + f.inbound.stops;
  if (stops > 0 && f.mode !== "car") watchOuts.push(`${stops} ${f.mode === "flight" ? "stop(s)" : "change(s)"} in total`);
  if (f.mode === "car") watchOuts.push("fuel, tolls, crossings and parking are estimates for your own car; rental is not included");
  const eachWay = Math.round(Math.max(f.outbound.durationMinutes, f.inbound.durationMinutes) / 60);
  if (f.mode === "car" ? eachWay > 6 : eachWay > 8) watchOuts.push(`a long ${f.mode === "car" ? "drive" : "journey"}: about ${eachWay} hours each way`);
  if (past && past.rating <= 2) watchOuts.push(`you rated ${place.name} ${past.rating}/5 after your last trip`);
  if (taste.disliked.includes(f.mode)) watchOuts.push(`travels by ${f.mode}, which you said you'd rather avoid`);
  if (!stay) watchOuts.push("accommodation is an estimate, not a live quote");
  if (stay?.refundable === false) watchOuts.push("the room rate is non-refundable");

  const place0 = place.place;
  // The party and price are part of the identity: the same trip for four is not the same option as for two.
  const id = createHash("sha256").update(`${f.id}|${stay?.id ?? "est"}|${pair.depart}|${pair.return}|${ctx.party}|${total}|${req.budget.currency}`).digest("base64url").slice(0, 12);
  return {
    id,
    label: "",
    destination: { code: place.code, name: place.name, country: place.country },
    dates: { depart: pair.depart, return: pair.return, nights: pair.nights, shiftedFromRequested: shiftDays > 0 },
    transport: {
      mode: f.mode,
      provider: f.provider,
      offerId: f.id,
      vehicles: f.vehicles,
      originCity: ctx.origin.code,
      co2KgPerPerson: co2,
      outbound: f.outbound,
      inbound: f.inbound,
      totalPrice: transportTotal,
      quoted: f.currency !== currency ? { amount: f.totalPrice, currency: f.currency } : undefined,
      bookingUrl: f.bookingUrl,
      indicative: !!f.indicative,
    },
    stay: stay
      ? {
          provider: stay.provider,
          offerId: stay.id,
          name: stay.name,
          stars: stay.stars,
          reviewScore: stay.reviewScore,
          nights: stay.nights,
          rooms: stay.rooms,
          sleeps: stay.sleeps,
          totalPrice: stayTotal,
          quoted: stay.currency !== currency ? { amount: stay.totalPrice, currency: stay.currency } : undefined,
          amenities: stay.amenities,
          address: stay.address,
          refundable: stay.refundable,
          bookingUrl: stay.bookingUrl,
          estimated: false,
          indicative: !!stay.indicative,
        }
      : {
          provider: "estimate",
          name: `Typical mid-range accommodation in ${place.name}`,
          nights: pair.nights,
          rooms: ctx.rooms,
          sleeps: ctx.seated,
          totalPrice: stayTotal,
          amenities: [],
          estimated: true,
          indicative: true,
        },
    price: {
      currency,
      total,
      perPerson: round2(total / ctx.party),
      travellers: ctx.party,
      transport: transportTotal,
      stay: stayTotal,
      budget: ctx.target,
      ceiling: ctx.ceiling,
      headroom: round2(ctx.target - total),
      dailySpendPerPerson: place0?.dailySpendGBP ? convert(place0.dailySpendGBP, "GBP", currency) ?? undefined : undefined,
    },
    match: { score: vibe.score, vibe, reasons, watchOuts },
    scores: { overall, match: vibe.score, value: round3(value), convenience: round3(convenience), quality: round3(quality), green: round3(green) },
    summary: "",
    sources: [...new Set([f.provider, stay?.provider ?? "estimate"])],
    indicative: !!f.indicative || !stay || !!stay.indicative,
    locked: [],
  };
}

/**
 * Three options that are genuinely different: the best overall, the best value
 * that still suits, and something different. With an open destination they are
 * three different places; with a fixed one, different stays or dates.
 */
export function choose(packages: TripOption[], kept: TripOption[], openDestination: boolean): TripOption[] {
  const chosen: TripOption[] = kept.map((k) => ({ ...k }));
  const differs = (a: TripOption, b: TripOption) =>
    openDestination ? a.destination.code !== b.destination.code : a.stay.name !== b.stay.name || a.dates.depart !== b.dates.depart || a.transport.offerId !== b.transport.offerId;
  const distinctFromChosen = (p: TripOption) => chosen.every((c) => c.id !== p.id && differs(p, c));
  // Prefer a different stay too when the destination is fixed.
  const freshStay = (p: TripOption) => openDestination || chosen.every((c) => c.stay.name !== p.stay.name);

  const byOverall = [...packages].sort((a, b) => b.scores.overall - a.scores.overall || a.price.total - b.price.total);
  const best = byOverall[0];
  const bestMatch = best ? best.match.score : 0;

  // "Best value" must still suit: close to the best match on vibe, not just cheap.
  const suits = byOverall.filter((p) => p.match.score >= bestMatch * 0.75);
  const byPrice = [...suits].sort((a, b) => a.price.total - b.price.total);
  const has = (label: string) => chosen.some((c) => c.label === label || (c.label === LABELS.both && (label === LABELS.match || label === LABELS.value)));

  if (!has(LABELS.match)) {
    const pick = byOverall.find((p) => distinctFromChosen(p) && freshStay(p)) ?? byOverall.find(distinctFromChosen);
    if (pick) {
      // If nothing that suits is cheaper, the best match is the best value too.
      const cheaper = byPrice.find((p) => p.price.total < pick.price.total && distinctFromChosen(p) && differs(p, pick));
      chosen.push({ ...pick, label: cheaper || has(LABELS.value) ? LABELS.match : LABELS.both });
    }
  }
  if (chosen.length < 3 && !has(LABELS.value)) {
    const anchor = chosen.find((c) => c.label === LABELS.match);
    const pick = byPrice.find((p) => distinctFromChosen(p) && freshStay(p) && (!anchor || p.price.total < anchor.price.total)) ?? byPrice.find((p) => distinctFromChosen(p) && (!anchor || p.price.total < anchor.price.total));
    if (pick) chosen.push({ ...pick, label: LABELS.value });
  }
  if (chosen.length < 3 && chosen.some((c) => c.label === LABELS.both) && !has(LABELS.upgrade)) {
    // Best match already the cheapest: offer the nicest trip that still suits.
    const top = chosen.find((c) => c.label === LABELS.both)!;
    const pick = [...suits]
      .filter((p) => distinctFromChosen(p) && freshStay(p) && p.price.total > top.price.total)
      .sort((a, b) => b.scores.quality + b.scores.convenience - (a.scores.quality + a.scores.convenience) || b.scores.overall - a.scores.overall)[0];
    if (pick) chosen.push({ ...pick, label: LABELS.upgrade });
  }
  if (chosen.length < 3) {
    // Most unlike what is already chosen: different country, stay tier or trip shape.
    const novelty = (p: TripOption) =>
      chosen.reduce(
        (n, c) =>
          n +
          (p.destination.country !== c.destination.country ? 1 : 0) +
          (p.transport.mode !== c.transport.mode ? 0.75 : 0) +
          ((p.stay.stars ?? 3) !== (c.stay.stars ?? 3) ? 0.5 : 0) +
          (p.dates.depart !== c.dates.depart ? 0.25 : 0),
        0,
      );
    const pick =
      [...byOverall]
        .filter(distinctFromChosen)
        .sort((a, b) => b.scores.overall + 0.1 * novelty(b) - (a.scores.overall + 0.1 * novelty(a)))
        .find((p) => freshStay(p)) ?? byOverall.find(distinctFromChosen);
    if (pick) chosen.push({ ...pick, label: LABELS.different });
  }
  // Anything still short (e.g. a role found nothing) is filled from the best remaining.
  for (const p of byOverall) {
    if (chosen.length >= 3) break;
    if (distinctFromChosen(p)) chosen.push({ ...p, label: LABELS.different });
  }
  return chosen.slice(0, 3);
}

/** A kept option survives a refinement only if it still meets every non-negotiable. */
function stillValid(o: TripOption, req: TripRequest, origin: ResolvedPlace, ceiling: number, excluded: Set<string>, destination?: ResolvedPlace): string | null {
  const hubs = new Set(origin.specific || !origin.place ? origin.airports : hubsOf(origin.place));
  const fromHere = !origin.specific && o.transport.originCity === origin.code;
  if (!fromHere && (!hubs.has(o.transport.outbound.from) || !hubs.has(o.transport.inbound.to))) return "it does not leave from your new starting point";
  if (!req.preferences.modes.includes(o.transport.mode)) return `it travels by ${o.transport.mode}, which you have ruled out`;
  if (o.price.currency !== req.budget.currency) return "the budget currency changed";
  if (o.price.travellers !== partySize(req.travellers) || o.stay.sleeps < seatedTravellers(req.travellers)) return "it was priced for a different number of travellers";
  if (o.price.total > ceiling) return `at ${formatMoney(o.price.total, o.price.currency)} it is over your new budget`;
  if (!withinWindow(o.dates, req.dates)) return "it falls outside your new dates";
  if (destination && o.destination.code !== destination.code) return `it is not in ${destination.name}`;
  if (excluded.has(o.destination.code)) return "you ruled that destination out";
  return null;
}

async function pool(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) await tasks[next++]!();
  });
  await Promise.all(workers);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function quote(s: string): string {
  return `“${s}”`;
}
