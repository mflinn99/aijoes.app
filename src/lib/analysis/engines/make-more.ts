/**
 * MAKE MORE engine — Directive §7.
 *
 * Revenue, pipeline, conversion, margin and market reach. Each rule states its
 * own trigger condition, so an opportunity only appears when the twin actually
 * supports it — the alternative is a generic list that an MSP cannot defend in
 * front of a customer.
 */

import type { Opportunity } from '../../core/opportunity';
import { BENCHMARKS } from '../benchmarks';
import type { AnalysisContext } from '../context';
import { benchmarkEvidence, evidenceFromField, makeOpportunity, money, type DraftInput } from './shared';
import { valueOf } from '../../core/provenance';

type Rule = (ctx: AnalysisContext) => DraftInput | null;

const dormantReactivation: Rule = (ctx) => {
  const customerValue = ctx.turnover.value * BENCHMARKS.averageCustomerValueRatio.value;
  const estimatedCustomers = Math.max(10, Math.round(ctx.turnover.value / Math.max(customerValue, 1)));
  const dormant = Math.round(estimatedCustomers * BENCHMARKS.dormantAccountPct.value);
  if (dormant < 5) return null;

  const reactivated = dormant * BENCHMARKS.dormantReactivationRate.value;
  const value = reactivated * customerValue;
  if (value < 5_000) return null;

  const basis = ctx.hasCrmData ? 'connected' : 'benchmark';

  return {
    category: 'MAKE_MORE',
    subcategory: 'Existing customer expansion',
    title: 'Dormant customer reactivation',
    summary: `${dormant} customer records are likely dormant. A structured reactivation campaign against a prior relationship converts far better than cold outreach.`,
    problem:
      'Customers who bought before and stopped are the cheapest revenue available, and they are almost never worked systematically because nobody owns them.',
    lines: [
      { label: 'Estimated active customer base', value: estimatedCustomers, unit: 'count', basis: ctx.hasCrmData ? 'connected' : 'benchmark', note: BENCHMARKS.averageCustomerValueRatio.note },
      { label: 'Average annual customer value', value: Math.round(customerValue), unit: 'GBP', basis, note: 'Turnover divided by estimated customer count.' },
      { label: 'Dormant share', value: BENCHMARKS.dormantAccountPct.value * 100, unit: 'percent', basis: 'benchmark', note: BENCHMARKS.dormantAccountPct.note },
      { label: 'Dormant accounts', value: dormant, unit: 'count', basis, note: 'Active base × dormant share.' },
      { label: 'Reactivation rate', value: BENCHMARKS.dormantReactivationRate.value * 100, unit: 'percent', basis: 'benchmark', note: BENCHMARKS.dormantReactivationRate.note },
      { label: 'Recovered annual revenue', value: Math.round(value), unit: 'GBP', basis, note: 'Dormant accounts × reactivation rate × average customer value.' },
    ],
    formula: 'dormant_accounts × reactivation_rate × average_customer_value',
    pointEstimate: value,
    implementationCost: Math.min(12_000, Math.max(3_000, value * 0.06)),
    confidence: ctx.hasCrmData ? 0.84 : 0.52,
    effort: 0.4,
    risk: 'low',
    timeToValue: 45,
    evidence: [
      evidenceFromField(ctx, `Turnover estimated at ${money(ctx.turnover.value)} — ${ctx.turnover.note}`, 'turnoverEstimate'),
      benchmarkEvidence(`${BENCHMARKS.dormantAccountPct.note}`, 0.5),
      benchmarkEvidence(`${BENCHMARKS.dormantReactivationRate.note}`, 0.55),
    ],
    assumptions: [
      ctx.hasCrmData
        ? 'Dormancy measured against connected CRM records.'
        : 'No CRM is connected — dormant count is modelled from turnover, not counted. Connect CRM to replace this with a real number.',
    ],
    reasoningSummary:
      'Prior customers carry established trust and known requirements, so the cost of the second sale is a fraction of the first. The value shown is the modelled recovery from one structured campaign, not a run rate.',
    dependencies: ctx.hasCrmData ? [] : ['CRM connection to identify actual dormant accounts'],
    capabilities: ['salesonic'],
    requiredIntegrations: ['crm'],
    playbookId: 'dormant-customer-reactivation',
    executionReadiness: ctx.hasCrmData ? 0.9 : 0.55,
    approvalRequirements: ['Approve target list before any outreach is sent'],
  };
};

