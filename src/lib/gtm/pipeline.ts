/**
 * Pipeline autopilot — Directive 02 Phase 10.
 *
 * "No qualified opportunity should become dormant simply because a human forgot
 * it." The autopilot is a set of explicit, dated rules over open opportunities.
 * Each rule states the condition it fires on, what it does, and whether a human
 * is required — and every firing is recorded, so the pipeline's movement has an
 * auditable cause rather than being attributed to "the AI".
 *
 * What it will do on its own: schedule the next action, compose a follow-up,
 * queue a CRM task, flag a stall, re-forecast a close date.
 *
 * What it will never do on its own: send an unapproved message, change a deal's
 * value, mark a deal won or lost, or contact anyone the outreach rules refuse.
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import { audit } from '../observability/events';
import type { GtmOpportunity, OutreachMessage, PipelineStage } from './types';
import { STAGE_PROBABILITY } from './types';
import { getAccount, getHypothesis, listContacts, listMeetings, listOpportunities, listOutreach, upsertOpportunity } from './store';
import type { MspProfile } from './profile';
import { compose } from './outreach';
import { DEFAULT_POLICY, type CommercialPolicy, needsEscalation, raiseDecisionOnce } from './governance';
import { crmTargets, syncOpportunity, syncTask, drainOutbox, type CrmTargets } from './crm/sync';

export type PipelineRuleId =
  | 'no-next-action'
  | 'next-action-overdue'
  | 'contacted-no-response'
  | 'response-not-progressed'
  | 'meeting-booked-not-held'
  | 'meeting-held-not-qualified'
  | 'qualified-no-proposal'
  | 'proposal-ageing'
  | 'dormant'
  | 'close-date-passed'
  | 'high-value-needs-owner';

export interface PipelineRule {
  id: PipelineRuleId;
  /** Plain English, because a salesperson has to be able to argue with it. */
  description: string;
  /** Stages the rule applies to. */
  stages: PipelineStage[];
  /** Days of inactivity before it fires. */
  afterDays: number;
  requiresHuman: boolean;
}

/**
 * The cadence. These are deliberately conservative — an engine that chases
 * every deal every day is worse than a human who forgets, because it burns the
 * relationship instead of just the opportunity.
 */
export const RULES: PipelineRule[] = [
  { id: 'no-next-action', description: 'An open opportunity with no next action is invisible work. Set one.', stages: ['identified', 'contacted', 'responded', 'meeting-booked', 'qualified', 'proposal'], afterDays: 0, requiresHuman: false },
  { id: 'next-action-overdue', description: 'The next action date has passed and nothing was logged.', stages: ['identified', 'contacted', 'responded', 'meeting-booked', 'qualified', 'proposal'], afterDays: 0, requiresHuman: false },
  { id: 'contacted-no-response', description: 'Contacted, no response. Prepare the next step of the sequence.', stages: ['contacted'], afterDays: 14, requiresHuman: false },
  { id: 'response-not-progressed', description: 'They replied and nothing happened for a week. That is the most expensive kind of forgetting.', stages: ['responded'], afterDays: 7, requiresHuman: true },
  { id: 'meeting-booked-not-held', description: 'The meeting date has passed and the outcome was never recorded.', stages: ['meeting-booked'], afterDays: 1, requiresHuman: true },
  { id: 'meeting-held-not-qualified', description: 'A meeting happened and the opportunity was never qualified or closed out.', stages: ['meeting-booked'], afterDays: 5, requiresHuman: true },
  { id: 'qualified-no-proposal', description: 'Qualified for three weeks with no proposal. Either write it or say why not.', stages: ['qualified'], afterDays: 21, requiresHuman: true },
  { id: 'proposal-ageing', description: 'A proposal has been out for a month without a decision.', stages: ['proposal'], afterDays: 30, requiresHuman: true },
  { id: 'dormant', description: 'Ninety days of silence. Move it to stalled so the forecast stops counting it.', stages: ['identified', 'contacted', 'responded', 'meeting-booked', 'qualified', 'proposal'], afterDays: 90, requiresHuman: false },
  { id: 'close-date-passed', description: 'The forecast close date is in the past. A forecast nobody re-dated is a lie in the pipeline.', stages: ['qualified', 'proposal'], afterDays: 0, requiresHuman: false },
  { id: 'high-value-needs-owner', description: 'A large opportunity with no named owner will be nobody’s job.', stages: ['qualified', 'proposal'], afterDays: 0, requiresHuman: true },
];

