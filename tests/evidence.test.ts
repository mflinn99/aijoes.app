/**
 * Directive §1 and §27: "Never fabricate certainty." These are the
 * hallucination guards — they assert that the platform cannot present an
 * assumption as a fact, and cannot invent a business it has no data for.
 */

import { describe, it, expect } from 'vitest';
import { harness } from './helpers';
import { analyseCompany } from '@/lib/analysis/pipeline';
import { createEmptyTwin, understandingScore } from '@/lib/core/company-twin';
import { addClaim, claim, isConflicted, isStale, valueOf, confidenceOf } from '@/lib/core/provenance';
import { SYNTHETIC_COMPANIES } from '@/lib/fixtures/synthetic';
import { buildContext } from '@/lib/analysis/context';
import { spendLessOpportunities } from '@/lib/analysis/engines/spend-less';

describe('provenance', () => {
  it('retains conflicting claims rather than overwriting them', () => {
    let field = addClaim(createEmptyTwin('c', 't').turnoverEstimate, claim(1_000_000, { connectorId: 'website', label: 'Website', method: 'inferred', confidence: 0.4 }));
    field = addClaim(field, claim(2_500_000, { connectorId: 'companies-house', label: 'Filing', method: 'connected-data', confidence: 0.95 }));

    expect(field.claims).toHaveLength(2);
    expect(valueOf(field)).toBe(2_500_000);
    expect(isConflicted(field)).toBe(false); // the weaker claim is below the credibility threshold
    expect(isConflicted(field, 0.3)).toBe(true);
  });

  it('lifts confidence when two independent sources agree, but never to certainty', () => {
    let field = addClaim(createEmptyTwin('c', 't').legalName, claim('Acme Ltd', { connectorId: 'website', label: 'Website', method: 'inferred', confidence: 0.6 }));
    field = addClaim(field, claim('Acme Ltd', { connectorId: 'companies-house', label: 'Filing', method: 'connected-data', confidence: 0.6 }));

    expect(field.claims).toHaveLength(1);
    expect(confidenceOf(field)).toBeGreaterThan(0.6);
    expect(confidenceOf(field)).toBeLessThanOrEqual(0.95);
  });

  it('flags stale evidence', () => {
    const fresh = addClaim(createEmptyTwin('c', 't').domain, claim('a.com', { connectorId: 'website', label: 'w', method: 'observed', confidence: 0.9 }));
    expect(isStale(fresh, 30)).toBe(false);

    const old = addClaim(createEmptyTwin('c', 't').domain, claim('a.com', { connectorId: 'website', label: 'w', method: 'observed', confidence: 0.9, at: '2020-01-01T00:00:00Z' }));
    expect(isStale(old, 30)).toBe(true);
  });

  it('scores understanding by confidence, not mere presence', () => {
    const confident = createEmptyTwin('c', 't');
    confident.turnoverEstimate = addClaim(confident.turnoverEstimate, claim(1, { connectorId: 'x', label: 'x', method: 'observed', confidence: 0.9 }));

    const doubtful = createEmptyTwin('c', 't');
    doubtful.turnoverEstimate = addClaim(doubtful.turnoverEstimate, claim(1, { connectorId: 'x', label: 'x', method: 'inferred', confidence: 0.2 }));

    expect(understandingScore(confident)).toBeGreaterThan(understandingScore(doubtful));
  });

  it('does not count an empty array as knowledge', () => {
    const twin = createEmptyTwin('c', 't');
    twin.services = addClaim(twin.services, claim([], { connectorId: 'x', label: 'x', method: 'observed', confidence: 0.9 }));
    expect(understandingScore(twin)).toBe(0);
  });
});

describe('never fabricate certainty', () => {
  it('produces a low understanding score, not an invented business, when nothing is known', async () => {
    const h = harness();
    const result = await analyseCompany(h.db, 'A Company With No Web Presence', { offline: true });

    expect(result.understanding).toBeLessThan(15);
    expect(result.recommendedConnections.length).toBeGreaterThan(0);
    // Any opportunity that does appear must be openly a hypothesis.
    for (const o of result.opportunities) {
      expect(o.epistemics).toBe('hypothesis');
      expect(o.confidence).toBeLessThanOrEqual(0.75);
    }
  });

  it('caps confidence for any opportunity whose model contains an assumption', async () => {
    const h = harness();
    const fixture = SYNTHETIC_COMPANIES[0]!;
    const result = await analyseCompany(h.db, fixture.domain, {
      offline: true,
      seedRecords: fixture.records,
      userSupplied: fixture.userSupplied,
    });

    for (const o of result.opportunities) {
      const hasAssumption = o.financialModel.lines.some((l) => l.basis === 'assumption' || l.basis === 'benchmark');
      if (hasAssumption) {
        expect(o.epistemics).toBe('hypothesis');
        expect(o.confidence).toBeLessThanOrEqual(0.75);
      }
    }
  });

  it('gives every opportunity a traceable financial model and evidence', async () => {
    const h = harness();
    const fixture = SYNTHETIC_COMPANIES[2]!;
    const result = await analyseCompany(h.db, fixture.domain, {
      offline: true,
      seedRecords: fixture.records,
      userSupplied: fixture.userSupplied,
    });

    expect(result.opportunities.length).toBeGreaterThan(0);
    for (const o of result.opportunities) {
      expect(o.financialModel.lines.length).toBeGreaterThan(0);
      expect(o.financialModel.formula).toBeTruthy();
      expect(o.evidence.length).toBeGreaterThan(0);
      expect(o.reasoningSummary.length).toBeGreaterThan(20);
      // Every line states where its number came from.
      for (const line of o.financialModel.lines) {
        expect(['observed', 'benchmark', 'assumption', 'connected']).toContain(line.basis);
      }
      // The point estimate sits inside its own band.
      expect(o.financialModel.pointEstimate).toBeGreaterThanOrEqual(o.financialModel.lowEstimate);
      expect(o.financialModel.pointEstimate).toBeLessThanOrEqual(o.financialModel.highEstimate);
    }
  });

  it('promotes benchmark hypotheses to connected facts once financial data is attached', () => {
    const twin = createEmptyTwin('c1', 'tenant-a');
    twin.employeesEstimate = addClaim(twin.employeesEstimate, claim(50, { connectorId: 'user', label: 'user', method: 'user-supplied', confidence: 0.9 }));

    const benchmarked = spendLessOpportunities(buildContext(twin));

    twin.dataSources = ['accounting'];
    const connected = spendLessOpportunities(buildContext(twin));

    const saas = (list: typeof benchmarked) => list.find((o) => o.subcategory === 'SaaS')!;
    expect(saas(benchmarked).epistemics).toBe('hypothesis');
    expect(saas(connected).confidence).toBeGreaterThan(saas(benchmarked).confidence);
    expect(saas(connected).financialModel.lines.some((l) => l.basis === 'connected')).toBe(true);
  });
});
