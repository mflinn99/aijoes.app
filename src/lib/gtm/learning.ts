/**
 * The learning loop — Directive 02 Phase 15.
 *
 * The directive's constraint is the interesting part: "Do not permit uncontrolled
 * model self-modification. Version strategies and retain rollback capability."
 *
 * So the loop here is deliberately open, not closed. The engine measures what
 * converted, proposes a new weighting with the evidence that produced it, and
 * then stops. Activation is a human act, recorded against a named person, and
 * every prior version stays on disk so rolling back is one call rather than a
 * reconstruction.
 *
 * The second constraint is statistical honesty. With eleven outcomes you cannot
 * tell a good archetype from a lucky one, so the loop refuses to propose changes
 * it cannot support and says how many more outcomes it needs.
 */

import type { TenantDb } from '../db/tenant';
import { audit } from '../observability/events';
import { DEFAULT_PRIORITY_WEIGHTS, type PriorityWeights } from './icp';
import { listHypotheses, listOpportunities, getAccount, getHypothesis } from './store';

export type OutcomeKind =
  | 'no-response'
  | 'negative-response'
  | 'positive-response'
  | 'meeting-booked'
  | 'qualified'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'opted-out';

/** Outcomes that count as the engine having been right about the account. */
const POSITIVE: OutcomeKind[] = ['positive-response', 'meeting-booked', 'qualified', 'proposal', 'won'];

export interface Outcome {
  id: string;
  accountId: string;
  hypothesisId: string | null;
  outcome: OutcomeKind;
  archetype: string | null;
  serviceId: string | null;
  sector: string | null;
  persona: string | null;
  signalKind: string | null;
  valueGbp: number | null;
  cycleDays: number | null;
  strategyVersion: string;
  recordedAt: string;
}

export interface StrategyVersion {
  version: string;
  weights: PriorityWeights;
  note: string;
  active: boolean;
  createdAt: string;
}

/** Below this, a difference between two archetypes is noise. */
export const MIN_OUTCOMES_PER_SEGMENT = 12;
/** Below this in total, the loop will not propose any change at all. */
export const MIN_OUTCOMES_TO_PROPOSE = 40;

// --- strategy versions -----------------------------------------------------

export function activeStrategy(db: TenantDb): StrategyVersion {
  const row = db.get<{ version: string; weights_json: string; note: string; active: number; created_at: string }>(
    `SELECT * FROM gtm_strategies WHERE tenant_id = @tenantId AND active = 1`,
  );
  if (!row) {
    return {
      version: 'v1-baseline',
      weights: DEFAULT_PRIORITY_WEIGHTS,
      note: 'The starting weights. A judgement, not a measurement — nothing has converted yet.',
      active: true,
      createdAt: new Date(0).toISOString(),
    };
  }
  return {
    version: row.version,
    weights: JSON.parse(row.weights_json) as PriorityWeights,
    note: row.note,
    active: true,
    createdAt: row.created_at,
  };
}

export function listStrategies(db: TenantDb): StrategyVersion[] {
  return db
    .all<{ version: string; weights_json: string; note: string; active: number; created_at: string }>(
      `SELECT * FROM gtm_strategies WHERE tenant_id = @tenantId ORDER BY created_at DESC`,
    )
    .map((r) => ({
      version: r.version, weights: JSON.parse(r.weights_json) as PriorityWeights,
      note: r.note, active: r.active === 1, createdAt: r.created_at,
    }));
}

/** Store a proposal. It is NOT activated — that is the whole point of Phase 15. */
export function saveStrategy(db: TenantDb, version: string, weights: PriorityWeights, note: string): StrategyVersion {
  const createdAt = new Date().toISOString();
  db.run(
    `INSERT INTO gtm_strategies (version, tenant_id, weights_json, note, active, created_at)
     VALUES (@version, @tenantId, @weights, @note, 0, @createdAt)
     ON CONFLICT (tenant_id, version) DO UPDATE SET weights_json = @weights, note = @note`,
    { version, weights: JSON.stringify(weights), note, createdAt },
  );
  return { version, weights, note, active: false, createdAt };
}

/**
 * Activation requires a named person. There is deliberately no code path that
 * activates a strategy the engine proposed to itself.
 */
