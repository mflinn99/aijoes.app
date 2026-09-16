# AIGoGo MetaMSP — Claude Code Build Directive

**Status:** Draft v0.1
**Owner:** Mike Flinn (mike@aigogo.ai)
**Repository:** `mflinn99/aijoes.app`
**Last updated:** 2026-09-16

---

## 0. How to read this document

This is a **build directive**, not a design doc. It is written to be handed to Claude
Code (or any coding agent) as the authoritative statement of *what to build, in what
order, under what constraints*. Where this directive and a prompt disagree, this
directive wins unless the human explicitly overrides it in that session.

Three kinds of statements appear here, and they bind differently:

| Marker | Meaning |
| --- | --- |
| **MUST** / **MUST NOT** | Non-negotiable. A change that violates it is rejected regardless of how well it works. |
| **SHOULD** | Default. Deviating is allowed, but the deviation must be stated in the PR description. |
| **MAY** | Genuinely optional. Agent's judgment. |

Anything marked `TODO(human)` is a decision that has **not** been made. An agent
**MUST NOT** resolve a `TODO(human)` by picking an answer and proceeding — it stops
and asks.

---

## 1. What MetaMSP is

A traditional MSP (Managed Service Provider) sells human hours: a technician
watches an RMM dashboard, triages a PSA ticket queue, and remediates by hand. The
economics are linear — more clients means more technicians.

**MetaMSP is the layer above that.** It is a multi-tenant control plane where the
unit of work is an *agent-executed runbook* rather than a technician-hour. MetaMSP
connects to the tools an MSP already runs (RMM, PSA, identity, endpoint security,
backup, cloud tenants), normalizes their signals into one event stream, and dispatches
autonomous agents against that stream under explicit, auditable policy.

The product thesis in one line:

> An MSP's margin is capped by how much of its ticket queue a human has to touch.
> MetaMSP drives that fraction toward zero without ever removing the human from
> accountability.

### 1.1 What this means concretely

MetaMSP is responsible for five things and nothing else:

1. **Ingest** — pull signals (alerts, tickets, telemetry, audit logs) from third-party
   MSP tooling into a normalized event model.
2. **Correlate** — collapse redundant signals into *incidents* with a single owner,
   so forty disk-space alerts from one client are one incident, not forty tickets.
3. **Decide** — evaluate each incident against policy to choose: auto-remediate,
   propose-and-wait, or escalate to a human.
4. **Act** — execute the chosen runbook through a permissioned, fully-logged
   execution path.
5. **Account** — produce an immutable record of what was decided, by whom or what,
   on what evidence, and what changed as a result.

### 1.2 What MetaMSP is explicitly NOT

An agent **MUST NOT** build these without a new directive:

- **Not an RMM.** MetaMSP does not ship an endpoint agent, do patch distribution, or
  own device inventory as a source of truth. It reads from the RMM.
- **Not a PSA.** No time tracking, quoting, invoicing, or contract management.
- **Not a SIEM.** Events are retained for correlation and audit, not for long-horizon
  security analytics or threat hunting.
- **Not a chatbot.** Conversational surfaces are one interface to the control plane,
  never the control plane itself. Business logic **MUST NOT** live in a prompt.

---

## 2. Non-negotiables

These hold across every milestone. They are the shortest section and the one that
kills the most pull requests.

### N1 — Tenant isolation is structural, not conditional

Every row of client data **MUST** carry a tenant identifier, and isolation **MUST** be
enforced at the data layer (row-level security or equivalent), not by remembering to
add `WHERE tenant_id = ?` in application code. A query path that can return
cross-tenant rows when a developer forgets a filter is a defect even if no current
caller triggers it.

Corollary: there is **no** "admin bypass" query helper. Cross-tenant reads happen
through one explicitly named, separately audited path, and only for platform
operations (billing rollups, fleet health), never in request handlers.

### N2 — Every mutation of a client system is attributable and reversible

