# AIGoGo MetaMSP

**Automated Land & Expand Engine.** Enter a company name or website; get credible,
evidenced ways for that company to make more and spend less, and for its MSP to
expand the relationship — each with a START button that creates a real, approvable
execution plan.

```
LAND → LEARN → IDENTIFY → QUANTIFY → START → EXECUTE → MEASURE → EXPAND → REPEAT
```

## Run it

```bash
npm install
npm run seed     # MSP tenant, three users, three synthetic companies, fully analysed
npm run dev      # http://localhost:3000
```

The seed prints three passwords once — it never ships a known default. Set
`METAMSP_ADMIN_PASSWORD` (and the user/viewer equivalents) to choose them yourself.

To connect a real Microsoft 365, Xero or HubSpot account you also need a vault key:

```bash
export METAMSP_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
```

Without it the platform refuses to store credentials rather than writing them in
plaintext, and those connectors report themselves unconfigured. See `.env.example`
for the rest, including SSO.

```bash
npm test         # 276 tests
npm run typecheck
npm run build && npm start
npm run db:reset # wipe and reseed
```

## What it does

| | |
| --- | --- |
| **Company Digital Twin** | 43 fields, each carrying its source, method, confidence and timestamp. Conflicting claims are kept, not overwritten. |
| **Understanding score** | Weighted, confidence-adjusted. A company with no web presence scores in single figures and the platform says so. |
| **Three engines** | MAKE MORE, SPEND LESS, MSP EXPAND — every opportunity with an inspectable financial model, line by line. |
| **Supply chain graph** | Suppliers, spend, criticality, switching cost, alternatives, renewal calendar. |
| **START** | A real execution contract: tasks routed to capabilities, approval gates identified, cost checked against value, authorised by a named human. |
| **Benefits Ledger** | Theoretical → Approved → Forecast → Committed → Realised → Verified. Forward only. |
| **Verification** | A baseline captured before execution, compared afterwards against the connected system of record. |
| **JoJo** | "Find £100k of addressable annual savings across this company." |

## Connectors

Five are implemented; the rest declare the interface so the ingestion contract is
fixed and adapters can be added without touching the twin or any engine.

| Connector | Gives you |
| --- | --- |
| **Company website** | Proposition, services, sectors, technology indicators. No credentials needed. |
| **Companies House** | Legal identity, SIC codes, filing history. |
| **Microsoft 365** | Counted user population, seats purchased vs assigned, leavers still licensed, dormant accounts. |
| **Xero** | Counted turnover, margin, supplier spend by category, software subscriptions, customer base. |
| **HubSpot** | Counted dormant accounts, open and stalled pipeline, conversion rate, average deal value. |

Connecting one does not decorate the analysis — it replaces the model. The licence
opportunity stops being a hypothesis and becomes a count of seats; the customer base
stops being turnover divided by a benchmark and becomes the invoices.

## Three rules the code enforces

**Never fabricate certainty.** An opportunity's epistemics are *derived* from the
weakest line in its financial model, not asserted by the rule that produced it. One
benchmark anywhere makes the whole thing a hypothesis, capped at 75% confidence
however confident the rest looks. Connect a system of record and the same rule lifts
it, mechanically.

**Nothing leaves the platform without a human.** Autonomy denies by default; a new
action type is `OBSERVE` for every tenant regardless of what else is granted. Any
capability action marked `external` cannot be invoked without an approval id — the
registry forces it into the action's required inputs, so a new external action cannot
be added without inheriting the gate.

**Roles are enforced, not described.** `READ_ONLY` holds nothing but read. `MSP_USER`
does the work — analyse, plan, run — but cannot *authorise* a plan or approve a gate,
because those commit money and reach a customer. Halting is available to anyone who
can act: an emergency stop that needs an administrator is not an emergency stop.

## Status

Every AIGoGo opco capability (Toleron, SaleSonic, ListeningPost, SourcingAI, Buyonic,
GrothOS, Sixonic, Strata/MetaMSP, Onward) is **simulated** — none is reachable as code
or as a service. Each is registered with its real interface and a deterministic mock,
so each becomes real by writing one adapter. Simulated value can reach `REALISED` in
the ledger but never `VERIFIED`.

Remaining before an internet-facing deployment: Postgres with row-level security
(isolation is currently enforced by a tested guard layer), encryption at rest for the
database file, and shared-store rate limiting. See `docs/security-model.md`.

## Documentation

| Document | Contents |
| --- | --- |
| `docs/build-status.md` | Current position: complete / mocked / blocked / remaining |
| `docs/BUILD-REPORT.md` | Iteration 1 record, capability gap analysis, next directive |
| `docs/BUILD-DIRECTIVE.md` | The directive this was built from |
| `docs/current-state.md` | Phase A discovery |
| `docs/metamsp-architecture.md` | Layers, module map, boundaries |
| `docs/company-twin.md` | Provenance and the understanding score |
| `docs/opportunity-graph.md` | Scoring, epistemics, the three engines |
| `docs/execution-engine.md` | The 15-step START workflow |
| `docs/capability-registry.md` | The mesh and the router |
| `docs/security-model.md` | Authentication, RBAC, vault, isolation, known gaps |
| `docs/screens/` | Screenshots of all 19 screens |
