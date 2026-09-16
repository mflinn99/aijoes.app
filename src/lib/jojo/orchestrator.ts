/**
 * JoJo — Directive §13 and §31.
 *
 * "Avoid creating a monolithic agent. JoJo should orchestrate specialist agents."
 *
 * JoJo holds no domain logic of its own. It parses an objective into a
 * measurable outcome, selects existing opportunities or capabilities that serve
 * it, and hands execution to the engine. Every decision it makes is inspectable
 * — objective parsing is deterministic pattern matching, not a model call, so a
 * mis-parse is a bug that can be fixed rather than a prompt that can be coaxed.
 */

import type { TenantDb } from '../db/tenant';
import type { Opportunity, OpportunityCategory } from '../core/opportunity';
import { startAvailable } from '../core/opportunity';
import { listOpportunities, listCompanies } from '../db/repositories/company';
import { listCustomers } from '../db/repositories/tenant-data';
import { routeObjective } from '../capabilities/router';
import { listBenefits, summariseLedger } from '../benefits/ledger';

export type ObjectiveKind =
  | 'analyse-company'
  | 'find-savings'
  | 'start-opportunities'
  | 'msp-expansion'
  | 'pipeline-target'
  | 'portfolio-next-action'
  | 'unknown';

export interface ParsedObjective {
  kind: ObjectiveKind;
  /** The measurable outcome JoJo will be held to. */
  measurableOutcome: string;
  /** GBP target, where the objective states one. */
  financialTarget: number | null;
  /** Numeric target that is not money, e.g. "10 qualified appointments". */
  countTarget: { value: number; unit: string } | null;
  companyHint: string | null;
  categoryFilter: OpportunityCategory | null;
  riskFilter: 'low' | null;
  limit: number | null;
  raw: string;
}

const MONEY = /£\s?([\d,]+(?:\.\d+)?)\s*([km])?/i;
const COUNT = /(\d+)\s+(qualified\s+)?(sales\s+)?(appointments?|meetings?|opportunit(?:y|ies)|leads?)/i;
const TOP_N = /\btop\s+(\d+|one|two|three|four|five|ten)\b/i;

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 };

export function parseObjective(raw: string): ParsedObjective {
  const text = raw.trim();
  const lower = text.toLowerCase();

  const moneyMatch = MONEY.exec(text);
  let financialTarget: number | null = null;
  if (moneyMatch) {
    const base = Number(moneyMatch[1]!.replace(/,/g, ''));
    const suffix = moneyMatch[2]?.toLowerCase();
    financialTarget = suffix === 'm' ? base * 1_000_000 : suffix === 'k' ? base * 1_000 : base;
  }

  const countMatch = COUNT.exec(text);
  const countTarget = countMatch ? { value: Number(countMatch[1]), unit: countMatch[4]! } : null;

  const topMatch = TOP_N.exec(text);
  const limit = topMatch ? (WORD_NUMBERS[topMatch[1]!.toLowerCase()] ?? Number(topMatch[1])) : null;

  const riskFilter = /\blow.risk\b/.test(lower) ? ('low' as const) : null;

  // Company hint: "analyse X and ...", "about X", "for X".
  const companyMatch =
    /\banalys[ei]s?\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)/.exec(text) ??
    /\b(?:for|about|on)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)/.exec(text);
  const companyHint = companyMatch?.[1]?.trim() ?? null;

  let kind: ObjectiveKind = 'unknown';
  let measurableOutcome = 'No measurable outcome could be derived from this objective.';
  let categoryFilter: OpportunityCategory | null = null;

  // An explicit "analyse <company>" wins over any keyword inside the same
  // sentence. The directive's own example — "analyse Claritas Solutions and
  // tell me the best ways to increase turnover and cut cost" — mentions both
  // growth and cost, and asking for one category there would drop half of what
  // was asked for.
  if (/\banalys[ei]/.test(lower)) {
    kind = 'analyse-company';
    const wantsGrowth = /turnover|revenue|grow|make more/.test(lower);
    const wantsCost = /cost|saving|spend less/.test(lower);
    if (wantsGrowth && !wantsCost) categoryFilter = 'MAKE_MORE';
    else if (wantsCost && !wantsGrowth) categoryFilter = 'SPEND_LESS';
    measurableOutcome = companyHint
      ? `Produce a ranked opportunity plan for ${companyHint}.`
      : 'Produce a ranked opportunity plan for the named company.';
  } else if (/\bstart\b/.test(lower) && /opportunit/.test(lower)) {
    kind = 'start-opportunities';
    measurableOutcome = `Create and authorise execution plans for the top ${limit ?? 3}${riskFilter ? ' low-risk' : ''} opportunities.`;
  } else if (/\bsaving|\bcut cost|\breduce cost|spend less\b/.test(lower)) {
    kind = 'find-savings';
    categoryFilter = 'SPEND_LESS';
    measurableOutcome = financialTarget
      ? `Identify at least £${financialTarget.toLocaleString('en-GB')} of addressable annual savings.`
      : 'Identify and rank all addressable annual savings.';
  } else if (/msp expansion|expansion opportunit|expand.*(estate|customer)/.test(lower)) {
    kind = 'msp-expansion';
    categoryFilter = 'MSP_EXPAND';
    measurableOutcome = `Rank the top ${limit ?? 5} MSP expansion opportunities by potential ARR across the estate.`;
  } else if (countTarget) {
    kind = 'pipeline-target';
    measurableOutcome = `Restore ${countTarget.value} ${countTarget.unit} for the target period, creating and executing an approved outreach plan if the current figure is short.`;
  } else if (/next best action|best action|what should/.test(lower)) {
    kind = 'portfolio-next-action';
    measurableOutcome = 'Identify the single highest-value practical action across the MSP estate.';
  } else if (/increase turnover|grow revenue|make more/.test(lower)) {
    kind = 'analyse-company';
    categoryFilter = 'MAKE_MORE';
    measurableOutcome = companyHint
      ? `Produce a ranked growth plan for ${companyHint}.`
      : 'Produce a ranked growth plan for the named company.';
  }

  return { kind, measurableOutcome, financialTarget, countTarget, companyHint, categoryFilter, riskFilter, limit, raw: text };
}