Before MetaMSP changes anything in a client environment it **MUST** record: the
incident that motivated it, the policy that authorized it, the identity that
executed it (human or agent, named), the exact parameters, and — where the operation
is not inherently idempotent — the inverse operation.

An action that cannot state its inverse **MUST** be classified as irreversible and
routed to human approval regardless of policy. Irreversible-by-nature operations
(data deletion, credential rotation, tenant teardown) are permanently in this class.

### N3 — Autonomy is granted per-action, per-tenant, and is revocable in one step

Autonomy levels are: `observe` (log only) → `propose` (draft the action, wait) →
`approve` (execute after explicit human OK) → `auto` (execute, notify after).

The default for any newly-introduced action type **MUST** be `observe`, for every
tenant, regardless of what that tenant's level is for other actions. Autonomy is
never inherited by a new capability.

There **MUST** be a single control — one API call, one button — that drops an entire
tenant, or the entire platform, to `observe`. It **MUST** take effect on in-flight
executions, not just new ones.

### N4 — The model is never the authority

An LLM may summarize, classify, draft, rank, and explain. It **MUST NOT** be the sole
gate on: whether an action is permitted, which tenant a request belongs to, whether a
credential may be used, or whether something is safe to delete. Those are code and
policy decisions with deterministic tests.

Practically: model output is *always* parsed into a typed structure and validated
against policy before it reaches an effectful code path. A free-text model response
**MUST NOT** be passed to a shell, a query builder, or a third-party API call.

### N5 — Credentials belong to the tenant, not to the platform

Third-party credentials are stored encrypted per-tenant, are fetched at point of use,
**MUST NOT** appear in logs, traces, error messages, prompts, model context, or
exception payloads, and **MUST** be scoped to the narrowest permission the integration
needs. If an integration only needs read access to run, it gets read access; write
scope is requested separately and recorded.

### N6 — Audit is append-only and outside the application's reach

The audit log **MUST NOT** be updatable or deletable through any application code
path. Retention is enforced by infrastructure policy, not by an application job that
could be made to delete more than it should.

---

## 3. Architecture

### 3.1 Shape

```
         ┌──────────────────────────────────────────────────────┐
         │  Surfaces: web console · API · notifications · chat  │
         └──────────────────────────┬───────────────────────────┘
                                    │
         ┌──────────────────────────▼───────────────────────────┐
         │                    CONTROL PLANE                     │
         │                                                      │
         │   Incidents  ·  Policy Engine  ·  Runbook Registry    │
         │   Autonomy   ·  Approvals      ·  Audit Ledger        │
         └───────┬──────────────────────────────────┬───────────┘
                 │                                  │
      ┌──────────▼──────────┐          ┌────────────▼───────────┐
      │   INGEST / NORMALIZE│          │    EXECUTION PLANE     │
      │                     │          │                        │
      │  connector adapters │          │  sandboxed runbook     │
      │  → canonical events │          │  workers, per-tenant   │
      │  → correlation      │          │  credential brokering  │
      └──────────┬──────────┘          └────────────┬───────────┘
                 │                                  │
         ┌───────▼──────────────────────────────────▼───────────┐
         │  Third-party MSP tooling (RMM · PSA · IdP · EDR ·    │
         │  backup · cloud tenants)                             │
         └──────────────────────────────────────────────────────┘
```

### 3.2 The four planes

**Ingest.** One adapter per third-party system. An adapter's only job is to turn that
vendor's payloads into canonical events. Adapters **MUST** be pure translation —
no policy, no side effects on client systems, no direct database writes outside the
event store. This is what makes adding a vendor cheap and makes vendor quirks
containable.

**Control.** The brain, and the only place business rules live. Owns incidents,
policy evaluation, autonomy state, approval workflow, and the audit ledger. Deterministic
and heavily tested. Control **MUST NOT** call third-party APIs directly — it emits
execution requests.

