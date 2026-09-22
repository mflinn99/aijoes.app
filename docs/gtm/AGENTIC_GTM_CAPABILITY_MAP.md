# Agentic GTM — Capability Map

**Phase 1 deliverable.** Audit date: 2026-09-22.
Machine-readable companion: `agentic_gtm_capability_registry.json`.

## Method

Every repository reachable from this account was listed and each candidate was
**cloned and inspected**, not judged by its name. Where a repository was not cloned,
the reason is stated. Nothing below is inferred from a repository title.

## The estate, as it actually is

| Repository | Inspected | Files | What it is | Verdict |
| --- | --- | --- | --- | --- |
| `mflinn99/aijoes.app` | ✅ cloned | 116 source | **MetaMSP** — the platform built in this workstream | **REUSE** as the foundation |
| `mflinn99/hazel-backend` | ✅ cloned | 508 | HAZEL: UK public-sector procurement agent. Real, working, different domain and stack | **REUSE ONE PATTERN** (email service) |
| `mflinn99/brightminds` | ✅ cloned | 184 | hijojo.ai — teen education product. Carries JoJo *branding*, no agent code | **NOT RELEVANT** |
| `mflinn99/-jojo-control-plane` | ✅ cloned | 1 | README only: `# -jojo-control-plane / aigogo group` | **NOTHING TO REUSE** |
| `mflinn99/listeningpost` | ✅ cloned | 0 | Empty repository, zero refs | **NOTHING TO REUSE** |
| `mflinn99/agent-portal` | ✅ cloned | 1 | `.gitattributes` only | **NOTHING TO REUSE** |
| `mflinn99/zerion-ev-pulse-clean`, `Zerion-site` | ❌ | — | EV telemetry product line | Not inspected — unrelated domain |
| `mflinn99/housecost-app` | ❌ | — | Housing cost tool | Not inspected — unrelated domain |
| `mflinn99/Hazel-demo` | ❌ | — | Demo of the HAZEL product already inspected | Not inspected — superseded by `hazel-backend` |
| `mflinn99/PbP` | ❌ | — | Unknown, last pushed June 2025 | Not inspected — dormant 15 months |

### The named capabilities, checked individually

The directive names nine AIGoGo capabilities to investigate. Here is what each one
actually resolves to:

| Named capability | Reality | Evidence |
| --- | --- | --- |
| **JoJo** | Orchestration layer **implemented in `aijoes.app`**. The `-jojo-control-plane` repo is a README; `brightminds` has a `JoJoMark.tsx` logo component | `src/lib/jojo/orchestrator.ts`, 1-file repo, logo component |
| **SaleSonicAI** | **No code anywhere.** Registered as a mocked capability with 8 declared actions | `src/lib/capabilities/registry.ts` |
| **Toleron** | **No code anywhere.** Mocked capability. Its analytical function is in practice implemented by MetaMSP's own twin and engines | ditto |
| **ListeningPost** | **Empty repository.** Mocked capability, health `unavailable` | zero refs on clone |
| **Onward** | **No system, no dataset, no credentials.** Mocked capability | ditto |
| **SourcingAI / Buyonic** | **No code anywhere.** Mocked capabilities | ditto |
| **CRM integrations** | **None exist.** `grep` for hubspot/salesforce/pipedrive/dynamics across every cloned repo returns nothing outside the HubSpot *connector* built in `aijoes.app` | grep across 3 substantial repos |
| **Microsoft/Azure infrastructure** | No deployed infrastructure reachable. A **working Microsoft Graph client** exists in `aijoes.app` | `src/lib/discovery/graph-client.ts` |
| **Email/outreach capability** | **None deployed.** `hazel-backend` contains a working dual-provider email service (SendGrid / AWS SES) with a no-op fallback — a directly portable pattern | `server/_core/emailService.ts` |

**Conclusion.** There is no separate AIGoGo service estate to integrate with. The
reusable estate *is* `aijoes.app`, and it is substantial: 116 source files, 278
passing tests, multi-tenant isolation, authentication and RBAC, a credential vault, a
durable job queue, a Company Digital Twin with provenance, live company research, an
opportunity engine, a capability registry and router, a benefits ledger, and JoJo.

That is the opposite of a problem: Agentic GTM is built **on top of** it rather than
beside it, and almost every hard part already exists and is tested.