export interface JojoStep {
  step: string;
  detail: string;
  status: 'done' | 'blocked' | 'proposed';
}

export interface JojoResponse {
  objective: ParsedObjective;
  steps: JojoStep[];
  /** Opportunities JoJo selected to serve the objective. */
  selected: Opportunity[];
  /** Plain-language answer for the user. */
  answer: string;
  /** Whether the objective can be met with what is currently known. */
  achievable: boolean;
  shortfall: number | null;
}

export function askJojo(db: TenantDb, raw: string, companyId?: string): JojoResponse {
  const objective = parseObjective(raw);
  const steps: JojoStep[] = [];

  steps.push({
    step: 'Translate objective into measurable outcome',
    detail: objective.measurableOutcome,
    status: objective.kind === 'unknown' ? 'blocked' : 'done',
  });

  if (objective.kind === 'unknown') {
    return {
      objective,
      steps,
      selected: [],
      answer:
        'I could not turn that into a measurable outcome. Try naming what should change and by how much — for example "find £100k of annual savings across this company" or "start the top three low-risk opportunities".',
      achievable: false,
      shortfall: null,
    };
  }

  // Obtain evidence.
  let pool = listOpportunities(db, companyId);
  steps.push({
    step: 'Obtain evidence',
    detail: `${pool.length} opportunities available${companyId ? ' for this company' : ' across the estate'}.`,
    status: pool.length > 0 ? 'done' : 'blocked',
  });

  if (objective.categoryFilter) {
    pool = pool.filter((o) => o.category === objective.categoryFilter);
  }
  if (objective.riskFilter === 'low') {
    pool = pool.filter((o) => o.risk === 'low');
  }
  pool = pool.sort((a, b) => b.score - a.score);

  // Select capability for the top item, so the user can see the routing.
  const top = pool[0];
  if (top) {
    const routing = routeObjective({
      actionId: top.playbookId ?? 'plan-objective',
      objective: top.title,
      availableInputs: ['companyId', 'tenantId', 'objective', 'financialTarget'],
      valueAtStake: top.estimatedAnnualValue,
    });
    steps.push({
      step: 'Select capability',
      detail: routing.rationale,
      status: 'done',
    });
  }

  let selected: Opportunity[] = [];
  let answer = '';
  let achievable = true;
  let shortfall: number | null = null;

  switch (objective.kind) {
    case 'find-savings': {
      const target = objective.financialTarget;
      if (target === null) {
        selected = pool;
        answer = `${pool.length} savings opportunities totalling £${sum(pool).toLocaleString('en-GB')} a year.`;
      } else {
        // Take highest-confidence-per-pound first, not simply largest.
        const ranked = [...pool].sort((a, b) => b.confidence * b.estimatedAnnualValue - a.confidence * a.estimatedAnnualValue);
        let running = 0;
        for (const o of ranked) {
          if (running >= target) break;
          selected.push(o);
          running += o.estimatedAnnualValue;
        }
        achievable = running >= target;
        shortfall = achievable ? null : target - running;
        answer = achievable
          ? `£${running.toLocaleString('en-GB')} of addressable annual savings across ${selected.length} opportunities, which meets the £${target.toLocaleString('en-GB')} target.`
          : `I can evidence £${running.toLocaleString('en-GB')} against a £${target.toLocaleString('en-GB')} target — a shortfall of £${(target - running).toLocaleString('en-GB')}. Connecting accounting or a bank feed is the fastest way to close the gap, because most remaining savings are currently benchmark hypotheses rather than counted spend.`;
      }
      break;
    }

    case 'start-opportunities': {
      const limit = objective.limit ?? 3;
      const startable = pool.filter((o) => startAvailable(o).available);
      selected = startable.slice(0, limit);
      achievable = selected.length >= limit;
      answer = selected.length === 0
        ? 'Nothing is currently startable — every candidate is blocked on confidence or a missing integration.'
        : `${selected.length} opportunit${selected.length === 1 ? 'y' : 'ies'} ready to start, worth £${sum(selected).toLocaleString('en-GB')} a year. Each needs authorisation before anything leaves the platform.`;
      steps.push({
        step: 'Understand delegated authority',
        detail: 'Every selected plan stops at authorisation. No external action runs without a named human approving it.',
        status: 'done',
      });
      steps.push({
        step: 'Execute',
        detail: 'Execution plans are created on request and presented for authorisation.',
        status: 'proposed',
      });
      break;
    }

    case 'msp-expansion': {
      const limit = objective.limit ?? 5;
      selected = pool.slice(0, limit);
      const arr = sum(selected);
      answer = `Top ${selected.length} MSP expansion opportunities, worth £${arr.toLocaleString('en-GB')} ARR (£${Math.round(arr / 12).toLocaleString('en-GB')} MRR) if all are taken.`;
      break;
    }

    case 'pipeline-target': {
      const target = objective.countTarget!;
      const pipelineOpps = listOpportunities(db, companyId).filter((o) => o.playbookId === 'pipeline-generation');
      selected = pipelineOpps;
      achievable = pipelineOpps.length > 0;
      answer = achievable
        ? `No live pipeline data is connected, so I cannot measure the current figure against your target of ${target.value} ${target.unit}. A pipeline generation plan is available and sized to produce that volume — connect a CRM and I can monitor the gap continuously and act on it.`
        : `I cannot measure ${target.unit} without a CRM connection, and no pipeline generation opportunity exists for this company yet.`;
      steps.push({
        step: 'Monitor',
        detail: 'Continuous monitoring against this target requires a CRM connector. Not available in this environment.',
        status: 'blocked',
      });
      break;
    }

    case 'portfolio-next-action': {
      const action = nextBestActionAcrossEstate(db);
      selected = action ? [action.opportunity] : [];
      answer = action
        ? `${action.opportunity.title} for ${action.customerName}: £${action.opportunity.estimatedAnnualValue.toLocaleString('en-GB')} at ${Math.round(action.opportunity.confidence * 100)}% confidence, ${action.reason}`
        : 'No actionable opportunity across the estate.';
      break;
    }

    case 'analyse-company': {
      selected = pool.slice(0, objective.limit ?? 10);
      answer = pool.length > 0
        ? `${pool.length} opportunities, worth £${sum(pool).toLocaleString('en-GB')} a year in total. The top ${selected.length} are shown.`
        : `No analysis exists${objective.companyHint ? ` for ${objective.companyHint}` : ''} yet. Run an analysis first.`;
      achievable = pool.length > 0;
      break;
    }
  }

  steps.push({
    step: 'Measure outcome',
    detail: 'Realised value is recorded in the Benefits Ledger and attributed to the capability that produced it.',
    status: 'proposed',
  });

  return { objective, steps, selected, answer, achievable, shortfall };
}