**Execution.** Runs runbooks in isolation, one tenant at a time, with credentials
brokered per-execution and never held longer than the execution. Execution **MUST NOT**
make policy decisions; it receives an authorized request and performs it, or fails.
The split between Control and Execution is what makes N2 and N3 enforceable rather
than aspirational.

**Surfaces.** Web console, API, notifications, conversational interfaces. Thin.
Surfaces **MUST NOT** contain business logic — if a rule can only be observed through
the UI, it is in the wrong place.

### 3.3 Core domain objects

| Object | Responsibility | Key invariant |
| --- | --- | --- |
| `Tenant` | A client of the MSP | Root of every authorization decision |
| `Connector` | A configured link to a third-party system | Owns credentials; scoped to one tenant |
| `Event` | A normalized signal | Immutable once written |
| `Incident` | Correlated events with one owner and lifecycle | Has exactly one open incident per correlation key |
| `Runbook` | A versioned, parameterized remediation | Declares its inverse or declares itself irreversible |
| `Policy` | Maps (incident class, tenant) → autonomy level | Deny by default |
| `Execution` | One attempt to run a runbook | Carries authorizing policy + identity; append-only status |
| `AuditRecord` | Immutable decision/action record | Append-only, infra-enforced retention |

### 3.4 Correlation

Correlation is the feature that makes the product work; it is also the easiest
thing to get subtly wrong. Rules:

- Every event **MUST** produce a deterministic correlation key from its own fields
  (tenant + affected resource + signal class). Same inputs, same key, always.
- An incoming event with an existing open incident for its key **MUST** attach to
  that incident rather than opening a new one.
- Correlation **MUST** be deterministic code, not a model call. A model **MAY**
  suggest *new correlation rules* offline for a human to adopt; it **MUST NOT** decide
  at runtime whether two events are the same incident.

---

## 4. Tech stack

Locked choices. Changing one is a directive amendment, not a PR decision.

| Layer | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript (strict) | One language across surfaces and services; strong typed-boundary story |
| Runtime | Node.js LTS | Boring, well-understood operationally |
| Web | Next.js (App Router) | Console + API in one deployable for early milestones |
| Data | PostgreSQL | Row-level security gives us N1 structurally |
| Queue | Postgres-backed job queue initially | One fewer system to run; revisit at scale, not before |
| Auth | `TODO(human)` — pick IdP (WorkOS / Auth0 / Clerk) | Blocks M1; must support SSO for MSP staff and per-tenant scoping |
| Secrets | `TODO(human)` — pick KMS/vault | Blocks M2; N5 cannot be satisfied with env vars |
| Model access | Anthropic Claude via official SDK | Latest Claude models; see §7 |
| Tests | Vitest (unit/integration) + Playwright (E2E) | |
| CI | GitHub Actions | |

Rules of thumb that override cleverness:

- Prefer a boring dependency with a maintenance history over a new one that is a
  better fit on paper.
- **MUST NOT** add a new infrastructure component (message broker, cache, search
  cluster) to solve a problem that has not yet been measured in production.

---

## 5. Repository layout

```
/
├── apps/
│   ├── console/          # Next.js web console (surface only)
│   └── worker/           # execution plane workers
├── packages/
│   ├── core/             # domain objects, policy engine, correlation — no I/O
│   ├── connectors/       # one directory per third-party adapter
│   ├── runbooks/         # versioned runbook definitions
│   ├── db/               # schema, migrations, RLS policies
│   └── agents/           # model-facing code: prompts, parsers, validators
├── docs/
│   ├── AIGOGO-METAMSP-BUILD-DIRECTIVE.md   # this file
│   ├── adr/              # architecture decision records
│   └── runbooks/         # human-readable runbook catalog
├── .claude/
│   ├── skills/           # repo-specific Claude Code skills
│   └── settings.json
└── CLAUDE.md             # agent operating instructions (see §7)
```

Dependency direction is one-way and **MUST** be enforced in CI:

