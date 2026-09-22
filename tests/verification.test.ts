/**
 * Verification — iteration 2 priority 5.
 *
 * "No benefit has ever reached VERIFIED, because verification requires a
 * connected system of record." These tests close that loop, and hold the line
 * that simulated value must never claim to be verified.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { TenantDb } from '@/lib/db/tenant';
import { captureBaseline, getBaseline, baselineKindFor } from '@/lib/verification/baseline';
import { verifyPlan } from '@/lib/verification/verify';
import { putFacts } from '@/lib/db/repositories/facts';
import { createBenefit, getBenefitByOpportunity, advance } from '@/lib/benefits/ledger';
import type { ExecutionPlan } from '@/lib/execution/types';
import type { LicenceFacts } from '@/lib/discovery/microsoft365-connector';

let db: Database;
let tdb: TenantDb;

const PLAN = {
  id: 'plan-1',
  tenantId: 't1',
  companyId: 'co1',
  opportunityId: 'opp-1',
  playbookId: 'microsoft-licence-optimisation',
} as ExecutionPlan;

function licenceFacts(overrides: Partial<LicenceFacts> = {}): LicenceFacts {
  return {
    totalUsers: 60,
    enabledUsers: 55,
    licensedUsers: 50,
    licensedDisabledUsers: 6,
    dormantLicensedUsers: 4,
    skus: [{ skuPartNumber: 'SPB', name: 'Business Premium', purchased: 60, assigned: 50, unassigned: 10, monthlyUnitCostGbp: 18.6, unassignedAnnualCostGbp: 2232 }],
    annualLicenceCostGbp: 11_160,
    recoverableAnnualGbp: 4_464,
    retrievedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  db = createTestDb();
  db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t1', 'T1', 'MSP', '2026-01-01')`).run();
  db.prepare(`INSERT INTO company_twins (id, tenant_id, display_name, understanding, twin_json, created_at, last_updated_at) VALUES ('co1','t1','Acme',40,'{}','x','x')`).run();
  db.prepare(
    `INSERT INTO opportunities (id,tenant_id,company_id,category,subcategory,title,estimated_annual_value,implementation_cost,confidence,effort,risk,time_to_value,execution_readiness,execution_status,score,opportunity_json,created_at)
     VALUES ('opp-1','t1','co1','SPEND_LESS','Microsoft licences','M365',4464,1800,0.92,0.2,'low',30,0.95,'NOT_STARTED',70,'{}','x')`,
  ).run();
  tdb = new TenantDb({ tenantId: 't1', userId: 'u1', role: 'MSP_ADMIN' }, db);

  createBenefit(tdb, {
    companyId: 'co1', opportunityId: 'opp-1', type: 'SAVING', stage: 'THEORETICAL',
    forecastValue: 4_464, realisedValue: 0, verifiedValue: 0, measurementPeriod: null, baseline: null,
    measurementMethod: 'counted', evidence: [], confidence: 0.92, attributedCapabilities: [],
  });
});

describe('baseline capture', () => {
  it('knows which playbooks can be verified and which cannot', () => {
    expect(baselineKindFor('microsoft-licence-optimisation')).toBe('licence');
    expect(baselineKindFor('saas-rationalisation')).toBe('financial');
    // Pipeline generation has no system of record to check against.
    expect(baselineKindFor('pipeline-generation')).toBeNull();
    expect(baselineKindFor(null)).toBeNull();
  });

  it('captures nothing when no system of record is connected', () => {
    expect(captureBaseline(tdb, PLAN, PLAN.playbookId, 90)).toBeNull();
  });

  it('captures the counted figures as they stood before execution', () => {
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts());
    const baseline = captureBaseline(tdb, PLAN, PLAN.playbookId, 30)!;

    expect(baseline.kind).toBe('licence');
    expect(baseline.facts.licence!.annualLicenceCostGbp).toBe(11_160);
    expect(new Date(baseline.verifyAfter).getTime()).toBeGreaterThan(Date.now());
    expect(getBaseline(tdb, 'plan-1')!.id).toBe(baseline.id);
  });
});

describe('verification', () => {
  it('refuses to verify with no baseline', () => {
    const result = verifyPlan(tdb, 'plan-1', 'tester');
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('no-baseline');
  });

  it('verifies a real reduction against the tenant', () => {
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts());
    captureBaseline(tdb, PLAN, PLAN.playbookId, 0);

    const benefit = getBenefitByOpportunity(tdb, 'opp-1')!;
    advance(tdb, advance(tdb, benefit, 'APPROVED'), 'REALISED', { realisedValue: 4_000 });

    // The reclaim happened: 16 seats gone, bill down.
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts({
      licensedUsers: 34,
      licensedDisabledUsers: 0,
      dormantLicensedUsers: 0,
      skus: [{ skuPartNumber: 'SPB', name: 'Business Premium', purchased: 40, assigned: 34, unassigned: 6, monthlyUnitCostGbp: 18.6, unassignedAnnualCostGbp: 1339 }],
      annualLicenceCostGbp: 7_589,
      recoverableAnnualGbp: 1_339,
    }));

    const result = verifyPlan(tdb, 'plan-1', 'tester');

    expect(result.verified).toBe(true);
    expect(result.verifiedValue).toBe(11_160 - 7_589);
    expect(result.narrative).toMatch(/verified saving/);
    expect(result.narrative).toMatch(/16 reclaimed seat/);
    expect(result.benefit!.stage).toBe('VERIFIED');
    expect(result.benefit!.verifiedValue).toBe(3_571);
  });

  it('verifies nothing when the cost did not move', () => {
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts());
    captureBaseline(tdb, PLAN, PLAN.playbookId, 0);

    const result = verifyPlan(tdb, 'plan-1', 'tester');
    expect(result.verified).toBe(false);
    expect(result.verifiedValue).toBe(0);
    expect(result.narrative).toMatch(/unchanged/);
    expect(getBenefitByOpportunity(tdb, 'opp-1')!.stage).not.toBe('VERIFIED');
  });

  it('reports a cost that moved the wrong way rather than flooring it at zero', () => {
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts());
    captureBaseline(tdb, PLAN, PLAN.playbookId, 0);
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts({ annualLicenceCostGbp: 13_000 }));

    const result = verifyPlan(tdb, 'plan-1', 'tester');
    expect(result.verified).toBe(false);
    expect(result.narrative).toMatch(/rose by £1,840/);
    expect(result.narrative).toMatch(/Nothing is verified/);
  });

  it('is retryable rather than final when the system of record is unreachable', () => {
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts());
    captureBaseline(tdb, PLAN, PLAN.playbookId, 0);
    db.prepare(`DELETE FROM connected_facts WHERE tenant_id = 't1'`).run();

    const result = verifyPlan(tdb, 'plan-1', 'tester');
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('source-unavailable');
  });

  it('does not verify twice', () => {
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts());
    captureBaseline(tdb, PLAN, PLAN.playbookId, 0);
    const benefit = getBenefitByOpportunity(tdb, 'opp-1')!;
    advance(tdb, advance(tdb, benefit, 'APPROVED'), 'REALISED', { realisedValue: 4_000 });
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts({ annualLicenceCostGbp: 9_000 }));

    const first = verifyPlan(tdb, 'plan-1', 'tester');
    expect(first.verified).toBe(true);

    const second = verifyPlan(tdb, 'plan-1', 'tester');
    expect(second.reason).toBe('already-verified');
    expect(second.verifiedValue).toBe(first.verifiedValue);
  });

  it('writes the comparison to the append-only audit log', () => {
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts());
    captureBaseline(tdb, PLAN, PLAN.playbookId, 0);
    putFacts(tdb, 'co1', 'licence', 'microsoft-365', licenceFacts({ annualLicenceCostGbp: 9_000 }));
    verifyPlan(tdb, 'plan-1', 'tester');

    const row = db.prepare(`SELECT action, detail_json FROM audit_log WHERE action = 'benefit.verified'`).get() as
      | { action: string; detail_json: string }
      | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row!.detail_json).verifiedValue).toBe(2_160);
  });
});
