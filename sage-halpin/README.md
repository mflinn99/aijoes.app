# Sage Halpin — The Evolving Board

**The team evolves. The knowledge compounds.**

Sage Halpin (formerly Sixonic) is a boardroom for people and AI together. Six AI
agents, each with a declared remit (governance, risk, commercial value,
innovation, culture and performance), test every strategic question. The
people accountable for the business make the decision.

This is Sixonic's functionality under the Sage Halpin name and brand, rebuilt
to run on Microsoft Azure with Claude on Microsoft Foundry.

| | |
| --- | --- |
| **Boardroom** (`/boardroom`) | Put a question to the board; all six agents answer independently, and the chair agent recommends a resolution |
| **Scenario analysis** (`/analysis`) | Six board challenges, four calibration dials, per-agent SWOT and consequences, a DO / DON'T DO recommendation, a functional (sales, finance, HR, product, legal, governance) view, two feedback rounds, then you lock the decision |
| **Executive workspace** (`/dashboard`) | KPI snapshot with an alert engine, decisions board, growth levers and risk register |
| **Decision log** (`/log`) | Locked decisions with outcomes |

Workspace data (KPIs, decisions, levers, risks, analyses, the log) is saved in
each visitor's browser, exactly as Sixonic did. There is no database and no
sign-in.

## Run locally

```bash
npm install
cp .env.example .env        # then choose a provider, below
npm run dev:api             # API on http://127.0.0.1:3001
npm run dev                 # web on http://localhost:5173 (proxies /api)
```

AI providers (`AI_PROVIDER` in `.env`):

- `foundry` (production): Claude on Microsoft Foundry. Set
  `ANTHROPIC_FOUNDRY_RESOURCE`. With no key it signs in with Microsoft Entra ID
  (`az login` locally, the managed identity in Azure).
- `anthropic`: the Claude API directly. Set `ANTHROPIC_API_KEY`.
- `mock`: deterministic replies labelled "Mock", for tests and offline demos.
  Refused when `NODE_ENV=production`.

## Check

```bash
npm run typecheck
npm test               # 31 tests: API contracts, validation, limits, brand
npm run build
npm run check:brand    # fails on any Sixonic branding or "roster" in shipped files
```

## Deploy to Azure

See [`docs/RUNBOOK.md`](docs/RUNBOOK.md). In short: create a Microsoft Foundry
resource with a Claude deployment, then

```bash
az login
RESOURCE_GROUP=rg-sagehalpin-prod FOUNDRY_RESOURCE_NAME=<your-foundry> ./infra/deploy.sh
```

That provisions everything in `infra/main.bicep` (Container Apps, Container
Registry, managed identity, Key Vault and Log Analytics, in UK South), builds the
image in the registry, rolls it out and waits for `/api/readyz`. The GitHub
Actions workflow (`.github/workflows/sage-halpin.yml`) does the same on merge to
the default branch once its repository variables are set.

## The website

`site/` is the public website: the landing page (`site/index.html`) and the
interactive demo (`site/demo/index.html`), plain HTML with no build step. It
publishes to GitHub Pages at www.sentinel8.ai through
`.github/workflows/sage-halpin-site.yml`. [`docs/HOSTING.md`](docs/HOSTING.md) has
the publishing steps for both the website and this app.

## Documentation

| | |
| --- | --- |
| [`docs/BUILD-STATUS.md`](docs/BUILD-STATUS.md) | What is complete, verified, not yet verified, and remaining |
| [`docs/INVENTORY.md`](docs/INVENTORY.md) | What Sixonic was, as received |
| [`docs/MAPPING.md`](docs/MAPPING.md) | Every Sixonic feature, its Sage Halpin name, and the test that proves it |
| [`docs/RENAME-EXCEPTIONS.md`](docs/RENAME-EXCEPTIONS.md) | Old identifiers kept on purpose, and why |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Proposal capabilities Sixonic never had, deliberately not built yet |
| [`docs/HOSTING.md`](docs/HOSTING.md) | What runs where, and how to publish the website and the app |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Deploy, roll back, rotate, observe |
| [`BLOCKERS.md`](BLOCKERS.md) | What needs a person before launch |

Human advisers and AI agents support the board. AI agents are not statutory
directors and do not exercise voting rights. The client's authorised people
retain decision authority. Data access, retention and deletion follow the agreed
terms.
