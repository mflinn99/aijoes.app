# BUILD REPORT — AIGoGo MetaMSP

> **This report records iteration 1.** Iterations 2 and 3 followed: authentication and
> RBAC, a credential vault, Microsoft 365 / Xero / HubSpot connectors, a durable job
> queue, the verification loop, estate import, refresh scheduling and SSO. See
> `docs/build-status.md` for the current position and `docs/security-model.md` for the
> current security posture. Section 10's "no authentication" and section 13's "0%
> reusable" were true when written; the first is closed, the second still holds.

**Directive:** `docs/BUILD-DIRECTIVE.md` · **Branch:** `claude/aiogo-metamsp-build-directive-2lsui2`
**Date:** 2026-09-16 · **Repository:** `mflinn99/aijoes.app` (was empty at build start)

---

## 1. Headline

A working MetaMSP MVP. You can enter a company name or URL, watch eleven analysis
stages complete, see MAKE MORE / SPEND LESS / MSP EXPAND opportunities with defensible
financial models, open any one and read exactly why it was recommended, press START,
review a real execution plan with routed capabilities and approval gates, authorise
it, watch tasks execute and stop at each gate, approve, and see realised value land in
the Benefits Ledger and change the estate's next best action.

The complete loop — **UNDERSTAND → FIND VALUE → START → EXECUTE → MEASURE → EXPAND** —
is proven by an automated test against all three synthetic companies, and was driven
end to end against the running server during this build.

**What is real:** the analysis, the financial models, the evidence and provenance
chain, the scoring, the routing, the execution contract, the approval gates, the
autonomy policy, the ledger, the audit trail and the cost accounting.

**What is simulated:** the AIGoGo opco services themselves. No group service is
reachable from this environment. Each is registered with its real interface and a
deterministic mock, and every simulated result is labelled as such everywhere it
appears — including in the ledger, where simulated value can reach `REALISED` but
never `VERIFIED`.

---

## 2. Architecture implemented

Six documents under `docs/`: `metamsp-architecture.md`, `company-twin.md`,
`opportunity-graph.md`, `execution-engine.md`, `capability-registry.md`,
`security-model.md`.

```
SURFACES        17 screens · JoJo objective bar · 5 route handlers
ORCHESTRATION   JoJo (objective → outcome → selection) · Capability Router
ANALYSIS        11-stage pipeline · 3 engines · supply chain graph
EXECUTION       15 playbooks · plan/authorise/run · approval gates · autonomy
MEASUREMENT     Benefits Ledger · cost accounting · append-only audit
KNOWLEDGE       Company Digital Twin with provenance on every field
INGESTION       17 connectors declared · 2 implemented
DATA            SQLite · tenant_id everywhere · guarded query layer
```

`src/lib/core/` performs no I/O and imports nothing above it — policy, scoring and
provenance are testable without a database.

## 3. Functionality completed

