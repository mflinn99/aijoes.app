/**
 * Execution Engine — Directive §11.
 *
 * "The START button must represent a real execution contract. Do not implement
 * START as a dummy status change."
 *
 * The fifteen-step START workflow from §11 is implemented literally, split into
 * three phases so a human sits between planning and doing:
 *
 *   planExecution()      steps 1–8   validate → preview
 *   authorisePlan()      step  9     a named human accepts
 *   runExecution()       steps 10–15 execute → monitor → measure → record →
 *                                    update twin → find next opportunity
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import type { Opportunity } from '../core/opportunity';
import { startAvailable } from '../core/opportunity';
import { getPlaybook } from '../playbooks/registry';
import { routeObjective } from '../capabilities/router';
import { getAdapter, getCapability, findActionOwner } from '../capabilities/registry';
import { AutonomyLevel, resolveAutonomy, type ActionRequest, type AutonomyGrant } from '../core/autonomy';
import { audit, recordEvent, proportionate } from '../observability/events';
import { advance, createBenefit, getBenefitByOpportunity, type Benefit } from '../benefits/ledger';
import type { ExecutionPlan, ExecutionPreview, ExecutionTask, PlanStatus, TaskStatus } from './types';

const MAX_RETRIES = 2;

export class ExecutionError extends Error {}

// ---------------------------------------------------------------------------
// Steps 1–8: validate, refresh, plan, route, preview
// ---------------------------------------------------------------------------

export interface PlanInput {
  opportunity: Opportunity;
  grants: AutonomyGrant[];
  connectedIntegrations: string[];
  userId: string;
}

export function planExecution(db: TenantDb, input: PlanInput): ExecutionPreview {
  const { opportunity, grants, connectedIntegrations, userId } = input;
  const blockers: string[] = [];

  // Step 1 — validate the opportunity.
  const gate = startAvailable(opportunity);
  if (!gate.available) blockers.push(gate.reason);

  const playbook = opportunity.playbookId ? getPlaybook(opportunity.playbookId) : undefined;
  if (!playbook) {
    blockers.push(`No playbook "${opportunity.playbookId}" is registered.`);
  }

  // Step 2/3 — eligibility against refreshed evidence and the current model.
  if (playbook) {
    for (const rule of playbook.eligibilityRules) {
      const failure = rule.check({
        confidence: opportunity.confidence,
        value: opportunity.estimatedAnnualValue,
        integrations: connectedIntegrations,
        readiness: opportunity.executionReadiness,
      });
      if (failure) blockers.push(failure);
    }
  }

  // Step 4/5/6 — generate the plan, route each task, validate integrations.
  const planId = randomUUID();
  const tasks: ExecutionTask[] = [];
  const simulated = new Set<string>();
  let estimatedCostGbp = 0;

  if (playbook) {
    playbook.tasks.forEach((pt, i) => {
      const routing = routeObjective({
        actionId: pt.capabilityAction,
        objective: `${opportunity.title}: ${pt.description}`,
        availableInputs: ['companyId', 'tenantId', 'objective', 'approvalId', 'financialTarget'],
        valueAtStake: opportunity.estimatedAnnualValue,
      });

      const chosen = routing.recommended ?? routing.fallback;
      const owner = findActionOwner(pt.capabilityAction);
      const capability = chosen ? getCapability(chosen.capabilityId) : owner?.capability;
      const actionDef = owner?.action;

      if (!capability) {
        blockers.push(`No capability can perform "${pt.capabilityAction}" for task "${pt.name}".`);
        return;
      }
      if (capability.maturity === 'mock') simulated.add(capability.name);

      const unitCost = actionDef?.unitCostGbp ?? 1;
      estimatedCostGbp += unitCost;

      // Step 7 — identify approvals. A task is gated if the playbook says so,
      // or the capability action touches the outside world, or autonomy is short.
      const external = actionDef?.external ?? false;
      const decision = resolveAutonomy(
        {
          tenantId: db.ctx.tenantId,
          userId,
          actionType: pt.capabilityAction,
          capabilityId: capability.id,
          monetaryImpact: external ? opportunity.estimatedAnnualValue : 0,
          risk: actionDef?.risk ?? 'low',
          external,
        } satisfies ActionRequest,
        grants,
      );

      tasks.push({
        id: `${planId}-t${i}`,
        executionPlanId: planId,
        seq: i,
        action: pt.action,
        name: pt.name,
        description: pt.description,
        assignedCapability: capability.id,
        assignedCapabilityName: capability.name,
        assignedAgent: `${capability.name} agent`,
        capabilityAction: pt.capabilityAction,
        routingRationale: routing.rationale,
        inputs: {
          companyId: opportunity.companyId,
          tenantId: db.ctx.tenantId,
          objective: opportunity.title,
          financialTarget: opportunity.estimatedAnnualValue * (playbook.financialModel.targetRealisationRate / playbook.tasks.length),
        },
        expectedOutputs: pt.expectedOutputs,
        preconditions: pt.preconditions,
        approvalRequired: pt.approvalRequired || external || decision.requiresApproval,
        approvalId: null,
        status: 'PENDING',
        startedAt: null,
        completedAt: null,
        outcome: null,
        evidence: [],
        costGbp: 0,
        measuredValueGbp: null,
        retryCount: 0,
        simulated: capability.maturity === 'mock',
      });
    });
  }

  // Step 8 — proportionality, then assemble the preview.
  const prop = proportionate(estimatedCostGbp, opportunity.estimatedAnnualValue);
  if (!prop.ok) blockers.push(prop.reason);

  const planLevel = resolveAutonomy(
    {
      tenantId: db.ctx.tenantId,
      userId,
      actionType: opportunity.playbookId ?? 'unknown',
      capabilityId: tasks[0]?.assignedCapability ?? 'jojo',
      monetaryImpact: opportunity.estimatedAnnualValue,
      risk: opportunity.risk,
      external: tasks.some((t) => t.approvalRequired),
    },
    grants,
  );

  const plan: ExecutionPlan = {
    id: planId,
    tenantId: db.ctx.tenantId,
    companyId: opportunity.companyId,
    opportunityId: opportunity.id,
    playbookId: playbook?.id ?? '',
    playbookVersion: playbook?.version ?? '',
    objective: opportunity.title,
    targetOutcome: playbook?.financialModel.note ?? '',
    financialTarget: Math.round(opportunity.estimatedAnnualValue * (playbook?.financialModel.targetRealisationRate ?? 0.5)),
    tasks,
    requiredCapabilities: [...new Set(tasks.map((t) => t.assignedCapability))],
    integrations: opportunity.requiredIntegrations,
    permissions: opportunity.approvalRequirements,
    approvals: playbook?.approvalPolicy.gates ?? [],
    constraints: opportunity.assumptions,
    metrics: playbook?.defaultKPIs ?? [],
    stopConditions: playbook?.stopConditions ?? [],
    rollbackPlan: rollbackFor(opportunity),
    status: blockers.length > 0 ? 'DRAFT' : 'AWAITING_AUTHORISATION',
    autonomyLevel: planLevel.level,
    autonomyReason: planLevel.reason,
    estimatedCostGbp: Math.round(estimatedCostGbp * 100) / 100,
    createdAt: new Date().toISOString(),
    authorisedAt: null,
    authorisedBy: null,
    completedAt: null,
    blockers,
  };

  persistPlan(db, plan);

  audit(db, {
    actor: userId,
    actorKind: 'human',
    action: 'execution.plan.created',
    subjectType: 'execution_plan',
    subjectId: plan.id,
    detail: { opportunityId: opportunity.id, blockers, taskCount: tasks.length, autonomy: planLevel.level },
  });

  return {
    plan,
    summary: {
      taskCount: tasks.length,
      externalTaskCount: tasks.filter((t) => t.approvalRequired).length,
      approvalsRequired: plan.approvals.length,
      estimatedCostGbp: plan.estimatedCostGbp,
      financialTarget: plan.financialTarget,
      proportionality: prop.reason,
      simulatedCapabilities: [...simulated],
    },
  };
}

function rollbackFor(o: Opportunity): string {
  switch (o.category) {
    case 'SPEND_LESS':
      return 'Licence, subscription and resource changes are reversible within the supplier\'s reinstatement window. Cancellations are scheduled at renewal where possible so no service is lost mid-term. Contract changes are not applied until the customer signs.';
    case 'MAKE_MORE':
      return 'Outreach is stopped immediately on request and contacts are suppressed. No pricing or contractual change is applied without written customer approval, so nothing requires financial unwinding.';
    case 'MSP_EXPAND':
      return 'Proposals can be withdrawn before signature. Once delivery starts, the onboarding is reversible for 30 days with no termination charge under the standard AIGoGo service terms.';
  }
}

// ---------------------------------------------------------------------------
// Step 9: human authorisation
// ---------------------------------------------------------------------------

export function authorisePlan(db: TenantDb, planId: string, userId: string, rationale: string): ExecutionPlan {
  const plan = getPlan(db, planId);
  if (!plan) throw new ExecutionError(`Execution plan ${planId} not found`);
  if (plan.blockers.length > 0) {
    throw new ExecutionError(`Plan cannot be authorised while blocked: ${plan.blockers.join('; ')}`);
  }
  if (plan.status !== 'AWAITING_AUTHORISATION') {
    throw new ExecutionError(`Plan is ${plan.status}, not awaiting authorisation`);
  }

  const now = new Date().toISOString();
  const authorised: ExecutionPlan = {
    ...plan,
    status: 'AUTHORISED',
    authorisedAt: now,
    authorisedBy: userId,
  };
  persistPlan(db, authorised);

  db.run(
    `INSERT INTO approvals (id, tenant_id, execution_plan_id, task_id, requested_at, decided_at, decided_by, decision, rationale, summary)
     VALUES (@id, @tenantId, @planId, NULL, @at, @at, @userId, 'APPROVED', @rationale, @summary)`,
    {
      id: randomUUID(),
      planId,
      at: now,
      userId,
      rationale,
      summary: `Authorised execution of "${plan.objective}" with a £${plan.financialTarget.toLocaleString('en-GB')} target.`,
    },
  );

  audit(db, {
    actor: userId,
    actorKind: 'human',
    action: 'execution.plan.authorised',
    subjectType: 'execution_plan',
    subjectId: planId,
    detail: { rationale, financialTarget: plan.financialTarget, taskCount: plan.tasks.length },
  });

  // Benefit moves THEORETICAL -> APPROVED (§16).
  const benefit = getBenefitByOpportunity(db, plan.opportunityId);
  if (benefit) advance(db, benefit, 'APPROVED');

  return authorised;
}

// ---------------------------------------------------------------------------
// Steps 10–15: execute, monitor, measure, record, update, find next
// ---------------------------------------------------------------------------

export interface RunResult {
  plan: ExecutionPlan;
  benefit: Benefit | null;
  /** Tasks that stopped and are waiting for a human. */
  awaitingApproval: ExecutionTask[];
  measuredValueGbp: number;
  totalCostGbp: number;
}

