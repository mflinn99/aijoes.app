/**
 * Opportunity Graph — Directive §6.
 */

import type { Epistemics, SourceRef } from './provenance';
import { clamp01 } from './provenance';

export type OpportunityCategory = 'MAKE_MORE' | 'SPEND_LESS' | 'MSP_EXPAND';

export type ExecutionStatus =
  | 'NOT_STARTED'
  | 'PLANNING'
  | 'AWAITING_APPROVAL'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface EvidenceItem {
  statement: string;
  epistemics: Epistemics;
  confidence: number;
  sources: SourceRef[];
}

/**
 * Directive §6/§21: the financial model must be inspectable, not an opaque
 * number. Every line shows where it came from.
 */
export interface FinancialLine {
  label: string;
  value: number;
  unit: 'GBP' | 'GBP/month' | 'percent' | 'count';
  basis: 'observed' | 'benchmark' | 'assumption' | 'connected';
  note?: string;
}

export interface FinancialModel {
  /** Ordered calculation, shown verbatim in the evidence view. */
  lines: FinancialLine[];
  formula: string;
  /** Low/high band. Directive §20 shows ranges like "£640k–£1.1m". */
  lowEstimate: number;
  highEstimate: number;
  /** The single number used for ranking and totals. */
  pointEstimate: number;
}

export interface Opportunity {
  id: string;
  tenantId: string;
  companyId: string;

  category: OpportunityCategory;
  subcategory: string;
  title: string;
  summary: string;
  problem: string;

  evidence: EvidenceItem[];
  assumptions: string[];
  reasoningSummary: string;

  financialModel: FinancialModel;
  estimatedAnnualValue: number;
  implementationCost: number;
  netBenefit: number;
  roi: number;

  /** 0..1 */
  confidence: number;
  /** 0..1, higher = more effort */
  effort: number;
  risk: RiskLevel;
  /** Days. */
  timeToValue: number;

  dependencies: string[];
  capabilities: string[];
  requiredIntegrations: string[];
  playbookId: string | null;

  /** 0..1 — can this actually be started right now? */
  executionReadiness: number;
  executionStatus: ExecutionStatus;
  approvalRequirements: string[];

  /** Directive §1: facts vs hypotheses. A benchmark-led saving is a hypothesis. */
  epistemics: Epistemics;

  owner: string | null;
  startedAt: string | null;
  completedAt: string | null;
  realisedValue: number | null;
  realisedValueEvidence: EvidenceItem[];

  score: number;
  createdAt: string;
}

export interface ScoringWeights {
  value: number;
  confidence: number;
  readiness: number;
  effort: number;
  risk: number;
  time: number;
  strategic: number;
  mspCommercial: number;
}

/** Directive §6: "Make weights configurable." These are the defaults. */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  value: 40,
  confidence: 20,
  readiness: 15,
  effort: 12,
  risk: 10,
  time: 8,
  strategic: 5,
  mspCommercial: 10,
};

const RISK_VALUE: Record<RiskLevel, number> = { low: 0.15, medium: 0.5, high: 0.9 };

/**
 * Normalise money onto 0..1 with a log curve. Linear normalisation lets one
 * £2m opportunity flatten everything else to zero; log keeps a £40k quick win
 * visible next to it, which is the behaviour an MSP actually wants.
 */
export function normaliseValue(value: number, ceiling = 1_000_000): number {
  if (value <= 0) return 0;
  return clamp01(Math.log10(1 + value) / Math.log10(1 + ceiling));
}

/** Time-to-value normalised against a one-year horizon. */
export function normaliseTime(days: number): number {
  return clamp01(days / 365);
}

export interface ScoreBreakdown {
  total: number;
  components: { label: string; weight: number; input: number; contribution: number }[];
}

/**
 * Directive §6: "Do not hard-code opaque AI ranking. Expose the calculation."
 * This returns the breakdown, and the UI renders it line by line.
 */
export function scoreOpportunity(
  o: Pick<
    Opportunity,
    'estimatedAnnualValue' | 'confidence' | 'executionReadiness' | 'effort' | 'risk' | 'timeToValue' | 'category'
  >,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  strategicRelevance = 0.5,
): ScoreBreakdown {
  const mspRelevance = o.category === 'MSP_EXPAND' ? 1 : 0.35;

  const components = [
    { label: 'Financial value', weight: weights.value, input: normaliseValue(o.estimatedAnnualValue) },
    { label: 'Confidence', weight: weights.confidence, input: clamp01(o.confidence) },
    { label: 'Execution readiness', weight: weights.readiness, input: clamp01(o.executionReadiness) },
    { label: 'Strategic relevance', weight: weights.strategic, input: clamp01(strategicRelevance) },
    { label: 'MSP commercial relevance', weight: weights.mspCommercial, input: mspRelevance },
    { label: 'Effort', weight: -weights.effort, input: clamp01(o.effort) },
    { label: 'Risk', weight: -weights.risk, input: RISK_VALUE[o.risk] },
    { label: 'Time to value', weight: -weights.time, input: normaliseTime(o.timeToValue) },
  ].map((c) => ({ ...c, contribution: c.weight * c.input }));

  const total = components.reduce((sum, c) => sum + c.contribution, 0);
  return { total: Math.round(total * 10) / 10, components };
}

export function netBenefitOf(value: number, cost: number): number {
  return value - cost;
}

export function roiOf(value: number, cost: number): number {
  if (cost <= 0) return value > 0 ? Infinity : 0;
  return Math.round(((value - cost) / cost) * 100) / 100;
}

export function effortLabel(effort: number): 'Low' | 'Medium' | 'High' {
  if (effort < 0.34) return 'Low';
  if (effort < 0.67) return 'Medium';
  return 'High';
}

export function timeToValueLabel(days: number): string {
  if (days <= 14) return '≤ 2 weeks';
  if (days <= 45) return `${Math.round(days / 7)}–${Math.round(days / 7) + 2} weeks`;
  if (days <= 120) return `${Math.round(days / 30)}–${Math.round(days / 30) + 1} months`;
  return `${Math.round(days / 30)} months`;
}

/**
 * Directive §11: START must not be available on an opportunity that cannot
 * actually be executed. This is the gate, and it is deterministic code — not a
 * model judgement.
 */
export function startAvailable(o: Opportunity): { available: boolean; reason: string } {
  if (o.executionStatus !== 'NOT_STARTED' && o.executionStatus !== 'FAILED' && o.executionStatus !== 'STOPPED') {
    return { available: false, reason: `Already ${o.executionStatus.toLowerCase().replace('_', ' ')}` };
  }
  if (!o.playbookId) {
    return { available: false, reason: 'No executable playbook is mapped to this opportunity yet' };
  }
  if (o.confidence < 0.35) {
    return { available: false, reason: 'Confidence too low to execute — connect more data first' };
  }
  if (o.executionReadiness < 0.3) {
    return { available: false, reason: 'Required integrations or evidence are missing' };
  }
  return { available: true, reason: 'Ready to start' };
}