| Directive section | Delivered |
| --- | --- |
| §1 Primary outcome | Name or URL in; three opportunity classes out, each with the 18 required attributes |
| §2 User experience | Landing input, ANALYSE COMPANY, 11 progressive stages, three money cards, ranked cards with START |
| §3 Company Digital Twin | 43 provenanced fields, conflicting claims retained, weighted understanding |
| §4 Learning engine | Connector interface, live website crawl, Companies House, 17-connector catalogue |
| §5 Toleron-style analysis | Capability registry for all 10 AIGoGo capabilities |
| §6 Opportunity graph | Canonical entity, configurable weights, exposed calculation |
| §7 MAKE MORE | 6 rules across expansion, new business, sales execution, marketing, product |
| §8 SPEND LESS | 6 rules; benchmark hypotheses promote to quantified on connection |
| §9 Supply chain | Persistent graph, renewal calendar, criticality, alternatives, switching cost |
| §10 MSP expansion | 11 services with charge, delivery cost, gross margin, sensitivity, next conversation |
| §11 Execution engine | 15-step START workflow; not a status change |
| §12 Autonomy | 5 levels, deny by default, scoped grants, one-step halt |
| §13 JoJo | All five directive example objectives parse and execute |
| §14 Capability router | Scored, explainable, extensible without touching orchestration |
| §15 Playbooks | All 15 named playbooks, versioned |
| §16 Benefits Ledger | Six stages, forward-only, answers all six ledger questions |
| §17 MSP portfolio | Estate table, sortable columns, next best action across estate |
| §18 Onward reference | MSP tenant model; no Onward-specific assumptions in the schema |
| §19 UI | 17 screens |
| §20 Company overview | Snapshot, business model, signals, top next action, opportunities, connections |
| §21 Evidence | Facts, sources, assumptions, calculations, uncertainty, missing data — no chain-of-thought |
| §22 Data quality | Field- and opportunity-level confidence, conflict and staleness flags, refresh |
| §23 Fail gracefully | Low understanding stated plainly; ranked connector uplift |
| §24 Security and tenancy | Structural isolation, append-only audit, secret refs only |
| §25 Observability | Every agent action emits the full required event |
| §26 Cost control | Per-capability cost, benefit, return on execution, proportionality gate |
| §27 Testing | 115 tests including all twelve required categories |
| §30 Definition of done | All 19 steps proven by test |

## 4. Screens and routes

Screenshots of all 15 rendered pages: `docs/screens/`.

| Route | Screen | Directive §19 |
| --- | --- | --- |
| `/` | MSP Portfolio | 2 |
| `/analyse` | Add / Analyse Company | 3 |
| `/company/[id]` | Company Overview | 4 |
| `/company/[id]/twin` | Company Twin | 5 |
| `/company/[id]/make-more` | Make More | 6 |
| `/company/[id]/spend-less` | Spend Less | 7 |
| `/company/[id]/msp-expand` | MSP Expand | 8 |
| `/company/[id]/supply-chain` | Supply Chain | 9 |
| `/opportunity/[id]` | Opportunity Detail + Execution Preview | 10, 11 |
| `/execution/[id]` | Execution Monitoring | 12 |
| `/benefits` | Benefits Ledger | 13 |
| `/activity` | Activity / Audit | 14 |
| `/integrations` | Integrations | 15 |
| `/autonomy` | Autonomy / Permissions | 16 |
| `/capabilities` | Capability Health | 17 |

Login (screen 1) is **not built** — no IdP is available in this environment. Session
resolves to a fixed demo MSP tenant. Everything downstream already takes a
`TenantContext`, so adding an IdP changes `src/lib/session.ts` only.

## 5. APIs

| Endpoint | Method | Contract |
| --- | --- | --- |
| `/api/analyse` | POST | `{input}` → `{runId}`; starts the pipeline without blocking |
| `/api/analyse/[runId]` | GET | Run with 11 stage states; 404 unknown |
| `/api/execution` | POST | `plan` \| `authorise` \| `run` \| `approve` \| `stop` |
| `/api/jojo` | POST | `{objective, companyId?}` → objective, steps, selection, answer |
| `/api/autonomy` | POST | `{action:'halt'}` → drops every grant to Observe |

All five have contract tests including their failure modes.

## 6. Schemas

15 tables. Tenant-scoped: `users`, `customers`, `company_twins`, `source_records`,
`opportunities`, `supplier_relationships`, `execution_plans`, `execution_tasks`,
`benefits`, `autonomy_grants`, `approvals`, `audit_log`, `agent_events`,
`analysis_runs`, `connector_configs`.

Core types: `CompanyTwin` (43 provenanced fields), `Opportunity`, `FinancialModel`,
`Playbook`, `ExecutionPlan`, `ExecutionTask`, `Benefit`, `AutonomyGrant`,
`Capability`, `SupplierRelationship`.

