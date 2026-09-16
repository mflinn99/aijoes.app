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

1. Authentication and RBAC enforcement at route level
2. Microsoft 365 connector (highest understanding uplift among unimplemented)
3. Accounting connector (largest promotion effect: turns spend hypotheses into counted facts)
4. CRM connector (unlocks real dormant-account counts and pipeline measurement)
5. Postgres migration with row-level security
6. Durable job runner for analysis and execution
7. Per-tenant credential vault
8. Competitor analysis (currently skipped with a stated reason)
9. LLM enrichment for proposition and evidence summarisation, behind the typed-output rule
10. Real Onward estate sync

## Test status

```
Test Files  11 passed (11)
Tests      115 passed (115)
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
