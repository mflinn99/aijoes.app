import { addDays } from "./dates.js";
import { formatMoney } from "./money.js";
import { placeByCode } from "./places.js";
import type { TripOption } from "./search.js";
import type { TripRequest } from "./schema.js";
import { hoursMinutes, MODE_LABEL, partyLabel, stopsLabel } from "./summary.js";

// The itinerary: a chosen option laid out day by day: when you leave and from
// where, how you get there, where you sleep, what the days in between could
// hold (from what the place is known for and what the traveller asked for),
// and how you get home. It is what a saved trip is printed, shared and
// reviewed as.

export interface ItineraryItem {
  time?: string;
  kind: "travel" | "stay" | "free" | "info";
  text: string;
}

export interface ItineraryDay {
  day: number;
  date: string;
  title: string;
  items: ItineraryItem[];
}

export interface Itinerary {
  optionId: string;
  title: string;
  destination: string;
  depart: string;
  return: string;
  nights: number;
  travellers: string;
  transport: string;
  stay: string;
  total: string;
  co2KgPerPerson?: number;
  days: ItineraryDay[];
  bookingLinks: { label: string; href: string }[];
}

const IDEAS: Record<string, string> = {
  beach: "A slow morning on the beach",
  food: "Eat your way round the local markets and a long lunch somewhere the locals go",
  history: "The old town and its history, best early before the crowds",
  culture: "A museum or gallery the city is known for",
  art: "Galleries and street art",
  nightlife: "An evening out: bars and late dinners",
  nature: "Out into the landscape: a scenic walk or viewpoint",
  hiking: "A day hike on one of the classic trails",
  adventure: "Something active: kayaking, climbing or a guided excursion",
  relax: "Nothing planned at all: pool, book, repeat",
  wellness: "A spa afternoon",
  shopping: "Shopping streets and markets",
  romance: "A sunset dinner with a view",
  family: "A family day out the children will remember",
  wine: "A vineyard visit or wine tasting",
  diving: "A dive or snorkel trip",
  ski: "A full day on the slopes",
  islands: "A boat trip round the coast",
  "theme parks": "A day at the parks",
  festival: "Whatever festival is on: check the local listings",
  beer: "A brewery or beer-hall crawl",
  architecture: "An architecture walk",
  music: "A concert or opera night",
  theatre: "A show in the evening",
};

function time(iso: string): string {
  return iso.slice(11, 16);
}

/** Ideas for free days: what the traveller asked for first, then what the place is known for. */
function ideasFor(option: TripOption): string[] {
  const place = placeByCode(option.destination.code);
  const wanted = [...option.match.vibe.matched];
  const known = place?.tags ?? [];
  const ordered = [...new Set([...wanted, ...known])].filter((t) => IDEAS[t]);
  const ideas = ordered.map((t) => IDEAS[t]!);
  return ideas.length ? ideas : [`Explore ${option.destination.name} at your own pace`];
}

export function buildItinerary(option: TripOption, req: TripRequest): Itinerary {
  const t = option.transport;
  const cur = option.price.currency;
  const leg = (l: TripOption["transport"]["outbound"]) =>
    `${MODE_LABEL[l.mode]}${l.modes.length > 1 ? ` (${[...new Set(l.modes)].join(" + ")})` : ""} from ${l.from} to ${l.to} with ${l.carriers.join(" / ")}, ${stopsLabel(l.stops, l.mode)} (${hoursMinutes(l.durationMinutes)})`;
  const stayName = option.stay.estimated ? `accommodation in ${option.destination.name} (to book: estimate only)` : option.stay.name;

  const days: ItineraryDay[] = [];
  const ideas = ideasFor(option);
  for (let i = 0; i <= option.dates.nights; i++) {
    const date = addDays(option.dates.depart, i);
    const items: ItineraryItem[] = [];
    let title: string;
    if (i === 0) {
      title = `Travel to ${option.destination.name}`;
      items.push({ time: time(t.outbound.departAt), kind: "travel", text: `Leave: ${leg(t.outbound)}` });
      items.push({ time: time(t.outbound.arriveAt), kind: "travel", text: `Arrive in ${option.destination.name}` });
      items.push({ kind: "stay", text: `Check in: ${stayName}` });
      if (t.mode === "car") items.push({ kind: "info", text: "Plan fuel and rest stops; parking at the accommodation is included in the estimate." });
    } else if (i === option.dates.nights) {
      title = "Home";
      items.push({ kind: "stay", text: `Check out of ${stayName}` });
      items.push({ time: time(t.inbound.departAt), kind: "travel", text: `Return: ${leg(t.inbound)}` });
      items.push({ time: time(t.inbound.arriveAt), kind: "travel", text: "Back home" });
    } else {
      const idea = ideas[(i - 1) % ideas.length]!;
      title = `${option.destination.name}: free day`;
      items.push({ kind: "free", text: idea });
    }
    days.push({ day: i + 1, date, title, items });
  }

  const bookingLinks = [
    ...(t.bookingUrl ? [{ label: `Book the ${t.mode === "car" ? "crossing" : t.mode}`, href: t.bookingUrl }] : []),
    ...(option.stay.bookingUrl ? [{ label: `Book ${option.stay.name}`, href: option.stay.bookingUrl }] : []),
  ];

  return {
    optionId: option.id,
    title: `${option.dates.nights} nights in ${option.destination.name}`,
    destination: option.destination.name,
    depart: option.dates.depart,
    return: option.dates.return,
    nights: option.dates.nights,
    travellers: partyLabel(req.travellers),
    transport: `${MODE_LABEL[t.mode]}: ${t.outbound.carriers.join(" / ")}`,
    stay: stayName,
    total: `${formatMoney(option.price.total, cur)} (${formatMoney(option.price.perPerson, cur)} per person)`,
    co2KgPerPerson: t.co2KgPerPerson,
    days,
    bookingLinks,
  };
}