## 7. Agents and capabilities

Ten capabilities registered, 34 actions total. JoJo is implemented in this repository;
the other nine are deterministic mocks. See `docs/capability-registry.md`.

## 8. Tests

```
Test Files  11 passed (11)
Tests      115 passed (115)
```

Every category the directive names is covered: unit, integration, API contract,
tenant isolation, permission, START workflow, financial calculation,
hallucination/evidence, scraper failure, agent failure/retry, capability router,
benefit ledger. Breakdown in `docs/build-status.md`.

Three synthetic companies (§27) — a small professional services firm, a manufacturer,
and a 100-user Microsoft-heavy SME — each run the full pipeline and the full loop.

## 9. Defects found and fixed during the build

Four real defects, found by the tests and by reading the rendered output:

1. **Every execution task was gated**, including internal preparation, because plan
   autonomy was OR'd into each task's approval requirement. This made the product
   unusable and misread §12 — `PREPARE` exists so work gets done and the human
   approves the step that leaves the building.
2. **External capability actions did not require an `approvalId`.** Now forced into
   `requiredInputs` by the registry, so a new external action cannot be added without
   inheriting the gate.
3. **"Cut cost" shadowed the analyse instruction** in JoJo's objective parser, so the
   directive's own example — "analyse Claritas Solutions and tell me the best ways to
   increase turnover and cut cost" — returned only savings.
4. **A host containing "services"** (e.g. `crosbygroupservices.co.uk`) made the
   homepage match as the services page, so navigation headings were reported as
   service lines.

Two modelling corrections:

5. **Pipeline generation applied a flat 20% win rate** regardless of deal size,
   producing £5.5m of "new revenue" for an £11.5m business. Win rate now scales down
   with average contract value and a first-year ramp applies.
6. **Task financial targets were divided by task count** while the task's own evidence
   claimed a percentage "of the financial target" — an internal contradiction, since
   only terminal tasks carry a value fraction.

## 10. Outstanding defects

| Defect | Severity | Note |
| --- | --- | --- |
| No authentication | **High** | Not safe for real customer data |
| RBAC roles defined but unenforced at routes | **High** | `READ_ONLY` can reach mutating routes |
| Analysis is fire-and-forget | Medium | A container restart mid-analysis leaves a run stuck `running` |
| Service extraction is heuristic | Medium | Headings are a proxy for services; wrong on sites that use headings decoratively |
| Competitor analysis skipped | Medium | Declared and stated rather than faked |
| `averageCustomerValueRatio` is one benchmark | Medium | Poor fit for very high- or low-ticket businesses |
| No pagination anywhere | Low | Fine at three customers, not at three hundred |

## 11. Security observations

Detail in `docs/security-model.md`. In short:

**Holds:** tenant isolation is structural and rejects a missing predicate before the
database sees it; the audit log rejects updates and deletes at the database; autonomy
denies by default and never inherits to a new action type; no credential is stored in
the database; no LLM sits in any effectful path.

**Open:** no authentication, no route-level RBAC, no encryption at rest, no rate
limiting, no CSRF protection. **The platform must not hold real customer data until
the first two are closed.**

## 12. Deployment status

**Not deployed.** Runs locally. It has no external dependencies beyond an optional
Companies House key, so a container deployment is straightforward — but the
authentication gap above should close first.

### Run locally

```bash
npm install
npm run seed     # MSP tenant + 3 synthetic companies, fully analysed
npm run dev      # http://localhost:3000
```

Optional `.env` (see `.env.example`): `ANTHROPIC_API_KEY`, `COMPANIES_HOUSE_API_KEY`,
`METAMSP_DB_PATH`. Analysis is fully deterministic without either key.

```bash
npm test         # 115 tests
npm run typecheck
npm run build && npm start
npm run db:reset # wipe and reseed
```

### Deploy

```bash
npm run build && npm start   # any Node 20+ container
```

