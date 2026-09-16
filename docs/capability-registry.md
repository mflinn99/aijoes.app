# Capability Registry and Router

Directive §5, §14, §31.

## Every AIGoGo capability is registered

| Capability | Opco | Type | Maturity | Actions |
| --- | --- | --- | --- | --- |
| Toleron | Toleron | intelligence | mock | 4 |
| SaleSonic | SaleSonic | growth | mock | 8 |
| ListeningPost | ListeningPost | intelligence | mock (unavailable) | 2 |
| SourcingAI | SourcingAI | procurement | mock | 3 |
| Buyonic | Buyonic | procurement | mock | 4 |
| GrothOS | GrothOS | growth | mock | 3 |
| Sixonic | Sixonic | automation | mock | 2 |
| Strata / MetaMSP | Strata | msp | mock | 4 |
| Onward | Onward | msp | mock (unavailable) | 2 |
| JoJo | AIGoGo | intelligence | **beta — implemented here** | 2 |

Nine of ten are mocked because no AIGoGo group service is reachable from this
environment (`docs/current-state.md`). Every mock states its reason, and the reason
is surfaced on the Capability Health screen and in the gap analysis — a simulated
result is never presented as a real one.

## Replacing a mock with a live service

1. Implement `CapabilityAdapter` against the same interface.
2. Set `maturity`, `apiEndpoint`, `authMethod`, `health`.
3. Call `registerAdapter()`.

No orchestration code changes. A test asserts this: registering a new capability at
runtime makes the router select it for its action, with nothing else modified.

## Routing

`routeObjective()` scores every capability action that either matches the requested
action id exactly or clears a keyword-fitness threshold against the objective:

| Criterion | Weight |
| --- | --- |
| Fitness for task | 35 |
| Capability health | 15 |
| Data availability | 15 |
| Execution success history | 12 |
| Maturity | 8 |
| Cost proportionality | 8 |
| Speed | 4 |
| Risk (inverse) | 3 |

Blocked candidates are **demoted, not hidden** (score × 0.25), so the execution
preview can explain why a plausible capability was not chosen — "SaleSonic is
unavailable", "missing input: approvalId", "cost is disproportionate to the value at
stake". A recommendation with no explanation is not auditable.

The router returns candidates, the recommendation, a fallback, and a one-sentence
rationale that is stored on the execution task for the audit trail.

## Mock behaviour

Mocks are deterministic: a FNV-1a hash of `capability:action:company` seeds the
variance, so the same inputs always produce the same outcome and tests are stable.
Every outcome carries `simulated: true`, which propagates to the Benefits Ledger —
simulated value can reach `REALISED` but never `VERIFIED`.

Mocks fail honestly: an unsupported action or a missing required input returns
`ok: false` with the reason, rather than a plausible-looking success.
