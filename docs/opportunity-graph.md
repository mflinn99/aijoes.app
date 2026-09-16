# Opportunity Graph

Directive §6, §7, §8, §10.

## The entity

An `Opportunity` carries its problem, evidence, assumptions, an inspectable financial
model, scoring inputs, the capabilities and integrations it needs, its playbook, its
execution state, and its realised value once executed.

## Epistemics are derived, not asserted

```
any line basis = 'assumption'  →  hypothesis
any line basis = 'benchmark'   →  hypothesis
all lines observed/connected   →  inferred-fact
```

An engine cannot declare its own output a fact. The weakest financial line decides,
and a hypothesis has its confidence capped at 0.75 regardless of what the rule asked
for. This is the single most important rule in the analysis layer: it is what stops
a plausible-looking chain of benchmarks presenting as knowledge.

## Financial models are line items, not numbers

Every model is an ordered list of labelled lines, each with a `basis`
(`observed` / `benchmark` / `assumption` / `connected`) and a note explaining where the
figure came from, plus a stated formula. The Opportunity Detail screen renders them
verbatim. An MSP can therefore defend any number in front of a customer, or see
immediately that they cannot.

The band (low–high) widens automatically when the model rests on benchmarks: ±45%
for a hypothesis, ±20% when evidenced.

## Scoring

```
score = 40·value_norm + 20·confidence + 15·readiness + 5·strategic + 10·msp_relevance
        − 12·effort − 10·risk − 8·time_norm
```

Weights are configurable. `normaliseValue` is logarithmic, because linear
normalisation lets one £2m opportunity flatten everything else to zero and an MSP
needs the £40k quick win to stay visible next to it.

The breakdown is returned with the score and rendered line by line. There is no
opaque ranking anywhere in the product.

## The three engines

| Engine | Rules | Trigger condition |
| --- | --- | --- |
| MAKE MORE | 6 | Dormant base, pipeline absence, ≥2 service lines, turnover, weak proposition, single location |
| SPEND LESS | 6 | Headcount, technology indicators, cloud presence, estimated IT spend |
| MSP EXPAND | 11 services | Headcount thresholds, missing cyber accreditation, cloud indicators, existing services held |

Each rule states its own trigger, so an opportunity only appears when the twin
actually supports it. A generic list an MSP cannot defend is worse than a short one.

## Promotion

SPEND LESS rules read `ctx.hasFinancialData`. When a financial connector is attached,
every spend line's basis flips from `benchmark` to `connected`, which lifts the
derived epistemics from hypothesis to inferred-fact and raises the confidence
ceiling. No rule contains promotion logic — it is mechanical.