export interface PipelineAction {
  id: string;
  opportunityId: string;
  rule: PipelineRuleId;
  action: string;
  detail: string;
  requiresHuman: boolean;
  createdAt: string;
}

export interface AutopilotReport {
  examined: number;
  fired: PipelineAction[];
  followUpsComposed: number;
  followUpsRefused: { rule: string; count: number }[];
  tasksRaised: number;
  stagesChanged: { opportunityId: string; from: PipelineStage; to: PipelineStage; because: PipelineRuleId }[];
  escalations: number;
  crm: { synced: number; queued: number; failed: number; drained: number; stillQueued: number };
  /** What the autopilot could not do and why — never silently skipped. */
  blocked: string[];
}

const DAY_MS = 86_400_000;

function daysSince(iso: string | null, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (now.getTime() - new Date(iso).getTime()) / DAY_MS;
}

function record(db: TenantDb, action: Omit<PipelineAction, 'id' | 'createdAt'>): PipelineAction {
  const full: PipelineAction = { ...action, id: randomUUID(), createdAt: new Date().toISOString() };
  db.run(
    `INSERT INTO gtm_pipeline_actions (id, tenant_id, opportunity_id, rule, action, detail, requires_human, created_at)
     VALUES (@id, @tenantId, @opportunityId, @rule, @action, @detail, @requiresHuman, @createdAt)`,
    { ...full, requiresHuman: full.requiresHuman ? 1 : 0 },
  );
  return full;
}

export function listPipelineActions(db: TenantDb, opts: { opportunityId?: string; limit?: number } = {}): PipelineAction[] {
  const clauses = ['tenant_id = @tenantId'];
  const params: Record<string, unknown> = {};
  if (opts.opportunityId) { clauses.push('opportunity_id = @opportunityId'); params['opportunityId'] = opts.opportunityId; }
  return db
    .all<{ id: string; opportunity_id: string; rule: string; action: string; detail: string; requires_human: number; created_at: string }>(
      `SELECT * FROM gtm_pipeline_actions WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ${Math.min(opts.limit ?? 200, 1000)}`,
      params,
    )
    .map((r) => ({
      id: r.id, opportunityId: r.opportunity_id, rule: r.rule as PipelineRuleId,
      action: r.action, detail: r.detail, requiresHuman: r.requires_human === 1, createdAt: r.created_at,
    }));
}

/** The last thing that happened on an opportunity, from any channel. */
function lastTouch(db: TenantDb, opp: GtmOpportunity): string | null {
  const candidates: (string | null)[] = [opp.lastActionAt, opp.updatedAt];
  const messages = listOutreach(db, { accountId: opp.accountId, limit: 50 });
  for (const m of messages) if (m.sentAt) candidates.push(m.sentAt);
  for (const m of listMeetings(db).filter((x) => x.opportunityId === opp.id)) candidates.push(m.scheduledFor);
  const valid = candidates.filter((c): c is string => c !== null);
  if (valid.length === 0) return null;
  return valid.sort().at(-1) ?? null;
}

