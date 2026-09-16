/**
 * Shared opportunity construction. Keeps every engine honest: the financial
 * model is assembled from labelled lines, the epistemics are derived from the
 * weakest line rather than asserted, and the confidence can never exceed what
 * the underlying data supports.
 */

import type {
  EvidenceItem,
  FinancialLine,
  FinancialModel,
  Opportunity,
  OpportunityCategory,
  RiskLevel,
} from '../../core/opportunity';
import { roiOf, scoreOpportunity } from '../../core/opportunity';
import type { Epistemics } from '../../core/provenance';
import { clamp01 } from '../../core/provenance';
import type { AnalysisContext } from '../context';

export interface DraftInput {
  category: OpportunityCategory;
  subcategory: string;
  title: string;
  summary: string;
  problem: string;
  lines: FinancialLine[];
  formula: string;
  pointEstimate: number;
  /** Band width as a fraction of the point estimate. Wider when data is thin. */
  band?: number;
  implementationCost: number;
  confidence: number;
  effort: number;
  risk: RiskLevel;
  timeToValue: number;
  evidence: EvidenceItem[];
  assumptions: string[];
  reasoningSummary: string;
  dependencies: string[];
  capabilities: string[];
  requiredIntegrations: string[];
  playbookId: string | null;
  executionReadiness: number;
  approvalRequirements: string[];
}

/**
 * Directive §1: never fabricate certainty. An opportunity is only as solid as
 * its weakest financial line — one assumption anywhere makes the whole thing a
 * hypothesis, however confident the rest of it looks.
 */
export function deriveEpistemics(lines: FinancialLine[]): Epistemics {
  if (lines.some((l) => l.basis === 'assumption')) return 'hypothesis';
  if (lines.some((l) => l.basis === 'benchmark')) return 'hypothesis';
  if (lines.every((l) => l.basis === 'connected' || l.basis === 'observed')) return 'inferred-fact';
  return 'hypothesis';
}

export function buildFinancialModel(input: DraftInput): FinancialModel {
  const band = input.band ?? (deriveEpistemics(input.lines) === 'hypothesis' ? 0.45 : 0.2);
  return {
    lines: input.lines,
    formula: input.formula,
    pointEstimate: Math.round(input.pointEstimate),
    lowEstimate: Math.round(input.pointEstimate * (1 - band)),
    highEstimate: Math.round(input.pointEstimate * (1 + band)),
  };
}

export function makeOpportunity(
  ctx: AnalysisContext,
  idPrefix: string,
  index: number,
  input: DraftInput,
): Opportunity {
  const financialModel = buildFinancialModel(input);
  const epistemics = deriveEpistemics(input.lines);
  const value = financialModel.pointEstimate;
  const cost = Math.round(input.implementationCost);

  // A hypothesis cannot present as high confidence, whatever the engine claims.
  const ceiling = epistemics === 'hypothesis' ? 0.75 : 0.95;
  const confidence = clamp01(Math.min(input.confidence, ceiling));

  const base = {
    estimatedAnnualValue: value,
    confidence,
    executionReadiness: clamp01(input.executionReadiness),
    effort: clamp01(input.effort),
    risk: input.risk,
    timeToValue: input.timeToValue,
    category: input.category,
  };

  const strategic = input.category === 'MSP_EXPAND' ? 0.8 : 0.5;
  const { total } = scoreOpportunity(base, undefined, strategic);

  return {
    id: `${idPrefix}-${input.category.toLowerCase().replace('_', '-')}-${index}`,
    tenantId: ctx.twin.tenantId,
    companyId: ctx.twin.id,
    category: input.category,
    subcategory: input.subcategory,
    title: input.title,
    summary: input.summary,
    problem: input.problem,
    evidence: input.evidence,
    assumptions: input.assumptions,
    reasoningSummary: input.reasoningSummary,
    financialModel,
    estimatedAnnualValue: value,
    implementationCost: cost,
    netBenefit: value - cost,
    roi: roiOf(value, cost),
    confidence,
    effort: clamp01(input.effort),
    risk: input.risk,
    timeToValue: input.timeToValue,
    dependencies: input.dependencies,
    capabilities: input.capabilities,
    requiredIntegrations: input.requiredIntegrations,
    playbookId: input.playbookId,
    executionReadiness: clamp01(input.executionReadiness),
    executionStatus: 'NOT_STARTED',
    approvalRequirements: input.approvalRequirements,
    epistemics,
    owner: null,
    startedAt: null,
    completedAt: null,
    realisedValue: null,
    realisedValueEvidence: [],
    score: total,
    createdAt: new Date().toISOString(),
  };
}

/** Evidence drawn from a twin field, carrying that field's real sources. */
export function evidenceFromField(
  ctx: AnalysisContext,
  statement: string,
  field: keyof typeof ctx.twin,
): EvidenceItem {
  const f = ctx.twin[field] as { current?: { confidence: number; epistemics: Epistemics; sources: EvidenceItem['sources'] } };
  return {
    statement,
    epistemics: f?.current?.epistemics ?? 'hypothesis',
    confidence: f?.current?.confidence ?? 0.2,
    sources: f?.current?.sources ?? [],
  };
}

export function benchmarkEvidence(statement: string, confidence = 0.5): EvidenceItem {
  return {
    statement,
    epistemics: 'hypothesis',
    confidence,
    sources: [
      {
        connectorId: 'benchmark-library',
        label: 'AIGoGo SME benchmark library',
        retrievedAt: new Date().toISOString(),
      },
    ],
  };
}

export function money(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}
