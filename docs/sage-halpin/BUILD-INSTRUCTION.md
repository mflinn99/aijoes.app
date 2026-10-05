CLAUDE CODE BUILD INSTRUCTION
Sage Halpin (formerly Sixonic) — The Evolving Board
Rebrand Sixonic as Sage Halpin, keep its functionality, host it in Microsoft Azure.

Written 29 September 2026. Sources: the Sage Halpin rebrand proposal (revised
23 September 2026), the direction that Sage Halpin replaces Sixonic's name and
branding while keeping its functionality, and the landing page already built at
`mflinn99/aijoes.app` → `sage-halpin/site/` (it was first built as a route in the
MetaMSP app, since moved there).

STATUS (29 September 2026): built from the Sixonic standalone export into
`sage-halpin/` in this repository. See `sage-halpin/docs/BUILD-STATUS.md` for
what was verified, and for where the build departs from this instruction
(Sixonic has no database, sign-in or tenants, so none were added).

---

HOW TO USE THIS

Start a new repository (suggested name `sage-halpin`), open Claude Code at its
root and give it this file as its instruction. Run it where Claude Code has
outbound network access to `sixonic.replit.app`, `github.com`, the npm registry
and Azure, and ideally with access to the Sixonic source. Phase 0 cannot be
done without that access, and nothing else starts until Phase 0 is done.

Work in phases. At the end of each phase commit, push, and update
`docs/BUILD-STATUS.md` with what is complete, mocked, blocked and remaining.
Never report something as done that has not been run.

---

0. WHAT YOU ARE BUILDING

**Sixonic's functionality, under the Sage Halpin name and brand, running on
Azure.**

Three rules decide every trade-off:

1. **Keep the functionality.** Every working Sixonic feature is carried
   across and must still work. Nothing is retired without Mark Halpin's
   explicit say-so, recorded in the Phase 0 mapping table.
2. **Replace the brand completely.** No "Sixonic" name, logo, colour, copy or
   domain remains in the product, except a deliberate "Sage Halpin, formerly
   Sixonic" transition notice and historical records.
3. **Keep the spirit: people and AI together.** Sage Halpin is a mixed
   platform of human experts and AI agents. Wherever Sixonic's features
   involve people or agents, the rebrand makes that visible and honest (see
   section 1).

The positioning the brand carries:

> **The team evolves. The knowledge compounds.**
> An evolving team of human experts and agentic advisers that scales and
> flexes with the ever-changing needs of your organisation, with one
> enduring institutional memory.

The build is finished when (section 10 has the detail):
- every Sixonic feature in the Phase 0 inventory passes a parity test on the
  Azure staging environment,
- the product carries the Sage Halpin brand everywhere and Sixonic's nowhere,
- production runs on Azure from infrastructure as code.

---

1. LANGUAGE AND BRAND RULES (UI copy, code identifiers, docs, prompts)

- The name is **Sage Halpin**, descriptor **THE EVOLVING BOARD**; **SH** is
  the compact mark. Use the full name externally.
- Never use the word "roster". Say **team**, **team member**, **adviser**,
  **assignment**, and describe the team as one that **scales and flexes**
  with the organisation's needs.