/** Which rules fire on this opportunity right now, in priority order. */
export function evaluateRules(db: TenantDb, opp: GtmOpportunity, policy: CommercialPolicy, now: Date): PipelineRule[] {
  if (opp.stage === 'won' || opp.stage === 'lost') return [];

  const idle = daysSince(lastTouch(db, opp), now);
  const fired: PipelineRule[] = [];

  for (const rule of RULES) {
    if (!rule.stages.includes(opp.stage)) continue;

    switch (rule.id) {
      case 'no-next-action':
        if (!opp.nextAction) fired.push(rule);
        break;
      case 'next-action-overdue':
        if (opp.nextActionAt && new Date(opp.nextActionAt) < now && daysSince(opp.lastActionAt, now) > daysSince(opp.nextActionAt, now)) fired.push(rule);
        break;
      case 'meeting-booked-not-held': {
        const past = listMeetings(db).filter((m) => m.opportunityId === opp.id && m.status === 'booked' && new Date(m.scheduledFor) < now);
        if (past.length > 0) fired.push(rule);
        break;
      }
      case 'meeting-held-not-qualified': {
        const held = listMeetings(db).filter((m) => m.opportunityId === opp.id && m.status === 'held');
        if (held.length > 0 && daysSince(held.map((m) => m.scheduledFor).sort().at(-1) ?? null, now) >= rule.afterDays) fired.push(rule);
        break;
      }
      case 'close-date-passed':
        if (opp.closeDate && new Date(opp.closeDate) < now) fired.push(rule);
        break;
      case 'high-value-needs-owner':
        if (!opp.owner && opp.valueGbp >= policy.highValueThresholdGbp) fired.push(rule);
        break;
      case 'dormant':
        if (idle >= rule.afterDays) fired.push(rule);
        break;
      default:
        if (idle >= rule.afterDays) fired.push(rule);
    }
  }

  // 'dormant' supersedes the softer nudges: one action per opportunity per run
  // for chase rules, so the autopilot cannot stack three follow-ups in a day.
  if (fired.some((r) => r.id === 'dormant')) {
    return fired.filter((r) => r.id === 'dormant' || r.id === 'no-next-action' || r.id === 'close-date-passed');
  }
  return fired;
}

/** Next action text per stage. Deliberately concrete — "follow up" is not an action. */
function nextActionFor(stage: PipelineStage, accountName: string): { action: string; inDays: number } {
  switch (stage) {
    case 'identified': return { action: `Send the first evidence-backed approach to ${accountName}`, inDays: 2 };
    case 'contacted': return { action: `Second touch to ${accountName} if no reply`, inDays: 14 };
    case 'responded': return { action: `Reply to ${accountName} and offer two specific times`, inDays: 1 };
    case 'meeting-booked': return { action: `Prepare for the ${accountName} meeting and record the outcome afterwards`, inDays: 3 };
    case 'qualified': return { action: `Scope and price the work for ${accountName}`, inDays: 7 };
    case 'proposal': return { action: `Chase the ${accountName} decision`, inDays: 7 };
    default: return { action: `Review ${accountName}`, inDays: 14 };
  }
}

export interface AutopilotOptions {
  mspId: string;
  profile: MspProfile;
  policy?: CommercialPolicy;
  now?: Date;
  targets?: CrmTargets;
  /** Cap on follow-ups composed in one run — volume discipline, not a technical limit. */
  maxFollowUps?: number;
}

/**
 * One pass of the autopilot. Idempotent within a day: a rule that has already
 * fired on an opportunity today does not fire again, so running it hourly does
 * not multiply the chasing.
 */
