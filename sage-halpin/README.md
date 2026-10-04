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
| **Your board** (`/organisation`) | Onboarding: the organisation, the real people included in decisions (name, role, email, phone, expertise, CV), each either a **permanent member** (always asked on every decision that involves people; the chair must confirm before deciding without their answer, and that is recorded) or invited as needed, and the shadow board of six AI agents, each with a persona, which the lead can seat and brief |
| **Agent development** (`/agents`) | The chair educates each agent (principles, facts, preferences, corrections, material to study) and sees its track record: questions advised, agreement with the board, outcomes called right. Agents also learn from feedback on their opinions, from decision outcomes and from horizon scanning; everything proposed waits for the chair's approval |
| **Checkpoint** (`/checkpoint`, and a pill at the top of every page) | The organisation on a page: status now and the last three years in order (events and achievements the lead logs, every decision with its plan and outcome, people joining and leaving, what the agents learned, high-impact external signals). Publishing a checkpoint takes a numbered snapshot with AI insights; later entries show as new. Print, save as PDF or download as HTML |
| **The horizon** (`/horizon`) | The platform keeps looking outward: on a schedule (6 hours to weekly) it reads the chosen RSS/Atom feeds and searches the web for the watch topics, keeps relevant signals (category, impact, horizon, which agents it concerns), and maintains the external landscape briefing every agent reads |
| **Board questions** (`/questions`) | The chair chooses who decides each question: **people** (questionnaires only), **agents** (the shadow board only) or **collaborative** (two rounds: independent views, then the agents challenge the people's answers and people can revise theirs; the chair sets the weighting, for example 70% people, 30% agents). | Put a question to the board. Each person involved is emailed a questionnaire (their position, their confidence and tailored questions). The decision can then be seen three ways: **people only**, **shadow board** (agents only, each speaking through its persona, then the Chair) and **people and agents** together, with a recommended resolution. Record the decision on the decisions board |
| **Questionnaire** (`/respond/<link>`) | What each person sees from their email: only their question and their own answers, which they can change until the lead closes it |
| **Shadow board** (`/boardroom`) | A quick consult: put a question to the six agents only; all six answer independently, and the chair agent recommends a resolution |
| **Scenario analysis** (`/analysis`) | Six board challenges, four calibration dials, per-agent SWOT and consequences, a DO / DON'T DO recommendation, a functional (sales, finance, HR, product, legal, governance) view, two feedback rounds, then you lock the decision |
| **Executive workspace** (`/dashboard`) | KPI snapshot with an alert engine, decisions board, growth levers and risk register |
| **Decision log** (`/log`) | Locked decisions with outcomes |

Workspace data (KPIs, decisions, levers, risks, analyses, the log) and the
board you assemble (people, CVs, agent settings) are saved in the lead's
browser, as Sixonic did. There is no sign-in.

Board questions are the exception, because people answer them from their own
devices: the question, the names, roles and emails of the people asked, and
their answers are kept on the server (Azure Table Storage in production) for
90 days by default, then deleted automatically. The lead can delete a question
and its answers at any time. CVs never leave the browser except to be read by
the AI model when the board is consulted. Access works by unguessable links: the
lead's browser holds the question's admin key, and each person's email holds
their own link, which the lead can replace.

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
npm test               # API contracts, consultations, validation, limits, brand
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

`site/` is the public website, plain HTML with no build step: the landing page
(`site/index.html`, with Contact Us), the interactive demo (`site/demo/`), the media
page with the hero videos (`site/media/`) and the standalone hero animation
(`site/hero.html`). `npm run check:site` checks every page's links, files, anchors
and contact details, and runs on every pull request and before every publish. It
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