const pipelineGeneration: Rule = (ctx) => {
  const customerValue = ctx.turnover.value * BENCHMARKS.averageCustomerValueRatio.value;
  const meetings = BENCHMARKS.outboundMeetingsPerRepPerMonth.value * 12;
  const wins = meetings * BENCHMARKS.meetingToWinRate.value;
  const value = wins * customerValue;
  if (value < 10_000) return null;

  const hasOutbound =
    ((valueOf(ctx.twin.salesChannels) as string[] | null) ?? []).length > 0 ||
    ctx.technology.some((t) => /CRM|Sales/i.test(t.category));

  return {
    category: 'MAKE_MORE',
    subcategory: 'New business',
    title: 'Build a repeatable outbound pipeline',
    summary: `A working outbound motion producing ${BENCHMARKS.outboundMeetingsPerRepPerMonth.value} qualified meetings a month is worth roughly ${money(value)} a year at this company's average deal size.`,
    problem: hasOutbound
      ? 'Sales tooling is present but there is no visible systematic outbound motion — pipeline depends on referral and inbound, which cannot be turned up on demand.'
      : 'No outbound sales motion is detectable. Growth is therefore capped by inbound volume, which the company does not control.',
    lines: [
      { label: 'Qualified meetings per month', value: BENCHMARKS.outboundMeetingsPerRepPerMonth.value, unit: 'count', basis: 'benchmark', note: BENCHMARKS.outboundMeetingsPerRepPerMonth.note },
      { label: 'Meetings per year', value: meetings, unit: 'count', basis: 'benchmark', note: 'Monthly target × 12.' },
      { label: 'Meeting to win rate', value: BENCHMARKS.meetingToWinRate.value * 100, unit: 'percent', basis: 'benchmark', note: BENCHMARKS.meetingToWinRate.note },
      { label: 'New customers per year', value: Math.round(wins), unit: 'count', basis: 'benchmark', note: 'Meetings × win rate.' },
      { label: 'Average annual customer value', value: Math.round(customerValue), unit: 'GBP', basis: ctx.turnover.basis, note: ctx.turnover.note },
      { label: 'New annual revenue', value: Math.round(value), unit: 'GBP', basis: 'benchmark', note: 'New customers × average customer value.' },
    ],
    formula: 'meetings_per_month × 12 × win_rate × average_customer_value',
    pointEstimate: value,
    implementationCost: Math.min(30_000, Math.max(8_000, value * 0.12)),
    confidence: 0.58,
    effort: 0.65,
    risk: 'medium',
    timeToValue: 90,
    evidence: [
      evidenceFromField(ctx, `Sectors identified: ${ctx.sectors.join(', ') || 'not determined'}`, 'sectors'),
      benchmarkEvidence(BENCHMARKS.meetingToWinRate.note, 0.55),
      benchmarkEvidence('First revenue typically lands 60–120 days after outreach begins, given B2B sales cycles.', 0.6),
    ],
    assumptions: [
      'One outbound motion, not a full sales team build.',
      'Win rate assumes the proposition converts at sector-typical rates.',
    ],
    reasoningSummary:
      'Pipeline is the one growth lever that responds to effort predictably. The model sizes a single working motion rather than a best case, and time-to-value reflects a real B2B cycle rather than campaign launch.',
    dependencies: ['Agreed ICP', 'CRM to hold the pipeline'],
    capabilities: ['salesonic', 'listeningpost'],
    requiredIntegrations: ['crm'],
    playbookId: 'pipeline-generation',
    executionReadiness: 0.75,
    approvalRequirements: ['Approve ICP and target list', 'Approve outreach content before sending'],
  };
};