Requires a writable volume for `.data/`. Before production: add an IdP, enforce RBAC
at the route layer, move to Postgres with row-level security, add a durable job
runner, and put credentials in a vault.

---

## 13. AIGoGo Capability Gap Analysis

For each opportunity type the platform identifies:

| Opportunity type | Existing AIGoGo capability | Reusable | Integration required | Missing capability | Recommended new service |
| --- | --- | --- | --- | --- | --- |
| Dormant reactivation | SaleSonic | **0%** (no reachable service) | CRM | Everything | Live SaleSonic API with campaign execution + reply handling |
| Pipeline generation | SaleSonic + ListeningPost | **0%** | CRM, email | Everything | SaleSonic pipeline API; ListeningPost has no code at all |
| Cross-sell | SaleSonic + GrothOS | **0%** | CRM, PSA | Everything | Service-holding matrix — no capability owns this today |
| Pricing review | GrothOS | **0%** | Accounting | Everything | Pricing model service with churn sensitivity |
| Proposition review | GrothOS | **0%** | — | Everything | Content generation service |
| Market entry | GrothOS + Toleron | **0%** | — | Market sizing data | Market intelligence connector (none exists) |
| M365 licence optimisation | Buyonic | **0%** | Microsoft 365 | Everything | **Highest-value build: self-funding and provable in 30 days** |
| SaaS rationalisation | Buyonic + SourcingAI | **0%** | Accounting, banking | Everything | Spend-analysis service over transaction data |
| Cloud optimisation | Buyonic + Sixonic | **0%** | Azure, AWS | Everything | Cloud billing analysis |
| Supplier consolidation | SourcingAI + Buyonic | **0%** | Accounting, procurement | Everything | Sourcing event execution |
| Contract renewal | Buyonic | **0%** | Procurement | Contract parsing | Contract intelligence service |
| Process automation | Sixonic | **0%** | — | Everything | Process mapping and automation delivery |
| MSP expansion | Strata / MetaMSP | **0%** | PSA | Everything | Service design + proposal generation |
| Customer business review | Strata / MetaMSP | **0%** | PSA | Everything | QBR pack assembly from ledger data |
| Company analysis | Toleron | **0%** | — | **Implemented here instead** | Promote MetaMSP's own analysis engine to the group Toleron service |

**The honest summary: reusable percentage is zero across the board.** Not because the
capabilities are unsuitable, but because none is reachable as code or as a service
from this environment. Every one is registered with its real interface and a working
mock, so each becomes real by writing one adapter.

Two observations worth acting on:

- **MetaMSP has, in building this, implemented the analysis capability Toleron is
  supposed to provide.** The three engines, the twin, the provenance model and the
  scoring are a working company-analysis service. The group decision is whether
  Toleron consumes this or duplicates it — duplicating it would be the expensive
  mistake.
- **Microsoft 365 licence optimisation is the highest-leverage first live
  integration.** It is self-funding, provable within 30 days, needs one OAuth
  connector, and converts the largest number of hypotheses into counted facts per
  unit of work.

---

## 14. NEXT AUTONOMOUS BUILD DIRECTIVE

> Paste the following as the next Claude Code instruction. It assumes no memory of
> this session.

---

**CLAUDE CODE BUILD DIRECTIVE — AIGoGo MetaMSP, Iteration 2: From Hypothesis to
Counted Fact**

You are continuing the AIGoGo MetaMSP Land & Expand engine in `mflinn99/aijoes.app`.
Iteration 1 is on `claude/aiogo-metamsp-build-directive-2lsui2`. Read
`docs/BUILD-DIRECTIVE.md` (the original directive), `docs/BUILD-REPORT.md`,
`docs/build-status.md` and the six architecture documents before writing code. Do not
rewrite working infrastructure. Maintain `docs/build-status.md` as you go.

