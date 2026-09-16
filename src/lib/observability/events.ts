/**
 * Observability and cost accounting — Directive §25 and §26.
 *
 * "Every agent/action must emit: request, objective, assigned capability, start
 * time, completion time, status, cost, tokens, outcome, failure, retry,
 * evidence, benefit generated."
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';

export interface AgentEvent {
  id: string;
  tenantId: string;
  companyId: string | null;
  objective: string;
  capabilityId: string | null;
  executionId: string | null;
  status: 'started' | 'succeeded' | 'failed' | 'skipped';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  costGbp: number;
  inputTokens: number;
  outputTokens: number;
  benefitGbp: number;
  failure: string | null;
  retryCount: number;
  detail: Record<string, unknown>;
}

export function recordEvent(db: TenantDb, event: Omit<AgentEvent, 'id'> & { id?: string }): AgentEvent {
  const full: AgentEvent = { id: event.id ?? randomUUID(), ...event };
  db.run(
    `INSERT INTO agent_events
       (id, tenant_id, company_id, objective, capability_id, execution_id, status, started_at,
        completed_at, duration_ms, cost_gbp, input_tokens, output_tokens, benefit_gbp, failure,
        retry_count, detail_json)
     VALUES
       (@id, @tenantId, @companyId, @objective, @capabilityId, @executionId, @status, @startedAt,
        @completedAt, @durationMs, @costGbp, @inputTokens, @outputTokens, @benefitGbp, @failure,
        @retryCount, @detailJson)`,
    {
      id: full.id,
      companyId: full.companyId,
      objective: full.objective,
      capabilityId: full.capabilityId,
      executionId: full.executionId,
      status: full.status,
      startedAt: full.startedAt,
      completedAt: full.completedAt,
      durationMs: full.durationMs,
      costGbp: full.costGbp,
      inputTokens: full.inputTokens,
      outputTokens: full.outputTokens,
      benefitGbp: full.benefitGbp,
      failure: full.failure,
      retryCount: full.retryCount,
      detailJson: JSON.stringify(full.detail),
    },
  );
  return full;
}

export interface AuditRecord {
  actor: string;
  actorKind: 'human' | 'agent' | 'system';
  action: string;
  subjectType: string;
  subjectId: string;
  detail: Record<string, unknown>;
}

/** Append-only — the table's triggers reject updates and deletes (§24). */
export function audit(db: TenantDb, record: AuditRecord): void {
  db.run(
    `INSERT INTO audit_log (id, tenant_id, actor, actor_kind, action, subject_type, subject_id, detail_json, at)
     VALUES (@id, @tenantId, @actor, @actorKind, @action, @subjectType, @subjectId, @detailJson, @at)`,
    {
      id: randomUUID(),
      actor: record.actor,
      actorKind: record.actorKind,
      action: record.action,
      subjectType: record.subjectType,
      subjectId: record.subjectId,
      detailJson: JSON.stringify(record.detail),
      at: new Date().toISOString(),
    },
  );
}

export interface CostSummary {
  totalCostGbp: number;
  totalBenefitGbp: number;
  eventCount: number;
  failureCount: number;
  /** Benefit per £1 of execution cost. */
  returnOnExecution: number;
  byCapability: { capabilityId: string; costGbp: number; benefitGbp: number; count: number }[];
}

export function costSummary(db: TenantDb, companyId?: string): CostSummary {
  const rows = db.all<{
    capability_id: string | null;
    cost_gbp: number;
    benefit_gbp: number;
    status: string;
  }>(
    companyId
      ? `SELECT capability_id, cost_gbp, benefit_gbp, status FROM agent_events
         WHERE tenant_id = @tenantId AND company_id = @companyId`
      : `SELECT capability_id, cost_gbp, benefit_gbp, status FROM agent_events WHERE tenant_id = @tenantId`,
    companyId ? { companyId } : {},
  );

  const byCapability = new Map<string, { costGbp: number; benefitGbp: number; count: number }>();
  let totalCostGbp = 0;
  let totalBenefitGbp = 0;
  let failureCount = 0;

  for (const r of rows) {
    totalCostGbp += r.cost_gbp;
    totalBenefitGbp += r.benefit_gbp;
    if (r.status === 'failed') failureCount++;
    const key = r.capability_id ?? 'platform';
    const acc = byCapability.get(key) ?? { costGbp: 0, benefitGbp: 0, count: 0 };
    acc.costGbp += r.cost_gbp;
    acc.benefitGbp += r.benefit_gbp;
    acc.count += 1;
    byCapability.set(key, acc);
  }

  return {
    totalCostGbp: Math.round(totalCostGbp * 100) / 100,
    totalBenefitGbp: Math.round(totalBenefitGbp),
    eventCount: rows.length,
    failureCount,
    returnOnExecution: totalCostGbp > 0 ? Math.round((totalBenefitGbp / totalCostGbp) * 10) / 10 : 0,
    byCapability: [...byCapability.entries()]
      .map(([capabilityId, v]) => ({ capabilityId, ...v, costGbp: Math.round(v.costGbp * 100) / 100 }))
      .sort((a, b) => b.costGbp - a.costGbp),
  };
}

/**
 * Directive §26: "Do not spend £1,000 analysing a £500 opportunity."
 * Called before an execution step commits cost.
 */
export function proportionate(plannedCostGbp: number, valueAtStake: number): { ok: boolean; reason: string } {
  if (valueAtStake <= 0) {
    return { ok: false, reason: 'No quantified value at stake — execution cost cannot be justified.' };
  }
  const ratio = plannedCostGbp / valueAtStake;
  if (ratio > 0.25) {
    return {
      ok: false,
      reason: `Planned execution cost £${plannedCostGbp.toFixed(2)} is ${Math.round(ratio * 100)}% of the £${Math.round(valueAtStake).toLocaleString('en-GB')} at stake. Disproportionate.`,
    };
  }
  return { ok: true, reason: `Execution cost is ${(ratio * 100).toFixed(1)}% of the value at stake.` };
}
