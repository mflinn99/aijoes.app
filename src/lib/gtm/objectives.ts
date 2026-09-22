/**
 * Commercial objectives — Directive 02 Phase 11.
 *
 * The directive states targets and then says "TARGETS SHOULD BE CONFIGURABLE,
 * NOT HARD-CODED". So they live in a table, seeded with the directive's numbers,
 * and the engine reports progress against whatever is configured rather than
 * against what it happens to have achieved.
 *
 * The one rule that matters here: progress is counted from the same tables the
 * pipeline uses, never from a separate tally the engine increments itself. A
 * counter the engine controls is a number the engine can be wrong about
 * indefinitely.
 */

import type { TenantDb } from '../db/tenant';
import { countAccounts, listHypotheses, listMeetings, listOpportunities } from './store';

export type ObjectiveKey =
  | 'accounts-researched'
  | 'hypotheses-evidence-backed'
  | 'opportunities-qualified'
  | 'meetings-booked'
  | 'weighted-pipeline-gbp';

export interface ObjectiveDefinition {
  key: ObjectiveKey;
  label: string;
  /** The directive's stated target, used only as the seed value. */
  defaultTarget: number;
  unit: 'count' | 'gbp';
  /** What exactly is counted, so a disputed number can be settled. */
  countedAs: string;
}

export const OBJECTIVES: ObjectiveDefinition[] = [
  {
    key: 'accounts-researched',
    label: 'Accounts researched to a usable standard',
    defaultTarget: 250,
    unit: 'count',
    countedAs: 'Non-synthetic accounts whose research state is "researched".',
  },
  {
    key: 'hypotheses-evidence-backed',
    label: 'Evidence-backed opportunity hypotheses',
    defaultTarget: 50,
    unit: 'count',
    countedAs: 'Hypotheses of quality strong or workable — meaning they cleared every rejection threshold, including at least two independent evidence items.',
  },
  {
    key: 'opportunities-qualified',
    label: 'Qualified opportunities',
    defaultTarget: 20,
    unit: 'count',
    countedAs: 'Opportunities at stage qualified, proposal or won.',
  },
  {
    key: 'meetings-booked',
    label: 'Meetings booked with target accounts',
    defaultTarget: 10,
    unit: 'count',
    countedAs: 'Meeting records with status booked or held against a non-synthetic account.',
  },
  {
    key: 'weighted-pipeline-gbp',
    label: 'Weighted professional services pipeline',
    defaultTarget: 500_000,
    unit: 'gbp',
    countedAs: 'Sum of value × stage probability across open opportunities. Won deals count at full value; lost deals count at nothing.',
  },
];

export interface ObjectiveProgress {
  key: ObjectiveKey;
  label: string;
  unit: 'count' | 'gbp';
  target: number;
  actual: number;
  /** 0..1, uncapped is misleading so it is capped at 1 for display and reported separately. */
  fraction: number;
  met: boolean;
  countedAs: string;
  /** Why the number is what it is — including when it is zero because of a blocker. */
  note: string | null;
}

export function getTargets(db: TenantDb, mspId: string): Record<ObjectiveKey, number> {
  const rows = db.all<{ key: string; target: number }>(
    `SELECT key, target FROM gtm_objectives WHERE tenant_id = @tenantId AND msp_id = @mspId`,
    { mspId },
  );
  const configured = new Map(rows.map((r) => [r.key, r.target]));
  const out = {} as Record<ObjectiveKey, number>;
  for (const def of OBJECTIVES) out[def.key] = configured.get(def.key) ?? def.defaultTarget;
  return out;
}

export function setTarget(db: TenantDb, mspId: string, key: ObjectiveKey, target: number): void {
  db.run(
    `INSERT INTO gtm_objectives (tenant_id, msp_id, key, target, updated_at)
     VALUES (@tenantId, @mspId, @key, @target, @now)
     ON CONFLICT (tenant_id, msp_id, key) DO UPDATE SET target = @target, updated_at = @now`,
    { mspId, key, target, now: new Date().toISOString() },
  );
}

/** Seed the directive's numbers. Idempotent — an edited target is never overwritten. */
export function seedObjectives(db: TenantDb, mspId: string): void {
  for (const def of OBJECTIVES) {
    db.run(
      `INSERT INTO gtm_objectives (tenant_id, msp_id, key, target, updated_at)
       VALUES (@tenantId, @mspId, @key, @target, @now)
       ON CONFLICT (tenant_id, msp_id, key) DO NOTHING`,
      { mspId, key: def.key, target: def.defaultTarget, now: new Date().toISOString() },
    );
  }
}

export interface ObjectivesReport {
  mspId: string;
  progress: ObjectiveProgress[];
  /** True only when every objective is met. */
  allMet: boolean;
  /** The objective furthest from target — where the effort should go. */
  worst: ObjectiveKey | null;
  generatedAt: string;
}

/**
 * Count progress. `excludeSynthetic` defaults to true because a target met with
 * accounts the engine invented is not met.
 */
export function measureObjectives(
  db: TenantDb,
  mspId: string,
  opts: { excludeSynthetic?: boolean; notes?: Partial<Record<ObjectiveKey, string>> } = {},
): ObjectivesReport {
  const excludeSynthetic = opts.excludeSynthetic ?? true;
  const targets = getTargets(db, mspId);

  const researched = excludeSynthetic
    ? countAccounts(db, mspId, { researchState: 'researched', synthetic: false })
    : countAccounts(db, mspId, { researchState: 'researched' });

  const hypotheses = listHypotheses(db, { limit: 5000 }).filter((h) => h.quality === 'strong' || h.quality === 'workable');

  const opportunities = listOpportunities(db, { limit: 5000 });
  const qualified = opportunities.filter((o) => ['qualified', 'proposal', 'won'].includes(o.stage)).length;
  const weighted = opportunities
    .filter((o) => o.stage !== 'lost')
    .reduce((s, o) => s + o.weightedGbp, 0);

  const meetings = listMeetings(db).filter((m) => m.status === 'booked' || m.status === 'held').length;

  const actuals: Record<ObjectiveKey, number> = {
    'accounts-researched': researched,
    'hypotheses-evidence-backed': hypotheses.length,
    'opportunities-qualified': qualified,
    'meetings-booked': meetings,
    'weighted-pipeline-gbp': Math.round(weighted),
  };

  const progress: ObjectiveProgress[] = OBJECTIVES.map((def) => {
    const target = targets[def.key];
    const actual = actuals[def.key];
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      target,
      actual,
      fraction: target > 0 ? Math.min(1, actual / target) : 1,
      met: actual >= target,
      countedAs: def.countedAs,
      note: opts.notes?.[def.key] ?? null,
    };
  });

  const worst = [...progress].sort((a, b) => a.fraction - b.fraction)[0];

  return {
    mspId,
    progress,
    allMet: progress.every((p) => p.met),
    worst: worst && !worst.met ? worst.key : null,
    generatedAt: new Date().toISOString(),
  };
}