export async function runAutopilot(db: TenantDb, opts: AutopilotOptions): Promise<AutopilotReport> {
  const now = opts.now ?? new Date();
  const policy = opts.policy ?? DEFAULT_POLICY;
  const targets = opts.targets ?? crmTargets(db);
  const maxFollowUps = opts.maxFollowUps ?? 10;

  const report: AutopilotReport = {
    examined: 0, fired: [], followUpsComposed: 0, followUpsRefused: [],
    tasksRaised: 0, stagesChanged: [], escalations: 0,
    crm: { synced: 0, queued: 0, failed: 0, drained: 0, stillQueued: 0 },
    blocked: [],
  };

  const refusals = new Map<string, number>();
  const today = now.toISOString().slice(0, 10);
  const firedToday = new Set(
    db
      .all<{ opportunity_id: string; rule: string }>(
        `SELECT opportunity_id, rule FROM gtm_pipeline_actions
         WHERE tenant_id = @tenantId AND created_at >= @since`,
        { since: `${today}T00:00:00.000Z` },
      )
      .map((r) => `${r.opportunity_id}:${r.rule}`),
  );

  for (const opp of listOpportunities(db, { open: true, limit: 500 })) {
    report.examined++;
    const account = getAccount(db, opp.accountId);
    if (!account) { report.blocked.push(`Opportunity ${opp.id} has no account.`); continue; }

    let current = opp;

    for (const rule of evaluateRules(db, current, policy, now)) {
      if (firedToday.has(`${current.id}:${rule.id}`)) continue;

      switch (rule.id) {
        case 'no-next-action':
        case 'next-action-overdue': {
          const next = nextActionFor(current.stage, account.name);
          current = upsertOpportunity(db, {
            ...current,
            nextAction: next.action,
            nextActionAt: new Date(now.getTime() + next.inDays * DAY_MS).toISOString(),
            updatedAt: now.toISOString(),
          });
          report.fired.push(record(db, {
            opportunityId: current.id, rule: rule.id,
            action: 'next-action-set', detail: next.action, requiresHuman: false,
          }));
          break;
        }

        case 'contacted-no-response': {
          if (report.followUpsComposed >= maxFollowUps) {
            report.blocked.push(`Follow-up cap of ${maxFollowUps} reached; ${account.name} deferred to the next run.`);
            break;
          }
          const hypothesis = getHypothesis(db, current.hypothesisId);
          if (!hypothesis) { report.blocked.push(`Opportunity ${current.id} has no hypothesis to follow up from.`); break; }

          const sent = listOutreach(db, { accountId: current.accountId, limit: 50 }).filter((m) => m.status === 'sent');
          const contacts = listContacts(db, current.accountId);
          const contact = contacts.find((c) => c.email && !c.suppressed) ?? contacts[0] ?? null;

          const result = compose(db, {
            account, hypothesis, contact, profile: opts.profile, policy,
            step: Math.min(sent.length + 1, 3),
          });

          if (result.composed) {
            report.followUpsComposed++;
            report.fired.push(record(db, {
              opportunityId: current.id, rule: rule.id,
              action: 'follow-up-drafted',
              detail: `Step ${result.message.step} drafted for approval. Reason: ${result.message.reasonForContact}`,
              requiresHuman: true,
            }));
          } else {
            refusals.set(result.rule, (refusals.get(result.rule) ?? 0) + 1);
            report.fired.push(record(db, {
              opportunityId: current.id, rule: rule.id,
              action: 'follow-up-refused', detail: `${result.rule}: ${result.reason}`, requiresHuman: false,
            }));
          }
          break;
        }

        case 'dormant': {
          const from = current.stage;
          current = upsertOpportunity(db, {
            ...current, stage: 'stalled', probability: STAGE_PROBABILITY.stalled, updatedAt: now.toISOString(),
          });
          report.stagesChanged.push({ opportunityId: current.id, from, to: 'stalled', because: rule.id });
          report.fired.push(record(db, {
            opportunityId: current.id, rule: rule.id,
            action: 'stage-changed',
            detail: `Ninety days without contact. Moved from ${from} to stalled so the weighted forecast stops counting it.`,
            requiresHuman: false,
          }));
          break;
        }

        case 'close-date-passed': {
          const pushed = new Date(now.getTime() + 30 * DAY_MS).toISOString().slice(0, 10);
          current = upsertOpportunity(db, { ...current, closeDate: pushed, updatedAt: now.toISOString() });
          report.fired.push(record(db, {
            opportunityId: current.id, rule: rule.id,
            action: 'close-date-reforecast',
            detail: `Close date had passed. Re-dated to ${pushed} and flagged for review — the engine cannot know the real date.`,
            requiresHuman: true,
          }));
          break;
        }

        default: {
          // The human rules: raise a dated, specific CRM task rather than nag.
          const dueAt = new Date(now.getTime() + DAY_MS).toISOString();
          const taskId = `task-${current.id}-${rule.id}`;
          const outcomes = await syncTask(db, targets, {
            localId: taskId,
            accountId: current.accountId,
            opportunityId: current.id,
            subject: `${account.name}: ${rule.description}`,
            body: `${rule.description}\n\nOpportunity: ${current.name}\nStage: ${current.stage}\nValue: £${Math.round(current.valueGbp).toLocaleString('en-GB')}\nLast activity: ${lastTouch(db, current) ?? 'none recorded'}`,
            dueAt,
            assignee: current.owner,
          });
          for (const o of outcomes) {
            if (o.action === 'created' || o.action === 'updated') report.crm.synced++;
            else if (o.action === 'queued') report.crm.queued++;
            else if (o.action === 'failed') report.crm.failed++;
          }
          report.tasksRaised++;
          report.fired.push(record(db, {
            opportunityId: current.id, rule: rule.id,
            action: 'task-raised', detail: rule.description, requiresHuman: true,
          }));
          break;
        }
      }

      firedToday.add(`${current.id}:${rule.id}`);
    }

    // Anything material goes to Mark with a recommendation, not a notification.
    const hypothesis = getHypothesis(db, current.hypothesisId);
    if (hypothesis) {
      const escalation = needsEscalation(hypothesis, opts.profile, policy);
      if (escalation.required && escalation.trigger) {
        const raised = raiseDecisionOnce(db, {
          trigger: escalation.trigger,
          subjectType: 'opportunity',
          subjectId: current.id,
          context: `${account.name} \u2014 ${current.name}, ${current.stage}, \u00a3${Math.round(current.valueGbp).toLocaleString('en-GB')}. ${hypothesis.whatIsHappening}`,
          evidence: hypothesis.evidence,
          recommendation: escalation.reason,
          expectedValue: current.weightedGbp,
          proposedAction: current.nextAction ?? hypothesis.nextAction,
        });
        if (raised) report.escalations++;
      }
    }

    const outcomes = await syncOpportunity(db, targets, current);
    for (const o of outcomes) {
      if (o.action === 'created' || o.action === 'updated') report.crm.synced++;
      else if (o.action === 'queued') report.crm.queued++;
      else if (o.action === 'failed') report.crm.failed++;
    }
  }

  const drain = await drainOutbox(db, targets, now);
  report.crm.drained = drain.drained;
  report.crm.stillQueued = drain.stillQueued;

  report.followUpsRefused = [...refusals.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count);

  audit(db, {
    actor: 'agent:pipeline', actorKind: 'agent', action: 'gtm.autopilot.run',
    subjectType: 'pipeline', subjectId: opts.mspId,
    detail: {
      examined: report.examined, fired: report.fired.length, tasksRaised: report.tasksRaised,
      stagesChanged: report.stagesChanged.length, escalations: report.escalations, crm: report.crm,
    },
  });

  return report;
}

