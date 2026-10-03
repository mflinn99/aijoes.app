import type { Place } from "./places.js";

// Turning "chilled beach, good food, no stag dos" into something we can score.
// Words map to a small vocabulary of tags; destinations carry those tags. Words
// we cannot map are kept as keywords and matched against names and amenities,
// so nothing the traveller says is silently thrown away.

const SYNONYMS: Record<string, string[]> = {
  beach: ["beach", "beaches", "seaside", "coast", "coastal", "sand", "sea", "ocean", "swim", "swimming"],
  warm: ["sun", "sunny", "sunshine", "warm", "hot", "heat", "tan", "summer", "tropical"],
  relax: ["relax", "relaxed", "relaxing", "chill", "chilled", "chilling", "calm", "quiet", "peaceful", "lazy", "unwind", "slow", "laid back", "laid-back", "rest"],
  city: ["city", "cities", "urban", "city break", "metropolis"],
  culture: ["culture", "cultural", "museum", "museums", "local life", "heritage"],
  history: ["history", "historic", "historical", "ancient", "ruins", "castles", "old town"],
  food: ["food", "foodie", "eat", "eating", "cuisine", "restaurants", "dining", "gastronomy", "street food", "michelin"],
  nightlife: ["nightlife", "bars", "clubs", "clubbing", "night out", "nights out", "drinks", "cocktails"],
  party: ["party", "partying", "rave", "stag", "hen", "festival vibes", "lively", "buzzing"],
  nature: ["nature", "outdoors", "landscape", "scenery", "wildlife", "countryside", "national park", "green"],
  adventure: ["adventure", "adventurous", "thrill", "adrenaline", "explore", "exploring", "active", "action"],
  hiking: ["hike", "hiking", "walking", "trek", "trekking", "trails"],
  romance: ["romance", "romantic", "honeymoon", "couple", "couples", "anniversary", "date"],
  family: ["family", "families", "kids", "children", "child friendly", "kid friendly", "family friendly"],
  wellness: ["wellness", "spa", "spas", "yoga", "retreat", "detox", "massage", "thermal", "baths"],
  luxury: ["luxury", "luxurious", "five star", "5 star", "upscale", "fancy", "treat", "splurge", "high end", "boutique"],
  budget: ["budget", "cheap", "affordable", "value", "backpacking", "inexpensive"],
  shopping: ["shopping", "shops", "markets", "souks", "malls", "boutiques"],
  art: ["art", "galleries", "gallery", "street art"],
  ski: ["ski", "skiing", "snowboard", "snowboarding", "snow", "slopes", "apres"],
  mountains: ["mountain", "mountains", "alps", "alpine"],
  diving: ["diving", "dive", "snorkel", "snorkelling", "snorkeling", "scuba", "reef", "coral"],
  islands: ["island", "islands", "island hopping"],
  wine: ["wine", "wineries", "vineyards", "wine tasting"],
  architecture: ["architecture", "buildings", "gaudi"],
  music: ["music", "opera", "concerts", "classical"],
  sailing: ["sailing", "boat", "boats", "yacht", "yachting"],
  golf: ["golf", "golfing"],
  "theme parks": ["theme park", "theme parks", "disney", "rollercoasters", "universal"],
  "northern lights": ["northern lights", "aurora"],
  cycling: ["cycling", "bike", "bikes", "biking"],
  theatre: ["theatre", "theater", "shows", "musicals", "west end", "broadway"],
  festival: ["festival", "festivals"],
  beer: ["beer", "pubs", "breweries"],
  design: ["design", "scandi"],
  fashion: ["fashion"],
};

// Tags that pull against each other: liking one counts as a mild dislike of the other.
const OPPOSITES: [string, string][] = [
  ["relax", "party"],
  ["relax", "nightlife"],
  ["budget", "luxury"],
  ["family", "party"],
  ["family", "nightlife"],
];

const PHRASES: [string, string][] = Object.entries(SYNONYMS)
  .flatMap(([tag, words]) => words.map((w) => [w, tag] as [string, string]))
  // Longest first, so "street food" wins over "food" and "night out" over "night".
  .sort((a, b) => b[0].length - a[0].length);

export interface Interpreted {
  tags: string[];
  keywords: string[];
}

/** Map free text (or a list of phrases) to vocabulary tags plus leftover keywords. */
export function interpret(phrases: string[]): Interpreted {
  const tags = new Set<string>();
  const keywords: string[] = [];
  for (const phrase of phrases) {
    let rest = ` ${phrase.toLowerCase().replace(/[^a-z0-9' -]/g, " ")} `;
    for (const [word, tag] of PHRASES) {
      const pattern = new RegExp(`\\b${word.replace(/[-]/g, "[- ]")}\\b`, "g");
      if (pattern.test(rest)) {
        tags.add(tag);
        rest = rest.replace(pattern, " ");
      }
    }
    const leftover = rest
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w));
    if (leftover.length > 0) keywords.push(leftover.join(" "));
  }
  return { tags: [...tags], keywords };
}

const STOPWORDS = new Set(["with", "and", "some", "good", "great", "lots", "plenty", "nice", "really", "very", "somewhere", "place", "places", "lovely", "proper", "want", "like", "love", "that", "this", "from", "into", "kind", "sort", "vibe", "vibes", "trip", "holiday", "break"]);

