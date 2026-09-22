/**
 * The closed loop, as one runnable thing — Directive 02 Phases 16 and 18.
 *
 * DISCOVER → RESEARCH → SCORE → IDENTIFY NEED → BUILD PROPOSITION →
 * IDENTIFY BUYERS → ENGAGE → FOLLOW UP → QUALIFY → BOOK MEETING →
 * UPDATE CRM → MONITOR PIPELINE → LEARN → REPEAT.
 *
 * Every stage is an existing agent; this orchestrates them, applies the recovery
 * rules between them, and reports what each stage actually did. A stage that
 * produced nothing says so with the reason, because a loop that reports success
 * regardless of output is the failure mode this whole build is trying to avoid.
 *
 * The engine/configuration split (Phase 16): nothing in this file names Onward.
 * The MSP arrives as a profile.
 */

import type { TenantDb } from '../db/tenant';
import { audit } from '../observability/events';
import type { MspProfile } from './profile';
import {
  marketAgent, signalAgent, accountIntelligenceAgent, opportunityAgent,
  solutionAgent, contactAgent, gtmAnalyst, createOpportunityFromHypothesis, type AgentRun,
} from './agents';
import { analyseCompany } from '../analysis/pipeline';
import { getSynthetic } from '../fixtures/synthetic';
import { listAccounts, listHypotheses, getAccount, updateAccount } from './store';
import { composeCampaign } from './outreach';
import { runAutopilot, type AutopilotReport } from './pipeline';
import { reconcile, crmTargets, type CrmTargets, type ReconcileReport } from './crm/sync';
import { harvestOutcomes, analyse as analyseLearning, type LearningReport } from './learning';
import { measureObjectives, seedObjectives, type ObjectivesReport } from './objectives';
import { withRecovery, recordFailure, health as recoveryHealth, type HealthSummary } from './recovery';
import { DEFAULT_POLICY, type CommercialPolicy } from './governance';
import { workable } from './hypothesis';
import { MIN_UNDERSTANDING_TO_SCORE } from './thresholds';

export interface StageResult {
  stage: string;
  ran: boolean;
  produced: number;
  /** What happened, in a sentence someone could disagree with. */
  summary: string;
  /** Present when the stage could not do its job. */
  blockedBy: string | null;
}

export interface LoopReport {
  mspId: string;
  startedAt: string;
  completedAt: string;
  stages: StageResult[];
  autopilot: AutopilotReport | null;
  crm: ReconcileReport | null;
  learning: LearningReport | null;
  objectives: ObjectivesReport;
  systemHealth: HealthSummary;
  /** The stage that most limits everything downstream. */
  constraint: string;
}

export interface LoopOptions {
  mspId: string;
  profile: MspProfile;
  /** Which discovery source to draw from. */
  sourceId?: string;
  /** How many accounts to add this cycle. */
  discover?: number;
  /** How many accounts to research this cycle — the expensive stage. */
  research?: number;
  /** Cap on messages composed. Deliberately small until responses are measured. */
  outreach?: number;
  policy?: CommercialPolicy;
  targets?: CrmTargets;
  /** Offline research, for synthetic accounts and tests. */
  offline?: boolean;
  now?: Date;
}

function fromAgent(stage: string, run: AgentRun, blockedBy: string | null = null): StageResult {
  return { stage, ran: true, produced: run.produced, summary: run.notes.join(' '), blockedBy };
}

/**
 * One full cycle. Safe to run repeatedly: every stage underneath is idempotent,
 * so a second cycle in the same hour adds accounts and re-scores, but does not
 * duplicate hypotheses, messages, opportunities or CRM records.
 */
