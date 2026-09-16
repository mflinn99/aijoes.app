/**
 * Directive §11 and §27: START is a real execution contract.
 *
 * "A button that simply changes a database status is not sufficient."
 */

import { describe, it, expect } from 'vitest';
import { harness, seedGrant, seedCustomer } from './helpers';
import { analyseCompany } from '@/lib/analysis/pipeline';
import { SYNTHETIC_COMPANIES } from '@/lib/fixtures/synthetic';
import { getOpportunity, listOpportunities } from '@/lib/db/repositories/company';
import { listGrants, listAudit } from '@/lib/db/repositories/tenant-data';
import { planExecution, authorisePlan, runExecution, approveTask, stopPlan, getPlan, ExecutionError } from '@/lib/execution/engine';
import { getBenefitByOpportunity } from '@/lib/benefits/ledger';
import { AutonomyLevel } from '@/lib/core/autonomy';
import { startAvailable, type Opportunity } from '@/lib/core/opportunity';
import { listAgentEvents } from '@/lib/db/repositories/tenant-data';

async function setup(fixtureIndex = 2) {
  const h = harness();
  const fixture = SYNTHETIC_COMPANIES[fixtureIndex]!;
  seedCustomer(h, `cust-${fixture.key}`, fixture.name, fixture.domain, fixture.currentMrr);
  seedGrant(h, AutonomyLevel.RECOMMEND);
  const result = await analyseCompany(h.db, fixture.domain, {
    customerId: `cust-${fixture.key}`,
    offline: true,
    seedRecords: fixture.records,
    userSupplied: fixture.userSupplied,
  });
  return { h, result };
}

function startable(opportunities: Opportunity[]): Opportunity {
  const o = opportunities.find((x) => startAvailable(x).available);
  if (!o) throw new Error('fixture produced no startable opportunity');
  return o;
}

function plan(h: Awaited<ReturnType<typeof setup>>['h'], opportunity: Opportunity) {
  return planExecution(h.db, {
    opportunity,
    grants: listGrants(h.db),
    connectedIntegrations: ['website'],
    userId: h.ctx.userId,
  });
}