```
apps/*  →  packages/{connectors,runbooks,db,agents}  →  packages/core
```

`packages/core` **MUST NOT** import from anything above it and **MUST NOT** perform
I/O. It is pure domain logic, which is what makes the policy engine testable without
a database.

---

## 6. Build order

Milestones are sequential. A milestone is not complete until it meets §9.

### M0 — Foundation
Monorepo scaffolding, TypeScript strict mode, lint/format, CI running on every PR,
`CLAUDE.md`, ADR directory. Postgres with migrations and **row-level security enabled
from the first migration** — retrofitting N1 later is the single most expensive
mistake available to this project.

**Done when:** CI is green on an empty-but-real app, and a test proves that a query
without a tenant context returns zero rows rather than all rows.

### M1 — Tenancy and identity
`Tenant` and user model, SSO, role model (platform admin / MSP staff / read-only),
per-tenant scoping end to end. Audit ledger exists and is append-only.

**Done when:** an integration test demonstrates that a user scoped to tenant A cannot
read, list, or infer the existence of tenant B's data through any API route.

### M2 — Connector framework + first connector
Adapter interface, credential storage per N5, canonical event model, event store,
and one real connector. Pick the connector with the ugliest API — the framework
should be shaped by a hard case, not an easy one. `TODO(human)`: name the first
connector.

**Done when:** live events from a real tenant flow into the event store, and
credentials are provably absent from logs, traces, and error payloads.

### M3 — Incidents and correlation
Correlation keys, incident lifecycle, deduplication, incident console view.

**Done when:** a burst of 50 related events from one tenant produces exactly one
incident, and a replay of the same events is idempotent.

### M4 — Policy and autonomy
Policy engine, the four autonomy levels, the one-step global downgrade from N3,
approval workflow, notifications.

**Done when:** every action type defaults to `observe` for a new tenant, and the
kill switch demonstrably halts an in-flight execution — tested, not asserted.

### M5 — Runbooks and execution
Runbook definition format, versioning, inverse declaration, sandboxed execution,
credential brokering, retries with idempotency, execution history.

**Done when:** a runbook executes against a real client system at `approve` level,
its inverse successfully reverts it, and the full chain is reconstructible from the
audit ledger alone.

### M6 — Agent layer
Model-assisted triage, summarization, and runbook *proposal*. Strictly bounded by N4:
the agent proposes, policy disposes.

**Done when:** a proposal that violates policy is rejected by policy, not by the
prompt — and there is a test that feeds deliberately malicious model output into the
path and shows it cannot reach an effectful call.

### M7 — Reporting
Per-tenant service reporting: incidents handled, automation rate, human-touch rate,
mean time to resolution, autonomy distribution.

**Done when:** the automation-rate number is defensible to a client during a QBR —
i.e. traceable to individual incidents and their audit records.

---

## 7. Claude Code operating rules

This section governs how an agent works in this repository. It is the source for
`CLAUDE.md`; when the two drift, this file wins and `CLAUDE.md` gets fixed.

### 7.1 Before writing code

- Read this directive. Read the ADRs in `docs/adr/` relevant to the area you're
  touching. **MUST NOT** contradict an accepted ADR — supersede it with a new ADR
  instead.
- Establish which milestone the work belongs to. Work that belongs to a later
  milestone **SHOULD NOT** be started early, even when it looks trivially easy from
  where you are standing.

### 7.2 While writing code

- Match surrounding style. This repo's conventions beat general best practice.
- `packages/core` stays pure. If a change requires I/O in core, the design is wrong —
  stop and raise it.
- New third-party dependencies need justification in the PR description.
- Tests are part of the change, not a follow-up. A milestone's "done when" clause is
  a test, not a description.

### 7.3 Model-facing code (`packages/agents`)

- Every model call **MUST** have a typed output schema and a parser that fails closed.
  An unparseable response is an error, never a fallback to free text.
