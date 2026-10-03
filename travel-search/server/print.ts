import { formatMoney } from "./money.js";
import type { Itinerary } from "./itinerary.js";
import type { SearchResult, TripOption } from "./search.js";
import type { Review } from "./trips.js";
import { dateRange, hoursMinutes, MODE_LABEL, partyLabel, stopsLabel } from "./summary.js";

// Print: a self-contained, printer-friendly page (A4, no scripts, no external
// assets) for any search version or saved trip, plus a plain-text version for
// email or a terminal. Every value is escaped; nothing from a provider or a
// traveller is ever rendered as markup.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function legLine(label: string, l: TripOption["transport"]["outbound"]): string {
  return `${label}: ${MODE_LABEL[l.mode]}${l.modes.length > 1 ? ` (${[...new Set(l.modes)].join(" + ")})` : ""}, ${l.from} → ${l.to}, ${l.departAt.replace("T", " ")} – ${l.arriveAt.replace("T", " ")} (${hoursMinutes(l.durationMinutes)}, ${stopsLabel(l.stops, l.mode)}, ${l.carriers.join(" / ")})`;
}

export interface PrintExtras {
  itinerary?: Itinerary | null;
  reviews?: Review[];
}

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

function reviewLine(r: Review): string {
  const aspects = Object.entries(r.aspects ?? {})
    .map(([k, v]) => `${k} ${v}/5`)
    .join(", ");
  return `${stars(r.rating)} ${r.by ?? "You"}${aspects ? ` (${aspects})` : ""}${r.wouldGoAgain ? ", would go again" : ""}${r.comment ? `: “${r.comment}”` : ""}`;
}

