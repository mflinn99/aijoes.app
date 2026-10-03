import { PLACES, resolvePlace } from "./places.js";
import { interpret, type KeywordProfile } from "./vibe.js";

// The keyword box: anything at all the traveller types to inform the search —
// "christmas markets", "Lisbon-ish", "honeymoon", "Greece", "tapas", "rooftop
// pool". Keywords never constrain; they steer. Each one is read in turn as a
// place, a region or country, a theme (with its season), a vibe word, or,
// failing all of those, free text matched against destinations and hotels.
// Every keyword is reported back with what it did, so nothing vanishes.

export interface KeywordInsight {
  keyword: string;
  kind: "place" | "region" | "theme" | "vibe" | "travel" | "text";
  effect: string;
  places?: string[];
  tags?: string[];
}

interface Theme {
  words: string[];
  places: string[];
  tags?: string[];
  /** Months (1-12) when the theme happens; out of season it barely counts. */
  months?: number[];
  label: string;
}

const THEMES: Theme[] = [
  { label: "Christmas markets", words: ["christmas market", "christmas markets", "xmas market", "festive market"], places: ["PRG", "VIE", "KRK", "BER", "MUC", "BUD", "EDI"], tags: ["culture", "food"], months: [11, 12] },
  { label: "northern lights", words: ["northern lights", "aurora", "aurora borealis"], places: ["REK"], tags: ["nature", "adventure"], months: [9, 10, 11, 12, 1, 2, 3] },
  { label: "Oktoberfest", words: ["oktoberfest"], places: ["MUC"], tags: ["beer", "party", "festival"], months: [9, 10] },
  { label: "carnival", words: ["carnival", "carnevale"], places: ["VCE", "LPA", "TFS"], tags: ["festival", "party"], months: [2, 3] },
  { label: "Edinburgh festivals", words: ["fringe", "edinburgh festival"], places: ["EDI"], tags: ["festival", "theatre"], months: [8] },
  { label: "cherry blossom", words: ["cherry blossom", "sakura", "hanami"], places: ["TYO"], tags: ["nature", "culture"], months: [3, 4] },
  { label: "safari", words: ["safari", "big five", "wildlife safari"], places: ["CPT", "ZNZ"], tags: ["nature", "adventure"] },
  { label: "theme parks", words: ["disney", "disneyland", "disney world", "universal studios", "theme park", "theme parks"], places: ["ORL", "PAR"], tags: ["family", "theme parks"] },
  { label: "honeymoon", words: ["honeymoon", "anniversary", "babymoon", "proposal"], places: ["MLE", "JTR", "BGI", "DPS", "VCE", "ZNZ"], tags: ["romance", "luxury"] },
  { label: "stag or hen", words: ["stag", "stag do", "hen do", "hen party", "bachelor", "bachelorette"], places: ["PRG", "BUD", "KRK", "IBZ", "BER", "AMS", "DUB"], tags: ["party", "nightlife"] },
  { label: "winter sun", words: ["winter sun", "escape the cold", "escape winter"], places: ["TFS", "LPA", "DXB", "RMF", "BGI", "CUN", "HKT", "MLE"], tags: ["warm", "beach"], months: [11, 12, 1, 2, 3] },
  { label: "surfing", words: ["surf", "surfing", "surf camp"], places: ["LIS", "LPA", "FAO", "DPS", "SYD", "CPT"], tags: ["beach", "adventure"] },
  { label: "golf", words: ["golf trip", "golfing holiday", "golf"], places: ["AGP", "FAO", "DXB", "ORL"], tags: ["golf"] },
  { label: "wine tasting", words: ["wine tasting", "vineyards", "wine region", "winery"], places: ["CPT", "FNC", "PAR", "JTR"], tags: ["wine", "food"] },
  { label: "diving", words: ["scuba", "dive trip", "liveaboard", "reef"], places: ["RMF", "MLE", "ZNZ", "HKT", "MLA", "CUN"], tags: ["diving"] },
  { label: "thermal baths", words: ["thermal baths", "hot springs", "blue lagoon", "bathhouse"], places: ["BUD", "REK"], tags: ["wellness"] },
  { label: "tapas", words: ["tapas", "pintxos", "sangria", "flamenco"], places: ["MAD", "SVQ", "BCN", "AGP"], tags: ["food", "culture"] },
  { label: "Italian food", words: ["pasta", "pizza", "gelato", "aperitivo"], places: ["ROM", "NAP", "MIL", "VCE"], tags: ["food"] },
  { label: "Japanese food", words: ["sushi", "ramen", "izakaya"], places: ["TYO"], tags: ["food"] },
  { label: "street food", words: ["street food", "night markets", "hawker"], places: ["BKK", "SIN", "IST", "HKT"], tags: ["food"] },
  { label: "castles", words: ["castle", "castles", "medieval"], places: ["EDI", "PRG", "KRK", "DBV"], tags: ["history"] },
  { label: "ancient history", words: ["ruins", "ancient", "colosseum", "acropolis", "mayan", "pyramids"], places: ["ROM", "ATH", "HER", "CUN", "IST"], tags: ["history", "culture"] },
  { label: "beer", words: ["beer", "craft beer", "breweries", "pubs"], places: ["PRG", "MUC", "BER", "DUB"], tags: ["beer", "nightlife"] },
  { label: "shopping", words: ["shopping trip", "outlets", "souks", "christmas shopping"], places: ["NYC", "DXB", "MIL", "IST", "RAK"], tags: ["shopping"] },
  { label: "all inclusive", words: ["all inclusive", "all-inclusive"], places: ["CUN", "DLM", "RMF", "TFS", "LPA"], tags: ["relax", "family"] },
  { label: "island hopping", words: ["island hopping", "islands"], places: ["SPU", "JTR", "HKT", "CFU"], tags: ["islands", "sailing"] },
  { label: "hiking", words: ["trek", "hiking trip", "mountain walks", "levada"], places: ["FNC", "INN", "GVA", "TFS", "CPT", "REK"], tags: ["hiking", "nature"] },
  { label: "skiing", words: ["ski trip", "skiing", "snowboarding", "apres ski"], places: ["GVA", "INN"], tags: ["ski", "mountains"], months: [12, 1, 2, 3, 4] },
  { label: "beach clubs", words: ["beach club", "beach clubs", "pool party"], places: ["IBZ", "MIA", "SPU", "DXB"], tags: ["party", "beach"] },
];

