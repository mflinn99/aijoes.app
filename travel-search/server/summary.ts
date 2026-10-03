import { formatMoney } from "./money.js";
import type { TripOption } from "./search.js";
import type { TripRequest } from "./schema.js";
import type { TransportMode } from "./providers/types.js";

// The words a traveller reads first: one short paragraph per option that says
// where, when, how, how much, and why it suits them.

const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"];

export function spell(n: number): string {
  return NUMBERS[n] ?? String(n);
}

export function hoursMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function partyLabel(t: TripRequest["travellers"]): string {
  const bits = [`${t.adults} adult${t.adults === 1 ? "" : "s"}`];
  if (t.children) bits.push(`${t.children} child${t.children === 1 ? "" : "ren"}`);
  if (t.infants) bits.push(`${t.infants} infant${t.infants === 1 ? "" : "s"}`);
  return bits.join(", ");
}

export function dateRange(depart: string, ret: string): string {
  const fmt = (iso: string, withMonth: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", ...(withMonth ? { month: "short" } : {}), timeZone: "UTC" });
  const sameMonth = depart.slice(0, 7) === ret.slice(0, 7);
  return `${fmt(depart, !sameMonth)}–${fmt(ret, true)}`;
}

export function stopsLabel(stops: number, mode: TransportMode = "flight"): string {
  if (mode === "car") return stops === 0 ? "no stops" : `${spell(stops)} break${stops === 1 ? "" : "s"}`;
  const word = mode === "flight" ? "stop" : "change";
  return stops === 0 ? "direct" : `${spell(stops)} ${word}${stops === 1 ? "" : "s"}`;
}

export const MODE_LABEL: Record<TransportMode, string> = { flight: "Flight", train: "Train", coach: "Coach", ferry: "Ferry", car: "Car" };

/** "Flying direct with easyJet from LGW (2h 10m)", "By train with Eurostar from London St Pancras (2h 16m)". */
export function journeyPhrase(t: TripOption["transport"]): string {
  const l = t.outbound;
  const time = hoursMinutes(l.durationMinutes);
  const via = l.modes.length > 1 ? ` (${[...new Set(l.modes)].join(" + ")})` : "";
  switch (t.mode) {
    case "flight":
      return `Flying ${stopsLabel(l.stops)} with ${l.carriers.join(" / ")} from ${l.from} (${time})`;
    case "car":
      return `Driving${l.km ? ` about ${l.km.toLocaleString("en-GB")} km` : ""} each way${t.vehicles && t.vehicles > 1 ? ` in ${t.vehicles} cars` : ""}, ${l.carriers.join(", ").replace(/^Own car via /, "via the ")} (${time})`;
    default:
      return `By ${t.mode}${via}, ${stopsLabel(l.stops, t.mode)}, with ${l.carriers.join(" / ")} from ${l.from} (${time})`;
  }
}

export function summarise(o: TripOption, req: TripRequest): string {
  const nights = `${capitalise(spell(o.dates.nights))} night${o.dates.nights === 1 ? "" : "s"}`;
  const journey = journeyPhrase(o.transport);
  const stay = o.stay.estimated
    ? `with accommodation estimated at ${formatMoney(o.stay.totalPrice, o.price.currency)}`
    : `staying at ${o.stay.name}${o.stay.stars ? ` (${o.stay.stars}★)` : ""}`;
  const money =
    o.price.headroom >= 0
      ? `${formatMoney(o.price.total, o.price.currency)} all in, ${formatMoney(o.price.headroom, o.price.currency)} under budget.`
      : `${formatMoney(o.price.total, o.price.currency)} all in, ${formatMoney(-o.price.headroom, o.price.currency)} over your target but inside your ${req.budget.flexibilityPercent}% flexibility.`;
  const why = o.match.reasons.length ? ` ${o.match.reasons[0]}` : "";
  const watch = o.match.watchOuts.length ? ` Watch out: ${o.match.watchOuts.join("; ")}.` : "";
  return `${nights} in ${o.destination.name}, ${dateRange(o.dates.depart, o.dates.return)}, for ${partyLabel(req.travellers)}. ${journey}, ${stay}. ${money}${why}${watch}`;
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