export function renderText(r: SearchResult, title: string, extras: PrintExtras = {}): string {
  const req = r.request;
  const lines = [
    title,
    "=".repeat(title.length),
    `From ${r.resolved.origin.name} · ${r.resolved.destination?.name ?? "Destination open"} · ${dateRange(req.dates.depart, req.dates.return)}${req.dates.flexibilityDays ? ` (±${req.dates.flexibilityDays} days)` : ""}`,
    `${partyLabel(req.travellers)} · Budget ${formatMoney(req.budget.amount, req.budget.currency)}${req.budget.per === "person" ? " per person" : ""}${req.budget.flexibilityPercent ? ` (+${req.budget.flexibilityPercent}%)` : ""} · Vibe: ${req.vibe.join(", ") || "–"}${req.keywords?.length ? ` · Keywords: ${req.keywords.join(", ")}` : ""}`,
    "",
  ];
  r.options.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.label ? `${o.label}: ` : ""}${o.destination.name}${o.destination.country ? `, ${o.destination.country}` : ""} — ${formatMoney(o.price.total, o.price.currency)}`);
    lines.push(`   ${o.summary}`);
    lines.push(`   ${legLine("Out", o.transport.outbound)}`);
    lines.push(`   ${legLine("Back", o.transport.inbound)}`);
    lines.push(`   Stay: ${o.stay.name}${o.stay.stars ? ` ${o.stay.stars}★` : ""}, ${o.stay.nights} nights, ${o.stay.rooms} room(s)${o.stay.estimated ? " (estimate)" : ""}`);
    lines.push(`   Price: ${o.transport.mode === "car" ? "driving" : "travel"} ${formatMoney(o.price.transport, o.price.currency)} + stay ${formatMoney(o.price.stay, o.price.currency)} = ${formatMoney(o.price.total, o.price.currency)} (${formatMoney(o.price.perPerson, o.price.currency)} pp)`);
    if (o.transport.bookingUrl) lines.push(`   Book travel: ${o.transport.bookingUrl}`);
    if (o.stay.bookingUrl) lines.push(`   Book stay: ${o.stay.bookingUrl}`);
    lines.push("");
  });
  const it = extras.itinerary;
  if (it) {
    lines.push(`Itinerary: ${it.title}`, "-".repeat(11 + it.title.length));
    for (const d of it.days) {
      lines.push(`Day ${d.day} · ${d.date} · ${d.title}`);
      for (const item of d.items) lines.push(`   ${item.time ? `${item.time}  ` : ""}${item.text}`);
    }
    lines.push(`Total ${it.total}${it.co2KgPerPerson !== undefined ? ` · about ${it.co2KgPerPerson} kg CO2e per person` : ""}`, "");
  }
  if (extras.reviews?.length) lines.push("Reviews:", ...extras.reviews.map((x) => `- ${reviewLine(x)}`), "");
  if (r.notes.length) lines.push("Notes:", ...r.notes.map((n) => `- ${n}`), "");
  lines.push(`Searched ${r.searchedAt.slice(0, 16).replace("T", " ")} UTC. Prices change; confirm before booking.`);
  return lines.join("\n");
}

export function renderHtml(r: SearchResult, title: string, extras: PrintExtras = {}): string {
  const e = escapeHtml;
  const req = r.request;
  const safeUrl = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);
  const options = r.options
    .map((o, i) => {
      const flightUrl = safeUrl(o.transport.bookingUrl);
      const stayUrl = safeUrl(o.stay.bookingUrl);
      return `
    <section class="option">
      <header>
        <span class="n">${i + 1}</span>
        <div><p class="label">${e(o.label)}${o.locked?.length ? ` · locked: ${e(o.locked.join(", "))}` : ""}</p><h2>${e(o.destination.name)}${o.destination.country ? `<small>, ${e(o.destination.country)}</small>` : ""}</h2></div>
        <p class="price">${e(formatMoney(o.price.total, o.price.currency))}<small>${e(formatMoney(o.price.perPerson, o.price.currency))} per person</small></p>
      </header>
      <p>${e(o.summary)}</p>
      <table>
        <tr><th>Dates</th><td>${e(dateRange(o.dates.depart, o.dates.return))} · ${o.dates.nights} nights${o.dates.shiftedFromRequested ? " (moved within your flexibility)" : ""}</td></tr>
        <tr><th>Out</th><td>${e(legLine("", o.transport.outbound).slice(2))}</td></tr>
        <tr><th>Back</th><td>${e(legLine("", o.transport.inbound).slice(2))}</td></tr>
        <tr><th>Stay</th><td>${e(o.stay.name)}${o.stay.stars ? ` ${"★".repeat(o.stay.stars)}` : ""}${o.stay.reviewScore ? ` · ${o.stay.reviewScore}/10` : ""} · ${o.stay.rooms} room(s), sleeps ${o.stay.sleeps}${o.stay.estimated ? " · <em>estimate</em>" : ""}</td></tr>
        <tr><th>Price</th><td>${o.transport.mode === "car" ? "Driving" : "Travel"} ${e(formatMoney(o.price.transport, o.price.currency))} + stay ${e(formatMoney(o.price.stay, o.price.currency))}${o.price.dailySpendPerPerson ? ` · allow about ${e(formatMoney(o.price.dailySpendPerPerson, o.price.currency))} pp a day on the ground` : ""}</td></tr>
        ${o.match.watchOuts.length ? `<tr><th>Watch out</th><td>${e(o.match.watchOuts.join("; "))}</td></tr>` : ""}
        ${flightUrl || stayUrl ? `<tr><th>Book</th><td>${flightUrl ? `<a href="${e(flightUrl)}">Travel</a>` : ""}${flightUrl && stayUrl ? " · " : ""}${stayUrl ? `<a href="${e(stayUrl)}">Stay</a>` : ""}</td></tr>` : ""}
      </table>
      <p class="src">Sources: ${e(o.sources.join(", "))}${o.indicative ? " · includes estimates" : ""}</p>
    </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  :root { color-scheme: light; --ink: #1b1d21; --muted: #5d6470; --line: #d9dde3; --accent: #0b6e69; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 820px; padding: 24px 16px; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: #fff; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .brief { color: var(--muted); margin: 0 0 20px; }
  .option { border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 0 0 16px; break-inside: avoid; }
  .option header { display: flex; gap: 12px; align-items: flex-start; }
  .option header > div { flex: 1; }
  .n { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 600; }
  .label { margin: 0; color: var(--accent); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  h2 { margin: 0; font-size: 18px; } h2 small { font-weight: 400; color: var(--muted); }
  .price { margin: 0; text-align: right; font-size: 18px; font-weight: 700; } .price small { display: block; font-size: 12px; font-weight: 400; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; vertical-align: top; width: 92px; color: var(--muted); font-weight: 500; padding: 4px 8px 4px 0; }
  td { padding: 4px 0; border-top: 1px solid var(--line); } th { border-top: 1px solid var(--line); }
  .src, footer { color: var(--muted); font-size: 12px; }
  .notes { background: #f6f7f9; border-radius: 8px; padding: 12px 16px; }
  a { color: var(--accent); }
  @media print { body { padding: 0; } a { color: inherit; text-decoration: none; } }
</style>
</head>
<body>
<h1>${e(title)}</h1>
<p class="brief">From ${e(r.resolved.origin.name)} · ${e(r.resolved.destination?.name ?? "Destination open")} · ${e(dateRange(req.dates.depart, req.dates.return))}${req.dates.flexibilityDays ? ` (±${req.dates.flexibilityDays} days)` : ""} · ${e(partyLabel(req.travellers))} · Budget ${e(formatMoney(req.budget.amount, req.budget.currency))}${req.budget.per === "person" ? " per person" : ""}${req.budget.flexibilityPercent ? ` (+${req.budget.flexibilityPercent}%)` : ""} · Vibe: ${e(req.vibe.join(", ") || "–")}${req.keywords?.length ? ` · Keywords: ${e(req.keywords.join(", "))}` : ""}${req.likes.length ? ` · Likes: ${e(req.likes.join(", "))}` : ""}${req.dislikes.length ? ` · Avoiding: ${e(req.dislikes.join(", "))}` : ""}</p>
${extras.itinerary ? itineraryHtml(extras.itinerary) : ""}
${options || "<p>No options matched every requirement.</p>"}
${extras.reviews?.length ? `<section class="option"><h2>Reviews</h2><ul>${extras.reviews.map((x) => `<li>${e(reviewLine(x))}</li>`).join("")}</ul></section>` : ""}
${r.notes.length ? `<div class="notes"><strong>Notes</strong><ul>${r.notes.map((n) => `<li>${e(n)}</li>`).join("")}</ul></div>` : ""}
<footer><p>Searched ${e(r.searchedAt.slice(0, 16).replace("T", " "))} UTC. Prices and availability change; confirm before booking.</p></footer>
</body>
</html>`;
}

function itineraryHtml(it: Itinerary): string {
  const e = escapeHtml;
  const days = it.days
    .map(
      (d) => `<tr><th>Day ${d.day}<br><small>${e(d.date)}</small></th><td><strong>${e(d.title)}</strong><ul>${d.items
        .map((i) => `<li>${i.time ? `<b>${e(i.time)}</b> ` : ""}${e(i.text)}</li>`)
        .join("")}</ul></td></tr>`,
    )
    .join("");
  return `<section class="option"><p class="label">Itinerary</p><h2>${e(it.title)}</h2><p>${e(it.travellers)} · ${e(it.transport)} · ${e(it.stay)} · ${e(it.total)}${it.co2KgPerPerson !== undefined ? ` · about ${it.co2KgPerPerson} kg CO2e per person` : ""}</p><table>${days}</table></section>`;
}