export async function runLoop(db: TenantDb, opts: LoopOptions): Promise<LoopReport> {
  const startedAt = new Date().toISOString();
  const now = opts.now ?? new Date();
  const targets = opts.targets ?? crmTargets(db);
  const policy = opts.policy ?? DEFAULT_POLICY;
  const stages: StageResult[] = [];

  seedObjectives(db, opts.mspId);

  // --- 1. DISCOVER ---------------------------------------------------------
  const discovery = await withRecovery(
    db, { component: 'market', operation: 'discover' },
    () => marketAgent(db, { mspId: opts.mspId, sourceId: opts.sourceId ?? 'seed-list', limit: opts.discover ?? 25 }),
  );
  stages.push(
    discovery.value
      ? fromAgent('discover', discovery.value)
      : { stage: 'discover', ran: false, produced: 0, summary: 'Discovery failed.', blockedBy: discovery.decisions.at(-1)?.rationale ?? 'Unknown failure.' },
  );

  // --- 2. RESEARCH ---------------------------------------------------------
  const unresearched = listAccounts(db, { mspId: opts.mspId, researchState: 'unresearched', limit: opts.research ?? 25 });
  let researched = 0;
  const researchNotes: string[] = [];

  for (const account of unresearched) {
    const fixture = account.domain ? getSynthetic(account.domain.split('.')[0] ?? '') : undefined;
    const result = await withRecovery(
      db, { component: 'research', operation: 'analyse', subjectId: account.id },
      () => analyseCompany(db, account.domain ?? account.name, {
        offline: opts.offline ?? false,
        ...(fixture ? { seedRecords: fixture.records, userSupplied: fixture.userSupplied } : {}),
      }),
    );

    // A run that completes without learning anything is not research. The
    // analysis pipeline deliberately survives connector failures, so a company
    // whose every source was unreachable comes back as a successful run over an
    // empty twin. Marking that 'researched' would be the engine claiming
    // knowledge it does not have, so understanding is the test, not the absence
    // of a thrown error.
    if (result.value && result.value.understanding >= MIN_UNDERSTANDING_TO_SCORE) {
      updateAccount(db, account.id, { companyId: result.value.twin.id, researchState: 'researched' });
      researched++;
    } else if (result.value) {
      updateAccount(db, account.id, { companyId: result.value.twin.id, researchState: 'research-failed' });
      const reason = `understanding ${result.value.understanding}% — no source returned anything usable`;
      researchNotes.push(`${account.name}: ${reason}`);
      recordFailure(db, {
        component: 'research', operation: 'analyse', subjectId: account.id,
        error: new Error(`EGRESS_BLOCKED or no source available for ${account.domain ?? account.name}: ${reason}`),
      });
    } else {
      updateAccount(db, account.id, { researchState: 'research-failed' });
      researchNotes.push(`${account.name}: ${result.decisions.at(-1)?.kind ?? 'unknown failure'}`);
    }
  }

  stages.push({
    stage: 'research',
    ran: unresearched.length > 0,
    produced: researched,
    summary: unresearched.length === 0
      ? 'Nothing was waiting to be researched.'
      : `${researched} of ${unresearched.length} account(s) researched.`,
    blockedBy: researchNotes.length > 0 ? `${researchNotes.length} failed: ${researchNotes.slice(0, 3).join('; ')}` : null,
  });

  // --- 3. SCORE ------------------------------------------------------------
  stages.push(fromAgent('score', accountIntelligenceAgent(db, { mspId: opts.mspId, profile: opts.profile })));

  // --- 4. SIGNALS ----------------------------------------------------------
  stages.push(fromAgent('detect-signals', signalAgent(db, { mspId: opts.mspId })));

  // --- 5. IDENTIFY NEED ----------------------------------------------------
  const opportunities = opportunityAgent(db, { mspId: opts.mspId, profile: opts.profile });
  stages.push({
    ...fromAgent('identify-need', opportunities),
    // Rejection is the feature. Reporting only the survivors would hide the bar.
    summary: `${opportunities.notes.join(' ')} Rejection is the engine working: a hypothesis that cannot answer all eleven questions is a lead, not an opportunity.`,
  });

  // --- 6. BUILD PROPOSITION ------------------------------------------------
  const solutions = solutionAgent(db, { profile: opts.profile });
  stages.push(fromAgent('build-proposition', solutions));

  // --- 7. IDENTIFY BUYERS --------------------------------------------------
  const contacts = contactAgent(db, { mspId: opts.mspId });
  stages.push(fromAgent('identify-buyers', contacts));

  // --- 8. ENGAGE -----------------------------------------------------------
  const hypotheses = workable(listHypotheses(db, { quality: ['strong', 'workable'], limit: 500 }));
  const accountMap = new Map(
    hypotheses.map((h) => [h.accountId, getAccount(db, h.accountId)]).filter((e): e is [string, NonNullable<ReturnType<typeof getAccount>>] => e[1] !== null),
  );
  const campaign = composeCampaign(db, {
    hypotheses, accounts: accountMap, profile: opts.profile, limit: opts.outreach ?? 10, policy,
  });
  stages.push({
    stage: 'engage',
    ran: true,
    produced: campaign.composed,
    summary: campaign.composed === 0
      ? `No message was composed. Refused: ${campaign.refused.map((r) => `${r.rule} (${r.count})`).join(', ') || 'nothing to compose from'}.`
      : `${campaign.composed} message(s) composed for approval. Refused: ${campaign.refused.map((r) => `${r.rule} (${r.count})`).join(', ') || 'none'}.`,
    blockedBy: campaign.haltedBecause ?? null,
  });

  // --- 9. OPEN OPPORTUNITIES -----------------------------------------------
  //
  // One open opportunity per account per service line. Three archetypes can all
  // point at managed IT for the same company — cyber, Microsoft estate and "no
  // internal IT" frequently do — and opening one opportunity each would show
  // three times the value of a single contract in the weighted forecast. The
  // account still carries all three hypotheses, because the reasons are
  // genuinely different and each is worth putting to the customer; it is the
  // money that must not be counted three times.
  const bestPerService = new Map<string, typeof hypotheses[number]>();
  for (const hypothesis of hypotheses) {
    const account = accountMap.get(hypothesis.accountId);
    if (!account || account.synthetic) continue;
    const key = `${hypothesis.accountId}:${hypothesis.serviceIds[0] ?? 'none'}`;
    const held = bestPerService.get(key);
    if (!held || hypothesis.confidence > held.confidence) bestPerService.set(key, hypothesis);
  }

  let opened = 0;
  let collapsed = 0;
  for (const hypothesis of bestPerService.values()) {
    const account = accountMap.get(hypothesis.accountId)!;
    createOpportunityFromHypothesis(db, hypothesis, account);
    opened++;
  }
  collapsed = hypotheses.filter((h) => {
    const a = accountMap.get(h.accountId);
    return a !== undefined && !a.synthetic;
  }).length - opened;

  stages.push({
    stage: 'open-opportunities',
    ran: true,
    produced: opened,
    summary: opened > 0
      ? `${opened} opportunit(ies) open in the pipeline.` +
        (collapsed > 0
          ? ` ${collapsed} further hypothesis(es) point at a service already in the pipeline for that account, so they are kept as reasons to talk but not counted again as money.`
          : '')
      : hypotheses.length === 0
        ? 'No opportunity was opened, because no hypothesis cleared the evidence bar. There is nothing to open.'
        : 'No opportunity was opened. Every workable hypothesis belongs to a synthetic account, and synthetic accounts are excluded by design.',
    blockedBy: null,
  });

  // --- 10. MONITOR PIPELINE ------------------------------------------------
  const autopilot = await runAutopilot(db, { mspId: opts.mspId, profile: opts.profile, policy, targets, now });
  stages.push({
    stage: 'monitor-pipeline',
    ran: true,
    produced: autopilot.fired.length,
    summary: `${autopilot.examined} examined, ${autopilot.fired.length} action(s), ${autopilot.stagesChanged.length} stage change(s), ${autopilot.escalations} escalation(s).`,
    blockedBy: autopilot.blocked.length > 0 ? autopilot.blocked.join(' ') : null,
  });

  // --- 11. UPDATE CRM ------------------------------------------------------
  const crm = await reconcile(db, targets);
  stages.push({
    stage: 'update-crm',
    ran: true,
    produced: crm.created + crm.updated,
    summary: `${crm.created} created, ${crm.updated} updated, ${crm.unchanged} already current.`,
    blockedBy: crm.externalProvider === null ? crm.notes.join(' ') : crm.queued > 0 ? `${crm.queued} write(s) queued after a retryable failure.` : null,
  });

  // --- 12. LEARN -----------------------------------------------------------
  harvestOutcomes(db);
  const learning = analyseLearning(db);
  stages.push({
    stage: 'learn',
    ran: true,
    produced: learning.totalOutcomes,
    summary: learning.proposal
      ? `A weighting change is proposed (${learning.proposal.version}). It will not be applied until a person activates it.`
      : learning.withheldBecause ?? 'No change proposed.',
    blockedBy: null,
  });

  const funnel = gtmAnalyst(db, { mspId: opts.mspId });
  const objectives = measureObjectives(db, opts.mspId);
  const systemHealth = recoveryHealth(db);

  const report: LoopReport = {
    mspId: opts.mspId,
    startedAt,
    completedAt: new Date().toISOString(),
    stages,
    autopilot,
    crm,
    learning,
    objectives,
    systemHealth,
    constraint: funnel.constraint,
  };

  audit(db, {
    actor: 'agent:loop', actorKind: 'agent', action: 'gtm.loop.completed',
    subjectType: 'msp', subjectId: opts.mspId,
    detail: {
      stages: stages.map((s) => ({ stage: s.stage, produced: s.produced, blocked: s.blockedBy !== null })),
      constraint: report.constraint,
    },
  });

  return report;
}

/** The loop as plain text, for a terminal run or a log. */
export function renderLoop(report: LoopReport): string {
  const lines = [`GTM LOOP — ${report.mspId} — ${report.startedAt.slice(0, 19).replace('T', ' ')}`, ''];
  for (const s of report.stages) {
    lines.push(`${s.stage.toUpperCase().padEnd(20)} ${String(s.produced).padStart(5)}  ${s.summary}`);
    if (s.blockedBy) lines.push(`${' '.repeat(20)}        BLOCKED: ${s.blockedBy}`);
  }
  lines.push('', `Constraint: ${report.constraint}`);
  lines.push(`System: ${report.systemHealth.operational ? 'operational' : 'degraded'}, ${report.systemHealth.unresolved} unresolved failure(s).`);
  return lines.join('\n');
}