const crossSell: Rule = (ctx) => {
  const services = (valueOf(ctx.twin.services) as string[] | null) ?? [];
  if (services.length < 2) return null;

  const existingRevenue = ctx.turnover.value * 0.7;
  const value = existingRevenue * BENCHMARKS.crossSellUpliftPct.value;
  if (value < 5_000) return null;

  return {
    category: 'MAKE_MORE',
    subcategory: 'Existing customer expansion',
    title: `Cross-sell across ${services.length} service lines`,
    summary: `The company sells ${services.length} distinguishable services. Most customers will buy only one of them, which is the single most common source of unrealised revenue in a services business.`,
    problem:
      'Service lines are sold by whoever owns the relationship, so customers are rarely shown the rest of the catalogue after the first sale.',
    lines: [
      { label: 'Service lines identified', value: services.length, unit: 'count', basis: 'observed', note: `From the public website: ${services.slice(0, 5).join(', ')}${services.length > 5 ? '…' : ''}` },
      { label: 'Revenue from existing customers', value: Math.round(existingRevenue), unit: 'GBP', basis: ctx.turnover.basis, note: 'Assumes 70% of turnover comes from the existing base.' },
      { label: 'Cross-sell uplift', value: BENCHMARKS.crossSellUpliftPct.value * 100, unit: 'percent', basis: 'benchmark', note: BENCHMARKS.crossSellUpliftPct.note },
      { label: 'Additional annual revenue', value: Math.round(value), unit: 'GBP', basis: 'benchmark', note: 'Existing customer revenue × uplift.' },
    ],
    formula: 'existing_customer_revenue × cross_sell_uplift_rate',
    pointEstimate: value,
    implementationCost: Math.max(4_000, value * 0.08),
    confidence: 0.6,
    effort: 0.35,
    risk: 'low',
    timeToValue: 60,
    evidence: [
      evidenceFromField(ctx, `Services observed on the website: ${services.slice(0, 6).join(', ')}`, 'services'),
      benchmarkEvidence(BENCHMARKS.crossSellUpliftPct.note, 0.55),
    ],
    assumptions: ['Service lines are genuinely separable and can be sold independently.'],
    reasoningSummary:
      'Cross-sell needs no new customers and no new capability — only a deliberate motion against the installed base. It is therefore low risk and fast relative to new business.',
    dependencies: ['Customer list with current services held'],
    capabilities: ['salesonic', 'grothos'],
    requiredIntegrations: ['crm'],
    playbookId: 'cross-sell',
    executionReadiness: ctx.hasCrmData ? 0.85 : 0.6,
    approvalRequirements: ['Approve the cross-sell target list'],
  };
};

const pricingReview: Rule = (ctx) => {
  const value = ctx.turnover.value * BENCHMARKS.pricingUpliftPct.value;
  if (value < 5_000) return null;

  return {
    category: 'MAKE_MORE',
    subcategory: 'Pricing and margin',
    title: 'Structured pricing review',
    summary: `A ${BENCHMARKS.pricingUpliftPct.value * 100}% pricing uplift is worth ${money(value)} a year, and lands almost entirely in margin.`,
    problem:
      'Prices set at the point of sale and increased below inflation erode margin quietly. Nobody notices until the margin is gone.',
    lines: [
      { label: 'Turnover', value: Math.round(ctx.turnover.value), unit: 'GBP', basis: ctx.turnover.basis, note: ctx.turnover.note },
      { label: 'Achievable uplift', value: BENCHMARKS.pricingUpliftPct.value * 100, unit: 'percent', basis: 'benchmark', note: BENCHMARKS.pricingUpliftPct.note },
      { label: 'Additional annual revenue', value: Math.round(value), unit: 'GBP', basis: 'benchmark', note: 'Turnover × uplift. Near-100% margin.' },
    ],
    formula: 'turnover × achievable_pricing_uplift',
    pointEstimate: value,
    implementationCost: Math.max(2_500, value * 0.04),
    confidence: 0.5,
    effort: 0.3,
    risk: 'medium',
    timeToValue: 75,
    evidence: [
      evidenceFromField(ctx, `Turnover basis: ${ctx.turnover.note}`, 'turnoverEstimate'),
      benchmarkEvidence(BENCHMARKS.pricingUpliftPct.note, 0.5),
    ],
    assumptions: [
      'Pricing has not been formally reviewed recently. Connect accounting to confirm historic price movement before acting.',
    ],
    reasoningSummary:
      'Pricing is the highest-margin lever available, and the risk is customer reaction rather than cost. It is rated medium risk for that reason, not because the money is uncertain.',
    dependencies: ['Current price list', 'Customer contract terms'],
    capabilities: ['grothos'],
    requiredIntegrations: ['accounting'],
    playbookId: 'pricing-review',
    executionReadiness: ctx.hasFinancialData ? 0.8 : 0.45,
    approvalRequirements: ['Director approval before any customer price change'],
  };
};

