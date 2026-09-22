/**
 * Verification — iteration 2 priority 5.
 *
 * No benefit in iteration 1 ever reached VERIFIED, because verification needs a
 * system of record to check against. With Microsoft 365 or accounting
 * connected, it now can: a baseline is captured before execution, and after the
 * measurement window the same figures are re-read and compared.
 *
 * This is what makes an automation-rate number defensible in a QBR — the value
 * is traceable to specific seats reclaimed or specific spend that stopped.
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import { getFacts, type ConnectedFacts } from '../db/repositories/facts';
import type { ExecutionPlan } from '../execution/types';

export type BaselineKind = 'licence' | 'financial';

export interface Baseline {
  id: string;
  companyId: string;
  opportunityId: string;
  executionPlanId: string;
  kind: BaselineKind;
  /** The counted figures as they stood before execution. */
  facts: ConnectedFacts;
  capturedAt: string;
  verifyAfter: string;
  verifiedAt: string | null;
  verifiedValue: number | null;
  outcome: string | null;
}

/** Which connected system, if any, can prove this opportunity's value. */
export function baselineKindFor(playbookId: string | null): BaselineKind | null {
  if (!playbookId) return null;
  if (playbookId === 'microsoft-licence-optimisation') return 'licence';
  if (['saas-rationalisation', 'supplier-consolidation', 'contract-renewal', 'procurement-event'].includes(playbookId)) {
    return 'financial';
  }
  return null;
}

export function captureBaseline(
  db: TenantDb,
  plan: ExecutionPlan,
  playbookId: string | null,
  measurementWindowDays: number,
): Baseline | null {
  const kind = baselineKindFor(playbookId);
  if (!kind) return null;

  const facts = getFacts(db, plan.companyId);
  // Nothing to measure against: the opportunity can still execute, but its
  // value will stay REALISED rather than becoming VERIFIED, and the ledger
  // says so rather than implying proof that does not exist.
  if (kind === 'licence' && !facts.licence) return null;
  if (kind === 'financial' && !facts.financial) return null;

  const capturedAt = new Date();
  const verifyAfter = new Date(capturedAt.getTime() + measurementWindowDays * 86_400_000);

  const baseline: Baseline = {
    id: randomUUID(),
    companyId: plan.companyId,
    opportunityId: plan.opportunityId,
    executionPlanId: plan.id,
    kind,
    facts,
    capturedAt: capturedAt.toISOString(),
    verifyAfter: verifyAfter.toISOString(),
    verifiedAt: null,
    verifiedValue: null,
    outcome: null,
  };

  db.run(
    `INSERT INTO verification_baselines
       (id, tenant_id, company_id, opportunity_id, execution_plan_id, kind, baseline_json, captured_at, verify_after)
     VALUES (@id, @tenantId, @companyId, @opportunityId, @planId, @kind, @baselineJson, @capturedAt, @verifyAfter)
     ON CONFLICT(tenant_id, execution_plan_id) DO NOTHING`,
    {
      id: baseline.id,
      companyId: baseline.companyId,
      opportunityId: baseline.opportunityId,
      planId: baseline.executionPlanId,
      kind,
      baselineJson: JSON.stringify(facts),
      capturedAt: baseline.capturedAt,
      verifyAfter: baseline.verifyAfter,
    },
  );

  return baseline;
}

export function getBaseline(db: TenantDb, executionPlanId: string): Baseline | null {
  const row = db.get<{
    id: string; company_id: string; opportunity_id: string; execution_plan_id: string;
    kind: string; baseline_json: string; captured_at: string; verify_after: string;
    verified_at: string | null; verified_value: number | null; outcome: string | null;
  }>(
    `SELECT * FROM verification_baselines WHERE tenant_id = @tenantId AND execution_plan_id = @planId`,
    { planId: executionPlanId },
  );
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    opportunityId: row.opportunity_id,
    executionPlanId: row.execution_plan_id,
    kind: row.kind as BaselineKind,
    facts: JSON.parse(row.baseline_json) as ConnectedFacts,
    capturedAt: row.captured_at,
    verifyAfter: row.verify_after,
    verifiedAt: row.verified_at,
    verifiedValue: row.verified_value,
    outcome: row.outcome,
  };
}

export function recordVerification(db: TenantDb, id: string, verifiedValue: number, outcome: string): void {
  db.run(
    `UPDATE verification_baselines
     SET verified_at = @at, verified_value = @value, outcome = @outcome
     WHERE tenant_id = @tenantId AND id = @id`,
    { id, at: new Date().toISOString(), value: verifiedValue, outcome },
  );
}

export function listBaselines(db: TenantDb, companyId?: string): Baseline[] {
  const rows = db.all<{ execution_plan_id: string }>(
    companyId
      ? `SELECT execution_plan_id FROM verification_baselines WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY captured_at DESC`
      : `SELECT execution_plan_id FROM verification_baselines WHERE tenant_id = @tenantId ORDER BY captured_at DESC`,
    companyId ? { companyId } : {},
  );
  return rows.map((r) => getBaseline(db, r.execution_plan_id)!).filter(Boolean);
}
