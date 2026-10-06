# Running the platform on Replit (preview)

Replit hosts a preview of the Sentinel8 platform while the Azure launch is set
up (see `HOSTING.md` and `RUNBOOK.md` for Azure). It runs the same app from this
folder, with Replit's PostgreSQL database for storage and Claude through the
Anthropic API.

## Set it up from your own Replit workspace (10 minutes)

Do this signed in to the Replit account that should own the app, so it appears
in that workspace and you can open it. (An app created on your behalf by another
tool can land in a different account or workspace and show "Page not found".)

1. In Replit, choose **Import** (left sidebar), then **GitHub**, and enter
   `https://github.com/mflinn99/aijoes.app`. It is public, so no GitHub sign-in
   is needed. Name the app **Sentinel8**.
2. Open **Tools → Secrets** and add:
   - `ANTHROPIC_API_KEY`: a key from console.anthropic.com → API Keys
   - `SESSION_SECRET`: 48 or more random characters (for example the output of
     `openssl rand -base64 48`). Set it once and never change it.
3. Open **Tools → Database** and create the PostgreSQL database.
4. In the Agent chat, paste:

   > Run the existing Sentinel8 app in the sage-halpin folder exactly as it is;
   > do not rewrite or restyle it. Follow sage-halpin/docs/REPLIT.md: from
   > sage-halpin run npm ci, npm run build, then node dist/server.mjs, listening
   > on PORT. Set NODE_ENV=production, AI_PROVIDER=anthropic,
   > AI_MODEL=claude-opus-5-5, WEB_SEARCH_TOOL=web_search_20260209,
   > TRUST_PROXY_HOPS=1, and PUBLIC_BASE_URL to the published address. Use the
   > ANTHROPIC_API_KEY and SESSION_SECRET secrets and the PostgreSQL database
   > already set up. Then publish it as a Reserved VM deployment.

5. When it is published, open `/signup` on the published address, create an
   account, and check you land on **Your board** with **Getting started**.
6. Send the published address to whoever maintains the website, to set as
   `APP_URL` (below).

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

The website's buttons point at **https://app.sentinel8.ai** (`APP_URL` in
`site/app-links.js`). Give the published app that address: in the Replit
deployment's settings, add the custom domain `app.sentinel8.ai` and create the
DNS records Replit shows at the domain registrar. Set
`PUBLIC_BASE_URL=https://app.sentinel8.ai` in the app.

Nothing else changes. The website asks `https://app.sentinel8.ai/api/healthz`
before sending anyone there, and opens the platform only when it answers as
Sentinel8 with accounts on. Until then the buttons show "Accounts open when the
platform launches". Do not use `sentinel8.ai` or `www.sentinel8.ai` for the
platform: they are the website (GitHub Pages), and its pages such as `/signup`
do not exist there.

## Moving to Azure later

Accounts and boards in the Replit database do not move to Azure Table storage
automatically. Before switching `APP_URL` to the Azure deployment, export the
`sentinel8_documents` table (partition key, row key, JSON) and load it into the
Azure table with the same keys, using the same `SESSION_SECRET`, so people keep
their accounts and saved workspaces.
