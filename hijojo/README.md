# Hijojo Agentic Prospecting

Give Hijojo an AIGoGo OpCo. It works out what the OpCo sells and who should buy
it, finds a small number of evidenced, qualified prospects, writes each one an
individually relevant introduction, has it independently checked, sends it,
follows up once after five days, and hands any engaged reply to
**mark@aigogo.ai**. Then automation stops and a human takes over.

The specification is [`docs/BUILD-REMIT.txt`](docs/BUILD-REMIT.txt), unchanged.

```
ENTER OPCO → UNDERSTAND → PROFILE → SEARCH → RESEARCH → QUALIFY → SCORE → SELF-QA → SEND
  → MONITOR → reply?  yes → STOP → HAND TO MARK
                      no  → WAIT 5 DAYS → RE-VALIDATE → ONE FOLLOW-UP → STOP
  → MEASURE → TIGHTEN QUALIFICATION
```

## Run it

```bash
cd hijojo
npm install
npm test          # 200 tests, including acceptance scenarios A–J
npm run demo      # http://localhost:5050, synthetic world, prints sign-ins
```

`npm run demo` builds nothing real: fictional `.test` companies, a scripted
model and a simulated mailbox. It is there to see the product work end to end.
Run `npm run build` first if you want the UI served by the demo; otherwise use
`npm run dev` (UI on :5173) alongside it.

For a real deployment:

```bash
npm run build
npm run seed      # creates admin/operator/viewer; prints passwords once
npm start         # simulation mode until configured otherwise
```

Configuration is in [`.env.example`](.env.example). Azure hosting is in
[`docs/AZURE.md`](docs/AZURE.md), Microsoft 365 Copilot in
[`docs/COPILOT.md`](docs/COPILOT.md), Outlook in [`docs/OUTLOOK.md`](docs/OUTLOOK.md).

## Status

Precise, because the remit asks for it: working, tested, simulated,
unconfigured and deferred are different things.

| Capability | State |
| --- | --- |
| OpCo analysis with FACT / INFERENCE / UNKNOWN; quotations re-verified against retrieved text | Working; tested |
| Prospecting profile: proposition, problem, ICP, buyers, USP, cost, buying signals, exclusions | Working; tested |
| Evidence-gated scoring at exactly 30/30/15/10/10/5, threshold 80 (can be raised, never lowered) | Working; tested |
| Independent QA: the six relevance questions plus identity, recipient, freshness, claims, commitments, links, OpCo, duplicates, suppression, prior response | Working; tested |
| Bounded sequence: intro → 5 days → re-validate → one follow-up → stop, enforced by the database | Working; tested |
| Response classification, immediate stop, unsubscribe suppression, bounce handling | Working; tested |
| Handoff to mark@aigogo.ai with full intelligence and conversation | Working; tested (simulated mailbox) |
| Transactional, idempotent sending; reconcile-before-resend on uncertain outcomes; daily cap; halt | Working; tested |
| Continuous QA metrics; learning suspends signals that produce false positives | Working; tested |
| Web UI, authentication, roles (admin / operator / viewer) | Working; tested (API) and exercised in a browser |
| Acceptance scenarios A–J | Passing on synthetic data with a fake clock |
| Claude for analysis, research, discovery (web search), drafting, QA review, reply triage | **Implemented for Microsoft Foundry (managed identity) and the Claude API; never run against either.** Tests check the exact requests each platform gets. |
| Live web retrieval | **Implemented, not exercised.** The build environment blocks outbound web access; only the private-network guard is tested. |
| Outlook (Microsoft Graph) sending and reply detection | **Implemented; tested against a fake Graph. Not connected.** Authorisation was not completed. |
| Contact-data provider | **Unconfigured: the provider has not been named.** Decision-makers can be entered by hand per prospect; without one a prospect waits in Researching. |
| Azure hosting (Container Apps, Foundry, managed identity, Azure Files) | **Template written and compiled; not deployed.** Production bundle run locally on production dependencies. See `docs/AZURE.md`. |
| Microsoft 365 Copilot (declarative agent + API plugin, Entra SSO) | **API implemented and tested with signed tokens; app package built; not registered in a tenant.** See `docs/COPILOT.md`. |
| Graph change notifications (instead of polling) | Deferred; polling every 5 minutes |
| PostgreSQL | Deferred; SQLite with write transactions (the existing MetaMSP pattern). The schema's safety rules are database constraints, so they move with it. |

