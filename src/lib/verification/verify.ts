/**
 * Comparing a baseline against the system of record.
 *
 * The comparison is deliberately conservative. A saving is only counted where
 * the connected system shows the cost actually fell, and a figure that moved
 * the wrong way is reported as such rather than floored at zero and forgotten —
 * an MSP needs to know when an executed change did not land.
 */

import type { TenantDb } from '../db/tenant';
import { getFacts } from '../db/repositories/facts';
import { advance, getBenefitByOpportunity, type Benefit } from '../benefits/ledger';
import { audit } from '../observability/events';
import { getBaseline, recordVerification, type Baseline } from './baseline';

export interface VerificationResult {
  verified: boolean;
  verifiedValue: number;
  /** What was compared, in the language of the system of record. */
  narrative: string;
  lines: { label: string; before: number; after: number; delta: number }[];
  benefit: Benefit | null;
  reason?: string;
}

export function verifyPlan(db: TenantDb, executionPlanId: string, actor: string): VerificationResult {
  const baseline = getBaseline(db, executionPlanId);
  if (!baseline) {
    return {
      verified: false,
      verifiedValue: 0,
      narrative: 'No baseline was captured for this execution, so there is nothing to verify against.',
      lines: [],
      benefit: null,
      reason: 'no-baseline',
    };
  }

  if (baseline.verifiedAt) {
    return {
      verified: true,
      verifiedValue: baseline.verifiedValue ?? 0,
      narrative: baseline.outcome ?? 'Already verified.',
      lines: [],
      benefit: getBenefitByOpportunity(db, baseline.opportunityId),
      reason: 'already-verified',
    };
  }

  const current = getFacts(db, baseline.companyId);
  const comparison =
    baseline.kind === 'licence' ? compareLicence(baseline, current) : compareFinancial(baseline, current);

  if (!comparison) {
    return {
      verified: false,
      verifiedValue: 0,
      narrative:
        'The connected system that captured the baseline is no longer returning data, so the change cannot be ' +
        'proved. Reconnect it and verify again.',
      lines: [],
      benefit: getBenefitByOpportunity(db, baseline.opportunityId),
      reason: 'source-unavailable',
    };
  }

  const benefit = getBenefitByOpportunity(db, baseline.opportunityId);
  const verifiedValue = Math.max(0, comparison.delta);

  recordVerification(db, baseline.id, verifiedValue, comparison.narrative);

  audit(db, {
    actor,
    actorKind: 'system',
    action: 'benefit.verified',
    subjectType: 'execution_plan',
    subjectId: executionPlanId,
    detail: {
      kind: baseline.kind,
      verifiedValue,
      lines: comparison.lines,
      capturedAt: baseline.capturedAt,
    },
  });

  let updated = benefit;
  if (benefit && verifiedValue > 0) {
    updated = advance(db, benefit, 'VERIFIED', {
      verifiedValue,
      evidence: [
        {
          statement: comparison.narrative,
          epistemics: 'fact',
          confidence: 0.95,
          sources: [
            {
              connectorId: baseline.kind === 'licence' ? 'microsoft-365' : 'accounting',
              label: baseline.kind === 'licence' ? 'Microsoft 365 tenant' : 'Accounting ledger',
              retrievedAt: new Date().toISOString(),
            },
          ],
        },
      ],
    });
  }

  return {
    verified: verifiedValue > 0,
    verifiedValue,
    narrative: comparison.narrative,
    lines: comparison.lines,
    benefit: updated,
    ...(verifiedValue === 0 ? { reason: 'no-change-measured' } : {}),
  };
}

interface Comparison {
  delta: number;
  narrative: string;
  lines: { label: string; before: number; after: number; delta: number }[];
}

function compareLicence(baseline: Baseline, current: ReturnType<typeof getFacts>): Comparison | null {
  const before = baseline.facts.licence;
  const after = current.licence;
  if (!before || !after) return null;

  const lines = [
    { label: 'Annual licence cost', before: before.annualLicenceCostGbp, after: after.annualLicenceCostGbp, delta: before.annualLicenceCostGbp - after.annualLicenceCostGbp },
    { label: 'Licensed users', before: before.licensedUsers, after: after.licensedUsers, delta: before.licensedUsers - after.licensedUsers },
    { label: 'Unassigned seats', before: before.skus.reduce((s, x) => s + x.unassigned, 0), after: after.skus.reduce((s, x) => s + x.unassigned, 0), delta: before.skus.reduce((s, x) => s + x.unassigned, 0) - after.skus.reduce((s, x) => s + x.unassigned, 0) },
    { label: 'Leavers still licensed', before: before.licensedDisabledUsers, after: after.licensedDisabledUsers, delta: before.licensedDisabledUsers - after.licensedDisabledUsers },
  ];

  const costDelta = lines[0]!.delta;
  const seatsReclaimed = lines[1]!.delta;

  const narrative =
    costDelta > 0
      ? `Annual licence cost fell from £${before.annualLicenceCostGbp.toLocaleString('en-GB')} to £${after.annualLicenceCostGbp.toLocaleString('en-GB')}, ` +
        `a verified saving of £${costDelta.toLocaleString('en-GB')} across ${seatsReclaimed} reclaimed seat(s), measured against the tenant.`
      : costDelta === 0
        ? 'Licence cost is unchanged against the baseline. Nothing is verified, and the realised figure stands as modelled only.'
        : `Licence cost rose by £${Math.abs(costDelta).toLocaleString('en-GB')} against the baseline — the estate grew rather than shrank. Nothing is verified.`;

  return { delta: costDelta, narrative, lines };
}

function compareFinancial(baseline: Baseline, current: ReturnType<typeof getFacts>): Comparison | null {
  const before = baseline.facts.financial;
  const after = current.financial;
  if (!before || !after) return null;

  const beforeSoftware = before.softwareSubscriptions.reduce((s, x) => s + x.annualSpend, 0);
  const afterSoftware = after.softwareSubscriptions.reduce((s, x) => s + x.annualSpend, 0);
  const beforeSuppliers = before.supplierSpend.reduce((s, x) => s + x.annualSpend, 0);
  const afterSuppliers = after.supplierSpend.reduce((s, x) => s + x.annualSpend, 0);

  const lines = [
    { label: 'Software spend', before: beforeSoftware, after: afterSoftware, delta: beforeSoftware - afterSoftware },
    { label: 'Total supplier spend', before: beforeSuppliers, after: afterSuppliers, delta: beforeSuppliers - afterSuppliers },
    { label: 'Supplier count', before: before.supplierSpend.length, after: after.supplierSpend.length, delta: before.supplierSpend.length - after.supplierSpend.length },
  ];

  const delta = lines[0]!.delta > 0 ? lines[0]!.delta : lines[1]!.delta;

  const narrative =
    delta > 0
      ? `Supplier spend fell by £${delta.toLocaleString('en-GB')} against the baseline captured on ${baseline.capturedAt.slice(0, 10)}, ` +
        `with ${Math.max(0, lines[2]!.delta)} fewer supplier(s) invoicing. Measured from the ledger.`
      : delta === 0
        ? 'Supplier spend is unchanged against the baseline. Nothing is verified.'
        : `Supplier spend rose by £${Math.abs(delta).toLocaleString('en-GB')} against the baseline. Nothing is verified.`;

  return { delta, narrative, lines };
}