## What is being reused, and how

| Component | Location | Role in Agentic GTM | Verdict |
| --- | --- | --- | --- |
| Multi-tenant data layer | `src/lib/db/tenant.ts` | Onward is one tenant; another MSP is another | **REUSE unchanged** |
| Authentication + RBAC | `src/lib/auth/` | Mark's commercial gate is an RBAC permission | **EXTEND** — add `commercial` permission |
| Credential vault | `src/lib/secrets/vault.ts` | CRM, email and enrichment credentials | **REUSE unchanged** |
| Durable job queue | `src/lib/jobs/` | Every agent runs as a job; autonomous recovery is a scheduled job | **EXTEND** — new job types |
| Company Digital Twin | `src/lib/core/company-twin.ts` | The account intelligence record | **REUSE unchanged** |
| Provenance model | `src/lib/core/provenance.ts` | Evidence and confidence on every claim — Phase 5's evidence requirement | **REUSE unchanged** |
| Website connector | `src/lib/discovery/website-connector.ts` | Account research: the Market and Account Intelligence agents | **REUSE unchanged** |
| Companies House connector | `src/lib/discovery/companies-house-connector.ts` | Registry facts for UK targets | **REUSE** (needs a key) |
| M365 / Xero / HubSpot connectors | `src/lib/discovery/` | HubSpot doubles as the **CRM system of record** | **EXTEND** — add CRM write path |
| Opportunity scoring | `src/lib/core/opportunity.ts` | The explainable-score pattern for all seven ICP scores | **REUSE the pattern** |
| Capability registry + router | `src/lib/capabilities/` | The ten GTM agents register here and route like any other capability | **EXTEND** |
| Benefits ledger | `src/lib/benefits/ledger.ts` | Pipeline value staging, forward-only | **EXTEND** — pipeline stages |
| Execution engine | `src/lib/execution/engine.ts` | Outreach campaigns are execution plans with approval gates | **REUSE unchanged** |
| JoJo orchestrator | `src/lib/jojo/orchestrator.ts` | Becomes the **JoJo GTM Director** | **EXTEND** — GTM objectives |
| Audit + agent events | `src/lib/observability/events.ts` | Agent decision logging, Phase 9 | **REUSE unchanged** |
| Rate limiting | `src/lib/rate-limit.ts` | Outreach volume control | **REUSE unchanged** |
| Email service pattern | `hazel-backend/server/_core/emailService.ts` | Outreach delivery | **WRAP** — port the provider-detection pattern, adapted |

## What genuinely has to be built

Only the GTM-specific layer. Everything below is new because nothing equivalent exists
anywhere in the estate:

1. **Onward capability graph** — what Onward sells, to whom, at what price (Phase 2)
2. **ICP engine** — fifteen archetypes, seven scores, explainable priority (Phase 3)
3. **Account universe** — discovery sources and the target set (Phase 4)
4. **Opportunity hypothesis engine** — evidence → commercial hypothesis (Phase 5)
5. **Ten GTM agents** — as logical roles over the existing orchestration (Phase 6)
6. **Commercial governance** — Mark's gate (Phase 7)
7. **Outreach composition and control** (Phase 8)
8. **CRM closed loop** — idempotent, with a local system of record (Phase 9)
9. **Pipeline autopilot** (Phase 10)
10. **Objectives and autonomous recovery** (Phases 11–12)
11. **GTM control centre and morning brief** (Phases 13–14)
12. **Learning loop with versioned strategies** (Phase 15)

## Deliberate non-rebuilds

Things it would have been faster to write from scratch, reused instead:

- **Account research** — the website connector already crawls, fingerprints technology,
  infers sector and segment, and records provenance. A GTM-specific scraper would have
  been worse and duplicated 400 lines.
- **Evidence and confidence** — the provenance model already retains conflicting claims
  and derives epistemics from the weakest input. Phase 5's "reject weak hypotheses" is
  that rule applied to a different entity.
- **Approval gates** — the execution engine already stops at external actions and
  requires a named human. Mark's gate is a policy on top, not a new mechanism.
- **Value staging** — the benefits ledger already ratchets forward through six stages
  with evidence. Pipeline stages reuse it rather than inventing a parallel concept.
