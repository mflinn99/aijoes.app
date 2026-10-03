// The places the platform knows by heart: airports for resolving a starting
// point, and for open searches ("anywhere"), a destination catalogue tagged by
// what it is like. Live providers bring the prices; this brings the character.
//
// nightlyGBP is a typical mid-range (3-4 star) double room, dailySpendGBP a
// typical per-person spend on food and getting about. Both are indicative and
// only used to estimate when a provider has no stay data, and by the mock.

export interface Place {
  /** IATA metropolitan or city code. */
  code: string;
  name: string;
  country: string;
  airports: string[];
  lat: number;
  lon: number;
  aliases?: string[];
  /** Absent for places we only know as starting points. */
  tags?: string[];
  /** Months (1-12) when it is reliably warm enough for a beach. */
  sunMonths?: number[];
  /** Months (1-12) with a dependable ski season. */
  skiMonths?: number[];
  nightlyGBP?: number;
  dailySpendGBP?: number;
}

const SUMMER = [6, 7, 8, 9];
const LONG_SUMMER = [5, 6, 7, 8, 9, 10];
const ALL_YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const NORTH_WINTER = [11, 12, 1, 2, 3, 4];
const ALPS = [12, 1, 2, 3, 4];

export const PLACES: Place[] = [
  // --- starting points (and destinations in their own right) ---------------
  { code: "LON", name: "London", country: "United Kingdom", airports: ["LHR", "LGW", "STN", "LTN", "LCY", "SEN"], lat: 51.51, lon: -0.13,
    tags: ["city", "culture", "history", "food", "nightlife", "shopping", "art", "theatre"], nightlyGBP: 190, dailySpendGBP: 90 },
  { code: "MAN", name: "Manchester", country: "United Kingdom", airports: ["MAN"], lat: 53.48, lon: -2.24 },
  { code: "BHX", name: "Birmingham", country: "United Kingdom", airports: ["BHX"], lat: 52.49, lon: -1.89 },
  { code: "BRS", name: "Bristol", country: "United Kingdom", airports: ["BRS"], lat: 51.45, lon: -2.59 },
  { code: "EDI", name: "Edinburgh", country: "United Kingdom", airports: ["EDI"], lat: 55.95, lon: -3.19,
    tags: ["city", "culture", "history", "festival", "nature", "hiking"], nightlyGBP: 150, dailySpendGBP: 70 },
  { code: "GLA", name: "Glasgow", country: "United Kingdom", airports: ["GLA"], lat: 55.86, lon: -4.25 },
  { code: "NCL", name: "Newcastle", country: "United Kingdom", airports: ["NCL"], lat: 54.98, lon: -1.61 },
  { code: "BFS", name: "Belfast", country: "United Kingdom", airports: ["BFS", "BHD"], lat: 54.6, lon: -5.93 },
  { code: "DUB", name: "Dublin", country: "Ireland", airports: ["DUB"], lat: 53.35, lon: -6.26,
    tags: ["city", "nightlife", "culture", "history", "food"], nightlyGBP: 170, dailySpendGBP: 75 },
  { code: "NYC", name: "New York", country: "United States", airports: ["JFK", "EWR", "LGA"], lat: 40.71, lon: -74.01, aliases: ["NYC", "Manhattan"],
    tags: ["city", "food", "shopping", "nightlife", "art", "culture", "theatre"], nightlyGBP: 260, dailySpendGBP: 110 },
  { code: "LAX", name: "Los Angeles", country: "United States", airports: ["LAX"], lat: 34.05, lon: -118.24, aliases: ["LA"],
    tags: ["city", "beach", "food", "shopping", "nightlife"], sunMonths: LONG_SUMMER, nightlyGBP: 210, dailySpendGBP: 100 },
  { code: "CHI", name: "Chicago", country: "United States", airports: ["ORD", "MDW"], lat: 41.88, lon: -87.63 },
  { code: "YTO", name: "Toronto", country: "Canada", airports: ["YYZ"], lat: 43.65, lon: -79.38 },
  { code: "PAR", name: "Paris", country: "France", airports: ["CDG", "ORY"], lat: 48.86, lon: 2.35,
    tags: ["city", "romance", "food", "art", "culture", "history", "shopping", "wine"], nightlyGBP: 200, dailySpendGBP: 85 },
  { code: "AMS", name: "Amsterdam", country: "Netherlands", airports: ["AMS"], lat: 52.37, lon: 4.9,
    tags: ["city", "nightlife", "art", "culture", "cycling"], nightlyGBP: 190, dailySpendGBP: 80 },
  { code: "FRA", name: "Frankfurt", country: "Germany", airports: ["FRA"], lat: 50.11, lon: 8.68 },

  // --- Europe -----------------------------------------------------------------
  { code: "BCN", name: "Barcelona", country: "Spain", airports: ["BCN"], lat: 41.39, lon: 2.17,
    tags: ["city", "beach", "food", "nightlife", "art", "culture", "architecture"], sunMonths: LONG_SUMMER, nightlyGBP: 150, dailySpendGBP: 70 },
  { code: "MAD", name: "Madrid", country: "Spain", airports: ["MAD"], lat: 40.42, lon: -3.7,
    tags: ["city", "food", "nightlife", "art", "culture"], nightlyGBP: 130, dailySpendGBP: 65 },
  { code: "PMI", name: "Mallorca", country: "Spain", airports: ["PMI"], lat: 39.57, lon: 2.65, aliases: ["Majorca", "Palma"],
    tags: ["beach", "relax", "family", "islands", "nightlife", "hiking", "cycling"], sunMonths: LONG_SUMMER, nightlyGBP: 140, dailySpendGBP: 60 },
  { code: "IBZ", name: "Ibiza", country: "Spain", airports: ["IBZ"], lat: 38.91, lon: 1.43,
    tags: ["beach", "nightlife", "party", "islands", "wellness"], sunMonths: SUMMER, nightlyGBP: 190, dailySpendGBP: 90 },
  { code: "TFS", name: "Tenerife", country: "Spain", airports: ["TFS", "TFN"], lat: 28.29, lon: -16.63,
    tags: ["beach", "relax", "family", "nature", "hiking", "islands"], sunMonths: ALL_YEAR, nightlyGBP: 110, dailySpendGBP: 55 },
  { code: "LPA", name: "Gran Canaria", country: "Spain", airports: ["LPA"], lat: 27.93, lon: -15.39,
    tags: ["beach", "relax", "family", "islands", "nightlife"], sunMonths: ALL_YEAR, nightlyGBP: 105, dailySpendGBP: 55 },
  { code: "AGP", name: "Malaga", country: "Spain", airports: ["AGP"], lat: 36.72, lon: -4.42, aliases: ["Costa del Sol", "Marbella"],
    tags: ["beach", "food", "culture", "family", "golf"], sunMonths: [4, 5, 6, 7, 8, 9, 10], nightlyGBP: 115, dailySpendGBP: 55 },
  { code: "SVQ", name: "Seville", country: "Spain", airports: ["SVQ"], lat: 37.39, lon: -5.98,
    tags: ["city", "culture", "history", "food", "romance", "architecture"], nightlyGBP: 115, dailySpendGBP: 55 },
  { code: "LIS", name: "Lisbon", country: "Portugal", airports: ["LIS"], lat: 38.72, lon: -9.14,
    tags: ["city", "food", "culture", "history", "nightlife", "beach", "romance"], sunMonths: SUMMER, nightlyGBP: 135, dailySpendGBP: 60 },
  { code: "FAO", name: "Algarve", country: "Portugal", airports: ["FAO"], lat: 37.02, lon: -7.93, aliases: ["Faro"],
    tags: ["beach", "relax", "family", "golf", "nature"], sunMonths: LONG_SUMMER, nightlyGBP: 110, dailySpendGBP: 50 },
  { code: "FNC", name: "Madeira", country: "Portugal", airports: ["FNC"], lat: 32.65, lon: -16.91,
    tags: ["nature", "hiking", "relax", "islands", "romance", "wine"], sunMonths: [5, 6, 7, 8, 9, 10], nightlyGBP: 115, dailySpendGBP: 50 },
  { code: "ROM", name: "Rome", country: "Italy", airports: ["FCO", "CIA"], lat: 41.9, lon: 12.5,
    tags: ["city", "history", "culture", "food", "romance", "art", "architecture"], nightlyGBP: 165, dailySpendGBP: 70 },
  { code: "MIL", name: "Milan", country: "Italy", airports: ["MXP", "LIN", "BGY"], lat: 45.46, lon: 9.19,
    tags: ["city", "shopping", "food", "art", "fashion"], nightlyGBP: 165, dailySpendGBP: 75 },
  { code: "VCE", name: "Venice", country: "Italy", airports: ["VCE", "TSF"], lat: 45.44, lon: 12.32,
    tags: ["romance", "history", "culture", "art", "architecture", "food"], nightlyGBP: 210, dailySpendGBP: 80 },
  { code: "NAP", name: "Naples & Amalfi", country: "Italy", airports: ["NAP"], lat: 40.85, lon: 14.27, aliases: ["Naples", "Amalfi Coast", "Sorrento"],
    tags: ["food", "beach", "romance", "history", "culture"], sunMonths: SUMMER, nightlyGBP: 140, dailySpendGBP: 60 },
  { code: "CAG", name: "Sardinia", country: "Italy", airports: ["CAG", "OLB"], lat: 39.22, lon: 9.11,
    tags: ["beach", "relax", "islands", "nature", "diving", "food"], sunMonths: SUMMER, nightlyGBP: 150, dailySpendGBP: 65 },
  { code: "ATH", name: "Athens", country: "Greece", airports: ["ATH"], lat: 37.98, lon: 23.73,
    tags: ["city", "history", "culture", "food", "nightlife"], sunMonths: LONG_SUMMER, nightlyGBP: 120, dailySpendGBP: 55 },
  { code: "JTR", name: "Santorini", country: "Greece", airports: ["JTR"], lat: 36.39, lon: 25.46,
    tags: ["romance", "beach", "islands", "luxury", "wine", "relax"], sunMonths: SUMMER, nightlyGBP: 230, dailySpendGBP: 85 },
  { code: "CFU", name: "Corfu", country: "Greece", airports: ["CFU"], lat: 39.62, lon: 19.92,
    tags: ["beach", "family", "relax", "islands", "nature"], sunMonths: SUMMER, nightlyGBP: 110, dailySpendGBP: 50 },
  { code: "HER", name: "Crete", country: "Greece", airports: ["HER", "CHQ"], lat: 35.34, lon: 25.13, aliases: ["Heraklion", "Chania"],
    tags: ["beach", "history", "family", "hiking", "food", "islands"], sunMonths: LONG_SUMMER, nightlyGBP: 110, dailySpendGBP: 50 },
  { code: "DBV", name: "Dubrovnik", country: "Croatia", airports: ["DBV"], lat: 42.65, lon: 18.09,
    tags: ["history", "beach", "romance", "culture", "islands"], sunMonths: SUMMER, nightlyGBP: 170, dailySpendGBP: 70 },
  { code: "SPU", name: "Split", country: "Croatia", airports: ["SPU"], lat: 43.51, lon: 16.44,
    tags: ["beach", "nightlife", "islands", "history", "sailing"], sunMonths: SUMMER, nightlyGBP: 130, dailySpendGBP: 55 },
  { code: "PRG", name: "Prague", country: "Czechia", airports: ["PRG"], lat: 50.08, lon: 14.44,
    tags: ["city", "history", "nightlife", "culture", "architecture", "beer", "budget"], nightlyGBP: 100, dailySpendGBP: 45 },
  { code: "BUD", name: "Budapest", country: "Hungary", airports: ["BUD"], lat: 47.5, lon: 19.04,
    tags: ["city", "nightlife", "wellness", "history", "culture", "budget"], nightlyGBP: 95, dailySpendGBP: 45 },
  { code: "KRK", name: "Krakow", country: "Poland", airports: ["KRK"], lat: 50.06, lon: 19.94,
    tags: ["city", "history", "culture", "nightlife", "budget"], nightlyGBP: 80, dailySpendGBP: 40 },
  { code: "BER", name: "Berlin", country: "Germany", airports: ["BER"], lat: 52.52, lon: 13.4,
    tags: ["city", "nightlife", "art", "history", "culture", "party"], nightlyGBP: 130, dailySpendGBP: 60 },
  { code: "MUC", name: "Munich", country: "Germany", airports: ["MUC"], lat: 48.14, lon: 11.58, aliases: ["Bavaria"],
    tags: ["city", "beer", "culture", "festival", "history", "food"], nightlyGBP: 150, dailySpendGBP: 70 },
  { code: "VIE", name: "Vienna", country: "Austria", airports: ["VIE"], lat: 48.21, lon: 16.37,
    tags: ["city", "culture", "history", "music", "art", "food"], nightlyGBP: 140, dailySpendGBP: 65 },
  { code: "CPH", name: "Copenhagen", country: "Denmark", airports: ["CPH"], lat: 55.68, lon: 12.57,
    tags: ["city", "food", "design", "culture", "cycling"], nightlyGBP: 200, dailySpendGBP: 95 },
  { code: "REK", name: "Reykjavik", country: "Iceland", airports: ["KEF"], lat: 64.15, lon: -21.94, aliases: ["Iceland"],
    tags: ["nature", "adventure", "hiking", "northern lights", "wellness"], nightlyGBP: 190, dailySpendGBP: 100 },
  { code: "GVA", name: "Geneva & Alps", country: "Switzerland", airports: ["GVA"], lat: 46.2, lon: 6.14, aliases: ["Geneva", "Chamonix"],
    tags: ["ski", "mountains", "nature", "hiking", "luxury"], skiMonths: ALPS, nightlyGBP: 210, dailySpendGBP: 110 },
  { code: "INN", name: "Innsbruck", country: "Austria", airports: ["INN"], lat: 47.27, lon: 11.39, aliases: ["Tyrol"],
    tags: ["ski", "mountains", "nature", "hiking", "adventure"], skiMonths: ALPS, nightlyGBP: 150, dailySpendGBP: 80 },
  { code: "MLA", name: "Malta", country: "Malta", airports: ["MLA"], lat: 35.9, lon: 14.51,
    tags: ["beach", "history", "diving", "islands", "culture"], sunMonths: LONG_SUMMER, nightlyGBP: 120, dailySpendGBP: 55 },
  { code: "IST", name: "Istanbul", country: "Turkey", airports: ["IST", "SAW"], lat: 41.01, lon: 28.98,
    tags: ["city", "history", "food", "culture", "shopping"], nightlyGBP: 100, dailySpendGBP: 45 },
  { code: "DLM", name: "Dalaman & Fethiye", country: "Turkey", airports: ["DLM"], lat: 36.75, lon: 28.79, aliases: ["Fethiye", "Turkish Riviera"],
    tags: ["beach", "family", "relax", "adventure", "budget", "sailing"], sunMonths: LONG_SUMMER, nightlyGBP: 75, dailySpendGBP: 40 },

  // --- Africa & the Middle East ------------------------------------------------
  { code: "RAK", name: "Marrakech", country: "Morocco", airports: ["RAK"], lat: 31.63, lon: -8.0,
    tags: ["culture", "food", "shopping", "wellness", "history", "adventure"], nightlyGBP: 95, dailySpendGBP: 45 },
  { code: "RMF", name: "Marsa Alam", country: "Egypt", airports: ["RMF", "HRG"], lat: 25.07, lon: 34.89, aliases: ["Red Sea", "Hurghada"],
    tags: ["beach", "diving", "relax", "budget"], sunMonths: ALL_YEAR, nightlyGBP: 80, dailySpendGBP: 35 },
  { code: "DXB", name: "Dubai", country: "United Arab Emirates", airports: ["DXB", "DWC"], lat: 25.2, lon: 55.27,
    tags: ["beach", "luxury", "shopping", "city", "family"], sunMonths: [10, 11, 12, 1, 2, 3, 4], nightlyGBP: 160, dailySpendGBP: 90 },
  { code: "CPT", name: "Cape Town", country: "South Africa", airports: ["CPT"], lat: -33.92, lon: 18.42,
    tags: ["nature", "adventure", "wine", "food", "beach", "hiking"], sunMonths: [11, 12, 1, 2, 3], nightlyGBP: 110, dailySpendGBP: 50 },
  { code: "ZNZ", name: "Zanzibar", country: "Tanzania", airports: ["ZNZ"], lat: -6.17, lon: 39.2,
    tags: ["beach", "islands", "relax", "diving", "romance"], sunMonths: [6, 7, 8, 9, 10, 12, 1, 2], nightlyGBP: 110, dailySpendGBP: 45 },

  // --- Asia & Oceania -------------------------------------------------------
  { code: "BKK", name: "Bangkok", country: "Thailand", airports: ["BKK", "DMK"], lat: 13.76, lon: 100.5,
    tags: ["city", "food", "nightlife", "culture", "shopping", "budget"], nightlyGBP: 70, dailySpendGBP: 35 },
  { code: "HKT", name: "Phuket", country: "Thailand", airports: ["HKT"], lat: 7.88, lon: 98.39,
    tags: ["beach", "islands", "nightlife", "diving", "relax", "budget"], sunMonths: NORTH_WINTER, nightlyGBP: 75, dailySpendGBP: 35 },
  { code: "DPS", name: "Bali", country: "Indonesia", airports: ["DPS"], lat: -8.65, lon: 115.22,
    tags: ["beach", "wellness", "culture", "nature", "relax", "romance", "budget"], sunMonths: [4, 5, 6, 7, 8, 9, 10], nightlyGBP: 70, dailySpendGBP: 35 },
  { code: "MLE", name: "Maldives", country: "Maldives", airports: ["MLE"], lat: 4.18, lon: 73.51,
    tags: ["beach", "luxury", "romance", "diving", "relax", "islands"], sunMonths: [11, 12, 1, 2, 3, 4], nightlyGBP: 420, dailySpendGBP: 120 },
  { code: "SIN", name: "Singapore", country: "Singapore", airports: ["SIN"], lat: 1.35, lon: 103.82,
    tags: ["city", "food", "shopping", "family"], nightlyGBP: 190, dailySpendGBP: 80 },
  { code: "TYO", name: "Tokyo", country: "Japan", airports: ["HND", "NRT"], lat: 35.68, lon: 139.69,
    tags: ["city", "food", "culture", "shopping", "nightlife", "art"], nightlyGBP: 150, dailySpendGBP: 70 },
  { code: "SYD", name: "Sydney", country: "Australia", airports: ["SYD"], lat: -33.87, lon: 151.21,
    tags: ["city", "beach", "food", "nature"], sunMonths: [11, 12, 1, 2, 3], nightlyGBP: 180, dailySpendGBP: 85 },

  // --- the Americas -------------------------------------------------------
  { code: "CUN", name: "Cancun", country: "Mexico", airports: ["CUN"], lat: 21.16, lon: -86.85, aliases: ["Riviera Maya", "Tulum"],
    tags: ["beach", "nightlife", "family", "history", "diving", "party"], sunMonths: [11, 12, 1, 2, 3, 4, 5], nightlyGBP: 140, dailySpendGBP: 60 },
  { code: "MIA", name: "Miami", country: "United States", airports: ["MIA", "FLL"], lat: 25.76, lon: -80.19,
    tags: ["beach", "nightlife", "city", "party", "food"], sunMonths: ALL_YEAR, nightlyGBP: 210, dailySpendGBP: 95 },
  { code: "ORL", name: "Orlando", country: "United States", airports: ["MCO"], lat: 28.54, lon: -81.38,
    tags: ["family", "theme parks", "shopping"], sunMonths: [3, 4, 5, 6, 7, 8, 9, 10, 11], nightlyGBP: 140, dailySpendGBP: 90 },
  { code: "BGI", name: "Barbados", country: "Barbados", airports: ["BGI"], lat: 13.1, lon: -59.61,
    tags: ["beach", "luxury", "relax", "romance", "islands", "food"], sunMonths: ALL_YEAR, nightlyGBP: 260, dailySpendGBP: 90 },
];

