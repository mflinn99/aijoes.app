/**
 * Benefits Ledger — Directive §16.
 *
 * "The system must distinguish: theoretical value, approved value, forecast
 * value, committed value, realised value, verified realised value."
 *
 * The stages are a one-way ratchet with a named transition each time, because
 * the number an MSP quotes in a QBR has to be traceable to the stage it is
 * actually at. Simulated capability outcomes can reach REALISED but never
 * VERIFIED — verification requires evidence from a connected system.
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import type { EvidenceItem } from '../core/opportunity';

export type BenefitType = 'REVENUE' | 'SAVING' | 'MARGIN' | 'MRR' | 'ARR' | 'PRODUCTIVITY';

export type BenefitStage =
  | 'THEORETICAL'
  | 'APPROVED'
  | 'FORECAST'
  | 'COMMITTED'
  | 'REALISED'
  | 'VERIFIED';

export const STAGE_ORDER: BenefitStage[] = [
  'THEORETICAL',
  'APPROVED',
  'FORECAST',
  'COMMITTED',
  'REALISED',
  'VERIFIED',
];

export const STAGE_DESCRIPTIONS: Record<BenefitStage, string> = {
  THEORETICAL: 'Identified by analysis. Nobody has agreed to pursue it.',
  APPROVED: 'A human has authorised execution.',
  FORECAST: 'Execution is under way and the plan projects this value.',
  COMMITTED: 'A customer or supplier commitment exists.',
  REALISED: 'Execution reported the value as delivered.',
  VERIFIED: 'Confirmed against a connected system of record.',
};

export interface Benefit {
  id: string;
  tenantId: string;
  companyId: string;
  opportunityId: string;
  type: BenefitType;
  stage: BenefitStage;
  forecastValue: number;
  realisedValue: number;
  verifiedValue: number;
  measurementPeriod: string | null;
  baseline: number | null;
  measurementMethod: string;
  evidence: EvidenceItem[];
  confidence: number;
  /** Which capability produced the value, for §16's "which capabilities created the value?" */
  attributedCapabilities: string[];
  createdAt: string;
  updatedAt: string;
}

export class BenefitStageError extends Error {}

/**
 * Open a benefit for an opportunity, or refresh the existing one.
 *
 * Re-analysis re-derives every opportunity, so this must not accumulate a new
 * benefit row per run. An existing benefit that is still THEORETICAL is updated
 * in place; one that has advanced is left exactly as it is, because its stage
 * and realised value are a record of what happened, not a projection to be
 * recalculated.
 */
