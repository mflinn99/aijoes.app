import { z } from "zod";
import { resolvePlace } from "./places.js";
import { tripRequestSchema, type TripRequest } from "./schema.js";
import { LOCK_ELEMENTS } from "./search.js";

// Refinement: the traveller changes anything, as often as they like. Changes
// arrive as a partial request (merged field by field), as a plain-English
// instruction ("cheaper, direct flights, somewhere else"), or both. Options can
// be kept or swapped out individually. Every refinement is a new version; the
// old ones stay in the history.

export const refineSchema = z.object({
  changes: z.record(z.unknown()).optional(),
  instruction: z.string().trim().max(500).optional(),
  /** Option ids to keep in the next set, if they still meet the request. */
  keep: z.array(z.string().max(32)).max(3).default([]),
  /** Option ids to swap out for something else. */
  replace: z.array(z.string().max(32)).max(3).default([]),
});

export const remixSchema = z.object({
  /** What to keep from the option; everything else is remixed. */
  lock: z.array(z.enum(LOCK_ELEMENTS)).min(1, "Lock at least one of destination, dates, flight or stay").max(3),
});

export type RefineInput = z.input<typeof refineSchema>;

type Json = Record<string, unknown>;

/** Merge a partial request onto the current one; nested objects merge, arrays and scalars replace. */
export function mergeRequest(current: TripRequest, changes: Json): TripRequest {
  const merged: Json = { ...(current as unknown as Json) };
  for (const [key, value] of Object.entries(changes)) {
    const existing = merged[key];
    if (value === null) delete merged[key];
    else if (isPlainObject(value) && isPlainObject(existing)) merged[key] = { ...existing, ...value };
    else merged[key] = value;
  }
  return tripRequestSchema.parse(merged);
}

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface Interpretation {
  changes: Json;
  understood: string[];
  /** Destinations to rule out ("somewhere else"). Resolved by the caller from the current options. */
  somewhereElse: boolean;
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

function num(s: string): number {
  return NUMBER_WORDS[s.toLowerCase()] ?? Number(s.replace(/,/g, ""));
}

/**
 * Read a plain-English instruction into structured changes. Deliberately
 * conservative: it only acts on phrasings it is sure of, and reports back
 * exactly what it understood so the traveller can see and correct it.
 */
export function interpretInstruction(text: string, current: TripRequest): Interpretation {
  const t = ` ${text.toLowerCase()} `;
  const changes: Json = {};
  const understood: string[] = [];
  const budget: Json = {};
  const travellers: Json = {};
  const dates: Json = {};
  const prefs: Json = {};
  let somewhereElse = false;

  // A number followed by a unit is not money: "under 5 hours", "max 2 stops", "4 star".
  const notMoney = "(?!\\s?(?:h\\b|hrs?|hours?|stars?|\\*|★|days?|nights?|adults?|kids?|child|children|people|stops?|%))";
  const money =
    new RegExp(`(?:budget|spend|max(?:imum)?|up to|under)\\D{0,12}?([£$€]?)\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k)?\\b${notMoney}`).exec(t) ??
    new RegExp(`([£$€])\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k)?\\b`).exec(t);
  if (money) {
    const amount = num(money[2]!) * (money[3] ? 1000 : 1);
    if (amount > 0) {
      budget.amount = amount;
      const sym = money[1];
      if (sym) budget.currency = sym === "£" ? "GBP" : sym === "€" ? "EUR" : "USD";
      understood.push(`budget ${budget.currency ?? current.budget.currency} ${amount}`);
    }
  } else if (/\b(cheaper|less expensive|lower (?:the )?(?:budget|price|cost)|spend less|save money)\b/.test(t)) {
    budget.amount = Math.round(current.budget.amount * 0.85);
    understood.push(`budget lowered 15% to ${current.budget.currency} ${budget.amount}`);
  } else if (/\b(more expensive|push the boat out|splash out|raise (?:the )?budget|spend more)\b/.test(t)) {
    budget.amount = Math.round(current.budget.amount * 1.2);
    understood.push(`budget raised 20% to ${current.budget.currency} ${budget.amount}`);
  }
  const budgetFlex = /(\d{1,2})\s?%\s?(?:over|flex|either way|leeway)/.exec(t);
  if (budgetFlex) {
    budget.flexibilityPercent = Math.min(50, Number(budgetFlex[1]));
    understood.push(`budget flexibility ${budget.flexibilityPercent}%`);
  }

  const adults = /\b(\d|one|two|three|four|five|six|seven|eight|nine)\s+(?:adults?|people|travellers|travelers|of us|guests)\b/.exec(t);
  if (adults) {
    travellers.adults = num(adults[1]!);
    understood.push(`${travellers.adults} adult(s)`);
  }
  const kids = /\b(\d|no|one|two|three|four|five|six)\s+(?:kids?|children|child)\b/.exec(t);
  if (kids) {
    travellers.children = kids[1] === "no" ? 0 : num(kids[1]!);
    understood.push(`${travellers.children} child(ren)`);
  } else if (/\badd (?:a|one|another) (?:kid|child)\b/.test(t)) {
    travellers.children = current.travellers.children + 1;
    understood.push(`${travellers.children} child(ren)`);
  }
  if (/\badd (?:a|one|another) (?:adult|person|traveller|traveler)\b/.test(t)) {
    travellers.adults = current.travellers.adults + 1;
    understood.push(`${travellers.adults} adult(s)`);
  }

  const flex = /\b(\d)\s+days?\s+(?:either side|flex(?:ibility|ible)?|each way|either way)\b/.exec(t);
  if (flex) {
    dates.flexibilityDays = Number(flex[1]);
    understood.push(`dates ±${dates.flexibilityDays} days`);
  } else if (/\b(flexible dates|more flexible|any dates? nearby)\b/.test(t)) {
    dates.flexibilityDays = Math.min(7, current.dates.flexibilityDays + 2);
    understood.push(`dates ±${dates.flexibilityDays} days`);
  }

  if (/\b(direct(?: flights?)?(?: only)?|non-?stop|no (?:stops|layovers|connections))\b/.test(t)) {
    prefs.maxStops = 0;
    understood.push("direct flights only");
  } else if (/\b(stops? (?:are|is) fine|allow (?:a )?stops?|connections? (?:are|is) fine)\b/.test(t)) {
    prefs.maxStops = 2;
    understood.push("stops allowed");
  }
  const hours = /\b(?:no|under|less than|max(?:imum)?)\s+(\d{1,2})\s?(?:h|hours?)\b/.exec(t);
  if (hours) {
    prefs.maxFlightHours = Number(hours[1]);
    understood.push(`flights under ${prefs.maxFlightHours}h`);
  } else if (/\b(no long[- ]haul|shorter flights?|no long flights?)\b/.test(t)) {
    prefs.maxFlightHours = 5;
    understood.push("flights under 5h");
  }
  const stars = /\b([1-5])\s?(?:\*|★|-?\s?stars?)\b/.exec(t);
  if (stars) {
    prefs.minHotelStars = Number(stars[1]);
    understood.push(`${prefs.minHotelStars}★ or better`);
  }
  if (/\bbusiness class\b/.test(t)) prefs.cabin = "business";
  else if (/\bpremium economy\b/.test(t)) prefs.cabin = "premium_economy";
  else if (/\bfirst class\b/.test(t)) prefs.cabin = "first";
  else if (/\beconomy\b/.test(t)) prefs.cabin = "economy";
  if (prefs.cabin) understood.push(`${String(prefs.cabin).replace("_", " ")} cabin`);

  if (/\b(somewhere else|somewhere different|different (?:places?|destinations?)|other (?:places?|destinations?))\b/.test(t)) {
    somewhereElse = true;
    understood.push("different destinations");
  }
  if (/\b(anywhere|open destination|any destination|surprise me)\b/.test(t)) {
    changes.destination = null;
    understood.push("destination open");
  }
  const goTo = /\b(?:go to|fly to|destination(?: is|:)?|instead go to|make it)\s+([a-z][a-z .'-]{2,40}?)(?=[,.;!]| and | but |\s*$)/.exec(t);
  if (goTo) {
    const place = resolvePlace(goTo[1]!.trim());
    if (place) {
      changes.destination = place.name;
      understood.push(`destination ${place.name}`);
    }
  }
  const from = /\b(?:from|leaving from|depart(?:ing)? from|start(?:ing)? (?:from|in))\s+([a-z][a-z .'-]{2,40}?)(?=[,.;!]| and | but |\s*$)/.exec(t);
  if (from) {
    const place = resolvePlace(from[1]!.trim());
    if (place) {
      changes.origin = place.name;
      understood.push(`starting from ${place.name}`);
    }
  }

  const kw = /\b(?:keywords?|theme|something like|inspired by)\s*[:=]?\s+([^.;!]{2,80})/.exec(t);
  if (kw) {
    const added = kw[1]!.split(/,| and /).map((x) => x.trim()).filter(Boolean);
    changes.keywords = [...new Set([...current.keywords, ...added])];
    understood.push(`keywords + ${added.join(", ")}`);
  }

  // "more X", "add X", "with X" → vibe; "no X", "avoid X", "less X", "not X" → dislikes.
  const addVibe = [...t.matchAll(/\b(?:more|add|with|make it more|i want|we want)\s+([a-z][a-z -]{2,30}?)(?=[,.;!]| and | but |\s*$)/g)].map((m) => m[1]!.trim());
  const avoid = [...t.matchAll(/\b(?:no|avoid|less|not|without|hate|don't want|dont want)\s+([a-z][a-z -]{2,30}?)(?=[,.;!]| and | but |\s*$)/g)].map((m) => m[1]!.trim());
  const ignore = /^(stops|layovers|connections|long[- ]haul|long flights?|kids|children|child|expensive|\d.*)$/;
  const vibeAdds = addVibe.filter((v) => !ignore.test(v) && !/^(budget|money|stops?|days?|flexib)/.test(v));
  const dislikeAdds = avoid.filter((v) => !ignore.test(v));
  if (vibeAdds.length) {
    changes.vibe = [...new Set([...current.vibe, ...vibeAdds])];
    understood.push(`vibe + ${vibeAdds.join(", ")}`);
  }
  if (dislikeAdds.length) {
    changes.dislikes = [...new Set([...current.dislikes, ...dislikeAdds])];
    changes.vibe = ((changes.vibe as string[] | undefined) ?? current.vibe).filter((v) => !dislikeAdds.includes(v));
    understood.push(`avoid ${dislikeAdds.join(", ")}`);
  }

  if (Object.keys(budget).length) changes.budget = budget;
  if (Object.keys(travellers).length) changes.travellers = { ...current.travellers, ...travellers };
  if (Object.keys(dates).length) changes.dates = dates;
  if (Object.keys(prefs).length) changes.preferences = prefs;
  return { changes, understood, somewhereElse };
}