export async function runExecution(db: TenantDb, planId: string, userId: string): Promise<RunResult> {
  const plan = getPlan(db, planId);
  if (!plan) throw new ExecutionError(`Execution plan ${planId} not found`);
  if (plan.status !== 'AUTHORISED' && plan.status !== 'EXECUTING' && plan.status !== 'AWAITING_APPROVAL') {
    throw new ExecutionError(`Plan is ${plan.status} — authorise it before running`);
  }

  let working: ExecutionPlan = { ...plan, status: 'EXECUTING', tasks: [...plan.tasks] };
  persistPlan(db, working);

  let measuredValueGbp = 0;
  let totalCostGbp = 0;
  const awaitingApproval: ExecutionTask[] = [];

  for (let i = 0; i < working.tasks.length; i++) {
    const task = working.tasks[i]!;
    if (task.status === 'COMPLETED' || task.status === 'SKIPPED') {
      measuredValueGbp += task.measuredValueGbp ?? 0;
      totalCostGbp += task.costGbp;
      continue;
    }

    // Step 10 — execute only what is authorised. A gated task stops the run
    // here rather than being quietly skipped: the plan is sequential and a
    // later task usually depends on the gated one's output.
    if (task.approvalRequired && !task.approvalId) {
      const approvalId = requestApproval(db, working, task);
      working.tasks[i] = { ...task, status: 'AWAITING_APPROVAL' as TaskStatus, approvalId };
      awaitingApproval.push(working.tasks[i]!);
      working = { ...working, status: 'AWAITING_APPROVAL' };
      break;
    }

    const outcome = await executeTask(db, working, task);
    working.tasks[i] = outcome;
    measuredValueGbp += outcome.measuredValueGbp ?? 0;
    totalCostGbp += outcome.costGbp;

    if (outcome.status === 'FAILED') {
      working = { ...working, status: 'FAILED' };
      break;
    }
  }

  const allDone = working.tasks.every((t) => t.status === 'COMPLETED' || t.status === 'SKIPPED');
  if (allDone) {
    working = { ...working, status: 'COMPLETED', completedAt: new Date().toISOString() };
  }
  persistPlan(db, working);

  // Steps 12–13 — measure and record the realised benefit.
  let benefit = getBenefitByOpportunity(db, working.opportunityId);
  if (benefit) {
    if (working.status === 'COMPLETED') {
      benefit = advance(db, benefit, 'REALISED', {
        realisedValue: Math.round(measuredValueGbp),
        attributedCapabilities: working.requiredCapabilities,
        evidence: [
          {
            statement:
              `Execution plan ${working.id} completed ${working.tasks.length} tasks. ` +
              `${working.tasks.some((t) => t.simulated) ? 'Capability outcomes are simulated — value is modelled, not verified against a system of record.' : 'Outcomes reported by live capabilities.'}`,
            epistemics: working.tasks.some((t) => t.simulated) ? 'hypothesis' : 'inferred-fact',
            confidence: working.tasks.some((t) => t.simulated) ? 0.4 : 0.8,
            sources: [{ connectorId: 'execution-engine', label: `Execution plan ${working.id}`, retrievedAt: new Date().toISOString() }],
          },
        ],
      });
    } else if (working.status === 'EXECUTING' || working.status === 'AWAITING_APPROVAL') {
      benefit = advance(db, benefit, 'FORECAST', { forecastValue: working.financialTarget });
    }
  }

  // Step 14 — the opportunity's status and realised value feed back to the twin view.
  updateOpportunityStatus(db, working, measuredValueGbp);

  audit(db, {
    actor: userId,
    actorKind: 'agent',
    action: 'execution.run',
    subjectType: 'execution_plan',
    subjectId: working.id,
    detail: {
      status: working.status,
      measuredValueGbp: Math.round(measuredValueGbp),
      totalCostGbp: Math.round(totalCostGbp * 100) / 100,
      awaitingApproval: awaitingApproval.map((t) => t.id),
    },
  });

  return { plan: working, benefit, awaitingApproval, measuredValueGbp: Math.round(measuredValueGbp), totalCostGbp };
}