The platform currently produces defensible *hypotheses*. Almost nothing is a counted
fact, because no financial or operational system is connected. This iteration closes
that gap and makes the platform safe to put in front of a real MSP.

**Priority 1 — Make it safe (blocking; nothing else ships without it).**
Add authentication with a real IdP supporting SSO. Enforce the existing four roles
(`PLATFORM_ADMIN`, `MSP_ADMIN`, `MSP_USER`, `READ_ONLY`) at every route handler —
`READ_ONLY` must not reach any mutating route, and there must be a test proving it.
Replace the fixed demo session in `src/lib/session.ts`; everything downstream already
takes a `TenantContext`, so this should be a narrow change. Add CSRF protection to
route handlers and rate limiting to `/api/analyse`.

**Priority 2 — Microsoft 365 connector.** The highest-leverage integration: it is
self-funding, provable in 30 days, and converts the most hypotheses per unit of work.
Implement `CompanyDataConnector` for M365 with OAuth2. Populate real user counts,
assigned versus consumed licences, SKU mix and leaver accounts still licensed. The
`microsoft-licence-optimisation` opportunity must move from `hypothesis` to
`inferred-fact` automatically — the promotion logic already exists via
`ctx.hasLicenceData`; do not special-case it.

**Priority 3 — Accounting connector.** Xero first. Populate real turnover, margin and
supplier spend. This promotes the entire SPEND LESS engine and replaces the
`averageCustomerValueRatio` benchmark with counted customer values. Store credentials
in a real vault, not environment variables.

**Priority 4 — Durable execution.** Analysis and execution are currently
fire-and-forget promises; a container restart leaves a run stuck in `running`. Add a
job runner that picks up `analysis_runs` and `execution_plans` from their persisted
state. Migrate SQLite to Postgres and replace the `TenantDb` guard with real
row-level security — `TenantDb` is the only path to tenant data, so this is a swap
behind one class, and the existing isolation tests must still pass unchanged.

**Priority 5 — Close the verification loop.** No benefit has ever reached `VERIFIED`,
because verification requires a connected system of record. With M365 and accounting
connected, implement verification: compare the post-execution invoice or licence count
against the pre-execution baseline and advance the benefit to `VERIFIED` with the
evidence. This is what makes the automation-rate number defensible in a QBR.

**Constraints that still hold.** Never fabricate certainty — epistemics are derived
from the weakest financial line, never asserted. Deny autonomy by default; a new
action type is `OBSERVE` for every tenant. Nothing reaches an external system without
a named human approving it. Every capability outcome states whether it is simulated.
The Benefits Ledger ratchets forward only. Model output, if you add any, is parsed
into a typed structure and validated against policy before touching an effectful path.

**Definition of done.** A real MSP can log in with SSO, connect a real customer's M365
and accounting, see the SPEND LESS opportunities re-rate from hypothesis to counted
fact with confidence rising accordingly, execute a licence optimisation, and see the
saving verified against the following month's invoice — with every step in the audit
log and the realised value traceable to the specific licences reclaimed.

Proceed autonomously. Use sensible defaults. Where a dependency is unavailable, define
the interface, mock it, record it, and continue. Do not stop the build because one
external system is unavailable, and do not silently skip requirements.

---

## 15. Next ten highest-value build actions

1. Authentication with SSO — **blocking for any real data**
2. Route-level RBAC enforcement, with a test that `READ_ONLY` cannot mutate
3. Microsoft 365 connector — highest hypothesis-to-fact conversion per unit of work
4. Accounting connector (Xero) — promotes the entire SPEND LESS engine
5. Durable job runner — analysis and execution survive a restart
6. Postgres with row-level security, replacing the guarded query layer
7. Verified benefit: measure against a connected system of record
8. CRM connector — real dormant counts, real pipeline measurement
9. Per-tenant credential vault, replacing environment variables
10. First live opco adapter — Buyonic, paired with the M365 connector so the licence
    opportunity is real end to end