export function createBenefit(
  db: TenantDb,
  input: Omit<Benefit, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
): Benefit {
  const now = new Date().toISOString();
  const existing = getBenefitByOpportunity(db, input.opportunityId);

  if (existing) {
    if (existing.stage !== 'THEORETICAL') return existing;
    const refreshed: Benefit = { ...existing, ...input, id: existing.id, tenantId: existing.tenantId, createdAt: existing.createdAt, updatedAt: now };
    persist(db, refreshed);
    return refreshed;
  }

  const benefit: Benefit = {
    id: randomUUID(),
    tenantId: db.ctx.tenantId,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  persist(db, benefit);
  return benefit;
}

function persist(db: TenantDb, b: Benefit): void {
  db.run(
    `INSERT INTO benefits
       (id, tenant_id, company_id, opportunity_id, type, stage, forecast_value, realised_value,
        verified_value, measurement_period, benefit_json, created_at, updated_at)
     VALUES
       (@id, @tenantId, @companyId, @opportunityId, @type, @stage, @forecastValue, @realisedValue,
        @verifiedValue, @measurementPeriod, @benefitJson, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       stage = @stage, forecast_value = @forecastValue, realised_value = @realisedValue,
       verified_value = @verifiedValue, benefit_json = @benefitJson, updated_at = @updatedAt`,
    {
      id: b.id,
      companyId: b.companyId,
      opportunityId: b.opportunityId,
      type: b.type,
      stage: b.stage,
      forecastValue: b.forecastValue,
      realisedValue: b.realisedValue,
      verifiedValue: b.verifiedValue,
      measurementPeriod: b.measurementPeriod,
      benefitJson: JSON.stringify(b),
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    },
  );
}

/**
 * Stages only move forward. Attempting to move a REALISED benefit back to
 * THEORETICAL is a bug in the caller, and silently allowing it would corrupt
 * every number the MSP reports.
 */
export function advance(
  db: TenantDb,
  benefit: Benefit,
  stage: BenefitStage,
  update: Partial<Pick<Benefit, 'forecastValue' | 'realisedValue' | 'verifiedValue' | 'evidence' | 'confidence' | 'attributedCapabilities' | 'measurementPeriod'>> = {},
): Benefit {
  const from = STAGE_ORDER.indexOf(benefit.stage);
  const to = STAGE_ORDER.indexOf(stage);
  if (to < from) {
    throw new BenefitStageError(`Cannot move a benefit backwards from ${benefit.stage} to ${stage}.`);
  }
  if (stage === 'VERIFIED' && (update.verifiedValue ?? benefit.verifiedValue) <= 0) {
    throw new BenefitStageError('A benefit cannot be VERIFIED without a verified value.');
  }

  const next: Benefit = {
    ...benefit,
    ...update,
    evidence: update.evidence ? [...benefit.evidence, ...update.evidence] : benefit.evidence,
    attributedCapabilities: update.attributedCapabilities
      ? [...new Set([...benefit.attributedCapabilities, ...update.attributedCapabilities])]
      : benefit.attributedCapabilities,
    stage,
    updatedAt: new Date().toISOString(),
  };
  persist(db, next);
  return next;
}

/**
 * Ensure a benefit has reached at least `stage`, without ever moving it back.
 *
 * `advance` stays strict, because an explicit backwards transition is a bug
 * worth throwing on. But a caller that means "this has now been approved"
 * should not fail when the benefit has already gone further — re-authorising a
 * plan for an opportunity that was executed before is an ordinary thing to do,
 * not an error.
 */
export function advanceAtLeast(
  db: TenantDb,
  benefit: Benefit,
  stage: BenefitStage,
  update: Parameters<typeof advance>[3] = {},
): Benefit {
  if (STAGE_ORDER.indexOf(benefit.stage) >= STAGE_ORDER.indexOf(stage)) return benefit;
  return advance(db, benefit, stage, update);
}

export function listBenefits(db: TenantDb, companyId?: string): Benefit[] {
  const rows = db.all<{ benefit_json: string }>(
    companyId
      ? `SELECT benefit_json FROM benefits WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY updated_at DESC`
      : `SELECT benefit_json FROM benefits WHERE tenant_id = @tenantId ORDER BY updated_at DESC`,
    companyId ? { companyId } : {},
  );
  return rows.map((r) => JSON.parse(r.benefit_json) as Benefit);
}

export function getBenefitByOpportunity(db: TenantDb, opportunityId: string): Benefit | null {
  const row = db.get<{ benefit_json: string }>(
    `SELECT benefit_json FROM benefits WHERE tenant_id = @tenantId AND opportunity_id = @opportunityId LIMIT 1`,
    { opportunityId },
  );
  return row ? (JSON.parse(row.benefit_json) as Benefit) : null;
}

export interface LedgerSummary {
  identified: number;
  approved: number;
  executing: number;
  realised: number;
  verified: number;
  byStage: Record<BenefitStage, number>;
  byType: Record<string, number>;
  byCapability: { capabilityId: string; value: number }[];
}

/** Directive §16: the six questions the ledger must answer. */
export function summariseLedger(benefits: Benefit[]): LedgerSummary {
  const byStage = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<BenefitStage, number>;
  const byType: Record<string, number> = {};
  const capability = new Map<string, number>();

  for (const b of benefits) {
    const headline = b.stage === 'VERIFIED' ? b.verifiedValue : b.stage === 'REALISED' ? b.realisedValue : b.forecastValue;
    byStage[b.stage] += headline;
    byType[b.type] = (byType[b.type] ?? 0) + headline;
    for (const cap of b.attributedCapabilities) {
      capability.set(cap, (capability.get(cap) ?? 0) + (b.realisedValue || 0));
    }
  }

  return {
    identified: benefits.reduce((s, b) => s + b.forecastValue, 0),
    approved: benefits.filter((b) => STAGE_ORDER.indexOf(b.stage) >= STAGE_ORDER.indexOf('APPROVED')).reduce((s, b) => s + b.forecastValue, 0),
    executing: benefits.filter((b) => b.stage === 'FORECAST' || b.stage === 'COMMITTED').reduce((s, b) => s + b.forecastValue, 0),
    realised: benefits.reduce((s, b) => s + b.realisedValue, 0),
    verified: benefits.reduce((s, b) => s + b.verifiedValue, 0),
    byStage,
    byType,
    byCapability: [...capability.entries()]
      .map(([capabilityId, value]) => ({ capabilityId, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value),
  };
}