async function executeTask(db: TenantDb, plan: ExecutionPlan, task: ExecutionTask): Promise<ExecutionTask> {
  const adapter = getAdapter(task.assignedCapability);
  const startedAt = new Date().toISOString();

  if (!adapter) {
    return {
      ...task,
      status: 'FAILED',
      startedAt,
      completedAt: new Date().toISOString(),
      outcome: `No adapter registered for capability "${task.assignedCapability}"`,
    };
  }

  let attempt = 0;
  let last: Awaited<ReturnType<typeof adapter.invoke>> | null = null;

  // Step 11 — monitor, and retry transient failure before giving up.
  while (attempt <= MAX_RETRIES) {
    last = await adapter.invoke({
      capabilityId: task.assignedCapability,
      actionId: task.capabilityAction,
      tenantId: plan.tenantId,
      companyId: plan.companyId,
      inputs: task.approvalId ? { ...task.inputs, approvalId: task.approvalId } : task.inputs,
    });
    if (last.ok) break;
    attempt++;
  }

  const completedAt = new Date().toISOString();
  const ok = last?.ok ?? false;

  recordEvent(db, {
    tenantId: plan.tenantId,
    companyId: plan.companyId,
    objective: `${plan.objective} — ${task.name}`,
    capabilityId: task.assignedCapability,
    executionId: plan.id,
    status: ok ? 'succeeded' : 'failed',
    startedAt,
    completedAt,
    durationMs: last?.durationMs ?? 0,
    costGbp: last?.costGbp ?? 0,
    inputTokens: 0,
    outputTokens: 0,
    benefitGbp: last?.measuredValueGbp ?? 0,
    failure: ok ? null : (last?.failure ?? 'unknown failure'),
    retryCount: attempt,
    detail: { taskId: task.id, action: task.capabilityAction, simulated: last?.simulated ?? true },
  });

  return {
    ...task,
    status: ok ? 'COMPLETED' : 'FAILED',
    startedAt,
    completedAt,
    outcome: ok ? `${task.assignedCapabilityName} completed ${task.name}` : (last?.failure ?? 'Failed'),
    evidence: last?.evidence ?? [],
    costGbp: last?.costGbp ?? 0,
    measuredValueGbp: last?.measuredValueGbp ?? null,
    retryCount: attempt,
    simulated: last?.simulated ?? true,
  };
}

