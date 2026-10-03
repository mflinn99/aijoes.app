# Travel search: back end

Tell it who's going, when, where from, the vibe and the budget. It asks the main
travel aggregators in parallel and comes back with **three different options**.
Change anything, as often as you like. Every result can be **saved** and
**printed**.

This is the API only. A front end calls it over JSON.

```bash
cd travel-search
npm install
TRAVEL_PROVIDERS=mock TRAVEL_STORE=memory npm run dev   # http://localhost:3002, demo data
npm test            # 72 tests, no network or keys needed
npm run typecheck
npm run build && npm start
```

## Inputs

| # | Input | Field | Required |
| --- | --- | --- | --- |
| 1 | Number of travellers | `travellers`: a number (adults), or `{ adults, children, infants }` | yes |
| 2 | Dates and flexibility | `dates`: `{ depart, return, flexibilityDays }` (0–7 days either side) | yes |
| 3 | Starting point, optional destination | `origin` (city or airport code), `destination` | origin only |
| 4 | Vibe | `vibe`: free text or a list, e.g. `"relaxed beach, good food"` | yes |
| 5 | Likes and dislikes | `likes`, `dislikes`: free text or lists | no |
| 6 | Budget and flexibility | `budget`: `{ amount, currency, per: "total" \| "person", flexibilityPercent }` | yes |

Optional `preferences`: `maxStops`, `cabin`, `minHotelStars`, `maxFlightHours`.

## How the search decides

Each rule below is enforced in code (`server/search.ts`) on every fare and room,
whichever aggregator it came from.

| Priority | Rule | Enforced as |
| --- | --- | --- |
| 1 | **Starting point is non-negotiable** | Out from, and back to, one of the origin's airports. Give an airport code (`LGW`) and that is the only airport used. An origin we don't recognise is rejected with suggestions, never guessed. |
| 2 | **Travellers are non-negotiable** | Fares must be priced for every passenger. Rooms must sleep the whole party. Anything else is discarded. |
| 3 | **Budget is non-negotiable** | Flights plus accommodation must come in under the ceiling (the target plus the flexibility you allow). Currency conversion adds a 3% buffer, and a price in a currency we can't convert is dropped. |
| 4 | Vibe, likes and dislikes matter | Scored. Destinations are tagged by character and by season (sun, ski), and hotel amenities count too. Dislikes are penalised hard and shown as watch-outs. |
| 5 | Destination is flexible when not given | With no destination, the best-matching places are searched, plus "anywhere" results from aggregators that support it. |

Dates stay inside your window. Trip length moves by no more than your flexibility.

If fewer than three options meet every rule, you get fewer, with a note saying
why (for example *"the cheapest trip over it was £1,020 (Lisbon)"*). The search
never bends a non-negotiable to fill the third slot.

### The three options

- **Best match**: the highest overall score (vibe 50%, value, convenience, quality).
- **Best value**: the cheapest option that still suits (within 75% of the best match on vibe).
- **Something different**: a different country, style or shape of trip.

With no destination, the three options are three different places. With a
destination, they differ in stay or dates. If the best match is also the
cheapest, it is labelled "Best match and best value" and the second slot becomes
an **Upgrade**. A luxury brief gives quality more weight; a budget brief gives
value more weight.

Each option has a one-paragraph `summary`, flight legs, the stay, a price
breakdown (`total`, `perPerson`, `flights`, `stay`, `headroom` against the
budget), `reasons`, `watchOuts`, its sources and booking links when the provider
gives them.

## API

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `/api/searches` | Search. Returns version 1 with up to three options. |
| `GET` | `/api/searches/:id[?version=n]` | The latest version, or any earlier one. |
| `GET` | `/api/searches/:id/versions` | The history of every refinement. |
| `POST` | `/api/searches/:id/refine` | Change anything; returns a new version. |
| `POST` | `/api/searches/:id/options/:optionId/replace` | Swap out one option and keep the other two. |
| `POST` | `/api/searches/:id/save` | Save a version, or chosen options from it, as a fixed snapshot. |
| `GET` | `/api/saved/:id` | Reopen a saved trip. |
| `GET` | `/api/searches/:id/print[?version=n&format=text&download=1]` | A printable A4 page (or plain text) for any version. |
| `GET` | `/api/saved/:id/print[?format=text&download=1]` | The same for a saved trip. |
| `GET` | `/api/healthz`, `/api/readyz` | Liveness, and which providers are configured. |