const REGIONS: Record<string, string[]> = {
  caribbean: ["BGI", "CUN"],
  canaries: ["TFS", "LPA"],
  "canary islands": ["TFS", "LPA"],
  "greek islands": ["JTR", "CFU", "HER"],
  balearics: ["PMI", "IBZ"],
  mediterranean: ["BCN", "PMI", "NAP", "ATH", "DBV", "MLA", "CAG", "JTR"],
  scandinavia: ["CPH", "REK"],
  "south east asia": ["BKK", "HKT", "DPS", "SIN"],
  "southeast asia": ["BKK", "HKT", "DPS", "SIN"],
  asia: ["BKK", "HKT", "DPS", "SIN", "TYO", "MLE"],
  "middle east": ["DXB"],
  africa: ["RAK", "CPT", "ZNZ", "RMF"],
  usa: ["NYC", "MIA", "ORL", "LAX"],
  america: ["NYC", "MIA", "ORL", "LAX"],
  "eastern europe": ["PRG", "BUD", "KRK"],
  europe: PLACES.filter((p) => ["United Kingdom", "Ireland", "France", "Netherlands", "Germany", "Spain", "Portugal", "Italy", "Greece", "Croatia", "Czechia", "Hungary", "Poland", "Austria", "Denmark", "Malta"].includes(p.country) && p.tags).map((p) => p.code),
  alps: ["GVA", "INN"],
};

const COUNTRIES = new Map<string, string[]>();
for (const p of PLACES) {
  if (!p.tags) continue;
  const key = p.country.toLowerCase();
  COUNTRIES.set(key, [...(COUNTRIES.get(key) ?? []), p.code]);
}
COUNTRIES.set("uk", COUNTRIES.get("united kingdom") ?? []);
COUNTRIES.set("us", COUNTRIES.get("united states") ?? []);
COUNTRIES.set("uae", COUNTRIES.get("united arab emirates") ?? []);

function names(codes: string[]): string[] {
  return codes.map((c) => PLACES.find((p) => p.code === c)?.name ?? c);
}

