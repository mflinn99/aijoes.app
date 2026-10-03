# Travel search: back end

Tell it who's going, when, where from, the vibe and the budget. It asks the main
travel aggregators in parallel and comes back with **three different options**.
Options can travel by **any mode**: flight, train, coach, ferry or car.

- Add **keywords**, anything at all, to steer the search.
- Change anything, as often as you like.
- **Lock** part of an option and **remix** the rest.
- **Save** any result, **print** it, **share** it, and **review** the trip afterwards.

This is the API only. A front end calls it over JSON.

```bash
cd travel-search
npm install
TRAVEL_PROVIDERS=mock,drive TRAVEL_STORE=memory npm run dev   # http://localhost:3002, demo data
npm test            # 119 tests, no network or keys needed
FAKE_TODAY=2027-03-01 npm test   # run them as if it were another day of the year
npm run typecheck
npm run build && npm start
```

## Inputs

| # | Input | Field | Required |
| --- | --- | --- | --- |
| 1 | Number of travellers | `travellers`: a number (adults), or `{ adults, children, infants }` | yes |
| 2 | Dates and flexibility | `dates`: `{ depart, return, flexibilityDays }` (0–7 days either side) | yes |
| 3 | Starting point, optional destination | `origin` (city or airport code), `destination` | origin only |
| 4 | Vibe | `vibe`: free text or a list, e.g. `"relaxed beach, good food"` | vibe or keywords |
| + | Keywords | `keywords`: anything that should inform the search, e.g. `"christmas markets, Lisbon-ish, rooftop bar"` | vibe or keywords |
| 5 | Likes and dislikes | `likes`, `dislikes`: free text or lists | no |
| 6 | Budget and flexibility | `budget`: `{ amount, currency, per: "total" \| "person", flexibilityPercent }` | yes |

Optional `preferences`:

- `modes`: the ways of travelling you'll accept. Default: all of `flight`, `train`, `coach`, `ferry`, `car`.
- `maxStops`: the most stops or changes each way.
- `maxTravelHours`: the most hours each way, by any mode. `maxFlightHours` still works as an alias.
- `cabin`
- `minHotelStars`

## How the search decides

Each rule below is enforced in code (`server/search.ts`) on every journey and
room, whichever aggregator it came from.

| Priority | Rule | Enforced as |
| --- | --- | --- |
| 1 | **Starting point is non-negotiable** | Out from, and back to, the origin. That means its airports, its stations (London St Pancras, King's Cross, Victoria Coach Station…), its ferry ports, or its own front door for a car. Give an airport code (`LGW`) and only that airport counts, by any mode. A station or port that belongs to another place is always rejected, whatever city a provider claims for it. An origin we don't recognise is rejected with suggestions, never guessed. |
| 2 | **Travellers are non-negotiable** | Fares must be priced for every passenger. Cars must have enough seats (five per car). Rooms must sleep the whole party. Anything else is discarded. |
| 3 | **Budget is non-negotiable** | Transport plus accommodation must come in under the ceiling (the target plus the flexibility you allow). Currency conversion adds a 3% buffer, and a price in a currency we can't convert is dropped. |
| 4 | Vibe, likes and dislikes matter | Scored. Destinations are tagged by character and by season (sun, ski), and hotel amenities count too. Dislikes are penalised hard and shown as watch-outs. |
| 5 | Destination is flexible when not given | With no destination, the best-matching places are searched, plus "anywhere" results from aggregators that support it. |

Dates stay inside your window. Trip length moves by no more than your flexibility.

If fewer than three options meet every rule, you get fewer, with a note saying
why (for example *"the cheapest trip over it was £1,020 (Lisbon)"*). The search
never bends a non-negotiable to fill the third slot.

### Any way of travelling

For each destination, every allowed mode that can plausibly get there is searched:

| Mode | When | Where the price comes from |
| --- | --- | --- |
| Flight | Any distance with airports at both ends | Amadeus, Duffel, Kiwi |
| Train | Same landmass, through the Channel Tunnel, or rail & sail to Ireland | Kiwi (rail) |
| Coach | As for rail | Kiwi (bus) |
| Ferry | Where a route runs (Barcelona–Mallorca, Piraeus–Santorini…) | Partner APIs (see below); demo data meanwhile |
| Car | Up to 1,500 km by road, with the Channel Tunnel or Irish Sea crossing where needed; never to an island | Calculated: fuel, typical tolls, the crossing and parking, per car (five seats each). Assumes your own car; rental is not included. Marked as an estimate. |

**Ranking across modes.** Options are compared door to door. A flight carries
about 2.5 hours of airport time on top; a train about half an hour. Connections
are penalised more heavily than breaks on a drive, and journeys of more than
8 hours each way (6 for a drive) are penalised and flagged.

**Carbon.** Every option carries `transport.co2KgPerPerson`, using UK government
conversion factors. A car's emissions are shared between the people in it.

**Mode preferences.** The traveller's own words steer the ranking:

- "eco", "low carbon" or "slow travel" favour lower-carbon options.
- "by train" or "road trip" favour that mode.
- A dislike such as "flying" counts against flights and is shown as a watch-out.

These steer; `preferences.modes` is what constrains. The one exception is
**"flight-free"** (or "no fly") anywhere in the brief. It is taken literally and
rules flights out, and the keyword feedback says so.

Within the three options, the "Something different" pick prefers a different
mode, so London to Paris tends to come back as plane, train and coach or car.

### Keywords

The keyword box takes anything: places, events, themes, interests, half-ideas.
Keywords steer the search but don't restrict it ("flight-free" is the
exception). Each keyword is read, in turn, as:

| Read as | Example | Effect |
| --- | --- | --- |
| **travel** | "flight-free", "by train", "road trip", "slow travel" | "Flight-free" rules out flying; the others favour that way of travelling. |
| a **theme** | "christmas markets", "honeymoon", "stag do", "northern lights", "tapas", "safari" | Favours the places known for it. Themes with a season (Christmas markets, cherry blossom, Oktoberfest, skiing) only nudge the search when your dates are out of season, and the response says so. |
| a **place** | "Lisbon", "Lisbon-ish", "Iceland" | That place gets a clear lead. The other options are still somewhere else; set `destination` to search only there. |
| a **region or country** | "Greece", "Caribbean", "canaries", "south east asia" | Favours the destinations there. |
| a **vibe word** | "foodie", "chilled", "adrenaline" | Adds to the vibe. |
| **free text** | "rooftop pool", "mulled" | Matched against destination and hotel names and amenities. |

Every response includes `keywords`: one entry per keyword with how it was read
and what it did, so the front end can show it and nothing is silently dropped.
Keywords can be the only brief (no vibe), and can be added during refinement
(`"keywords: castles and beer"` or `changes.keywords`).

### The three options

- **Best match**: the highest overall score (vibe, value, convenience, quality, and carbon when asked for).
- **Best value**: the cheapest option that still suits (within 75% of the best match on vibe).
- **Something different**: a different country, mode, style or shape of trip.

With no destination, the three options are three different places. With a
destination, they differ in transport, stay or dates. If the best match is also
the cheapest, it is labelled "Best match and best value" and the second slot
becomes an **Upgrade**.

Each option has:

- a one-paragraph `summary`
- `transport`: the mode, outbound and inbound legs (each leg's modes in order, e.g. train + ferry + train), carriers, CO2, and the number of cars for a drive
- the stay
- a price breakdown: `total`, `perPerson`, `transport`, `stay`, and `headroom` against the budget
- `reasons` and `watchOuts`
- its sources, and booking links when the provider gives them

## API

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `/api/searches` | Search. Returns version 1 with up to three options. |
| `GET` | `/api/searches/:id[?version=n]` | The latest version, or any earlier one. |
| `GET` | `/api/searches/:id/versions` | The history of every refinement and remix. |
| `POST` | `/api/searches/:id/refine` | Change anything; returns a new version. |
| `POST` | `/api/searches/:id/options/:optionId/replace` | Swap out one option and keep the other two. |
| `POST` | `/api/searches/:id/options/:optionId/remix` | Lock elements of one option and remix the rest. |
| `POST` | `/api/searches/:id/save` | Save a version, or options from it, as a trip. |
| `GET` | `/api/travellers/me/trips` | Your saved trips (send `X-Traveller-Key`). |
| `GET` | `/api/saved/:id` | A saved trip: options, itinerary, shares, reviews. |
| `PATCH` | `/api/saved/:id` | Rename, add `myNotes`, or set `chosenOptionId` (the option you're going with). |
| `DELETE` | `/api/saved/:id` | Delete the trip and its share links. |
| `POST` | `/api/saved/:id/share` | Create a read-only share link. |
| `DELETE` | `/api/saved/:id/shares/:shareId` | Revoke a share link. |
| `GET` | `/api/shared/:token` | What someone with the link sees. |
| `POST` | `/api/saved/:id/reviews` | Review the trip, once it has started. |
| `POST` | `/api/shared/:token/reviews` | A companion's review, if the link allows it. |
| `GET` | `/api/searches/:id/print`, `/api/saved/:id/print`, `/api/shared/:token/print` | A printable A4 page; add `?format=text` for plain text, `&download=1` to download. |
| `GET` | `/api/healthz`, `/api/readyz` | Liveness, and which providers and modes are configured. |

Every response carries the actions available from it (`actions.refine`,
`actions.remixOption`, `actions.save`, `actions.print`, `actions.share`,
`actions.review`…), so a front end can always offer them. The print pages are
self-contained: no scripts, no external assets, every value escaped.

### Refine, as many times as needed

Send any mix of the following:

```jsonc
{
  "instruction": "cheaper, train only, somewhere else",           // plain English
  "changes": { "travellers": { "adults": 3 }, "destination": "Lisbon" }, // partial request, merged
  "keep": ["<optionId>"],     // carry these over, if they still meet the request
  "replace": ["<optionId>"]   // swap these out (an open search also rules out that destination)
}
```

`change.understood` in the response lists what was understood, so the traveller
can see it and correct it. The instruction parser understands:

| Topic | Examples |
| --- | --- |
| budget | "cheaper", "budget £3,000", "up to 4k", "10% over" |
| travellers | "3 adults", "2 kids", "add a child" |
| dates | "3 days either side", "more flexible" |
| how you travel | "train only", "no flying", "flight-free", "road trip", "go by coach", "include ferries", "avoid driving", "any transport" |
| journeys | "direct only", "under 5 hours", "no long journeys", "business class" |
| stays | "4 star" |
| places | "fly to Lisbon", "from Manchester", "surprise me", "somewhere else" |
| vibe and keywords | "more culture", "no crowds", "keywords: castles and beer" |

An instruction it can't understand gets a 422 with examples rather than a silent
re-run.

### Lock and remix

```http
POST /api/searches/:id/options/:optionId/remix
{ "lock": ["destination"] }        // any of: destination, dates, transport, stay  ("flight" is accepted for transport)
```

| Lock | Kept | Remixed |
| --- | --- | --- |
| `destination` | the place | dates, transport, stay |
| `dates` | the exact dates | destination (three different places on an open search), transport, stay |
| `transport` | the journey, so also its destination and dates | the stay |
| `stay` | the hotel, so also its destination and dates | the transport |

Remixed options change every unlocked element where they can, and always at
least one. Locked elements are checked against the non-negotiables again, and
are reported, never quietly replaced, if they no longer fit. Each remix is a new
version.

## Save, share, review

**Save.** `POST /api/searches/:id/save { name?, version?, optionIds? }` takes a
snapshot. It doesn't change when the search is refined later.

**My trips.** The first save returns a **traveller key**, shown once. Send it as
`X-Traveller-Key` to save more trips to the same list, and to list them with
`GET /api/travellers/me/trips`. Each trip shows its status (`planning`,
`upcoming`, `in progress`, `completed`), the chosen option, its review summary
and its active share links.

**Itinerary.** Choose the option you're going with (`PATCH { chosenOptionId }`;
saving a single option chooses it). The trip then carries a day-by-day
`itinerary`:

- **Day 1:** when and where you leave, the journey (mode, carriers, changes, duration), arrival and check-in.
- **Free days:** ideas drawn from what you asked for and what the place is known for.
- **Last day:** check out, the journey home, and when you're back.

The itinerary also has a summary and booking links. It is what gets printed and
shared. `myNotes` are your own and never appear on a share link.

**Share.** `POST /api/saved/:id/share { label?, allowReviews?, expiresInDays? }`
returns a link. The link is shown once and only a hash of it is stored.

- **What it shows:** the trip, itinerary, options and reviews, read-only, and a print page.
- **What it hides:** your notes, the search it came from, and the trip's own id.
- **Limits:** links can expire, can be revoked individually, and a trip can have up to 20 active links.
- **Companion reviews:** with `allowReviews`, people with the link can add their own review, with their name.

**Review.** Reviews open once the trip has started. Before that, a review gets a
409 with the date reviews open. A review has:

- `rating` (1–5)
- an optional `comment`
- optional `aspects`: `transport`, `stay`, `destination`, `value` (1–5 each)
- optional `wouldGoAgain`

The trip shows a summary: count, average rating, and how many would go again.

**Reviews feed the next search.** Search with your `X-Traveller-Key` and your own
reviews are taken into account. A place you rated 2/5 or lower drops back, with a
watch-out ("you rated Lisbon 2/5 after your last trip"). One you rated 4/5 or
higher gets a nudge and a reason. Naming a place in your keywords still wins over
an old review.

There are no accounts, by design. Access is by unguessable links (128-bit or
more):

| Secret | Gives |
| --- | --- |
| Search id | that search and its versions |
| Saved trip id | the owner's view: manage, share, delete |
| Share token | read-only access, plus reviews if the link allows them |
| Traveller key | the list of your trips |

Put an identity provider in front if trips need to belong to user accounts.

## Aggregators

| Provider | Gives | Notes |
| --- | --- | --- |
| **Amadeus** Self-Service | Flights; hotels | `AMADEUS_ENV=production` for live prices. |
| **Duffel** | Flights (NDC + GDS, 300+ airlines); Stays when enabled | Children are priced as age 8, because the inputs don't ask for ages. |
| **Kiwi.com Tequila** | Flights, **trains and buses**, including **anywhere** and **whole-date-window** searches | Powers open searches and most ground transport. |
| **drive** (built in) | Car journeys | A calculation, not a quote. Tune with `DRIVE_FUEL_GBP_PER_KM` and `DRIVE_MAX_KM`. |
| Skyscanner, Booking.com, Expedia Rapid, Trainline, Omio, Rail Europe, FlixBus, Direct Ferries, Ferryhopper | Not implemented | Partner-only APIs. Each slots in behind the `Provider` interface (`server/providers/types.ts`) once a commercial agreement grants keys. |
| `mock` | Demo flights, trains, coaches, ferries and hotels | For development and tests. Marked indicative. Refused in production. |

Providers run in parallel with a per-call timeout. If one fails, the search
carries on, and a note names the failed provider. If no aggregator quotes a room,
accommodation is estimated from a typical rate. The estimate is marked as such,
and the option is flagged `indicative`.

## Configuration

See `.env.example`. With no transport provider configured (`drive` alone doesn't
count), the server refuses to start. The same happens if the mock provider is
enabled with `NODE_ENV=production`. Storage is JSON files (`TRAVEL_STORE=file`,
the default) or memory. For more than one replica, put a database behind the
four-method `Store` interface in `server/store.ts`.

## Layout

```
server/
  schema.ts      the inputs, validated (zod)
  places.ts      airports for start points; destination catalogue tagged by character and season
  ground.ts      landmasses, stations, ferry routes, crossings, road distance, CO2 factors
  vibe.ts        free text → tags; scoring vibe, likes, dislikes, keywords
  keywords.ts    the keyword box: travel words, themes, places, regions, free text
  dates.ts       flexibility → concrete date pairs, window checks
  money.ts       pessimistic currency conversion
  providers/     amadeus, duffel, kiwi, drive, mock, behind one interface
  search.ts      fan out, enforce the non-negotiables, rank across modes, choose three; locks for remix
  summary.ts     the paragraph each option leads with
  refine.ts      partial changes and plain-English instructions
  sessions.ts    search versions, keep and replace, remix
  trips.ts       save, my trips, choose, share links, reviews
  itinerary.ts   the chosen option, day by day
  print.ts       printable HTML and plain text
  clock.ts       the current time (movable in tests)
  app.ts         HTTP API
```
