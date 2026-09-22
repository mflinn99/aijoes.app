# Build Status

**Updated:** 2026-09-16 · Directive §29.

## Phases

| Phase | Status | Output |
| --- | --- | --- |
| A — Discovery | **Complete** | `docs/current-state.md` |
| B — Architecture | **Complete** | 6 architecture documents |
| C — Foundation | **Complete** | Twin, Opportunity, Benefit Ledger, Capability Registry, Playbook Registry, execution contracts |
| D — Analysis MVP | **Complete** | Input, discovery, 3 engines, confidence/evidence |
| E — Execution MVP | **Complete** | START, preview, approval, routing, invocation, monitoring, write-back |
| F — Portfolio | **Complete** | Estate view, prioritisation, next best action, benefit totals |
| G — QA | **Complete** | 115 tests, all passing |

## Iteration 2 — from hypothesis to counted fact

| Priority | Status | Output |
| --- | --- | --- |
| 1 — Make it safe | **Complete** | Authentication, session management, RBAC on every page and route, CSRF, rate limiting, user administration |
| 2 — Microsoft 365 connector | **Complete** | Graph client, counted licence facts, mechanical promotion to inferred-fact |
| 3 — Accounting connector | **Complete** | Xero client, counted turnover, supplier spend, software subscriptions and customer base |
| 4 — Durable execution | **Partly complete** | Durable job queue with claim, retry, backoff, dead-letter and stale-lock recovery. Postgres migration still open — no server available in this environment |
| 5 — Verification loop | **Complete** | Baselines captured before execution, compared against the system of record, benefits reaching VERIFIED |

## Iteration 3 — usable by a real MSP

| Item | Status | Output |
| --- | --- | --- |
| Estate import | **Complete** | CSV / paste import with per-line validation, preview, and one queued analysis per customer |
| Refresh scheduling (§22) | **Complete** | Every analysed company on an interval; the worker queues what falls due |
| Portfolio at scale | **Complete** | Search, nine sorts, pagination; unanalysed customers counted separately |
| SSO end to end | **Complete** | Discovery, single-use state with bound nonce, token exchange, JWKS signature verification, guarded JIT provisioning |
| CRM connector | **Complete** | HubSpot: counted dormant accounts, pipeline, conversion rate and average deal value |

## Completed

- Company Digital Twin: 43 provenanced fields, conflicting-claim retention, weighted understanding score
- Connector framework: interface + 17-connector catalogue; website and Companies House implemented
- 11-stage progressive analysis pipeline with per-stage detail
- MAKE MORE (6 rules), SPEND LESS (6 rules), MSP EXPAND (11 services) engines
- Supply chain graph with renewal calendar and savings potential
- Opportunity scoring with a fully exposed breakdown
- 15 versioned playbooks, every task mapped to a registered capability action
- Capability registry covering all 10 AIGoGo capabilities, with router
- Execution engine: the 15-step START workflow as plan / authorise / run
- Approval gates, autonomy policy, tenant-wide halt, stop conditions, rollback statements
- Benefits Ledger with a forward-only six-stage ratchet
- Observability: agent events, append-only audit, cost accounting, proportionality
- JoJo: objective parsing, selection, shortfall reporting, next best action
- 17 screens
- Multi-tenant data layer with structurally enforced isolation

## Mocked

| Thing | Why | Swap cost |
| --- | --- | --- |
| Toleron, SaleSonic, SourcingAI, Buyonic, GrothOS, Sixonic, Strata/MetaMSP | No group service reachable | One adapter each |
| ListeningPost | Repository is empty | One adapter |
| Onward MSP estate | No dataset or credentials | One adapter + seed swap |
| LLM enrichment | No `ANTHROPIC_API_KEY` in this environment | Provider is abstracted; analysis is deterministic without it |
| Companies House | No API key | Implemented; reports `not-configured` and contributes nothing |

## Blocked

| Item | Blocker | Owner |
| --- | --- | --- |
| Authentication | No IdP chosen or reachable | AIGoGo |
| Live opco invocation | No group service endpoints or credentials | AIGoGo |
| Onward pilot | No dataset access | AIGoGo |
| Verified benefit | Requires a connected system of record | AIGoGo |

## Remaining

1. Postgres migration with row-level security — no Postgres server is available in this environment
2. Shared-store rate limiting, for more than one instance
3. Encryption at rest for the database file itself
4. PSA connector — current MSP services and contract values, which would make MSP EXPAND counted too
5. Competitor analysis (currently skipped with a stated reason)
6. LLM enrichment for proposition and evidence summarisation, behind the typed-output rule
7. Real Onward estate sync
8. First live opco adapter, replacing a mock
9. Per-company refresh interval controls in the interface (the mechanism exists; the controls do not)
10. Sage and QuickBooks alongside Xero

## Test status

```
Test Files  21 passed (21)
Tests      271 passed (271)
```

| Suite | Tests | Covers |
| --- | --- | --- |
| `tenant-isolation` | 10 | §24 — isolation, append-only audit, platform escape hatch |
| `permissions` | 10 | §12 — deny by default, caps, halt |
| `financial` | 15 | §6 — models, scoring, MSP economics, START gate |
| `evidence` | 9 | §1, §21, §22 — provenance, never fabricate certainty, promotion |
| `router` | 16 | §14, §26 — routing, blockers, proportionality, mock honesty |
| `execution` | 14 | §11 — the full START contract |
| `benefits` | 7 | §16 — stage ratchet, ledger questions |
| `resilience` | 10 | §23, §27 — source failure, malformed HTML, agent retry |
| `playbooks` | 6 | §15 — completeness, capability mapping, external gating |
| `api-contract` | 10 | §27 — route handler contracts |
| `end-to-end` | 8 | §30 — the complete loop, all three synthetic companies |
| `auth` | 30 | Passwords, sessions, lockout, RBAC matrix, rate limiting, providers |
| `jobs` | 8 | Durable queue: claim, retry, backoff, dead-letter, stale-lock recovery |
| `vault` | 10 | Encryption at rest, tenant isolation, rotation, tampering |
| `microsoft365` | 14 | Graph client, counted licence facts, promotion to inferred-fact |
| `xero` | 13 | Xero client, counted spend and customers, promotion |
| `verification` | 10 | Baselines, comparison against the system of record, VERIFIED |
| `estate` | 20 | CSV parsing, import application, refresh scheduling |
| `oidc` | 23 | Discovery, state, signature verification, alg confusion, provisioning |
| `hubspot` | 12 | CRM client, counted dormancy and pipeline, promotion |