describe('START workflow', () => {
  it('builds a real plan with routed tasks, not a status change', async () => {
    const { h, result } = await setup();
    const opportunity = startable(result.opportunities);
    const preview = plan(h, opportunity);

    expect(preview.plan.tasks.length).toBeGreaterThan(0);
    expect(preview.plan.playbookId).toBe(opportunity.playbookId);
    expect(preview.plan.playbookVersion).toBeTruthy();
    expect(preview.plan.rollbackPlan.length).toBeGreaterThan(20);
    expect(preview.plan.metrics.length).toBeGreaterThan(0);

    for (const task of preview.plan.tasks) {
      expect(task.assignedCapability).toBeTruthy();
      expect(task.routingRationale).toBeTruthy();
      expect(task.status).toBe('PENDING');
    }
  });

  it('identifies approval gates for anything touching the outside world', async () => {
    const { h, result } = await setup();
    const opportunity = startable(result.opportunities);
    const preview = plan(h, opportunity);
    expect(preview.summary.externalTaskCount).toBeGreaterThan(0);
  });

  it('flags simulated capabilities in the preview', async () => {
    const { h, result } = await setup();
    const preview = plan(h, startable(result.opportunities));
    expect(preview.summary.simulatedCapabilities.length).toBeGreaterThan(0);
  });

  it('refuses to authorise a blocked plan', async () => {
    const { h, result } = await setup();
    const opportunity = startable(result.opportunities);
    // Force a blocker by demanding an integration that is not connected.
    const blockedOpportunity = { ...opportunity, playbookId: 'cloud-cost-optimisation' };
    const preview = planExecution(h.db, {
      opportunity: blockedOpportunity,
      grants: listGrants(h.db),
      connectedIntegrations: [],
      userId: h.ctx.userId,
    });

    expect(preview.plan.blockers.length).toBeGreaterThan(0);
    expect(preview.plan.status).toBe('DRAFT');
    expect(() => authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'test')).toThrow(ExecutionError);
  });

  it('requires authorisation before anything runs', async () => {
    const { h, result } = await setup();
    const preview = plan(h, startable(result.opportunities));
    await expect(runExecution(h.db, preview.plan.id, h.ctx.userId)).rejects.toThrow(/authorise it before running/);
  });

  it('stops at the first external task and waits for a human', async () => {
    const { h, result } = await setup();
    const preview = plan(h, startable(result.opportunities));
    authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'approved for test');

    const run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    expect(run.awaitingApproval.length).toBe(1);
    expect(run.plan.status).toBe('AWAITING_APPROVAL');

    const gated = run.awaitingApproval[0]!;
    expect(gated.approvalId).toBeTruthy();
    // Nothing after the gate has run.
    const after = run.plan.tasks.filter((t) => t.seq > gated.seq);
    expect(after.every((t) => t.status === 'PENDING')).toBe(true);
  });

  it('completes the whole plan once each gate is approved', async () => {
    const { h, result } = await setup();
    const preview = plan(h, startable(result.opportunities));
    authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'approved for test');

    let run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    let guard = 0;
    while (run.awaitingApproval.length > 0 && guard++ < 20) {
      const task = run.awaitingApproval[0]!;
      approveTask(h.db, preview.plan.id, task.id, h.ctx.userId, 'APPROVED', 'approved in test');
      run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    }

    expect(run.plan.status).toBe('COMPLETED');
    expect(run.plan.tasks.every((t) => t.status === 'COMPLETED' || t.status === 'SKIPPED')).toBe(true);
    expect(run.measuredValueGbp).toBeGreaterThan(0);
    expect(run.totalCostGbp).toBeGreaterThan(0);
  });

  it('records realised value on the opportunity and the benefit ledger', async () => {
    const { h, result } = await setup();
    const opportunity = startable(result.opportunities);
    const preview = plan(h, opportunity);
    authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'approved');

    let run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    let guard = 0;
    while (run.awaitingApproval.length > 0 && guard++ < 20) {
      approveTask(h.db, preview.plan.id, run.awaitingApproval[0]!.id, h.ctx.userId, 'APPROVED', 'ok');
      run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    }

    const updated = getOpportunity(h.db, opportunity.id)!;
    expect(updated.executionStatus).toBe('COMPLETED');
    expect(updated.realisedValue).toBeGreaterThan(0);

    const benefit = getBenefitByOpportunity(h.db, opportunity.id)!;
    expect(benefit.stage).toBe('REALISED');
    expect(benefit.realisedValue).toBeGreaterThan(0);
    // Simulated capabilities can realise value but must never verify it.
    expect(benefit.verifiedValue).toBe(0);
    expect(benefit.attributedCapabilities.length).toBeGreaterThan(0);
  });

  it('rejecting a gate stops the plan rather than silently skipping ahead', async () => {
    const { h, result } = await setup();
    const preview = plan(h, startable(result.opportunities));
    authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'approved');
    const run = await runExecution(h.db, preview.plan.id, h.ctx.userId);

    const rejected = approveTask(h.db, preview.plan.id, run.awaitingApproval[0]!.id, h.ctx.userId, 'REJECTED', 'not appropriate');
    expect(rejected.status).toBe('STOPPED');
    expect(rejected.tasks.find((t) => t.id === run.awaitingApproval[0]!.id)!.status).toBe('SKIPPED');
  });

  it('stop halts every task that has not already run', async () => {
    const { h, result } = await setup();
    const preview = plan(h, startable(result.opportunities));
    authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'approved');
    await runExecution(h.db, preview.plan.id, h.ctx.userId);

    const stopped = stopPlan(h.db, preview.plan.id, h.ctx.userId, 'operator halted');
    expect(stopped.status).toBe('STOPPED');
    expect(stopped.tasks.some((t) => t.outcome?.includes('operator halted'))).toBe(true);
    expect(stopped.tasks.filter((t) => t.status === 'PENDING')).toHaveLength(0);
  });

  it('writes an audit record for every decision', async () => {
    const { h, result } = await setup();
    const preview = plan(h, startable(result.opportunities));
    authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'approved');
    await runExecution(h.db, preview.plan.id, h.ctx.userId);

    const actions = listAudit(h.db, 200).map((a) => a.action);
    expect(actions).toContain('execution.plan.created');
    expect(actions).toContain('execution.plan.authorised');
    expect(actions).toContain('execution.run');
    expect(actions).toContain('approval.requested');
    expect(actions).toContain('company.analysed');
  });

  it('emits an observability event per task with cost and benefit', async () => {
    const { h, result } = await setup();
    const preview = plan(h, startable(result.opportunities));
    authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'approved');
    await runExecution(h.db, preview.plan.id, h.ctx.userId);

    // Task events are named "<plan objective> — <task name>"; the analysis event is not.
    const events = listAgentEvents(h.db, 100).filter((e) => e.objective.includes(' — '));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.objective).toBeTruthy();
      expect(e.cost_gbp).toBeGreaterThanOrEqual(0);
      expect(['succeeded', 'failed']).toContain(e.status);
    }
  });

  it('persists the plan so it survives a fresh read', async () => {
    const { h, result } = await setup();
    const preview = plan(h, startable(result.opportunities));
    const reloaded = getPlan(h.db, preview.plan.id)!;
    expect(reloaded.id).toBe(preview.plan.id);
    expect(reloaded.tasks).toHaveLength(preview.plan.tasks.length);
  });

  it('recomputes the next best action after execution changes the estate', async () => {
    const { h, result } = await setup();
    const before = listOpportunities(h.db).filter((o) => startAvailable(o).available);
    const opportunity = startable(result.opportunities);

    const preview = plan(h, opportunity);
    authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'approved');
    let run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    let guard = 0;
    while (run.awaitingApproval.length > 0 && guard++ < 20) {
      approveTask(h.db, preview.plan.id, run.awaitingApproval[0]!.id, h.ctx.userId, 'APPROVED', 'ok');
      run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    }

    const after = listOpportunities(h.db).filter((o) => startAvailable(o).available);
    expect(after.length).toBe(before.length - 1);
    expect(after.find((o) => o.id === opportunity.id)).toBeUndefined();
  });
});