Every search response includes `actions.refine`, `actions.replaceOption`,
`actions.save` and `actions.print`, so a front end can always offer them. The
print page is self-contained: no scripts, no external assets, every value
escaped.

### Search

```http
POST /api/searches
{
  "travellers": { "adults": 2, "children": 1 },
  "dates": { "depart": "2027-02-13", "return": "2027-02-20", "flexibilityDays": 2 },
  "origin": "Manchester",
  "vibe": "relaxed, sunshine, family",
  "likes": ["good food", "pool"],
  "dislikes": ["party", "long flights"],
  "budget": { "amount": 3000, "currency": "GBP", "per": "total", "flexibilityPercent": 5 }
}
```

### Refine, as many times as needed

Send any mix of the following:

```jsonc
{
  "instruction": "cheaper, direct flights only, somewhere else",  // plain English
  "changes": { "travellers": { "adults": 3 }, "destination": "Lisbon" }, // partial request, merged
  "keep": ["<optionId>"],     // carry these over, if they still meet the request
  "replace": ["<optionId>"]   // swap these out (an open search also rules out that destination)
}
```

The response's `change.understood` lists what was understood, e.g.
`["budget lowered 15% to GBP 2550", "direct flights only", "different destinations"]`,
so the traveller can see it and correct it. The instruction parser understands:

- budget: "cheaper", "budget £3,000", "up to 4k", "10% over"
- travellers: "3 adults", "2 kids", "add a child"
- dates: "3 days either side", "more flexible"
- flights: "direct only", "under 5 hours", "no long flights", "business class"
- stays: "4 star"
- places: "fly to Lisbon", "from Manchester", "surprise me", "somewhere else"
- vibe: "more culture", "no crowds"

An instruction it can't understand gets a 422 with examples rather than a silent
re-run.

A kept option survives only if it still meets the non-negotiables. For example,
add a traveller and an option priced for two is dropped, with a note saying why.

### Save and print

```http
POST /api/searches/:id/save   { "name": "Winter sun", "version": 2, "optionIds": ["..."] }
GET  /api/saved/:savedId/print
```

A saved trip doesn't change when the search is refined later. Search and save
ids are 128-bit random values, so whoever has the link can open the trip. Add
accounts in front of this if trips need to be private to a user.

## Aggregators

| Provider | Gives | Notes |
| --- | --- | --- |
| **Amadeus** Self-Service | Flights (Flight Offers Search), hotels (Hotel List + Hotel Search) | `AMADEUS_ENV=production` for live prices. |
| **Duffel** | Flights (NDC + GDS, 300+ airlines); Stays when enabled | Children are priced as age 8, because the inputs don't ask for ages. |
| **Kiwi.com Tequila** | Flights, including **anywhere** and **whole-date-window** searches | Powers open searches. |
| Skyscanner, Booking.com, Expedia Rapid | Not implemented | Partner-only APIs. Each slots in behind the `Provider` interface (`server/providers/types.ts`) once a commercial agreement grants keys. |
| `mock` | Deterministic demo fares and hotels | For development and tests. Marked indicative. Refused in production. |

Providers run in parallel with a per-call timeout. If one fails, the search
carries on, and a note names the failed provider. If no aggregator quotes a room,
accommodation is estimated from a typical rate. The estimate is marked as such,
and the option is flagged `indicative`.

## Configuration

See `.env.example`. With no flight provider configured, the server refuses to
start. The same happens if the mock provider is enabled with
`NODE_ENV=production`. Storage is JSON files (`TRAVEL_STORE=file`, the default)
or memory. For more than one replica, put a database behind the three-method
`Store` interface in `server/store.ts`.

## Layout

```
server/
  schema.ts      the six inputs, validated (zod)
  places.ts      airports for start points; destination catalogue tagged by character and season
  vibe.ts        free text → tags; scoring vibe, likes, dislikes
  dates.ts       flexibility → concrete date pairs, window checks
  money.ts       pessimistic currency conversion
  providers/     amadeus, duffel, kiwi, mock, behind one interface
  search.ts      fan out, enforce the non-negotiables, rank, choose three
  summary.ts     the paragraph each option leads with
  refine.ts      partial changes and plain-English instructions
  sessions.ts    versions, keep and replace, save
  print.ts       printable HTML and plain text
  app.ts         HTTP API
```
