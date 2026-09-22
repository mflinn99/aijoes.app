/**
 * The executive morning brief — Directive 02 Phase 14.
 *
 * What Mark should be able to read in two minutes, before anything else, and
 * know what the engine did, what it found, what it needs and what it is stuck
 * on. The rule applied throughout: every line is derived from a table, and
 * anything the engine does not know is stated as unknown rather than smoothed
 * over. A brief that reads well and is wrong is worse than no brief.
 */

import type { TenantDb } from '../db/tenant';
import { gtmAnalyst } from './agents';
import { listDecisions } from './governance';
import { measureObjectives, type ObjectivesReport } from './objectives';
import { pipelineHealth, listPipelineActions, type PipelineHealth } from './pipeline';
import { health as recoveryHealth, type HealthSummary } from './recovery';
import { analyse as analyseLearning, activeStrategy } from './learning';
import { listAccounts, listHypotheses, listMeetings, listOutreach, listOpportunities } from './store';
import { pendingOutbox } from './crm/sync';

export interface BriefItem {
  /** One line, in the order Mark should read them. */
  headline: string;
  detail: string;
  /** What he is being asked to do, when anything. */
  action: string | null;
  /** Where the number came from, so it can be checked. */
  basis: string;
}

export interface MorningBrief {
  generatedAt: string;
  mspId: string;
  /** Three lines, maximum. If it needs more than three, it is not a summary. */
  headlines: string[];
  overnight: BriefItem[];
  needsYou: BriefItem[];
  pipeline: PipelineHealth;
  objectives: ObjectivesReport;
  systemHealth: HealthSummary;
  /** Things the engine cannot do and is not pretending to. */
  blockers: string[];
  /** The single most useful thing to do today, with the reason. */
  oneThing: { action: string; because: string } | null;
}