**Not production-ready.** The remit's acceptance standard needs the full journey
demonstrated repeatedly against real companies. That needs an API key, outbound
web access, Outlook connected and a contact provider. Nothing has been sent to
anyone.

## Sale mandates and private scenarios

An OpCo can be a business for sale. Leave the website blank, paste the teaser or
information memorandum as supporting information, and give an intro link of the
OpCo's own (typically an NDA request page). Hijojo analyses the document alone,
prospects for acquirers, and QA lets sourced figures from the teaser through
while still rejecting anything framed as a price or valuation. The fictional
mandate *Project SLATE* (`server/sim/scenarios.ts`, `tests/sale-mandate.test.ts`)
exercises this end to end.

Real mandates are confidential. Put them as JSON scenario files in
`.data/private-scenarios/` (git-ignored); `npm run demo` runs them in place of
SLATE, and `tests/private-scenarios.test.ts` checks every quotation against the
document. They are never committed.

## How the rules are enforced

**Evidence over assumption.** Every FACT carries a quotation, and the quotation
is checked against the stored text of a page Hijojo itself retrieved
(`server/evidence.ts`). A model citing something it remembers gets its FACT
downgraded, with the reason recorded. QA re-verifies citations again just
before a send.

**Score cannot be talked up.** The Qualification Agent proposes points and the
findings behind them; `server/qualification.ts` decides what they are worth. No
need points without a verified trigger tied to a buying signal; timing capped
by the trigger's age; buyer fit decided by the contact's role, not by opinion;
evidence quality counted from distinct sources.

**The generator does not approve itself.** `server/qa/` builds its own view
from the database, ignores the composer's account, and judges the rendered
message. Only PASS on the exact content (by hash) permits a send. An optional
second model reviewer can add objections; it can never overturn a failed rule.

**At most two messages, structurally.** A partial unique index on
`outbound(prospect_id, kind)` makes a second introduction or follow-up
impossible regardless of what any code path tries. Sending re-checks halt,
mode, cap, status, suppression and replies inside a write transaction.

**Any response stops automation** in the same transaction that records it,
before it is classified. Unsubscribe and "no thanks" suppress immediately.
Positive, interested and referral responses go to Mark.

**Agentic boundary.** QA rejects pricing, discounts, trials, guarantees,
contracts and commitments outright. There is no third message and no
continued selling after a response.

## Layout

| Path | What |
| --- | --- |
| `server/agents/` | OpCo analyst and profile, discovery, research, contacts, qualification, composer |
| `server/qa/` | Independent QA |
| `server/engine.ts` | The operating loop as durable jobs; sending; reply handling; handoff |
| `server/qualification.ts` | ICP matching, exclusions, role matching, scoring |
| `server/evidence.ts` | Provenance |
| `server/research/` | Fetcher with private-network protection; HTML to text |
| `server/mail/` | Mail interfaces, simulated mailbox, Outlook via Graph |
| `server/responses/` | Classification and the handoff |
| `server/metrics.ts` | Continuous QA and learning |
| `server/sim/` | The synthetic world used by tests and the demo |
| `src/` | The UI |
| `tests/` | Suites per the remit: OpCo analysis, qualification (discovery), communications, sequence, responses, safety, E2E A–J, plus fetcher, Graph, API, learning |

## About the handoff package

The Replit export this was briefed with contained an empty pnpm scaffold
(Express, Postgres/Drizzle, a mockup sandbox). It held no Hijojo logic, so this
follows the repository's own convention instead: a self-contained npm project
like `sage-halpin/`, Express plus React, SQLite like MetaMSP.
