# Running the platform on Replit (preview)

Replit hosts a preview of the Sentinel8 platform while the Azure launch is set
up (see `HOSTING.md` and `RUNBOOK.md` for Azure). It runs the same app from this
folder, with Replit's PostgreSQL database for storage and Claude through the
Anthropic API.

## Source

- Repository: https://github.com/mflinn99/aijoes.app (public)
- Branch: `claude/aiogo-metamsp-build-directive-2lsui2` (the default branch)
- App folder: `sage-halpin/`. Everything else in the repository is unrelated
  and can be left out.

## Build and run

Node.js 22. From `sage-halpin/`:

| Step | Command |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` (the web app into `dist/public`, the server into `dist/server.mjs`) |
| Run | `node dist/server.mjs` |
| Health check | `GET /api/healthz` answers `{"status":"ok"}`; `GET /api/readyz` also reports the AI provider |

The server listens on `PORT` (Replit sets it; default 3001) and serves both the
web app and the API from that one port.

## Database

Add Replit's PostgreSQL database to the app. Replit then provides
`DATABASE_URL`, and in production the app stores accounts, saved workspaces,
board questions, answers and the organisation's record there automatically
(`STORE=postgres` is chosen whenever `DATABASE_URL` is set). It creates its one
table, `sentinel8_documents`, on first use. Nothing else to set up.

## Secrets and settings

| Name | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `AI_PROVIDER` | `anthropic` | Claude through the Anthropic API |
| `ANTHROPIC_API_KEY` | (secret) | From console.anthropic.com → API keys |
| `AI_MODEL` | `claude-opus-5-5` | Optional; this is the default |
| `WEB_SEARCH_TOOL` | `web_search_20260209` | Web search version for the Anthropic API |
| `SESSION_SECRET` | (secret) 48+ random characters | Signs sign-in sessions and encrypts saved workspaces. Generate once and never change it, or everyone is signed out and saved workspaces become unreadable |
| `PUBLIC_BASE_URL` | the app's published address, e.g. `https://sentinel8.replit.app` | Used in the questionnaire links people are sent |
| `TRUST_PROXY_HOPS` | `1` | Replit's proxy sits in front of the app |
| `DATABASE_URL` | (provided by Replit) | |

The server refuses to start in production without an AI key, and switches
accounts off (sign-up answers 503) without `SESSION_SECRET`.

## Publishing

Use a **Reserved VM** deployment if possible: the horizon scanner runs on a
timer inside the server, which an Autoscale deployment suspends when idle.
Autoscale also works; scans then run only while the app is awake.

## Connect the website

Once published, set `APP_URL` in `site/app-links.js` to the published address
(or to `https://app.sentinel8.ai` after adding that custom domain in Replit's
deployment settings and its DNS records at the registrar), then merge. The
website's **Sign in** and **Create account** buttons then open the live
platform instead of the "Accounts open when the platform launches" note.

## Moving to Azure later

Accounts and boards in the Replit database do not move to Azure Table storage
automatically. Before switching `APP_URL` to the Azure deployment, export the
`sentinel8_documents` table (partition key, row key, JSON) and load it into the
Azure table with the same keys, using the same `SESSION_SECRET`, so people keep
their accounts and saved workspaces.
