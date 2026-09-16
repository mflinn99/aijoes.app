/**
 * Capability Router — Directive §14.
 *
 * routeObjective(objective, companyTwin) => candidates, scores, recommended,
 * fallback. Scoring is explicit and inspectable, never an opaque model call.
 *
 * "The router should allow new AIGoGo capabilities to be registered without
 * altering core orchestration logic" — hence routing works off the registry's
 * declared actions, not a hard-coded mapping.
 */

import type { Capability, CapabilityAction, CapabilityHealth } from './types';
import { listCapabilities } from './registry';

export interface RoutingRequest {
  /** The action the plan needs performed, e.g. "reactivate-dormant". */
  actionId: string;
  /** Free-text objective, used for keyword fitness when no exact action matches. */
  objective: string;
  /** Inputs the plan can supply. Missing required inputs cost the candidate. */
  availableInputs: string[];
  /** GBP this step is worth, used to keep execution proportionate (§26). */
  valueAtStake: number;
  /** Prefer speed over cost when the opportunity is time-critical. */
  urgency?: 'normal' | 'high';
}

export interface CandidateScore {
  capabilityId: string;
  capabilityName: string;
  actionId: string;
  total: number;
  components: { label: string; weight: number; input: number; contribution: number }[];
  blockers: string[];
}

export interface RoutingResult {
  candidates: CandidateScore[];
  recommended: CandidateScore | null;
  fallback: CandidateScore | null;
  /** Why the recommendation won, in one sentence for the audit trail. */
  rationale: string;
}

const HEALTH_SCORE: Record<CapabilityHealth, number> = {
  healthy: 1,
  unknown: 0.6,
  degraded: 0.35,
  unavailable: 0,
};

const MATURITY_SCORE: Record<Capability['maturity'], number> = {
  production: 1,
  beta: 0.75,
  mock: 0.4,
  planned: 0.05,
};

/** Keyword fitness when the plan names an objective rather than an exact action. */
function keywordFitness(objective: string, capability: Capability, action: CapabilityAction): number {
  const text = `${capability.name} ${capability.description} ${action.name} ${action.description}`.toLowerCase();
  const words = objective
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  if (words.length === 0) return 0;
  const hits = words.filter((w) => text.includes(w)).length;
  return hits / words.length;
}

/**
 * Directive §26: "Do not spend £1,000 analysing a £500 opportunity."
 * A candidate whose unit cost is a large fraction of the value at stake is
 * penalised, and one that exceeds it outright is blocked.
 */
function proportionality(unitCost: number, valueAtStake: number): { score: number; blocked: boolean } {
  if (valueAtStake <= 0) return { score: 0.5, blocked: false };
  const ratio = unitCost / valueAtStake;
  if (ratio >= 1) return { score: 0, blocked: true };
  return { score: Math.max(0, 1 - ratio * 20), blocked: false };
}

export function routeObjective(req: RoutingRequest): RoutingResult {
  const candidates: CandidateScore[] = [];

  for (const capability of listCapabilities()) {
    for (const action of capability.supportedActions) {
      const exact = action.id === req.actionId;
      const fitness = exact ? 1 : keywordFitness(req.objective, capability, action);
      if (fitness < 0.34) continue;

      const blockers: string[] = [];
      if (capability.health === 'unavailable') blockers.push(`${capability.name} is unavailable`);

      const missing = action.requiredInputs.filter((i) => !req.availableInputs.includes(i));
      const dataAvailability = action.requiredInputs.length === 0
        ? 1
        : 1 - missing.length / action.requiredInputs.length;
      if (missing.length > 0) blockers.push(`Missing input(s): ${missing.join(', ')}`);

      const prop = proportionality(action.unitCostGbp, req.valueAtStake);
      if (prop.blocked) {
        blockers.push(
          `Cost £${action.unitCostGbp} is disproportionate to £${req.valueAtStake} at stake`,
        );
      }

      const speed = req.urgency === 'high'
        ? 1 - Math.min(1, capability.typicalDurationSec / 600)
        : 0.5;

      const components = [
        { label: 'Fitness for task', weight: 35, input: fitness },
        { label: 'Capability health', weight: 15, input: HEALTH_SCORE[capability.health] },
        { label: 'Data availability', weight: 15, input: dataAvailability },
        { label: 'Execution success history', weight: 12, input: capability.successRate },
        { label: 'Maturity', weight: 8, input: MATURITY_SCORE[capability.maturity] },
        { label: 'Cost proportionality', weight: 8, input: prop.score },
        { label: 'Speed', weight: 4, input: speed },
        { label: 'Risk (inverse)', weight: 3, input: action.risk === 'low' ? 1 : action.risk === 'medium' ? 0.6 : 0.25 },
      ].map((c) => ({ ...c, contribution: c.weight * c.input }));

      const raw = components.reduce((s, c) => s + c.contribution, 0);
      // A blocker does not hide the candidate — it demotes it, so the UI can
      // explain why a plausible capability was not chosen.
      const total = blockers.length > 0 ? raw * 0.25 : raw;

      candidates.push({
        capabilityId: capability.id,
        capabilityName: capability.name,
        actionId: action.id,
        total: Math.round(total * 10) / 10,
        components,
        blockers,
      });
    }
  }

  candidates.sort((a, b) => b.total - a.total);
  const viable = candidates.filter((c) => c.blockers.length === 0);
  const recommended = viable[0] ?? null;
  const fallback = viable[1] ?? candidates.find((c) => c !== recommended) ?? null;

  const rationale = recommended
    ? `${recommended.capabilityName} scored ${recommended.total} for "${req.actionId}" — ` +
      `highest on ${[...recommended.components].sort((a, b) => b.contribution - a.contribution)[0]!.label.toLowerCase()}.`
    : candidates.length > 0
      ? `No capability is currently viable for "${req.actionId}": ${candidates[0]!.blockers.join('; ')}.`
      : `No registered capability supports "${req.actionId}".`;

  return { candidates, recommended, fallback, rationale };
}
