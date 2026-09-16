# MetaMSP Architecture

**Phase B deliverable.** Companion documents: `company-twin.md`, `opportunity-graph.md`,
`execution-engine.md`, `capability-registry.md`, `security-model.md`.

## The loop this architecture serves

```
LAND → LEARN → IDENTIFY → QUANTIFY → START → EXECUTE → MEASURE → EXPAND → REPEAT
```

Every module below exists to move a company one step further round that loop, and
nothing exists that does not.

## Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  SURFACES          Next.js App Router · 17 screens · JoJo objective  │
│                    bar · REST route handlers                          │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  ORCHESTRATION     JoJo: objective → measurable outcome → selection   │
│                    Capability Router: action → capability, scored     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌──────────────┬────────────────┴─────────────┬───────────────────────┐
│  ANALYSIS    │  EXECUTION                   │  MEASUREMENT          │
│              │                              │                       │
│  11-stage    │  Playbooks (15, versioned)   │  Benefits Ledger      │
│  pipeline    │  Plan → Authorise → Run      │  Cost accounting      │
│  3 engines   │  Approval gates              │  Audit log            │
│  Supply      │  Autonomy policy             │  Agent events         │
│  chain graph │  Rollback + stop conditions  │                       │
└──────────────┴──────────────┬───────────────┴───────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────────┐
│  KNOWLEDGE        Company Digital Twin · provenance on every field    │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────────┐
│  INGESTION        CompanyDataConnector × 17 declared, 2 implemented   │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────────┐
│  DATA             SQLite · tenant_id on every scoped table ·          │
│                   guarded query layer · append-only audit             │
└──────────────────────────────────────────────────────────────────────┘
```

## Module map

| Path | Responsibility | I/O? |
| --- | --- | --- |
| `src/lib/core/` | Pure domain: provenance, twin, opportunity, autonomy | No |
| `src/lib/db/` | Schema, guarded tenant access, repositories | Yes |
| `src/lib/discovery/` | Connector interface, website + Companies House, catalogue | Yes |
| `src/lib/analysis/` | Benchmarks, context, three engines, supply chain, pipeline | Via repos |
| `src/lib/capabilities/` | Capability registry, router, mock adapters | Via adapters |
| `src/lib/playbooks/` | 15 versioned playbooks | No |
| `src/lib/execution/` | START contract: plan, authorise, run, approve, stop | Yes |
| `src/lib/benefits/` | Benefits Ledger with a forward-only stage ratchet | Yes |
| `src/lib/jojo/` | Objective parsing, selection, next best action | Via repos |
| `src/lib/observability/` | Agent events, audit, cost accounting, proportionality | Yes |
| `src/app/` | Screens and route handlers | Via lib |

`src/lib/core/` performs no I/O and imports nothing above it. That is what lets the
policy engine, the scoring model and the provenance rules be tested exhaustively
without a database, and it is the boundary most worth defending as the codebase grows.

## Request paths

**Analysis.** `POST /api/analyse` creates a run row and starts the pipeline without
awaiting it, returning a run id. The client polls `GET /api/analyse/[runId]`, which
returns the eleven stage states. Progress is therefore real work reported as it
completes, not an animation over a single blocking call.

**Execution.** `POST /api/execution` carries the four verbs of the START contract —
`plan`, `authorise`, `run`, `approve`, plus `stop`. Planning and running are separated
by a human decision by design; there is no code path that plans and executes in one
call.

## Where the boundaries are, and why

- **Analysis never executes.** An engine produces opportunities. It cannot invoke a
  capability. This keeps "what could be done" separable from "what we are permitted
  to do".
- **Execution never decides policy.** The engine asks `resolveAutonomy` and obeys it.
  Autonomy lives in `core/` where it can be reasoned about in isolation.
- **Capabilities never see the twin.** They receive typed inputs. A capability cannot
  widen its own scope by reading the company record.
- **The ledger never accepts a backwards move.** Stage transitions are a ratchet, so
  the value an MSP reports in a QBR cannot silently regress.

## Scaling notes

SQLite and a Postgres-backed queue were chosen to keep the number of running systems
at one. The seams that would need to move first, in order:

1. **Postgres with row-level security**, replacing the guarded query layer. The
   `TenantDb` interface is already the only way tenant data is read, so this is a
   swap behind one class.
2. **A real job runner** for analysis and execution, replacing fire-and-forget. The
   run and plan records already hold all state, so a worker can pick them up.
3. **Per-tenant credential vault**, replacing environment variables, once a connector
   needs OAuth.

None of these are needed before a design partner is running against real data.