export function activateStrategy(db: TenantDb, version: string, activatedBy: string, reason: string): StrategyVersion {
  const target = db.get<{ version: string; weights_json: string; note: string; created_at: string }>(
    `SELECT * FROM gtm_strategies WHERE tenant_id = @tenantId AND version = @version`,
    { version },
  );
  if (!target) throw new Error(`No strategy version "${version}" to activate.`);

  const previous = db.get<{ version: string }>(`SELECT version FROM gtm_strategies WHERE tenant_id = @tenantId AND active = 1`);

  db.run(`UPDATE gtm_strategies SET active = 0 WHERE tenant_id = @tenantId`);
  db.run(`UPDATE gtm_strategies SET active = 1 WHERE tenant_id = @tenantId AND version = @version`, { version });

  audit(db, {
    actor: activatedBy, actorKind: 'human', action: 'gtm.strategy.activated',
    subjectType: 'strategy', subjectId: version,
    detail: { previous: previous?.version ?? 'v1-baseline', reason },
  });

  return {
    version: target.version, weights: JSON.parse(target.weights_json) as PriorityWeights,
    note: target.note, active: true, createdAt: target.created_at,
  };
}

/** Rollback is activation of an earlier version, recorded as a rollback. */
export function rollbackStrategy(db: TenantDb, toVersion: string, rolledBackBy: string, reason: string): StrategyVersion {
  const result = activateStrategy(db, toVersion, rolledBackBy, reason);
  audit(db, {
    actor: rolledBackBy, actorKind: 'human', action: 'gtm.strategy.rolledback',
    subjectType: 'strategy', subjectId: toVersion, detail: { reason },
  });
  return result;
}

// --- outcomes --------------------------------------------------------------

export function recordOutcome(
  db: TenantDb,
  input: { accountId: string; hypothesisId?: string | null; outcome: OutcomeKind; valueGbp?: number | null; cycleDays?: number | null },
): Outcome {
  const hypothesis = input.hypothesisId ? getHypothesis(db, input.hypothesisId) : null;
  const account = getAccount(db, input.accountId);
  const strategy = activeStrategy(db);
  const id = `${input.accountId}:${input.hypothesisId ?? '-'}:${input.outcome}`;

  const record: Outcome = {
    id,
    accountId: input.accountId,
    hypothesisId: input.hypothesisId ?? null,
    outcome: input.outcome,
    archetype: hypothesis?.archetype ?? null,
    serviceId: hypothesis?.serviceIds[0] ?? null,
    sector: account?.scores?.icp.components.find((c) => c.label === 'Sector fit')?.why ?? null,
    persona: hypothesis?.whoOwnsTheProblem[0] ?? null,
    signalKind: hypothesis?.evidence[0]?.source ?? null,
    valueGbp: input.valueGbp ?? hypothesis?.commercialValue.point ?? null,
    cycleDays: input.cycleDays ?? null,
    strategyVersion: strategy.version,
    recordedAt: new Date().toISOString(),
  };

  // Keyed on account+hypothesis+outcome so the same outcome cannot be counted twice.
  db.run(
    `INSERT INTO gtm_outcomes (id, tenant_id, account_id, hypothesis_id, outcome, archetype, service_id,
       sector, persona, signal_kind, value_gbp, cycle_days, strategy_version, recorded_at)
     VALUES (@id, @tenantId, @accountId, @hypothesisId, @outcome, @archetype, @serviceId, @sector,
       @persona, @signalKind, @valueGbp, @cycleDays, @strategyVersion, @recordedAt)
     ON CONFLICT (id) DO NOTHING`,
    { ...record },
  );
  return record;
}

export function listOutcomes(db: TenantDb, limit = 5000): Outcome[] {
  return db
    .all<{ id: string; account_id: string; hypothesis_id: string | null; outcome: string; archetype: string | null; service_id: string | null; sector: string | null; persona: string | null; signal_kind: string | null; value_gbp: number | null; cycle_days: number | null; strategy_version: string; recorded_at: string }>(
      `SELECT * FROM gtm_outcomes WHERE tenant_id = @tenantId ORDER BY recorded_at DESC LIMIT ${Math.min(limit, 20000)}`,
    )
    .map((r) => ({
      id: r.id, accountId: r.account_id, hypothesisId: r.hypothesis_id, outcome: r.outcome as OutcomeKind,
      archetype: r.archetype, serviceId: r.service_id, sector: r.sector, persona: r.persona,
      signalKind: r.signal_kind, valueGbp: r.value_gbp, cycleDays: r.cycle_days,
      strategyVersion: r.strategy_version, recordedAt: r.recorded_at,
    }));
}

