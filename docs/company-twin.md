# Company Digital Twin

The persistent company knowledge layer. Directive §3.

## Contract

`CompanyTwin` holds 43 provenanced fields plus `dataSources` and `lastUpdatedAt`.
Connectors added later must not change this contract — they emit claims against
existing field names, or the field list grows; neither breaks an analysis engine.

## Provenance

Every field is a `ProvenancedField<T>`:

```ts
{
  current: Claim<T> | null,   // highest-confidence claim
  claims:  Claim<T>[]         // every claim ever made, including conflicting ones
}
```

and every claim carries `value`, `method`, `epistemics`, `confidence`, `sources[]`
and `observedAt`.

**Conflicting facts are retained, never overwritten.** `addClaim` appends; it only
merges when two claims share a value, and then it *raises* confidence, because two
independent sources agreeing is stronger evidence than either alone — capped at 0.95,
because corroboration is not proof.

`isConflicted()` surfaces a field holding two credible but different values. The
Company Twin screen badges those, rather than silently presenting the winner.

## Understanding score

A weighted, confidence-adjusted coverage measure, not a field count:

```
understanding = Σ(weight × confidence) / Σ(weight)
```

Weights reflect analytical value: `turnoverEstimate` is 5, `tradingNames` is 1. A
field populated at 30% confidence contributes 30% of its weight, so a thin guess can
never read as understanding. An empty array counts as no knowledge at all.

This is what makes §23 honest: a company with no web presence scores in single
figures and the platform says so, rather than producing a confident-looking analysis
of a business it knows nothing about.

## Connector uplift

`recommendedConnections()` ranks unconnected connectors by the understanding each
would add. The figures come from the twin field weights each connector can populate —
they are estimates, and the UI labels them as such.

## Field weight reference

The five heaviest fields, which is where analysis quality actually comes from:

| Field | Weight | Why |
| --- | --- | --- |
| `turnoverEstimate` | 5 | Every financial model scales from it |
| `employeesEstimate` | 4 | Drives licence, SaaS, telecoms and MSP unit counts |
| `services` | 4 | Cross-sell and proposition work depend on it |
| `technologyEstate` | 4 | Drives the entire SPEND LESS analysis |
| `estimatedSpendCategories` | 4 | Supply chain and procurement opportunities |
