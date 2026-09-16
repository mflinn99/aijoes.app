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
npm run seed     # MSP tenant + 3 synthetic companies, fully analysed
npm run dev      # http://localhost:3000
```

No API keys are required. Analysis is deterministic without an LLM; see
`.env.example` for the optional ones.

```bash
npm test         # 115 tests
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
| **JoJo** | "Find £100k of addressable annual savings across this company." |

## Two rules the code enforces

**Never fabricate certainty.** An opportunity's epistemics are *derived* from the
weakest line in its financial model, not asserted by the rule that produced it. One
benchmark anywhere makes the whole thing a hypothesis, and a hypothesis is capped at
75% confidence however confident the rest looks.

**Nothing leaves the platform without a human.** Autonomy denies by default; a new
action type is `OBSERVE` for every tenant regardless of what else is granted. Any
capability action marked `external` cannot be invoked without an approval id — the
registry forces it into the action's required inputs, so a new external action cannot
be added without inheriting the gate.

## Status

Every AIGoGo opco capability (Toleron, SaleSonic, ListeningPost, SourcingAI, Buyonic,
GrothOS, Sixonic, Strata/MetaMSP, Onward) is **simulated** — none is reachable as code
or as a service. Each is registered with its real interface and a deterministic mock,
so each becomes real by writing one adapter. Simulated value can reach `REALISED` in
the ledger but never `VERIFIED`.

**Not safe for real customer data yet:** there is no authentication and no route-level
RBAC. See `docs/security-model.md`.

## Documentation

| Document | Contents |
| --- | --- |
| `docs/BUILD-REPORT.md` | What was built, what was found, what to do next |
| `docs/BUILD-DIRECTIVE.md` | The directive this was built from |
| `docs/current-state.md` | Phase A discovery |
| `docs/metamsp-architecture.md` | Layers, module map, boundaries |
| `docs/company-twin.md` | Provenance and the understanding score |
| `docs/opportunity-graph.md` | Scoring, epistemics, the three engines |
| `docs/execution-engine.md` | The 15-step START workflow |
| `docs/capability-registry.md` | The mesh and the router |
| `docs/security-model.md` | Isolation, autonomy, known gaps |
| `docs/build-status.md` | Completed / mocked / blocked / remaining |
| `docs/screens/` | Screenshots of all 15 screens |