/** What the keyword box contributes (see keywords.ts). */
export interface KeywordProfile {
  tags: string[];
  /** Free text matched against destination and hotel names and amenities. */
  text: string[];
  /** Destinations a keyword points at, by city code: weight 0 to 1.2, and which keyword. */
  boosts: Record<string, { weight: number; keyword: string }>;
}

export interface VibeProfile {
  vibe: Interpreted;
  likes: Interpreted;
  dislikes: Interpreted;
  keywords: KeywordProfile;
}

const NO_KEYWORDS: KeywordProfile = { tags: [], text: [], boosts: {} };

export function profile(vibe: string[], likes: string[], dislikes: string[], keywords: KeywordProfile = NO_KEYWORDS): VibeProfile {
  return { vibe: interpret(vibe), likes: interpret(likes), dislikes: interpret(dislikes), keywords };
}

export interface VibeMatch {
  /** 0 to 1. */
  score: number;
  matched: string[];
  missed: string[];
  /** Things the traveller dislikes that this place is known for. */
  conflicts: string[];
  /** The keyword that points at this place, if one does. */
  keyword?: string;
  /** A keyword named this place outright (not just a theme or region it belongs to). */
  named?: boolean;
}

/** Which of a place's tags hold in the given travel month. */
export function seasonalTags(place: Place, month: number): Set<string> {
  const tags = new Set(place.tags ?? []);
  const sunny = place.sunMonths?.includes(month) ?? false;
  if (sunny) tags.add("warm");
  // A beach out of season is still a beach, but not one anyone swims at.
  if (!sunny && tags.has("beach") && place.sunMonths) tags.delete("beach");
  if (place.skiMonths && !place.skiMonths.includes(month)) tags.delete("ski");
  return tags;
}

/**
 * Score how well a place suits the traveller. Vibe carries the most weight,
 * likes add, dislikes subtract hard. Free-text keywords match against the
 * place's name and any extra text (hotel names, amenities) the caller passes.
 */
export function scoreVibe(p: VibeProfile, place: Place, month: number, extraText = ""): VibeMatch {
  const tags = seasonalTags(place, month);
  // The stay counts too: a hotel with a spa answers "spa", a party hostel answers "no nightlife".
  for (const t of interpret([extraText]).tags) if (t !== "warm" && t !== "beach" && t !== "ski") tags.add(t);
  const haystack = `${place.name} ${place.country} ${[...tags].join(" ")} ${extraText}`.toLowerCase();
  const has = (t: string) => tags.has(t);
  const hasKeyword = (k: string) => haystack.includes(k);

  const wanted = [...p.vibe.tags];
  const vibeHits = wanted.filter(has);
  const vibeKwHits = p.vibe.keywords.filter(hasKeyword);
  const vibeTotal = wanted.length + p.vibe.keywords.length;
  const vibeScore = vibeTotal === 0 ? 0.5 : (vibeHits.length + vibeKwHits.length) / vibeTotal;

  const likeTotal = p.likes.tags.length + p.likes.keywords.length;
  const likeHits = p.likes.tags.filter(has);
  const likeKwHits = p.likes.keywords.filter(hasKeyword);
  const likeScore = likeTotal === 0 ? 0.5 : (likeHits.length + likeKwHits.length) / likeTotal;

  // Keywords: their tags and text, plus a direct pull towards places they name.
  const kw = p.keywords;
  const kwTotal = kw.tags.length + kw.text.length;
  const kwTagHits = kw.tags.filter(has);
  const kwTextHits = kw.text.filter(hasKeyword);
  const kwBoost = kw.boosts[place.code];
  const kwScore = kwTotal === 0 ? (kwBoost ? 1 : 0) : Math.min(1, (kwTagHits.length + kwTextHits.length) / kwTotal + (kwBoost?.weight ?? 0) * 0.5);
  const hasKw = kwTotal > 0 || Object.keys(kw.boosts).length > 0;

  const conflicts = [...p.dislikes.tags.filter(has), ...p.dislikes.keywords.filter(hasKeyword)];
  // A wanted tag's opposite counts as half a conflict.
  const implied = OPPOSITES.flatMap(([a, b]) => [
    ...(wanted.includes(a) && has(b) ? [b] : []),
    ...(wanted.includes(b) && has(a) ? [a] : []),
  ]).filter((t) => !conflicts.includes(t));

  // Vibe leads; keywords take a share when given, and all of the vibe's share when there is no vibe.
  const w = !hasKw ? { v: 0.65, l: 0.35, k: 0 } : vibeTotal === 0 ? { v: 0, l: 0.3, k: 0.7 } : { v: 0.45, l: 0.25, k: 0.3 };
  const raw = w.v * vibeScore + w.l * likeScore + w.k * kwScore + (kwBoost ? 0.15 * kwBoost.weight : 0) - 0.3 * conflicts.length - 0.1 * implied.length;
  return {
    score: clamp01(raw),
    matched: unique([...vibeHits, ...vibeKwHits, ...likeHits, ...likeKwHits, ...kwTagHits, ...kwTextHits]),
    keyword: kwBoost?.keyword,
    named: (kwBoost?.weight ?? 0) > 1,
    missed: unique([...wanted.filter((t) => !has(t)), ...p.vibe.keywords.filter((k) => !hasKeyword(k))]),
    conflicts: unique(conflicts),
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