export interface PipelineHealth {
  open: number;
  weightedGbp: number;
  byStage: { stage: PipelineStage; count: number; valueGbp: number; weightedGbp: number }[];
  /** Open opportunities with no activity for 30+ days. */
  atRisk: { id: string; name: string; stage: PipelineStage; idleDays: number; valueGbp: number }[];
  /** Opportunities the autopilot has handed to a person and nobody has picked up. */
  awaitingHuman: number;
  oldestUnactionedDays: number | null;
}

export function pipelineHealth(db: TenantDb, now = new Date()): PipelineHealth {
  const open = listOpportunities(db, { open: true, limit: 1000 });
  const byStage = new Map<PipelineStage, { count: number; valueGbp: number; weightedGbp: number }>();
  const atRisk: PipelineHealth['atRisk'] = [];

  for (const o of open) {
    const slot = byStage.get(o.stage) ?? { count: 0, valueGbp: 0, weightedGbp: 0 };
    slot.count++; slot.valueGbp += o.valueGbp; slot.weightedGbp += o.weightedGbp;
    byStage.set(o.stage, slot);

    const idle = daysSince(lastTouch(db, o), now);
    if (idle >= 30) {
      atRisk.push({ id: o.id, name: o.name, stage: o.stage, idleDays: Math.round(idle === Infinity ? 999 : idle), valueGbp: o.valueGbp });
    }
  }

  const humanActions = listPipelineActions(db, { limit: 1000 }).filter((a) => a.requiresHuman);
  const oldest = humanActions.at(-1);

  return {
    open: open.length,
    weightedGbp: Math.round(open.reduce((s, o) => s + o.weightedGbp, 0)),
    byStage: [...byStage.entries()].map(([stage, v]) => ({ stage, ...v, valueGbp: Math.round(v.valueGbp), weightedGbp: Math.round(v.weightedGbp) })),
    atRisk: atRisk.sort((a, b) => b.valueGbp - a.valueGbp).slice(0, 20),
    awaitingHuman: humanActions.length,
    oldestUnactionedDays: oldest ? Math.round(daysSince(oldest.createdAt, now)) : null,
  };
}
