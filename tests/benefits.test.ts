/** Directive §16: the Benefits Ledger stage ratchet. */

import { describe, it, expect } from 'vitest';
import { harness, seedCustomer } from './helpers';
import { createBenefit, advance, listBenefits, summariseLedger, getBenefitByOpportunity, BenefitStageError, STAGE_ORDER } from '@/lib/benefits/ledger';
import { analyseCompany } from '@/lib/analysis/pipeline';
import { SYNTHETIC_COMPANIES } from '@/lib/fixtures/synthetic';

function seedBenefit(h: ReturnType<typeof harness>, companyId: string, opportunityId: string, forecast = 100_000) {
  return createBenefit(h.db, {
    companyId,
    opportunityId,
    type: 'SAVING',
    stage: 'THEORETICAL',
    forecastValue: forecast,
    realisedValue: 0,
    verifiedValue: 0,
    measurementPeriod: null,
    baseline: null,
    measurementMethod: 'test × formula',
    evidence: [],
    confidence: 0.6,
    attributedCapabilities: [],
  });
}

async function withCompany() {
  const h = harness();
  const fixture = SYNTHETIC_COMPANIES[0]!;
  seedCustomer(h, 'c1', fixture.name, fixture.domain);
  const result = await analyseCompany(h.db, fixture.domain, {
    customerId: 'c1', offline: true, seedRecords: fixture.records, userSupplied: fixture.userSupplied,
  });
  return { h, result };
}

describe('benefits ledger', () => {
  it('opens every identified opportunity as theoretical', async () => {
    const { h, result } = await withCompany();
    const benefits = listBenefits(h.db);
    expect(benefits).toHaveLength(result.opportunities.length);
    expect(benefits.every((b) => b.stage === 'THEORETICAL')).toBe(true);
    expect(benefits.every((b) => b.realisedValue === 0)).toBe(true);
  });

  it('advances forward through the stages', async () => {
    const { h, result } = await withCompany();
    let benefit = getBenefitByOpportunity(h.db, result.opportunities[0]!.id)!;

    benefit = advance(h.db, benefit, 'APPROVED');
    expect(benefit.stage).toBe('APPROVED');
    benefit = advance(h.db, benefit, 'FORECAST', { forecastValue: 50_000 });
    expect(benefit.forecastValue).toBe(50_000);
    benefit = advance(h.db, benefit, 'REALISED', { realisedValue: 42_000, attributedCapabilities: ['buyonic'] });
    expect(benefit.realisedValue).toBe(42_000);
    expect(benefit.attributedCapabilities).toContain('buyonic');
  });

  it('refuses to move a benefit backwards', async () => {
    const { h, result } = await withCompany();
    const benefit = advance(h.db, getBenefitByOpportunity(h.db, result.opportunities[0]!.id)!, 'REALISED', { realisedValue: 10 });
    expect(() => advance(h.db, benefit, 'THEORETICAL')).toThrow(BenefitStageError);
    expect(() => advance(h.db, benefit, 'APPROVED')).toThrow(BenefitStageError);
  });

  it('refuses to verify a benefit with no verified value', async () => {
    const { h, result } = await withCompany();
    const benefit = advance(h.db, getBenefitByOpportunity(h.db, result.opportunities[0]!.id)!, 'REALISED', { realisedValue: 10_000 });
    expect(() => advance(h.db, benefit, 'VERIFIED')).toThrow(/cannot be VERIFIED without a verified value/);
    expect(() => advance(h.db, benefit, 'VERIFIED', { verifiedValue: 9_500 })).not.toThrow();
  });

  it('accumulates evidence rather than replacing it', async () => {
    const { h, result } = await withCompany();
    let benefit = getBenefitByOpportunity(h.db, result.opportunities[0]!.id)!;
    const before = benefit.evidence.length;
    benefit = advance(h.db, benefit, 'APPROVED', {
      evidence: [{ statement: 'new', epistemics: 'fact', confidence: 1, sources: [] }],
    });
    expect(benefit.evidence).toHaveLength(before + 1);
  });

  it('answers the six ledger questions', () => {
    const h = harness();
    h.raw.prepare(`INSERT INTO company_twins (id,tenant_id,display_name,understanding,twin_json,created_at,last_updated_at) VALUES ('co','tenant-a','Co',10,'{}','x','x')`).run();
    h.raw.prepare(`INSERT INTO opportunities (id,tenant_id,company_id,category,subcategory,title,estimated_annual_value,implementation_cost,confidence,effort,risk,time_to_value,execution_readiness,execution_status,score,opportunity_json,created_at) VALUES ('o1','tenant-a','co','SPEND_LESS','x','X',100,0,0.5,0.5,'low',30,0.5,'NOT_STARTED',1,'{}','x')`).run();
    h.raw.prepare(`INSERT INTO opportunities (id,tenant_id,company_id,category,subcategory,title,estimated_annual_value,implementation_cost,confidence,effort,risk,time_to_value,execution_readiness,execution_status,score,opportunity_json,created_at) VALUES ('o2','tenant-a','co','SPEND_LESS','x','X',100,0,0.5,0.5,'low',30,0.5,'NOT_STARTED',1,'{}','x')`).run();

    const a = seedBenefit(h, 'co', 'o1', 100_000);
    const b = seedBenefit(h, 'co', 'o2', 40_000);
    advance(h.db, a, 'REALISED', { realisedValue: 60_000, attributedCapabilities: ['buyonic'] });
    advance(h.db, b, 'FORECAST');

    const summary = summariseLedger(listBenefits(h.db));
    expect(summary.identified).toBe(140_000);
    expect(summary.approved).toBe(140_000);
    expect(summary.executing).toBe(40_000);
    expect(summary.realised).toBe(60_000);
    expect(summary.verified).toBe(0);
    expect(summary.byCapability[0]).toEqual({ capabilityId: 'buyonic', value: 60_000 });
  });

  it('orders the stages as the directive defines them', () => {
    expect(STAGE_ORDER).toEqual(['THEORETICAL', 'APPROVED', 'FORECAST', 'COMMITTED', 'REALISED', 'VERIFIED']);
  });
});