// --- what the outcomes say -------------------------------------------------

export interface SegmentPerformance {
  dimension: 'archetype' | 'service' | 'persona' | 'signal';
  segment: string;
  attempts: number;
  positive: number;
  won: number;
  /** Positive outcomes ÷ attempts. Null when there is not enough to say. */
  rate: number | null;
  wonValueGbp: number;
  /** Stated plainly when the sample is too small, rather than shown as a percentage. */
  verdict: string;
}

function summarise(dimension: SegmentPerformance['dimension'], rows: Map<string, Outcome[]>): SegmentPerformance[] {
  return [...rows.entries()]
    .map(([segment, outcomes]) => {
      const attempts = outcomes.length;
      const positive = outcomes.filter((o) => POSITIVE.includes(o.outcome)).length;
      const won = outcomes.filter((o) => o.outcome === 'won').length;
      const wonValueGbp = outcomes.filter((o) => o.outcome === 'won').reduce((s, o) => s + (o.valueGbp ?? 0), 0);
      const enough = attempts >= MIN_OUTCOMES_PER_SEGMENT;
      return {
        dimension, segment, attempts, positive, won, wonValueGbp,
        rate: enough ? Math.round((positive / attempts) * 1000) / 1000 : null,
        verdict: enough
          ? `${positive} of ${attempts} went somewhere.`
          : `${attempts} outcome(s) — ${MIN_OUTCOMES_PER_SEGMENT - attempts} more needed before this means anything.`,
      };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.attempts - a.attempts);
}

function group(outcomes: Outcome[], key: (o: Outcome) => string | null): Map<string, Outcome[]> {
  const map = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    const k = key(o);
    if (!k) continue;
    const list = map.get(k) ?? [];
    list.push(o);
    map.set(k, list);
  }
  return map;
}

export interface LearningReport {
  totalOutcomes: number;
  byArchetype: SegmentPerformance[];
  byService: SegmentPerformance[];
  byPersona: SegmentPerformance[];
  bySignal: SegmentPerformance[];
  /** What the data supports doing. Empty when it supports nothing yet. */
  findings: string[];
  /** The proposal, when there is enough evidence for one. Never auto-applied. */
  proposal: { version: string; weights: PriorityWeights; note: string; changes: string[] } | null;
  /** Why no proposal, when there is none. */
  withheldBecause: string | null;
  activeVersion: string;
}

/**
 * Analyse. Proposing is separate from applying, and both are separate from
 * activating — which only a person can do.
 */