function sum(opportunities: Opportunity[]): number {
  return Math.round(opportunities.reduce((s, o) => s + o.estimatedAnnualValue, 0));
}

export interface NextBestAction {
  opportunity: Opportunity;
  customerName: string;
  companyId: string;
  reason: string;
}

/**
 * Directive §17: "JoJo should calculate the highest-value practical action for
 * the MSP at portfolio level." Practical, not merely largest — an unstartable
 * £1m opportunity loses to a £40k one that can begin this week.
 */
export function nextBestActionAcrossEstate(db: TenantDb): NextBestAction | null {
  const companies = listCompanies(db);
  const customers = listCustomers(db);
  const all = listOpportunities(db);

  const candidates = all
    .filter((o) => startAvailable(o).available)
    .map((o) => {
      const company = companies.find((c) => c.id === o.companyId);
      const customer = customers.find((c) => c.id === company?.customerId);
      // Practicality: value, weighted by confidence and readiness, discounted by time.
      const practicality = o.estimatedAnnualValue * o.confidence * o.executionReadiness * (1 - Math.min(0.6, o.timeToValue / 365));
      return {
        opportunity: o,
        customerName: customer?.name ?? company?.displayName ?? 'Unknown customer',
        companyId: o.companyId,
        practicality,
      };
    })
    .sort((a, b) => b.practicality - a.practicality);

  const best = candidates[0];
  if (!best) return null;

  return {
    opportunity: best.opportunity,
    customerName: best.customerName,
    companyId: best.companyId,
    reason: `startable now at ${Math.round(best.opportunity.executionReadiness * 100)}% readiness with value in ${best.opportunity.timeToValue} days.`,
  };
}

/** Directive §16: the ledger questions, answered for a tenant. */
export function portfolioValueSummary(db: TenantDb) {
  return summariseLedger(listBenefits(db));
}
