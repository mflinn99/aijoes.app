# SIXONIC — standalone source

This is the current SIXONIC boardroom web app plus its boardroom AI API, packaged
without the other workspace apps, database, deployment settings, or private data.

## Requirements

- Node.js 22 or newer
- npm (included with Node)
- An OpenAI-compatible provider account with access to the configured model.
  AI requests may incur provider charges. No credentials are included.

## Run locally

1. Extract this archive and open a terminal in `sixonic-standalone`.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and enter your own `OPENAI_API_KEY`.
   Set `OPENAI_BASE_URL` only for a compatible non-default provider, and
   choose an `OPENAI_MODEL` that provider supports (default: `gpt-5.1`).
4. In one terminal run `npm run dev:api`. In another run `npm run dev`.
5. Open `http://localhost:5173/`. The Vite dev server forwards `/api` to
   the API server at `http://127.0.0.1:3001`.

## Build and host

Run `npm run typecheck`, then `npm run build`. Run `npm start` from this
directory with your host's `PORT` and `OPENAI_API_KEY` set. The Express process
serves `dist/public` and the `/api/boardroom` endpoints on that single port.
Keep your provider key server-side only; never set it as a `VITE_` variable.
For production, terminate TLS at your hosting provider and consider rate limits
and abuse controls for the publicly accessible AI endpoints.

## What is (and is not) included

- The latest SIXONIC pages and six-perspective oval boardroom visual.
- The SIXONIC boardroom chat and scenario analysis API, with its original
  prompt and output contracts. The Accenture-specific board is not included.
- Browser-local KPI, decision, risk, and analysis storage. These are saved
  separately in each visitor's browser, not shared via a database.
- No Replit AI integration, Supabase account login, user data, historical
  browser storage, credentials, or production deployment.

The default app uses six parallel model calls for a full board session. The
host must support `OPENAI_MODEL`; if its API is not OpenAI-compatible, adapt
`server/routes/boardroom.ts` to that provider before running AI features.