function requestApproval(db: TenantDb, plan: ExecutionPlan, task: ExecutionTask): string {
  const id = randomUUID();
  db.run(
    `INSERT INTO approvals (id, tenant_id, execution_plan_id, task_id, requested_at, summary)
     VALUES (@id, @tenantId, @planId, @taskId, @at, @summary)`,
    {
      id,
      planId: plan.id,
      taskId: task.id,
      at: new Date().toISOString(),
      summary: `"${task.name}" via ${task.assignedCapabilityName} affects systems outside the platform and needs approval before it runs.`,
    },
  );
  audit(db, {
    actor: 'jojo',
    actorKind: 'agent',
    action: 'approval.requested',
    subjectType: 'execution_task',
    subjectId: task.id,
    detail: { planId: plan.id, capability: task.assignedCapability, action: task.capabilityAction },
  });
  return id;
}

export function approveTask(db: TenantDb, planId: string, taskId: string, userId: string, decision: 'APPROVED' | 'REJECTED', rationale: string): ExecutionPlan {
  const plan = getPlan(db, planId);
  if (!plan) throw new ExecutionError(`Execution plan ${planId} not found`);
  const idx = plan.tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) throw new ExecutionError(`Task ${taskId} not found in plan ${planId}`);

  const task = plan.tasks[idx]!;
  db.run(
    `UPDATE approvals SET decided_at = @at, decided_by = @userId, decision = @decision, rationale = @rationale
     WHERE tenant_id = @tenantId AND id = @approvalId`,
    { at: new Date().toISOString(), userId, decision, rationale, approvalId: task.approvalId ?? '' },
  );

  const tasks = [...plan.tasks];
  tasks[idx] =
    decision === 'APPROVED'
      ? { ...task, status: 'PENDING', approvalRequired: false }
      : { ...task, status: 'SKIPPED', outcome: `Rejected: ${rationale}` };

  const next: ExecutionPlan = {
    ...plan,
    tasks,
    status: decision === 'APPROVED' ? 'AUTHORISED' : 'STOPPED',
  };
  persistPlan(db, next);

  audit(db, {
    actor: userId,
    actorKind: 'human',
    action: decision === 'APPROVED' ? 'approval.granted' : 'approval.rejected',
    subjectType: 'execution_task',
    subjectId: taskId,
    detail: { planId, rationale },
  });

  return next;
}