function clean(k: string): string {
  return k
    .toLowerCase()
    .replace(/[-_]?ish\b/g, "")
    .replace(/[^a-z0-9' &-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Said anywhere in the brief, this rules flights out: the one keyword that constrains. */
export const FLIGHT_FREE = /\b(flight[- ]?free|no[- ]fly(?:ing)?|no flights?|not flying|without flying)\b/;

const TRAVEL_WORDS: [string, RegExp][] = [
  ["train", /^(trains?|rail|railway|by train|sleeper trains?|interrail(?:ing)?|scenic rail)$/],
  ["car", /^(road ?trip|drive|driving|by car)$/],
  ["coach", /^(coach|bus|by coach|by bus)$/],
  ["ferry", /^(ferry|ferries|by ferry|by sea)$/],
  ["low-carbon transport", /^(eco|low[- ]carbon|sustainable(?: travel)?|green travel|slow travel)$/],
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Read the keyword box into a profile the scorer uses, plus a plain account of each keyword. */
export function interpretKeywords(keywords: string[], month: number): { profile: KeywordProfile; insights: KeywordInsight[] } {
  const boosts: KeywordProfile["boosts"] = {};
  const tags = new Set<string>();
  const text: string[] = [];
  const insights: KeywordInsight[] = [];
  const boost = (codes: string[], weight: number, keyword: string) => {
    for (const c of codes) if ((boosts[c]?.weight ?? 0) < weight) boosts[c] = { weight, keyword };
  };

  for (const raw of keywords) {
    const k = clean(raw);
    if (!k) continue;

    if (FLIGHT_FREE.test(k)) {
      insights.push({ keyword: raw, kind: "travel", effect: "Read as flight-free: flights are ruled out; trains, coaches, ferries and driving only." });
      continue;
    }
    const mode = TRAVEL_WORDS.find(([, re]) => re.test(k));
    if (mode) {
      insights.push({ keyword: raw, kind: "travel", effect: `Favouring travel by ${mode[0]}, without ruling other ways out.` });
      continue;
    }

    const theme = THEMES.find((t) => t.words.some((w) => k === w || ` ${k} `.includes(` ${w} `)));
    if (theme) {
      const inSeason = !theme.months || theme.months.includes(month);
      boost(theme.places, inSeason ? 1 : 0.25, raw);
      if (inSeason) theme.tags?.forEach((t) => tags.add(t));
      insights.push({
        keyword: raw,
        kind: "theme",
        effect: inSeason
          ? `Read as ${theme.label}: favouring ${names(theme.places).slice(0, 4).join(", ")}${theme.places.length > 4 ? " and others" : ""}.`
          : `Read as ${theme.label}, which is out of season on your dates (best ${theme.months!.map((m) => MONTH_NAMES[m - 1]).join(", ")}), so it only nudges the search.`,
        places: names(theme.places),
        tags: theme.tags,
      });
      continue;
    }

    const place = resolvePlace(k);
    if (place?.place?.tags) {
      boost([place.code], 1.2, raw);
      insights.push({ keyword: raw, kind: "place", effect: `Favouring ${place.name}, without ruling anywhere else out. Set it as the destination to search only there.`, places: [place.name] });
      continue;
    }

    const region = REGIONS[k] ?? COUNTRIES.get(k);
    if (region?.length) {
      boost(region, 0.8, raw);
      insights.push({ keyword: raw, kind: "region", effect: `Favouring destinations in ${raw.trim()}: ${names(region).slice(0, 5).join(", ")}${region.length > 5 ? " and others" : ""}.`, places: names(region) });
      continue;
    }

    const vibe = interpret([raw]);
    if (vibe.tags.length) {
      vibe.tags.forEach((t) => tags.add(t));
      text.push(...vibe.keywords);
      insights.push({ keyword: raw, kind: "vibe", effect: `Read as ${vibe.tags.join(", ")}${vibe.keywords.length ? `, and looking for "${vibe.keywords.join(", ")}" in destinations and hotels` : ""}.`, tags: vibe.tags });
      continue;
    }

    text.push(k);
    insights.push({ keyword: raw, kind: "text", effect: `Looking for "${k}" in destination and hotel names and amenities.` });
  }
  return { profile: { tags: [...tags], text, boosts }, insights };
}