const BY_CODE = new Map<string, Place>();
const BY_AIRPORT = new Map<string, Place>();
const BY_NAME = new Map<string, Place>();
for (const p of PLACES) {
  BY_CODE.set(p.code, p);
  for (const a of p.airports) BY_AIRPORT.set(a, p);
  for (const n of [p.name, ...(p.aliases ?? [])]) BY_NAME.set(normalise(n), p);
}

function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ResolvedPlace {
  code: string;
  name: string;
  country: string;
  airports: string[];
  lat?: number;
  lon?: number;
  /** The catalogue entry, when we know the place. */
  place?: Place;
  /** The traveller named one airport: only that airport will do, by any mode. */
  specific?: boolean;
}

function fromPlace(p: Place, airports = p.airports): ResolvedPlace {
  return { code: p.code, name: p.name, country: p.country, airports, lat: p.lat, lon: p.lon, place: p };
}

/**
 * Resolve free text ("London", "lgw", "Palma") to a place with its airports.
 * A specific airport code narrows to that airport only: if the traveller says
 * "from Gatwick (LGW)" we never fly them from Heathrow.
 */
export function resolvePlace(text: string): ResolvedPlace | null {
  const raw = text.trim();
  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) {
    const city = BY_CODE.get(upper);
    // A city code that is also one of its airports (MAN, EDI) means the city.
    if (city) return fromPlace(city);
    const viaAirport = BY_AIRPORT.get(upper);
    if (viaAirport) return { ...fromPlace(viaAirport, [upper]), specific: true };
  }
  const key = normalise(raw);
  const named = BY_NAME.get(key);
  if (named) return fromPlace(named);
  // "London Gatwick", "Paris, France": try the leading words.
  const words = key.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const hit = BY_NAME.get(words.slice(0, n).join(" "));
    if (hit) return fromPlace(hit);
  }
  return null;
}

export function placeByCode(code: string): Place | undefined {
  return BY_CODE.get(code) ?? BY_AIRPORT.get(code);
}

export function destinationCatalogue(): Place[] {
  return PLACES.filter((p) => p.tags && p.tags.length > 0);
}

export function suggestPlaces(text: string, limit = 5): string[] {
  const key = normalise(text);
  if (!key) return [];
  return PLACES.filter((p) => [p.name, ...(p.aliases ?? [])].map(normalise).some((n) => n.startsWith(key) || n.includes(key) || key.startsWith(n)))
    .slice(0, limit)
    .map((p) => p.name);
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
