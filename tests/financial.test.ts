/** Directive §6 and §27: financial calculation and scoring. */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  netBenefitOf,
  normaliseTime,
  normaliseValue,
  roiOf,
  scoreOpportunity,
  startAvailable,
  effortLabel,
  timeToValueLabel,
  type Opportunity,
} from '@/lib/core/opportunity';
import { deriveEpistemics, buildFinancialModel } from '@/lib/analysis/engines/shared';
import { serviceEconomics, MSP_SERVICES } from '@/lib/analysis/engines/msp-expand';
import { buildContext } from '@/lib/analysis/context';
import { createEmptyTwin } from '@/lib/core/company-twin';
import { addClaim, claim } from '@/lib/core/provenance';

describe('financial calculations', () => {
  it('computes net benefit and ROI', () => {
    expect(netBenefitOf(100_000, 20_000)).toBe(80_000);
    expect(roiOf(100_000, 20_000)).toBe(4);
    expect(roiOf(100_000, 0)).toBe(Infinity);
    expect(roiOf(0, 0)).toBe(0);
  });

  it('normalises value logarithmically so a small quick win stays visible', () => {
    const big = normaliseValue(1_000_000);
    const small = normaliseValue(40_000);
    expect(big).toBeCloseTo(1, 2);
    // Linear normalisation would put this at 0.04; log keeps it meaningful.
    expect(small).toBeGreaterThan(0.7);
    expect(normaliseValue(0)).toBe(0);
    expect(normaliseValue(-5)).toBe(0);
  });

  it('clamps time normalisation at a one-year horizon', () => {
    expect(normaliseTime(0)).toBe(0);
    expect(normaliseTime(365)).toBe(1);
    expect(normaliseTime(900)).toBe(1);
  });

  it('exposes the scoring calculation rather than a single opaque number', () => {
    const { total, components } = scoreOpportunity({
      estimatedAnnualValue: 100_000,
      confidence: 0.8,
      executionReadiness: 0.9,
      effort: 0.3,
      risk: 'low',
      timeToValue: 45,
      category: 'SPEND_LESS',
    });
    expect(components).toHaveLength(8);
    const recomputed = components.reduce((s, c) => s + c.weight * c.input, 0);
    expect(total).toBeCloseTo(Math.round(recomputed * 10) / 10, 5);
    expect(components.find((c) => c.label === 'Effort')!.weight).toBe(-DEFAULT_WEIGHTS.effort);
  });

  it('ranks a confident, ready, low-risk opportunity above a larger uncertain one', () => {
    const solid = scoreOpportunity({
      estimatedAnnualValue: 60_000, confidence: 0.85, executionReadiness: 0.9,
      effort: 0.2, risk: 'low', timeToValue: 30, category: 'SPEND_LESS',
    }).total;
    const speculative = scoreOpportunity({
      estimatedAnnualValue: 400_000, confidence: 0.3, executionReadiness: 0.4,
      effort: 0.8, risk: 'high', timeToValue: 270, category: 'MAKE_MORE',
    }).total;
    expect(solid).toBeGreaterThan(speculative);
  });

  it('widens the estimate band when the model rests on benchmarks', () => {
    const hypothesis = buildFinancialModel({
      lines: [{ label: 'x', value: 1, unit: 'GBP', basis: 'benchmark' }],
      pointEstimate: 100_000,
    } as never);
    const evidenced = buildFinancialModel({
      lines: [{ label: 'x', value: 1, unit: 'GBP', basis: 'connected' }],
      pointEstimate: 100_000,
    } as never);
    const hypothesisWidth = hypothesis.highEstimate - hypothesis.lowEstimate;
    const evidencedWidth = evidenced.highEstimate - evidenced.lowEstimate;
    expect(hypothesisWidth).toBeGreaterThan(evidencedWidth);
  });

  it('derives epistemics from the weakest financial line', () => {
    expect(deriveEpistemics([{ label: 'a', value: 1, unit: 'GBP', basis: 'connected' }])).toBe('inferred-fact');
    expect(deriveEpistemics([
      { label: 'a', value: 1, unit: 'GBP', basis: 'connected' },
      { label: 'b', value: 1, unit: 'GBP', basis: 'assumption' },
    ])).toBe('hypothesis');
    expect(deriveEpistemics([
      { label: 'a', value: 1, unit: 'GBP', basis: 'observed' },
      { label: 'b', value: 1, unit: 'GBP', basis: 'benchmark' },
    ])).toBe('hypothesis');
  });

  it('computes MSP service economics with a consistent margin', () => {
    const twin = createEmptyTwin('c1', 'tenant-a');
    twin.employeesEstimate = addClaim(twin.employeesEstimate, claim(100, { connectorId: 'user', label: 'user', method: 'user-supplied', confidence: 0.9 }));
    const ctx = buildContext(twin);

    const def = MSP_SERVICES.find((s) => s.id === 'managed-microsoft')!;
    const econ = serviceEconomics(def, ctx);

    expect(econ.monthlyCharge).toBe(100 * def.pricePerUnit);
    expect(econ.monthlyGrossMargin).toBe(econ.monthlyCharge - econ.monthlyDeliveryCost);
    expect(econ.annualRevenue).toBe(econ.monthlyCharge * 12);
    expect(econ.grossMarginPct).toBeGreaterThan(0);
    expect(econ.grossMarginPct).toBeLessThan(100);
  });

  it('applies the monthly floor to small estates', () => {
    const twin = createEmptyTwin('c1', 'tenant-a');
    twin.employeesEstimate = addClaim(twin.employeesEstimate, claim(6, { connectorId: 'user', label: 'user', method: 'user-supplied', confidence: 0.9 }));
    const ctx = buildContext(twin);
    const def = MSP_SERVICES.find((s) => s.id === 'managed-microsoft')!;
    expect(serviceEconomics(def, ctx).monthlyCharge).toBe(def.floorMonthly);
  });

  it('labels effort and time to value in business language', () => {
    expect(effortLabel(0.1)).toBe('Low');
    expect(effortLabel(0.5)).toBe('Medium');
    expect(effortLabel(0.9)).toBe('High');
    expect(timeToValueLabel(10)).toBe('≤ 2 weeks');
    expect(timeToValueLabel(200)).toMatch(/months/);
  });
});

describe('START availability gate', () => {
  const base = {
    executionStatus: 'NOT_STARTED', playbookId: 'pipeline-generation',
    confidence: 0.8, executionReadiness: 0.8,
  } as Opportunity;

  it('permits a ready opportunity', () => {
    expect(startAvailable(base).available).toBe(true);
  });

  it('blocks when no playbook is mapped', () => {
    const r = startAvailable({ ...base, playbookId: null });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/playbook/);
  });

  it('blocks on low confidence', () => {
    expect(startAvailable({ ...base, confidence: 0.2 }).available).toBe(false);
  });

  it('blocks on low readiness', () => {
    expect(startAvailable({ ...base, executionReadiness: 0.1 }).available).toBe(false);
  });

  it('blocks an opportunity already in flight, but allows a retry after failure', () => {
    expect(startAvailable({ ...base, executionStatus: 'EXECUTING' }).available).toBe(false);
    expect(startAvailable({ ...base, executionStatus: 'FAILED' }).available).toBe(true);
  });
});