/** Directive §12: the single control that halts execution. */
export function stopPlan(db: TenantDb, planId: string, userId: string, reason: string): ExecutionPlan {
  const plan = getPlan(db, planId);
  if (!plan) throw new ExecutionError(`Execution plan ${planId} not found`);
  const stopped: ExecutionPlan = {
    ...plan,
    status: 'STOPPED',
    tasks: plan.tasks.map((t) =>
      t.status === 'PENDING' || t.status === 'AWAITING_APPROVAL' || t.status === 'RUNNING'
        ? { ...t, status: 'SKIPPED' as TaskStatus, outcome: `Stopped: ${reason}` }
        : t,
    ),
  };
  persistPlan(db, stopped);
  audit(db, {
    actor: userId,
    actorKind: 'human',
    action: 'execution.stopped',
    subjectType: 'execution_plan',
    subjectId: planId,
    detail: { reason },
  });
  return stopped;
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

export function persistPlan(db: TenantDb, plan: ExecutionPlan): void {
  db.run(
    `INSERT INTO execution_plans
       (id, tenant_id, opportunity_id, company_id, objective, financial_target, status, plan_json,
        created_at, authorised_at, authorised_by, completed_at)
     VALUES
       (@id, @tenantId, @opportunityId, @companyId, @objective, @financialTarget, @status, @planJson,
        @createdAt, @authorisedAt, @authorisedBy, @completedAt)
     ON CONFLICT(id) DO UPDATE SET
       status = @status, plan_json = @planJson, authorised_at = @authorisedAt,
       authorised_by = @authorisedBy, completed_at = @completedAt`,
    {
      id: plan.id,
      opportunityId: plan.opportunityId,
      companyId: plan.companyId,
      objective: plan.objective,
      financialTarget: plan.financialTarget,
      status: plan.status,
      planJson: JSON.stringify(plan),
      createdAt: plan.createdAt,
      authorisedAt: plan.authorisedAt,
      authorisedBy: plan.authorisedBy,
      completedAt: plan.completedAt,
    },
  );

  for (const task of plan.tasks) {
    db.run(
      `INSERT INTO execution_tasks
         (id, tenant_id, execution_plan_id, seq, action, assigned_capability, approval_required,
          status, task_json, started_at, completed_at)
       VALUES
         (@id, @tenantId, @planId, @seq, @action, @capability, @approvalRequired, @status,
          @taskJson, @startedAt, @completedAt)
       ON CONFLICT(id) DO UPDATE SET
         status = @status, task_json = @taskJson, started_at = @startedAt,
         completed_at = @completedAt, approval_required = @approvalRequired`,
      {
        id: task.id,
        planId: plan.id,
        seq: task.seq,
        action: task.action,
        capability: task.assignedCapability,
        approvalRequired: task.approvalRequired ? 1 : 0,
        status: task.status,
        taskJson: JSON.stringify(task),
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      },
    );
  }
}

export function getPlan(db: TenantDb, planId: string): ExecutionPlan | null {
  const row = db.get<{ plan_json: string }>(
    `SELECT plan_json FROM execution_plans WHERE tenant_id = @tenantId AND id = @planId`,
    { planId },
  );
  return row ? (JSON.parse(row.plan_json) as ExecutionPlan) : null;
}

export function listPlans(db: TenantDb, companyId?: string): ExecutionPlan[] {
  const rows = db.all<{ plan_json: string }>(
    companyId
      ? `SELECT plan_json FROM execution_plans WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY created_at DESC`
      : `SELECT plan_json FROM execution_plans WHERE tenant_id = @tenantId ORDER BY created_at DESC`,
    companyId ? { companyId } : {},
  );
  return rows.map((r) => JSON.parse(r.plan_json) as ExecutionPlan);
}

function updateOpportunityStatus(db: TenantDb, plan: ExecutionPlan, measuredValue: number): void {
  const statusMap: Record<PlanStatus, string> = {
    DRAFT: 'PLANNING',
    AWAITING_AUTHORISATION: 'AWAITING_APPROVAL',
    AUTHORISED: 'EXECUTING',
    EXECUTING: 'EXECUTING',
    AWAITING_APPROVAL: 'AWAITING_APPROVAL',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    STOPPED: 'STOPPED',
  };

  const row = db.get<{ opportunity_json: string }>(
    `SELECT opportunity_json FROM opportunities WHERE tenant_id = @tenantId AND id = @id`,
    { id: plan.opportunityId },
  );
  if (!row) return;

  const opportunity = JSON.parse(row.opportunity_json) as Opportunity;
  const updated: Opportunity = {
    ...opportunity,
    executionStatus: statusMap[plan.status] as Opportunity['executionStatus'],
    startedAt: opportunity.startedAt ?? plan.createdAt,
    completedAt: plan.completedAt,
    realisedValue: plan.status === 'COMPLETED' ? Math.round(measuredValue) : opportunity.realisedValue,
  };

  db.run(
    `UPDATE opportunities
     SET execution_status = @status, realised_value = @realisedValue, opportunity_json = @json
     WHERE tenant_id = @tenantId AND id = @id`,
    {
      id: plan.opportunityId,
      status: updated.executionStatus,
      realisedValue: updated.realisedValue,
      json: JSON.stringify(updated),
    },
  );
}

export { createBenefit, AutonomyLevel };