function since(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function morningBrief(db: TenantDb, mspId: string, opts: { windowHours?: number } = {}): MorningBrief {
  const windowHours = opts.windowHours ?? 24;
  const cutoff = since(windowHours);
  const generatedAt = new Date().toISOString();

  const funnel = gtmAnalyst(db, { mspId });
  const pipeline = pipelineHealth(db);
  const objectives = measureObjectives(db, mspId);
  const systemHealth = recoveryHealth(db);
  const learning = analyseLearning(db);
  const strategy = activeStrategy(db);

  // --- what happened overnight --------------------------------------------

  const newAccounts = listAccounts(db, { mspId, limit: 2000 }).filter((a) => a.createdAt >= cutoff);
  const newHypotheses = listHypotheses(db, { limit: 2000 }).filter((h) => h.createdAt >= cutoff);
  const workable = newHypotheses.filter((h) => h.quality === 'strong' || h.quality === 'workable');
  const rejected = newHypotheses.filter((h) => h.quality === 'rejected');
  const drafted = listOutreach(db, { limit: 500 }).filter((m) => m.createdAt >= cutoff);
  const sent = drafted.filter((m) => m.status === 'sent');
  const actions = listPipelineActions(db, { limit: 500 }).filter((a) => a.createdAt >= cutoff);
  const newMeetings = listMeetings(db).filter((m) => m.createdAt >= cutoff);
  const queued = pendingOutbox(db);

  const overnight: BriefItem[] = [];

  if (newAccounts.length > 0) {
    overnight.push({
      headline: `${newAccounts.length} account(s) entered the universe.`,
      detail: newAccounts.slice(0, 5).map((a) => a.name).join(', ') + (newAccounts.length > 5 ? `, and ${newAccounts.length - 5} more` : ''),
      action: null,
      basis: `gtm_accounts created in the last ${windowHours} hours.`,
    });
  }

  if (newHypotheses.length > 0) {
    overnight.push({
      headline: `${workable.length} of ${newHypotheses.length} new hypotheses cleared the evidence bar.`,
      detail: rejected.length > 0
        ? `${rejected.length} were rejected. The engine rejecting most of what it generates is the system working, not failing.`
        : 'Nothing was rejected in this window.',
      action: workable.length > 0 ? 'Review the strongest before the outreach goes out.' : null,
      basis: 'gtm_hypotheses, quality assigned by the Phase 5 rejection thresholds.',
    });
  }

  if (drafted.length > 0) {
    overnight.push({
      headline: `${drafted.length} message(s) drafted, ${sent.length} sent.`,
      detail: sent.length === 0
        ? 'Nothing has been sent. No approved email provider is configured, so messages stop at approval by design.'
        : `${sent.length} went out under approval.`,
      action: drafted.length > sent.length ? `${drafted.length - sent.length} awaiting approval.` : null,
      basis: 'gtm_outreach.',
    });
  }

  if (actions.length > 0) {
    const auto = actions.filter((a) => !a.requiresHuman).length;
    overnight.push({
      headline: `The autopilot took ${actions.length} action(s) on the pipeline.`,
      detail: `${auto} handled without you; ${actions.length - auto} need a person.`,
      action: actions.length - auto > 0 ? 'See "needs you" below.' : null,
      basis: 'gtm_pipeline_actions.',
    });
  }

  if (newMeetings.length > 0) {
    overnight.push({
      headline: `${newMeetings.length} meeting(s) booked.`,
      detail: newMeetings.map((m) => m.scheduledFor.slice(0, 10)).join(', '),
      action: 'Confirm and prepare.',
      basis: 'gtm_meetings.',
    });
  }

  if (overnight.length === 0) {
    overnight.push({
      headline: 'Nothing happened overnight.',
      detail: 'No accounts, hypotheses, messages or pipeline actions in the window. That is either a quiet night or a stopped engine — check system health below.',
      action: null,
      basis: `No rows created since ${cutoff}.`,
    });
  }

  // --- what needs Mark ------------------------------------------------------

  const needsYou: BriefItem[] = [];

  for (const decision of listDecisions(db, 'open').slice(0, 5)) {
    needsYou.push({
      headline: `${decision.trigger.replace(/-/g, ' ')}: ${decision.context}`,
      detail: `${decision.recommendation} Expected value £${Math.round(decision.expectedValue).toLocaleString('en-GB')}.`,
      action: decision.proposedAction,
      basis: `${decision.evidence.length} evidence item(s) recorded with the decision.`,
    });
  }

  const humanActions = actions.filter((a) => a.requiresHuman);
  if (humanActions.length > 0) {
    needsYou.push({
      headline: `${humanActions.length} pipeline item(s) the engine will not do itself.`,
      detail: humanActions.slice(0, 3).map((a) => a.detail).join(' | '),
      action: 'Clear these or tell the system to stop chasing them.',
      basis: 'gtm_pipeline_actions where requires_human = 1.',
    });
  }

  if (pipeline.atRisk.length > 0) {
    const top = pipeline.atRisk[0]!;
    needsYou.push({
      headline: `${pipeline.atRisk.length} open opportunit(ies) untouched for 30+ days.`,
      detail: `Largest: ${top.name} at £${Math.round(top.valueGbp).toLocaleString('en-GB')}, ${top.idleDays} days idle.`,
      action: 'Decide: work it, or let the autopilot mark it stalled at 90 days.',
      basis: 'Last activity across outreach, meetings and opportunity updates.',
    });
  }

  if (systemHealth.needsHuman.length > 0) {
    needsYou.push({
      headline: `${systemHealth.needsHuman.length} failure(s) the engine cannot recover from.`,
      detail: systemHealth.needsHuman.slice(0, 3).map((f) => `${f.component}/${f.operation}: ${f.kind}`).join(' | '),
      action: 'Most of these are credentials or permissions. See BLOCKERS.md.',
      basis: 'gtm_failures, unresolved, where the recovery rule is escalate or refresh-credential.',
    });
  }

  if (learning.proposal) {
    needsYou.push({
      headline: `The learning loop has proposed a new scoring weight set (${learning.proposal.version}).`,
      detail: learning.proposal.changes.join(' '),
      action: 'Activate it or leave it. The engine will not activate it itself.',
      basis: `${learning.totalOutcomes} recorded outcomes under ${strategy.version}.`,
    });
  }

  // --- blockers -------------------------------------------------------------

  const blockers: string[] = [];
  if (queued.length > 0) {
    blockers.push(`${queued.length} CRM write(s) queued and not yet accepted. Latest error: ${queued[0]!.lastError ?? 'unknown'}.`);
  }
  if (sent.length === 0 && drafted.length > 0) {
    blockers.push('No approved email provider is configured, so nothing can actually be sent.');
  }
  if (funnel.researched === 0) {
    blockers.push('No account has been researched. Everything downstream is empty for that reason, not because there is nothing to find.');
  }
  for (const item of objectives.progress.filter((p) => p.actual === 0)) {
    blockers.push(`${item.label}: nothing counted yet against a target of ${item.unit === 'gbp' ? `£${item.target.toLocaleString('en-GB')}` : item.target}.`);
  }

  // --- headlines ------------------------------------------------------------

  const headlines = [
    `£${pipeline.weightedGbp.toLocaleString('en-GB')} weighted pipeline across ${pipeline.open} open opportunit${pipeline.open === 1 ? 'y' : 'ies'}.`,
    needsYou.length > 0 ? `${needsYou.length} thing(s) need you.` : 'Nothing needs you today.',
    funnel.constraint,
  ];

  // --- the one thing --------------------------------------------------------

  const oneThing = decideOneThing(db, { needsYou, pipeline, objectives, funnelConstraint: funnel.constraint });

  return {
    generatedAt, mspId, headlines, overnight, needsYou,
    pipeline, objectives, systemHealth, blockers, oneThing,
  };
}

/**
 * One recommendation, ranked by what it costs to ignore. A brief that ends with
 * five priorities has no priority.
 */
function decideOneThing(
  db: TenantDb,
  input: { needsYou: BriefItem[]; pipeline: PipelineHealth; objectives: ObjectivesReport; funnelConstraint: string },
): { action: string; because: string } | null {
  const decisions = listDecisions(db, 'open');
  const biggest = decisions.sort((a, b) => b.expectedValue - a.expectedValue)[0];
  if (biggest && biggest.expectedValue >= 50_000) {
    return {
      action: biggest.proposedAction,
      because: `It is the largest open decision at £${Math.round(biggest.expectedValue).toLocaleString('en-GB')} expected value, and nothing moves on it until you decide.`,
    };
  }

  const atRisk = input.pipeline.atRisk[0];
  if (atRisk && atRisk.valueGbp >= 25_000) {
    return {
      action: `Contact ${atRisk.name} — ${atRisk.idleDays} days of silence on £${Math.round(atRisk.valueGbp).toLocaleString('en-GB')}.`,
      because: 'Idle time is the single strongest predictor of a deal not closing, and this is the largest idle deal.',
    };
  }

  const opportunities = listOpportunities(db, { open: true, limit: 50 });
  if (opportunities.length === 0) {
    return {
      action: 'Nothing is in the pipeline. The constraint is upstream.',
      because: input.funnelConstraint,
    };
  }

  if (input.objectives.worst) {
    const worst = input.objectives.progress.find((p) => p.key === input.objectives.worst)!;
    return {
      action: `Push on "${worst.label}" — ${worst.actual} of ${worst.target}.`,
      because: `It is the objective furthest from target. ${worst.countedAs}`,
    };
  }

  return null;
}

/** The brief as plain text, for email or the terminal. */
export function renderBrief(brief: MorningBrief): string {
  const lines: string[] = [];
  lines.push(`MORNING BRIEF — ${brief.generatedAt.slice(0, 10)}`);
  lines.push('');
  for (const h of brief.headlines) lines.push(`  ${h}`);
  lines.push('');

  if (brief.oneThing) {
    lines.push('IF YOU DO ONE THING');
    lines.push(`  ${brief.oneThing.action}`);
    lines.push(`  Because: ${brief.oneThing.because}`);
    lines.push('');
  }

  lines.push('OVERNIGHT');
  for (const item of brief.overnight) {
    lines.push(`  ${item.headline}`);
    lines.push(`    ${item.detail}`);
    if (item.action) lines.push(`    → ${item.action}`);
  }
  lines.push('');

  lines.push('NEEDS YOU');
  if (brief.needsYou.length === 0) lines.push('  Nothing.');
  for (const item of brief.needsYou) {
    lines.push(`  ${item.headline}`);
    lines.push(`    ${item.detail}`);
    if (item.action) lines.push(`    → ${item.action}`);
  }
  lines.push('');

  lines.push('OBJECTIVES');
  for (const p of brief.objectives.progress) {
    const actual = p.unit === 'gbp' ? `£${p.actual.toLocaleString('en-GB')}` : String(p.actual);
    const target = p.unit === 'gbp' ? `£${p.target.toLocaleString('en-GB')}` : String(p.target);
    lines.push(`  ${p.met ? '✓' : ' '} ${p.label}: ${actual} / ${target}`);
  }
  lines.push('');

  if (brief.blockers.length > 0) {
    lines.push('BLOCKED');
    for (const b of brief.blockers) lines.push(`  ${b}`);
    lines.push('');
  }

  lines.push(`System: ${brief.systemHealth.operational ? 'operational' : 'degraded'}, ${brief.systemHealth.unresolved} unresolved failure(s).`);
  return lines.join('\n');
}