- Prompts live in version-controlled files, not inline string literals scattered
  through business logic.
- Model context **MUST** be scoped to one tenant. Assembling context across tenants
  is an N1 violation of the worst kind, because it leaks into a system that memorizes.
- Never place credentials, tokens, or raw PII into a prompt.
- Use current Claude models via the official Anthropic SDK; pin the model id in
  configuration, not in scattered call sites.

### 7.4 Things an agent MUST NOT do in this repo

- Weaken, skip, or quarantine a test to make CI green.
- Loosen a row-level-security policy to make a query work.
- Add an autonomy default above `observe`.
- Resolve a `TODO(human)` by choosing an answer.
- Commit anything that writes to a real client system from a test suite.
- Push directly to the default branch.

### 7.5 Pull requests

Every PR states: which milestone, which non-negotiables it touches, what was tested
and how, and any **SHOULD** it deviated from with the reason. PRs that change policy,
autonomy, credential handling, or RLS require human review — no exceptions, and
"the change is small" is not one.

---

## 8. Security and compliance posture

MetaMSP holds privileged access to many businesses at once. That makes it a
supply-chain target, and the threat model **MUST** be written accordingly: assume an
attacker who has compromised one tenant's connector credentials and is trying to
traverse to another tenant, and assume an attacker who can inject text into an event
payload hoping it reaches a model's context.

The second one deserves naming, because it is new and this product is unusually
exposed to it: **event content is untrusted input**. Alert text, ticket bodies, and
log lines come from systems that outsiders can influence. When that text reaches a
model, it is data, never instruction. Model output derived from it is a *suggestion
about* the incident, and it goes through policy like everything else (N4).

Baseline requirements:

- All third-party credentials encrypted at rest with per-tenant keys.
- Every privileged operation lands in the audit ledger before it is attempted, not
  after it succeeds — a crash mid-operation must still leave a record.
- Dependency and secret scanning in CI, blocking on findings.
- `TODO(human)`: target compliance regime (SOC 2 Type II is the assumption; confirm)
  and whether any tenant will require regional data residency. Both have architectural
  consequences and are cheaper to decide before M2 than after.

---

## 9. Definition of done

A milestone is complete when all of the following are true:

1. Its "done when" criterion passes as an automated test.
2. No non-negotiable from §2 is violated anywhere in the milestone's surface area.
3. CI is green: typecheck, lint, unit, integration, E2E where applicable.
4. Anything a human must know to operate it is documented in `docs/`.
5. Decisions with lasting consequence are captured as ADRs.
6. No `TODO(human)` in the milestone's scope remains unresolved.

---

## 10. Open decisions

These block the milestones noted. They are listed here so they are visible rather
than discovered.

| # | Decision | Blocks |
| --- | --- | --- |
| 1 | Identity provider | M1 |
| 2 | Secrets management backend | M2 |
| 3 | First connector target | M2 |
| 4 | Compliance regime and data residency | M2 |
| 5 | Design partner MSP (who validates M3–M5 against real queues) | M3 |
| 6 | Pricing model — per-endpoint, per-incident, or per-automation | M7 |

---

## 11. Glossary

- **MSP** — Managed Service Provider. Outsourced IT for small and mid-size businesses.
- **RMM** — Remote Monitoring and Management. Endpoint agent, patching, alerting.
- **PSA** — Professional Services Automation. Ticketing, time, billing.
- **Runbook** — A versioned, parameterized remediation procedure.
- **Incident** — Correlated events sharing one cause, one owner, one lifecycle.
- **Autonomy level** — How far MetaMSP may act without a human: `observe`,
  `propose`, `approve`, `auto`.
- **Human-touch rate** — Fraction of incidents requiring human intervention. The
  number the product exists to reduce.
- **QBR** — Quarterly Business Review. Where an MSP justifies its value to a client.

---

*End of directive. Amendments require a version bump and a note in `docs/adr/`.*
