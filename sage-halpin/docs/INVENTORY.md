# Sixonic inventory (as received)

Source: `sixonic-standalone.zip`, supplied 29 September 2026, committed unmodified
as `chore(sage-halpin): import the Sixonic standalone source as received`. The
live site, sixonic.replit.app, could not be reached from the build environment,
so this inventory is of the source.

## What it is

"SIXONIC — Boardroom Intelligence": a single-page web app plus a small API.
Six AI perspectives analyse a CEO's strategic question or a board challenge.
Tagline: "Better decisions. Responsible performance." Headline copy: "Boardroom
intelligence for the whole company. Six perspectives connect commercial ambition
with ethical leadership, organisational culture and long-term value."

## Stack

Vite + React 19, wouter, Tailwind 4 with shadcn/ui, framer-motion. Express 5 API
bundled by esbuild into one Node process that also serves the built site. AI via
the OpenAI SDK (`gpt-5.1` for chat, `gpt-4.1` for analysis). No database, no
authentication (a Supabase login existed previously and was removed; its
storage namespacing remained).

## Screens

| Route | Screen |
| --- | --- |
| `/` | Home: brand, oval six-seat boardroom visual, Start/Resume Scenario, Ask the Board, Enter Workspace |
| `/dashboard` | Executive Workspace: KPI snapshot (editable), alert engine, decisions board, growth levers, risk register, boardroom call to action |
| `/boardroom` | Chat: CEO statement plus optional context, three discussion starters, six parallel responses, chair's resolution |
| `/analysis` | Analysis engine: six fixed challenges, four calibration sliders, "bespoke challenge — coming soon" with a waitlist mailto, running state with timed board statements, results (verdict, assessment, expert and traditional views), two feedback rounds, lock |
| `/log` | Decision log: locked decisions, outcomes |
| `/reset-password` | Redirects to `/` (auth disabled) |

## API

| Route | Contract |
| --- | --- |
| `POST /api/boardroom/chat` | `{ topic, context?, sessionHistory?, mode: "full_board" \| "single", personaId? }` → six `{ personaId, name, role, emoji, color, content }` in order orion, grimm, solara, zephyr, mira, aquila (or one, in single mode) |
| `POST /api/boardroom/analysis` | `{ challenge, calibration: { risk, ambition, time, cost }, feedbackRound?, feedbackComment? }` → `personaOutputs` (6 SWOTs), `aggregatedOutput` (DO/DONT_DO, rationale, difficulty, cost, time, risk, `personaActions` keyed by dr_white … col_blue), `traditionalView` (6 functions) |
| `GET /api/healthz` | `{ status: "ok" }` |

Six challenges with "board truths": reduce payroll, improve margins, increase
sales, build new product, recruit senior leader, identify redundancies.

## People and AI

The CEO (a person) asks; six AI personas answer; the chair persona "must not
leave the session without a decision". The person locks the decision in the
analysis flow. Personas were characters (Orion the Owl of Truth, Grimm the Iron
Wolf, Solara the Golden Lion, Zephyr the Spiral Dragon, Mira the Ember Sprite,
Aquila the Sky Judge) in chat and named people (Dr White, Cmdr Black, Ms Gold,
Dr Green, Lt Red, Col Blue) in analysis. The UI already labelled seats by
function.

## Data

Browser `localStorage` only, keys `sixonic_anon_*`. No server-side persistence,
no customer data in the package.

## Brand

Name SIXONIC in the header, dashboard, analysis page, boardroom table centre,
footer, page titles, `index.html` metadata, the favicon (six dots on emerald
`#0f4d3a`), `opengraph.jpg` and a waitlist address `waitlist@sixonic.ai`. Palette
"ESG Corporate": deep emerald primary (`hsl(161 68% 18%)`), Plus Jakarta Sans.

## Also found

- `DemoModal.tsx`: unused, and embedded a placeholder YouTube video.
- Comments describing an "Accenture Reinvention Board" that is not in the package.
- Public AI endpoints with no input limits or rate limiting (the Sixonic README
  itself recommends adding them).
