#!/usr/bin/env node
// End-to-end functional test: boots the built server (dist/server.mjs) with the
// demo aggregators and a file store, then walks a traveller's whole journey over
// HTTP, as a front end would: search, refine, remix, save, share, then restarts
// the server 60 days later to check persistence, review the trip, and see the
// review shape the next search. Prints a readable transcript; exits non-zero on
// any failed check.
//
//   npm run build && node scripts/e2e.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 3987);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(path.join(tmpdir(), "travel-e2e-"));
const LONDON = ["LHR", "LGW", "STN", "LTN", "LCY", "SEN", "London St Pancras International", "London King's Cross", "London Euston", "London Paddington", "London Victoria Coach Station", "LON"];

let passed = 0;
const failures = [];
let server;

// --- helpers ------------------------------------------------------------------

const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const DEPART = day(45);
const RETURN = day(49);

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}
function show(text) {
  console.log(`    \x1b[2m${text}\x1b[0m`);
}
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failures.push(`${name}${detail ? ` (${detail})` : ""}`);
    console.log(`  \x1b[31m✗ ${name}${detail ? ` (${detail})` : ""}\x1b[0m`);
  }
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

async function start(extraEnv = {}) {
  server = spawn(process.execPath, ["dist/server.mjs"], {
    env: { ...process.env, NODE_ENV: "development", PORT: String(PORT), TRAVEL_PROVIDERS: "mock,drive", TRAVEL_STORE: "file", TRAVEL_DATA_DIR: DATA, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/healthz`)).ok) return log;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${log}`);
}

async function stop() {
  if (!server) return;
  const exited = new Promise((r) => server.once("exit", r));
  server.kill();
  await exited;
  server = undefined;
}

const brief = (o = {}) => ({
  travellers: 2,
  dates: { depart: DEPART, return: RETURN, flexibilityDays: 1 },
  origin: "London",
  vibe: "relaxed, sunshine, good food",
  likes: ["spa"],
  dislikes: ["nightlife"],
  budget: { amount: 2500, currency: "GBP", flexibilityPercent: 5 },
  ...o,
});

const fmt = (o) => `${o.label.padEnd(26)} ${o.destination.name.padEnd(16)} ${o.transport.mode.padEnd(6)} £${String(Math.round(o.price.total)).padStart(5)}  ${o.dates.depart}→${o.dates.return}  ${o.stay.name}`;

// --- the journey -----------------------------------------------------------------

async function run() {
  section("1. Server");
  const log = await start();
  show(log.trim());
  const ready = await api("GET", "/api/readyz");
  check("health and readiness report the configured providers and modes", ready.status === 200 && ready.json.providers.some((p) => p.name === "drive" && p.transport.includes("car")));
  const health = await api("GET", "/api/healthz");
  check("security headers are sent", health.headers.get("x-content-type-options") === "nosniff" && !health.headers.get("x-powered-by"));

  section("2. Inputs are validated before anything is searched");
  let r = await api("POST", "/api/searches", { vibe: "beach" });
  check("missing non-negotiables are named (400)", r.status === 400 && ["travellers", "dates", "origin", "budget"].every((f) => r.json.issues.some((i) => i.path === f)));
  r = await api("POST", "/api/searches", brief({ origin: "Manch" }));
  check("an unknown start point is refused with suggestions, never guessed (422)", r.status === 422 && r.json.suggestions.includes("Manchester"));
  show(`→ ${r.json.error} Suggestions: ${r.json.suggestions.join(", ")}`);
  r = await api("POST", "/api/searches", brief({ dates: { depart: day(-5), return: day(-1) } }));
  check("dates in the past are refused (422)", r.status === 422);
  r = await api("POST", "/api/searches", brief({ vibe: [], keywords: [] }));
  check("a vibe or keywords are required", r.status === 400);

  section("3. Search: open destination, vibe + likes + dislikes + keywords");
  r = await api("POST", "/api/searches", brief({ keywords: ["winter sun", "rooftop pool"] }));
  const search = r.json;
  check("201 with three options", r.status === 201 && search.options.length === 3);
  search.options.forEach((o) => show(fmt(o)));
  show(`summary: ${search.options[0].summary}`);
  check("three different destinations", new Set(search.options.map((o) => o.destination.code)).size === 3);
  check("labels: best match / best value / something different (or upgrade)", search.options.every((o) => /Best match|Best value|Something different|Upgrade/.test(o.label)));
  const ceiling = 2500 * 1.05;
  check("NON-NEGOTIABLE start point: every journey leaves from and returns to London", search.options.every((o) => LONDON.includes(o.transport.outbound.from) && LONDON.includes(o.transport.inbound.to)));
  check("NON-NEGOTIABLE travellers: priced for 2, rooms sleep 2", search.options.every((o) => o.price.travellers === 2 && o.stay.sleeps >= 2));
  check(`NON-NEGOTIABLE budget: every total ≤ £${ceiling} (target + 5%)`, search.options.every((o) => o.price.total <= ceiling + 0.01));
  check("dates stay inside the ±1 day window", search.options.every((o) => o.dates.depart >= day(44) && o.dates.depart <= day(46) && o.dates.return >= day(48) && o.dates.return <= day(50)));
  check("every option explains itself: reasons, watch-outs, CO2", search.options.every((o) => Array.isArray(o.match.reasons) && Array.isArray(o.match.watchOuts) && o.transport.co2KgPerPerson > 0));
  check("each keyword is reported with how it was read", search.keywords.length === 2);
  search.keywords.forEach((k) => show(`keyword "${k.keyword}" → ${k.kind}: ${k.effect}`));
  check("refine, remix, save and print actions are always offered", ["refine", "replaceOption", "remixOption", "save", "print"].every((a) => search.actions[a]));

  section("4. Any transport");
  r = await api("POST", "/api/searches", brief({ destination: "Paris", vibe: "city, food", likes: [], dislikes: [] }));
  r.json.options.forEach((o) => show(fmt(o) + `  ${o.transport.co2KgPerPerson}kg CO2e pp`));
  check("London → Paris offers more than one way of travelling", new Set(r.json.options.map((o) => o.transport.mode)).size >= 2);
  for (const mode of ["train", "coach", "car"]) {
    r = await api("POST", "/api/searches", brief({ destination: "Paris", vibe: "city", likes: [], dislikes: [], preferences: { modes: [mode] } }));
    check(`preferences.modes = [${mode}] → only ${mode}`, r.json.options.length > 0 && r.json.options.every((o) => o.transport.mode === mode));
    if (mode === "car") show(r.json.options[0].summary);
  }
  r = await api("POST", "/api/searches", brief({ origin: "Barcelona", destination: "Mallorca", vibe: "beach", preferences: { modes: ["ferry"] } }));
  check("by sea where a ferry runs (Barcelona → Mallorca)", r.json.options.length > 0 && r.json.options.every((o) => o.transport.mode === "ferry" && o.transport.outbound.from === "Port de Barcelona"));
  r = await api("POST", "/api/searches", brief({ keywords: ["flight-free"], vibe: "city, food", dislikes: [] }));
  check("'flight-free' in the brief rules flights out", r.json.options.length > 0 && r.json.options.every((o) => o.transport.mode !== "flight"));
  r = await api("POST", "/api/searches", brief({ origin: "LGW", destination: "Paris", vibe: "city" }));
  check("a named airport (LGW) means flying from LGW only", r.json.options.every((o) => o.transport.mode === "flight" && o.transport.outbound.from === "LGW"));
  r = await api("POST", "/api/searches", brief({ destination: "Tenerife", preferences: { modes: ["car", "train"] } }));
  check("no driving or trains to an island: nothing, with a reason", r.json.options.length === 0 && r.json.notes.length > 0);
  show(`→ ${r.json.notes[0]}`);

  section("5. The budget is never bent to fill three slots");
  r = await api("POST", "/api/searches", brief({ budget: { amount: 450, currency: "GBP" } }));
  check("fewer than three options, all within £450", r.json.options.length < 3 && r.json.options.every((o) => o.price.total <= 450));
  show(`→ ${r.json.notes[0]}`);
  r = await api("POST", "/api/searches", brief({ budget: { amount: 2000, currency: "EUR" } }));
  check("budgets in other currencies are honoured (EUR)", r.json.options.length > 0 && r.json.options.every((o) => o.price.currency === "EUR" && o.price.total <= 2000));

  section("6. Refine, as many times as needed");
  const id = search.id;
  r = await api("POST", `/api/searches/${id}/refine`, { instruction: "cheaper, no flying, 4 star" });
  check("plain English is applied and echoed back (v2)", r.status === 200 && r.json.version === 2);
  show(`understood: ${r.json.change.understood.join(" | ")}`);
  check("…budget lowered, flights out, 4★+ stays", r.json.request.budget.amount === 2125 && !r.json.request.preferences.modes.includes("flight") && r.json.options.every((o) => o.transport.mode !== "flight" && (o.stay.estimated || o.stay.stars >= 4)));
  r.json.options.forEach((o) => show(fmt(o)));
  r = await api("POST", `/api/searches/${id}/refine`, { changes: { travellers: { adults: 3 }, budget: { amount: 3500 }, preferences: { modes: ["flight", "train", "coach", "ferry", "car"], minHotelStars: null } } });
  check("structured changes merge field by field (v3: 3 adults)", r.json.version === 3 && r.json.options.every((o) => o.price.travellers === 3));
  const v3 = r.json.options;
  r = await api("POST", `/api/searches/${id}/options/${v3[1].id}/replace`);
  const ids4 = r.json.options.map((o) => o.id);
  check("replace one option: the other two stay, its destination is ruled out", ids4.includes(v3[0].id) && ids4.includes(v3[2].id) && !ids4.includes(v3[1].id) && !r.json.options.some((o) => o.destination.code === v3[1].destination.code));
  show(`replaced ${v3[1].destination.name} with ${r.json.options.find((o) => ![v3[0].id, v3[2].id].includes(o.id))?.destination.name}`);
  r = await api("POST", `/api/searches/${id}/refine`, { instruction: "somewhere else" });
  check("'somewhere else' gives three new places", r.json.options.every((o) => !r.json.history.at(-2).options.some((p) => p.destination === o.destination.name)));
  r = await api("POST", `/api/searches/${id}/refine`, { instruction: "hmm" });
  check("an instruction it can't understand gets a helpful 422", r.status === 422);
  show(`→ ${r.json.error}`);
  r = await api("GET", `/api/searches/${id}/versions`);
  check("every version is kept", r.json.length === 5);
  r = await api("GET", `/api/searches/${id}?version=1`);
  check("…and any version can be reopened", JSON.stringify(r.json.options.map((o) => o.id)) === JSON.stringify(search.options.map((o) => o.id)));

  section("7. Lock an element, remix the rest");
  const latest = (await api("GET", `/api/searches/${id}`)).json;
  const pick = latest.options[0];
  show(`remixing: ${fmt(pick)}`);
  r = await api("POST", `/api/searches/${id}/options/${pick.id}/remix`, { lock: ["destination"] });
  check("lock destination → three new trips there", r.status === 200 && r.json.options.length > 0 && r.json.options.every((o) => o.destination.code === pick.destination.code && o.id !== pick.id));
  show(r.json.notes[0]);
  r.json.options.forEach((o) => show(fmt(o)));
  const fromRemix = r.json.options[0];
  r = await api("POST", `/api/searches/${id}/options/${fromRemix.id}/remix`, { lock: ["transport"] });
  check("lock transport → same journey, new stays", r.json.options.every((o) => o.transport.offerId === fromRemix.transport.offerId && o.stay.name !== fromRemix.stay.name));
  const t = r.json.options[0] ?? fromRemix;
  r = await api("POST", `/api/searches/${id}/options/${t.id}/remix`, { lock: ["dates"] });
  check("lock dates → same dates, other places", r.json.options.every((o) => o.dates.depart === t.dates.depart && o.dates.return === t.dates.return));
  r = await api("POST", `/api/searches/${id}/options/${r.json.options[0].id}/remix`, { lock: ["transport", "stay"] });
  check("locking transport and stay together is refused: nothing left to remix", r.status === 422);

  section("8. Save, my trips, itinerary, print");
  const finalSearch = (await api("POST", "/api/searches", brief({ name: undefined }))).json;
  r = await api("POST", `/api/searches/${finalSearch.id}/save`, { name: "Autumn sun <b>escape</b>" });
  const trip = r.json;
  const KEY = trip.traveller?.key;
  check("save returns the trip and a traveller key (shown once)", r.status === 201 && typeof KEY === "string");
  const second = await api("POST", `/api/searches/${id}/save`, {}, { "X-Traveller-Key": KEY });
  check("saving again with the key adds to the same list (no new key)", second.status === 201 && !second.json.traveller);
  r = await api("GET", "/api/travellers/me/trips", undefined, { "X-Traveller-Key": KEY });
  check("my trips lists both", r.json.length === 2);
  r.json.forEach((x) => show(`${x.name} · ${x.status} · ${x.destinations.join(" / ")}`));
  check("a trip with no chosen option has no itinerary yet", trip.itinerary === null && trip.status === "planning");
  const chosen = trip.options[0];
  r = await api("PATCH", `/api/saved/${trip.id}`, { chosenOptionId: chosen.id, myNotes: "PRIVATE: key safe code 4812" });
  check("choosing an option makes it the itinerary (status: upcoming)", r.json.status === "upcoming" && r.json.itinerary.optionId === chosen.id);
  check(`itinerary has ${chosen.dates.nights + 1} days, out and back`, r.json.itinerary.days.length === chosen.dates.nights + 1);
  r.json.itinerary.days.forEach((d) => show(`Day ${d.day} ${d.date}: ${d.items.map((i) => (i.time ? `${i.time} ` : "") + i.text).join(" / ")}`));
  r = await api("GET", `/api/saved/${trip.id}/print`);
  check("print: a standalone A4 HTML page, no scripts, values escaped", r.status === 200 && r.text.includes("@page") && !r.text.includes("<script") && r.text.includes("&lt;b&gt;escape&lt;/b&gt;") && r.headers.get("content-security-policy").includes("default-src 'none'"));
  r = await api("GET", `/api/saved/${trip.id}/print?format=text&download=1`);
  check("print as plain text, as a download", r.headers.get("content-disposition")?.startsWith("attachment") && r.text.includes("Itinerary:"));

  section("9. Share");
  r = await api("POST", `/api/saved/${trip.id}/share`, { label: "Family", allowReviews: true });
  const SHARE = r.json.href;
  check("a share link is created (shown once)", r.status === 201 && /^\/api\/shared\/[A-Za-z0-9_-]{32}$/.test(SHARE));
  const viewOnly = (await api("POST", `/api/saved/${trip.id}/share`, {})).json.href;
  const expiring = (await api("POST", `/api/saved/${trip.id}/share`, { expiresInDays: 7 })).json.href;
  const revoked = (await api("POST", `/api/saved/${trip.id}/share`, {})).json;
  r = await api("GET", SHARE);
  const shared = JSON.stringify(r.json);
  check("the shared view shows the trip and itinerary", r.status === 200 && r.json.itinerary.optionId === chosen.id);
  check("…but never the owner's notes, the trip id or the search", !shared.includes("4812") && !shared.includes(trip.id) && !shared.includes(finalSearch.id));
  r = await api("GET", `${SHARE}/print?format=text`);
  check("the shared print-out works and is private too", r.status === 200 && !r.text.includes("4812"));
  r = await api("GET", `/api/saved/${trip.id}`);
  check("the owner sees their share links, but not the tokens", r.json.shares.length === 4 && !JSON.stringify(r.json.shares).includes(SHARE.split("/").pop()));
  await api("DELETE", `/api/saved/${trip.id}/shares/${revoked.share.id}`);
  check("a revoked link stops working", (await api("GET", revoked.href)).status === 404);
  r = await api("POST", `/api/saved/${trip.id}/reviews`, { rating: 5 });
  check("reviews are not open before the trip starts (409)", r.status === 409);
  show(`→ ${r.json.error}`);

  section("10. 60 days later: restart, then review");
  await stop();
  const later = await start({ TRAVEL_CLOCK_OFFSET_DAYS: "60" });
  show(later.trim());
  r = await api("GET", `/api/saved/${trip.id}`);
  check("after a restart the saved trip is still there (file store)", r.status === 200 && r.json.myNotes.includes("4812"));
  check("…and is now 'completed'", r.json.status === "completed");
  check("the search history survived too", (await api("GET", `/api/searches/${id}/versions`)).json.length >= 5);
  check("the 7-day share link has expired (410)", (await api("GET", expiring)).status === 410);
  r = await api("POST", `/api/saved/${trip.id}/reviews`, { rating: 1, comment: "Too hot, too far", aspects: { transport: 2, stay: 3, destination: 1, value: 2 }, wouldGoAgain: false });
  check("the traveller reviews the trip", r.status === 201 && r.json.trip.reviewSummary.count === 1);
  r = await api("POST", `${viewOnly}/reviews`, { by: "Gran", rating: 5 });
  check("a view-only link can't add reviews", r.status === 422);
  r = await api("POST", `${SHARE}/reviews`, { rating: 4 });
  check("a companion must give their name", r.status === 422);
  r = await api("POST", `${SHARE}/reviews`, { by: "Alex", rating: 4, comment: "Loved the hotel" });
  check("a companion reviews through a link that allows it", r.status === 201);
  r = await api("GET", SHARE);
  check("reviews show on the shared view", r.json.reviewSummary.count === 2);
  r.json.reviews.forEach((x) => show(`${x.by}: ${x.rating}/5 ${x.comment ?? ""}`));
  r = await api("GET", `/api/saved/${trip.id}/print?format=text`);
  check("reviews are on the print-out", r.text.includes("Reviews:") && r.text.includes("Too hot, too far"));

  section("11. Reviews shape the next search");
  const place = chosen.destination;
  r = await api("POST", "/api/searches", brief());
  check(`anonymously, the same brief still puts ${place.name} first`, r.json.options[0].destination.code === place.code);
  r = await api("POST", "/api/searches", brief(), { "X-Traveller-Key": KEY });
  check(`for the traveller who rated it 1/5, ${place.name} is no longer first`, r.json.options[0].destination.code !== place.code);
  const flagged = r.json.options.find((o) => o.destination.code === place.code);
  if (flagged) show(`watch-out: ${flagged.match.watchOuts.find((w) => w.includes("rated"))}`);
  r.json.options.forEach((o) => show(fmt(o)));

  section("12. Delete");
  r = await api("DELETE", `/api/saved/${trip.id}`);
  check("deleting the trip removes it, its links and its place in my trips", r.status === 204 && (await api("GET", `/api/saved/${trip.id}`)).status === 404 && (await api("GET", SHARE)).status === 404 && (await api("GET", "/api/travellers/me/trips", undefined, { "X-Traveller-Key": KEY })).json.length === 1);

  section("13. Production guards");
  await stop();
  for (const [name, env] of [
    ["the demo provider is refused in production", { NODE_ENV: "production", TRAVEL_PROVIDERS: "mock" }],
    ["the clock offset is refused in production", { NODE_ENV: "production", TRAVEL_PROVIDERS: "drive,mock", TRAVEL_CLOCK_OFFSET_DAYS: "5" }],
    ["no transport provider configured: refuses to start", { TRAVEL_PROVIDERS: "drive" }],
  ]) {
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, ["dist/server.mjs"], { env: { ...process.env, PORT: String(PORT + 1), TRAVEL_STORE: "memory", ...env }, stdio: "ignore" });
      const timer = setTimeout(() => (p.kill(), resolve("still running")), 3000);
      p.on("exit", (c) => (clearTimeout(timer), resolve(c)));
    });
    check(name, code !== 0 && code !== "still running", `exit ${code}`);
  }
}

try {
  await run();
} catch (err) {
  failures.push(`crashed: ${err.stack ?? err}`);
  console.error(err);
} finally {
  await stop();
  rmSync(DATA, { recursive: true, force: true });
}

console.log(`\n${failures.length ? "\x1b[31m" : "\x1b[32m"}${passed} passed, ${failures.length} failed\x1b[0m`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
