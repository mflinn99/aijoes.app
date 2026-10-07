# Running the platform on Replit (preview)

Replit hosts a preview of the Sentinel8 platform while the Azure launch is set
up (see `HOSTING.md` and `RUNBOOK.md` for Azure). It runs the same app from this
folder, with Replit's PostgreSQL database for storage and Claude through the
Anthropic API.

## Set it up from your own Replit workspace (5 minutes)

Do this signed in to the Replit account that should own the app, so it appears
in that workspace and you can open it. (An app created on your behalf by another
tool can land in a different account or workspace and show "Page not found".)

The repository's `.replit` file already tells Replit how to install, build, run
and publish the platform, with its non-secret settings. You only add the
secrets and the database.

1. In Replit, choose **Import** (left sidebar), then **GitHub**, and enter
   `https://github.com/mflinn99/aijoes.app`. It is public, so no GitHub sign-in
   is needed. Name the app **Sentinel8**. If the Agent offers to set the app up
   or change it, decline: it is ready to run.
2. Open **Tools → Secrets** and add:
   - `ANTHROPIC_API_KEY`: a key from console.anthropic.com → API Keys (set a
     monthly spend limit on it)
   - `SESSION_SECRET`: 48 or more random characters, for example from a
     password generator. Set it once and never change it: changing it signs
     everyone out and makes saved workspaces unreadable.
3. Open **Tools → Database** and create the PostgreSQL database.
4. Press **Run** once to check it starts (the console ends with
   `Sentinel8 listening … store: postgres … accounts: on`).
5. Press **Publish** (Deploy) and accept the settings it shows (Reserved VM,
   build and run commands from `.replit`).
6. Open `/signup` on the published address, create an account, and check you
   land on **Your board** with **Getting started**.
7. Connect `app.sentinel8.ai` (below), or send the published address to whoever
   maintains the website.

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

**Live now:** the platform runs at **https://exciting-inferior-axis.replit.app**
(Claude through Replit's built-in Anthropic integration, PostgreSQL), and the
website's buttons point there (`APP_URL` in `site/app-links.js`). That app is
in the Replit account Claude's Replit connection uses, not the owner's own
workspace.

To move to the branded address, publish from your own workspace (steps above),
add the custom domain `app.sentinel8.ai` in the deployment's settings, create
the DNS records Replit shows at the domain registrar, set
`PUBLIC_BASE_URL=https://app.sentinel8.ai`, then change `APP_URL` and the
buttons' addresses to it (`check:site` checks they match) and merge.

The website asks `APP_URL/api/healthz`
before sending anyone there, and opens the platform only when it answers as
Sentinel8 with accounts on. Until then the buttons show "Accounts open when the
platform launches". Do not use `sentinel8.ai` or `www.sentinel8.ai` for the
platform: they are the website (GitHub Pages), and its pages such as `/signup`
do not exist there.

## Moving to Azure later

The production design is Azure App Service with PostgreSQL Flexible Server
(`docs/security/ADR-001-azure-hosting.md`, Bicep in `infra/azure/`). The data
moves with `pg_dump`/`pg_restore` of the `sentinel8_documents` table, keeping
the same `SESSION_SECRET`, following `docs/security/MIGRATION-RUNBOOK.md`. That
runbook is blocked until the app and its database are in a Replit workspace
the owner controls.