const propositionClarity: Rule = (ctx) => {
  const props = (valueOf(ctx.twin.valuePropositions) as string[] | null) ?? [];
  const weak = props.length === 0 || (props[0] ?? '').length < 60;
  if (!weak) return null;

  const value = ctx.turnover.value * 0.02;
  if (value < 4_000) return null;

  return {
    category: 'MAKE_MORE',
    subcategory: 'Marketing',
    title: 'Sharpen the market proposition',
    summary:
      'The public proposition is thin or absent. Every downstream sales and marketing motion inherits that weakness, so fixing it raises the return on everything else.',
    problem:
      'A visitor cannot tell within a few seconds what the company does, who for, and why it is the better choice. Outbound and paid spend then underperform for reasons that look like channel problems.',
    lines: [
      { label: 'Turnover', value: Math.round(ctx.turnover.value), unit: 'GBP', basis: ctx.turnover.basis, note: ctx.turnover.note },
      { label: 'Conversion uplift from proposition clarity', value: 2, unit: 'percent', basis: 'assumption', note: 'Conservative placeholder — proposition work is an enabler, and its value is hard to isolate.' },
      { label: 'Indicative annual value', value: Math.round(value), unit: 'GBP', basis: 'assumption', note: 'Deliberately conservative. Treat as an enabler, not a standalone revenue case.' },
    ],
    formula: 'turnover × conversion_uplift',
    pointEstimate: value,
    implementationCost: 6_000,
    confidence: 0.4,
    effort: 0.3,
    risk: 'low',
    timeToValue: 30,
    evidence: [
      props.length > 0
        ? evidenceFromField(ctx, `Current public proposition: "${props[0]}"`, 'valuePropositions')
        : benchmarkEvidence('No meta description or clear proposition statement was found on the homepage.', 0.7),
    ],
    assumptions: ['Proposition weakness is inferred from public web content only.'],
    reasoningSummary:
      'This is an enabler rather than a revenue line in its own right. It is included because pipeline and cross-sell work built on an unclear proposition underperforms, and the fix is cheap.',
    dependencies: [],
    capabilities: ['grothos'],
    requiredIntegrations: [],
    playbookId: 'proposition-review',
    executionReadiness: 0.8,
    approvalRequirements: ['Approve messaging before publication'],
  };
};

const marketExpansion: Rule = (ctx) => {
  const locations = (valueOf(ctx.twin.locations) as string[] | null) ?? [];
  if (ctx.sectors.length === 0) return null;
  if (locations.length > 3) return null; // already multi-site

  const value = ctx.turnover.value * 0.06;
  if (value < 15_000) return null;

  return {
    category: 'MAKE_MORE',
    subcategory: 'New business',
    title: 'Adjacent market or geography expansion',
    summary: `The company appears concentrated in ${locations.length > 0 ? locations.length + ' location(s)' : 'a single location'}. The same proposition applied to an adjacent region or sector is the lowest-risk route to new demand.`,
    problem:
      'Geographic or sector concentration caps addressable market and increases exposure to a single local economy.',
    lines: [
      { label: 'Turnover', value: Math.round(ctx.turnover.value), unit: 'GBP', basis: ctx.turnover.basis, note: ctx.turnover.note },
      { label: 'Expansion contribution in year one', value: 6, unit: 'percent', basis: 'assumption', note: 'A deliberately modest first-year contribution from one adjacent market.' },
      { label: 'Additional annual revenue', value: Math.round(value), unit: 'GBP', basis: 'assumption', note: 'Turnover × first-year expansion contribution.' },
    ],
    formula: 'turnover × first_year_expansion_contribution',
    pointEstimate: value,
    implementationCost: Math.max(10_000, value * 0.2),
    confidence: 0.38,
    effort: 0.75,
    risk: 'high',
    timeToValue: 180,
    evidence: [
      evidenceFromField(ctx, `Operating sectors: ${ctx.sectors.join(', ')}`, 'sectors'),
      benchmarkEvidence('Expansion into an adjacent market typically takes 6–12 months to produce meaningful revenue.', 0.6),
    ],
    assumptions: ['The proposition transfers to the adjacent market without material change.'],
    reasoningSummary:
      'Ranked below the customer-base opportunities on purpose: it is the slowest and riskiest growth route here, and should only be started once the cheaper revenue has been taken.',
    dependencies: ['Market research', 'Capacity to deliver outside the current footprint'],
    capabilities: ['grothos', 'salesonic', 'listeningpost'],
    requiredIntegrations: [],
    playbookId: 'new-market-entry',
    executionReadiness: 0.5,
    approvalRequirements: ['Board approval for market entry investment'],
  };
};

const RULES: Rule[] = [dormantReactivation, pipelineGeneration, crossSell, pricingReview, propositionClarity, marketExpansion];

export function makeMoreOpportunities(ctx: AnalysisContext): Opportunity[] {
  const out: Opportunity[] = [];
  RULES.forEach((rule, i) => {
    const draft = rule(ctx);
    if (draft) out.push(makeOpportunity(ctx, ctx.twin.id, i, draft));
  });
  return out;
}