export function analyse(db: TenantDb): LearningReport {
  const outcomes = listOutcomes(db);
  const active = activeStrategy(db);

  const byArchetype = summarise('archetype', group(outcomes, (o) => o.archetype));
  const byService = summarise('service', group(outcomes, (o) => o.serviceId));
  const byPersona = summarise('persona', group(outcomes, (o) => o.persona));
  const bySignal = summarise('signal', group(outcomes, (o) => o.signalKind));

  const findings: string[] = [];
  for (const segment of [...byArchetype, ...byService, ...byPersona].filter((s) => s.rate !== null)) {
    if (segment.rate! >= 0.25) findings.push(`${segment.dimension} "${segment.segment}" converts at ${Math.round(segment.rate! * 100)}% over ${segment.attempts} attempts.`);
    if (segment.rate! <= 0.02 && segment.attempts >= MIN_OUTCOMES_PER_SEGMENT * 2) {
      findings.push(`${segment.dimension} "${segment.segment}" has produced almost nothing in ${segment.attempts} attempts. Worth stopping rather than tuning.`);
    }
  }

  if (outcomes.length < MIN_OUTCOMES_TO_PROPOSE) {
    return {
      totalOutcomes: outcomes.length, byArchetype, byService, byPersona, bySignal, findings,
      proposal: null,
      withheldBecause: `${outcomes.length} recorded outcomes. The loop will not propose a weighting change below ${MIN_OUTCOMES_TO_PROPOSE}, because with fewer than that it would be fitting to noise.`,
      activeVersion: active.version,
    };
  }

  // The only adjustment the loop makes on its own is a modest shift towards the
  // signals that actually preceded conversions. It never rewrites the model.
  const positives = outcomes.filter((o) => POSITIVE.includes(o.outcome));
  const timingLed = positives.filter((o) => o.signalKind && o.signalKind !== 'website').length / Math.max(1, positives.length);
  const evidenceLed = positives.filter((o) => (o.valueGbp ?? 0) > 0).length / Math.max(1, positives.length);

  const weights: PriorityWeights = { ...active.weights };
  const changes: string[] = [];
  const shift = 3;

  if (timingLed > 0.6 && weights.icp > shift) {
    weights.timing += shift;
    weights.icp -= shift;
    changes.push(`Timing +${shift}, ICP -${shift}: ${Math.round(timingLed * 100)}% of positive outcomes followed an external event rather than a profile match.`);
  }
  if (evidenceLed > 0.8 && weights.contactability > shift) {
    weights.evidence += shift;
    weights.contactability -= shift;
    changes.push(`Evidence +${shift}, Contactability -${shift}: conversions are tracking evidence depth more closely than how easy the account was to reach.`);
  }

  if (changes.length === 0) {
    return {
      totalOutcomes: outcomes.length, byArchetype, byService, byPersona, bySignal, findings,
      proposal: null,
      withheldBecause: `${outcomes.length} outcomes analysed and none of the adjustment conditions were met. The current weighting is not contradicted by the data, so leaving it alone is the right answer.`,
      activeVersion: active.version,
    };
  }

  const version = `v${listStrategies(db).length + 2}-${new Date().toISOString().slice(0, 10)}`;
  return {
    totalOutcomes: outcomes.length, byArchetype, byService, byPersona, bySignal, findings,
    proposal: {
      version,
      weights,
      note: `Proposed from ${outcomes.length} outcomes under ${active.version}. Requires a person to activate.`,
      changes,
    },
    withheldBecause: null,
    activeVersion: active.version,
  };
}

/** Persist a proposal so it can be reviewed. Still inactive. */
export function propose(db: TenantDb): StrategyVersion | null {
  const report = analyse(db);
  if (!report.proposal) return null;
  const saved = saveStrategy(db, report.proposal.version, report.proposal.weights, `${report.proposal.note} ${report.proposal.changes.join(' ')}`);
  audit(db, {
    actor: 'agent:learning', actorKind: 'agent', action: 'gtm.strategy.proposed',
    subjectType: 'strategy', subjectId: saved.version,
    detail: { changes: report.proposal.changes, outcomes: report.totalOutcomes },
  });
  return saved;
}

/**
 * Harvest outcomes from pipeline state. Called after each autopilot run, so the
 * learning loop is fed by what actually happened rather than by a separate log
 * the engine writes about itself.
 */
export function harvestOutcomes(db: TenantDb): number {
  let recorded = 0;
  for (const opp of listOpportunities(db, { limit: 5000 })) {
    const outcome: OutcomeKind | null =
      opp.stage === 'won' ? 'won'
        : opp.stage === 'lost' ? 'lost'
          : opp.stage === 'proposal' ? 'proposal'
            : opp.stage === 'qualified' ? 'qualified'
              : opp.stage === 'meeting-booked' ? 'meeting-booked'
                : opp.stage === 'responded' ? 'positive-response'
                  : opp.stage === 'stalled' ? 'no-response'
                    : null;
    if (!outcome) continue;

    const cycleDays = Math.round((new Date(opp.updatedAt).getTime() - new Date(opp.createdAt).getTime()) / 86_400_000);
    recordOutcome(db, {
      accountId: opp.accountId, hypothesisId: opp.hypothesisId, outcome,
      valueGbp: opp.valueGbp, cycleDays,
    });
    recorded++;
  }

  // A hypothesis the engine rejected is also a lesson: it tells us where the
  // evidence bar is biting, which is how you tell a strict engine from a blind one.
  for (const h of listHypotheses(db, { limit: 5000 })) {
    if (h.quality !== 'rejected') continue;
    recordOutcome(db, { accountId: h.accountId, hypothesisId: h.id, outcome: 'no-response' });
  }

  return recorded;
}