- Every contributor is visibly a **human adviser** or an **AI agent**:
  circles for people, diamonds for agents (the symbol's convention). Agents
  are named by role ("Finance agent"), never given a human name or face.
- Where Sixonic shows information, keep a clear line between **sourced
  fact**, **interpretation** and **recommendation**.
- Never promise infallibility or total knowledge capture.
- Footer disclosure, verbatim, on every public page:
  "Human advisers and AI agents support the board. AI agents are not
  statutory directors and do not exercise voting rights. The client's
  authorised people retain decision authority. Data access, retention and
  deletion follow the agreed terms."
- Code: rename Sixonic identifiers in packages, routes, UI components and
  env vars to Sage Halpin equivalents (`sage-halpin`, `SageHalpin`,
  `SAGE_HALPIN_*`). Where renaming would break stored data or an external
  integration (database table names, webhook paths, API routes customers
  call), keep the old identifier, alias it, and list it in
  `docs/sixonic/RENAME-EXCEPTIONS.md`.

---

2. PHASE 0 — INVENTORY SIXONIC (mandatory, before any code)

Sixonic lives at https://sixonic.replit.app. It could not be reviewed when
this instruction was written: the authoring environment's network policy
blocked the host, and the Repl is not visible to the `mflinn99` Replit
account (it is probably owned by another account). Nothing below assumes
what Sixonic does. Establish it.

1. Walk the live app with Playwright. Capture every public route and every
   screen reachable with a demo or test login, with a screenshot of each in
   `docs/sixonic/screens/`.
2. Get the source (ask Mark Halpin or Bryn Sage for access to the Repl or an
   export). Read `replit.md`, the database schema (`lib/db/src/schema/*` if
   it follows the AIGoGo Replit template), the API contract
   (`lib/api-spec/openapi.yaml`), the web routes, and any AI or agent code.
3. Write `docs/sixonic/INVENTORY.md`:
   - what Sixonic does and for whom, and its current copy (verbatim)
   - every feature, screen, API route, background job and data entity
   - where people and where AI agents take part in each feature
   - integrations, the secrets it expects, its auth model and roles
   - whether it holds real customer data (do NOT copy any; record only
     counts and categories), its domains and legal entity
   - every place the Sixonic brand appears (name, logo, colours, fonts,
     copy, emails, metadata, favicon, domains)
4. Write `docs/sixonic/MAPPING.md`, one row per feature:

   | Sixonic feature | Sage Halpin name and label | Carry across (default: yes) | Parity test | Notes |

   Rename labels into Sage Halpin language (section 1) without changing
   behaviour. A feature is only dropped when Mark says so; record who and
   when in Notes.
5. Stop only if the source or a working login cannot be obtained, and record
   that in `BLOCKERS.md`. The live-site inventory alone is enough to start
   the brand work, but not to claim parity.

---

3. ARCHITECTURE AND STACK

Port Sixonic onto the conventions the other AIGoGo platforms already use (HI
Secure, Guardian, GrowthOS, ListeningPost UK, WISE Hub, AIGoGo Platforms). If
Sixonic already uses the AIGoGo Replit template, keep its structure and swap
the Replit-specific pieces for Azure ones. If it uses something else, keep
its behaviour and move it onto this stack.

| Concern | Choice |
|---|---|
| Monorepo | pnpm workspaces, Node.js 24, TypeScript 5.9 strict |
| API | Express 5, `/api` prefix |
| Contract | `lib/api-spec/openapi.yaml` is the source of truth; Orval generates React Query hooks and Zod schemas (`zod/v4`). Re-run codegen after any spec change |
| Database | PostgreSQL 16 + Drizzle ORM; `drizzle-kit` migrations committed and applied by CI (no `push` in production) |
| Web | React + Vite, wouter, TanStack Query, Tailwind + shadcn/ui, restyled to the Sage Halpin identity (section 6) |
| Public site | Port the landing page from `mflinn99/aijoes.app` `sage-halpin/site/`: copy, the `Constellation` hero animation, the `Mark` symbol and the CSS tokens. Keep its reduced-motion behaviour and phone-width layout. Adjust copy only where Sixonic's real functionality needs describing |
| AI | Whatever Sixonic's AI features do, now via Claude on Microsoft Foundry (section 5) |
| Build | esbuild CJS bundle for the API; Vite static build for the web |

Replit-to-Azure replacements:

| Replit | Azure |
|---|---|
| Replit deployment | Azure Container Apps |
| Replit Postgres | Azure Database for PostgreSQL – Flexible Server |
| Replit Secrets | Azure Key Vault, read via managed identity |
| Replit Object Storage | Azure Blob Storage |
| Replit AI integrations (OpenAI or other) | Claude via Microsoft Foundry, same behaviour |
| `*.replit.app` domain | Azure Front Door default host, then the Sage Halpin domain |
| Replit Auth, if used | Microsoft Entra ID / Entra External ID |

---

4. SECURITY, IDENTITY AND DATA (baseline, whatever Sixonic did before)

Carry Sixonic's roles and permissions across unchanged. On top of them:

- **Identity**: Microsoft Entra ID (OIDC with PKCE) for organisations on
  Microsoft 365; Entra External ID for everyone else. HTTP-only, SameSite
  session cookies; server-side sessions in PostgreSQL.
- **Tenant isolation**: if Sixonic is multi-tenant, add PostgreSQL row-level
  security keyed on a per-request `app.organisation_id`, plus an API guard.
  Tests must prove one tenant cannot read another's data, including through
  search and any AI retrieval.
- **People and agents**: agents run under a service identity with a declared
  scope, never as a user. An agent cannot take an action Sixonic reserves
  for a person; test each such action.
- **Secrets**: Key Vault only. No secret in a file, image, committed env
  file or log. No default or known passwords; the first admin is
  bootstrapped once from a Key Vault secret.
- **Audit**: an append-only audit log of writes and agent runs,
  hash-chained per organisation (reuse Guardian's pattern: advisory lock on
  append, database mutation guard, re-verification endpoint).
- **Data protection**: UK GDPR. Data resident in UK South, backups in UK
  West. Draft `docs/DPIA.md` for review; do not present it as approved.

---

5. AI ON AZURE: CLAUDE VIA MICROSOFT FOUNDRY

Keep whatever Sixonic's AI features do and move them to Claude on Microsoft
Foundry (billed through the Microsoft Marketplace at Anthropic's standard API
rates).

- TypeScript client: `import AnthropicFoundry from "@anthropic-ai/foundry-sdk"`.
  It exposes the same `messages.create` / `messages.stream` surface as the
  first-party SDK. Do not point the first-party client at a Foundry URL.
- Default model `claude-opus-5-5`, set by configuration (`AI_MODEL`), with
  adaptive thinking and an explicit `output_config.effort` per feature (the
  Opus 5.5 default is `medium`; set it deliberately). Stream long requests.
- Check `stop_reason` before reading content, and handle `refusal`.
  Server-side fallbacks are not available on Foundry; use the SDK's
  client-side refusal-fallback middleware.
- Foundry has two deployment types. **Hosted on Azure** keeps inference in
  Azure but does not support code execution, the Files API, Agent Skills or
  programmatic tool calling, and has only the basic web search and fetch
  tools. **Hosted on Anthropic** supports them. Build on plain Messages API
  tool use (your own tools, run in the API) so either works. Confirm the
  deployment type and region for UK data residency before go-live; record it
  in BLOCKERS if unresolved.
- Auth: Entra ID with the app's managed identity where the SDK supports it;
  otherwise a Foundry key in Key Vault.
- Managed Agents is not available on Foundry. Run any agent loop in the API
  (the SDK tool runner or a manual loop) with per-turn hooks for approval
  gates and audit.
- If a Sixonic feature depends on another AI provider's behaviour, write a
  parity test from its current outputs before switching, then compare.
- Prompts live in versioned files, not inline strings.

---

6. IDENTITY SYSTEM (replaces Sixonic's branding everywhere)

- Palette: midnight ink `#13232B`, warm ivory `#F5F1E9`, muted brass
  `#B28A56`, slate `#65737A`, white `#FFFFFF`. Map every Sixonic colour
  token to one of these; delete the old tokens.
- Type: Unbounded (wide, rounded) for headlines, Figtree (rounded sans) for
  interface and text; both SIL OFL.
- Symbol and favicon: six dots, each a different colour, seated around one
  oval table. People are green and AI agents white wherever the two are
  distinguished. No robots, brains or circuit boards.
- Motion: the mark itself becomes the hero. Its six seats slowly change
  between people (always green) and AI agents (the mark's other colours), one
  seat at a time at a steady rhythm, while faded years roll forward from 2020
  to 2030 and round again at a constant speed; respect `prefers-reduced-motion`.
- Character: intelligent, assured, adaptable, quietly ambitious; more
  contemporary institution than software startup. Generous space, fine
  rules, structured timelines.
- Imagery: real photographs of people working together only when real
  photographs exist; never generated portraits.
- Replace Sixonic branding in: page titles and metadata, favicon and app
  icons, emails and templates, PDFs and exports, error pages, the demo, API
  docs, and OpenGraph images.

---

7. AZURE HOSTING

Infrastructure as code in `infra/` (Bicep, Azure Developer CLI `azd`
compatible). Three environments, `dev`, `staging`, `prod`, each its own
resource group in UK South.

| Resource | Purpose |
|---|---|
| Azure Container Apps (environment, `api` app, `jobs` for scheduled work) | API, agent runs, scheduled jobs, demo reset |
| Azure Static Web Apps (or the API container serving the Vite build) | Web app and public site |
| Azure Database for PostgreSQL – Flexible Server 16, private access, zone-redundant in prod | Primary store |
| Azure Blob Storage (private, soft delete, versioning) | Files and exports |
| Azure Key Vault | All secrets |
| User-assigned managed identity | API → Key Vault, Storage, PostgreSQL (Entra auth), Foundry |
| Azure Container Registry | Images |
| Microsoft Foundry resource + Claude deployment | Models |
| Azure Front Door (Standard/Premium) with WAF | Custom domain, TLS, edge rate limiting |
| Application Insights + Log Analytics | Traces, logs, alerts (no prompt or document content in logs) |
| Azure Communication Services Email (when a verified domain exists) | Outbound email, if Sixonic sends any |

CI/CD with GitHub Actions and OIDC federated credentials (no stored Azure
secrets):
1. On pull request: install, typecheck, lint, unit tests, API integration
   tests against a PostgreSQL service container, Bicep `what-if`.
2. On merge to `main`: build and push images, apply migrations to staging,
   deploy, run the parity and brand suites against staging.
3. Production deploys through a manual approval on a GitHub environment.

Health endpoints: `/api/healthz` (liveness) and `/api/readyz` (database, Key
Vault and Foundry reachable). The custom domain waits on the trade mark and
domain checks; until then use the Front Door default host.

---

8. MIGRATION FROM SIXONIC

1. Phase 0 inventory and mapping (section 2).
2. Bryn Sage's and Mark Halpin's written consent to the name and its public
   association. Trade mark and domain checks in the relevant markets.
3. Carry every mapped feature across with its parity test green.
4. Use "Sage Halpin, formerly Sixonic" during the transition where
   appropriate. Update contracts, privacy notices and client communications
   to match the actual legal entity and data arrangements.
5. Migrate real Sixonic customer data only under a written plan the data
   owner approves, with record counts reconciled before and after, and
   rehearsed on staging first.
6. Once production is live on Azure, put a transition notice (then a
   redirect) on sixonic.replit.app, and keep the Repl read-only until the
   migration is signed off.

---

9. LATER, NOT IN THIS BUILD

The proposal describes capabilities Sixonic may not have today. Where Phase 0
shows Sixonic lacks one, record it in `docs/BACKLOG.md` instead of building
it now, so the rebrand does not become a rewrite:

- team timeline showing how the team scaled and flexed, and why
- decision room: evidence map (fact / interpretation / recommendation),
  options, dissent, a decision recorded only by an authorised person
- client-owned institutional memory with provenance, versioning,
  contradiction and stale-knowledge review
- human-readable handover when an adviser leaves, traceable to sources
- engagements: First Decision, Living Board, Group Intelligence
- actions and outcomes, forecast versus reality

---

10. TESTS AND ACCEPTANCE

- **Parity**: one automated test per row of `docs/sixonic/MAPPING.md`,
  written against current Sixonic behaviour and passing on Azure staging.
  End-to-end journeys in Playwright.
- **Brand**: a test that fails if "Sixonic" (case-insensitive) appears in
  shipped UI, metadata, emails or API docs, except the allow-listed
  transition notice; a visual check that the palette, type and symbol are
  applied; the disclosure is present on every public page; no "roster" in
  shipped copy.
- **People and AI**: every contributor shows a human/AI identity; each
  action reserved for a person is refused for an agent, with an audit
  event.
- **Security**: tenant isolation (if multi-tenant), no default passwords,
  secrets only from Key Vault, audit chain verifies and detects tampering.
- **Quality**: typecheck clean, no skipped tests, axe accessibility check
  with no serious violations on the public site and key screens.

---

11. BLOCKERS TO RECORD HONESTLY (in `BLOCKERS.md`, with who can unblock)

- Sixonic source and a working login (Mark Halpin, Bryn Sage).
- Name consent (Bryn Sage, Mark Halpin); trade mark; domain.
- Enquiry route for Talk to Us (an address or booking link).
- Email sending: verified domain with SPF, DKIM and DMARC.
- Claude on Foundry: deployment type and UK region confirmed.
- Pricing: cost human participation, agent activity, integrations,
  retention and service levels before publishing any price.
- Photography.

Do not work around any of these by inventing content.

---

12. DEFINITION OF DONE

- Every feature in the Sixonic inventory is carried across (or dropped with
  Mark's recorded approval) and its parity test is green on Azure staging.
- The brand suite is green: Sage Halpin everywhere, Sixonic nowhere outside
  the transition notice.
- Production infrastructure is deployed from `infra/` by the pipeline, with
  no manual portal changes.
- `docs/BUILD-STATUS.md`, `BLOCKERS.md`, `docs/sixonic/INVENTORY.md`,
  `docs/sixonic/MAPPING.md`, `docs/BACKLOG.md` and `docs/RUNBOOK.md` (deploy,
  roll back, restore the database, rotate secrets, reset the demo) are
  current and truthful.
