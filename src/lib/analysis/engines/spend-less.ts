/**
 * SPEND LESS engine — Directive §8.
 *
 * "Where actual spend data is not connected, clearly label recommendations as
 * hypotheses or benchmark-led opportunities. Once financial/transaction/invoice
 * systems are connected, promote hypotheses to quantified opportunities."
 *
 * That promotion is mechanical here: every line's `basis` flips from 'benchmark'
 * to 'connected' when ctx.hasFinancialData is true, which in turn lifts the
 * derived epistemics from hypothesis to inferred-fact and raises the confidence
 * ceiling. No rule needs to know about it.
 */

import type { Opportunity } from '../../core/opportunity';
import { BENCHMARKS, sectorMultiplier } from '../benchmarks';
import type { AnalysisContext } from '../context';
import { benchmarkEvidence, evidenceFromField, makeOpportunity, money, type DraftInput } from './shared';
import type { FinancialLine } from '../../core/opportunity';

type Rule = (ctx: AnalysisContext) => DraftInput | null;

/** Spend lines are 'connected' once a financial system is attached, else 'benchmark'. */
function spendBasis(ctx: AnalysisContext): FinancialLine['basis'] {
  return ctx.hasFinancialData ? 'connected' : 'benchmark';
}

function confidenceFor(ctx: AnalysisContext, connected: number, benchmarked: number): number {
  return ctx.hasFinancialData ? connected : benchmarked;
}


/**
 * The same opportunity, built from a connected tenant.
 *
 * Every line is `connected`, so the derived epistemics become inferred-fact and
 * the confidence ceiling lifts. The numbers are seats, not estimates: unassigned
 * licences, leavers who still hold one, and accounts that have not signed in.
 */
function microsoftLicencesFromFacts(ctx: AnalysisContext, licence: NonNullable<AnalysisContext['facts']['licence']>): DraftInput | null {
  if (licence.recoverableAnnualGbp < 250) return null;

  const unassignedAnnual = licence.skus.reduce((sum, s) => sum + s.unassignedAnnualCostGbp, 0);
  const unassignedSeats = licence.skus.reduce((sum, s) => sum + s.unassigned, 0);
  const staleSeats = licence.licensedDisabledUsers + licence.dormantLicensedUsers;

  const lines: FinancialLine[] = [
    { label: 'Licensed users', value: licence.licensedUsers, unit: 'count', basis: 'connected', note: `Counted from the tenant on ${licence.retrievedAt.slice(0, 10)}.` },
    { label: 'Annual licence cost', value: licence.annualLicenceCostGbp, unit: 'GBP', basis: 'connected', note: 'Assigned seats × published unit price × 12.' },
    { label: 'Unassigned seats', value: unassignedSeats, unit: 'count', basis: 'connected', note: 'Purchased but assigned to nobody.' },
    { label: 'Cost of unassigned seats', value: unassignedAnnual, unit: 'GBP', basis: 'connected', note: 'Paid for and unused.' },
    { label: 'Disabled accounts still licensed', value: licence.licensedDisabledUsers, unit: 'count', basis: 'connected', note: 'Leavers whose licence was never reclaimed.' },
    { label: `Licensed accounts dormant 60+ days`, value: licence.dormantLicensedUsers, unit: 'count', basis: 'connected', note: 'Enabled and licensed, but not signing in.' },
    { label: 'Recoverable annual spend', value: licence.recoverableAnnualGbp, unit: 'GBP', basis: 'connected', note: 'Unassigned seats plus leaver and dormant seats at the average seat price.' },
  ];

  const skuSummary = licence.skus
    .filter((s) => s.purchased > 0)
    .map((s) => `${s.name}: ${s.assigned}/${s.purchased}`)
    .join(', ');

  return {
    category: 'SPEND_LESS',
    subcategory: 'Microsoft licences',
    title: 'Microsoft 365 licence optimisation',
    summary:
      `${money(licence.recoverableAnnualGbp)} a year is recoverable from the connected tenant: ` +
      `${unassignedSeats} unassigned seat(s), ${licence.licensedDisabledUsers} leaver(s) still licensed and ` +
      `${licence.dormantLicensedUsers} dormant account(s).`,
    problem:
      'Licence spend grows with joiners and never shrinks with leavers. None of it appears on an invoice as waste — ' +
      'it appears as a slightly larger bill every month.',
    lines,
    formula: 'unassigned_seats × unit_price × 12 + (leavers + dormant) × average_seat_cost',
    pointEstimate: licence.recoverableAnnualGbp,
    band: 0.1,
    implementationCost: 1_800,
    confidence: 0.92,
    effort: 0.2,
    risk: 'low',
    timeToValue: 30,
    evidence: [
      {
        statement: `Tenant reports ${licence.totalUsers} account(s), ${licence.enabledUsers} enabled, ${licence.licensedUsers} licensed. ${skuSummary}`,
        epistemics: 'fact',
        confidence: 0.97,
        sources: [{ connectorId: 'microsoft-365', label: 'Microsoft Graph', locator: 'graph:/users', retrievedAt: licence.retrievedAt }],
      },
      {
        statement: `${staleSeats} seat(s) are assigned to accounts that are disabled or have not signed in for 60 days.`,
        epistemics: 'fact',
        confidence: 0.95,
        sources: [{ connectorId: 'microsoft-365', label: 'Microsoft Graph', locator: 'graph:/users', retrievedAt: licence.retrievedAt }],
      },
    ],
    assumptions: [
      'Unit prices are published UK list prices; a tenant on a negotiated agreement will differ, and the saving moves with it.',
      'Dormancy is measured on sign-in activity, which requires the tenant to report it.',
    ],
    reasoningSummary:
      'Counted directly from the connected tenant rather than modelled. The reclaim requires no negotiation and no ' +
      'supplier change, and the saving appears on the next billing cycle.',
    dependencies: [],
    capabilities: ['buyonic'],
    requiredIntegrations: ['microsoft-365'],
    playbookId: 'microsoft-licence-optimisation',
    executionReadiness: 0.95,
    approvalRequirements: ['Confirm each seat removal with the customer before applying'],
  };
}

const microsoftLicences: Rule = (ctx) => {
  // With a connected tenant every figure below is counted rather than modelled,
  // which is what lifts this opportunity out of hypothesis. The rule does not
  // decide that — deriveEpistemics reads the line bases and concludes it.
  const licence = ctx.facts.licence;
  if (licence) return microsoftLicencesFromFacts(ctx, licence);

  const users = ctx.employees.value;
  const annualCost = users * BENCHMARKS.m365CostPerUserPerMonth.value * 12;
  const value = annualCost * BENCHMARKS.m365WastePct.value;
  if (value < 1_000) return null;

  const hasM365Indicator = ctx.technology.some((t) => /Microsoft|Productivity/i.test(`${t.name} ${t.category}`));
  const basis = ctx.hasLicenceData ? 'connected' : 'benchmark';

  return {
    category: 'SPEND_LESS',
    subcategory: 'Microsoft licences',
    title: 'Microsoft 365 licence optimisation',
    summary: `At ${users} users, the M365 estate is worth roughly ${money(annualCost)} a year. Estates that have never had a licence review typically carry ${BENCHMARKS.m365WastePct.value * 100}% waste.`,
    problem:
      'Leavers stay licensed, seats sit unassigned, and users sit on a higher SKU than their role needs. None of it shows up on an invoice as waste — it shows up as a slightly larger bill every month.',
    lines: [
      { label: 'User count', value: users, unit: 'count', basis: ctx.employees.basis, note: ctx.employees.note },
      { label: 'Cost per user per month', value: BENCHMARKS.m365CostPerUserPerMonth.value, unit: 'GBP/month', basis: 'benchmark', note: BENCHMARKS.m365CostPerUserPerMonth.note },
      { label: 'Annual M365 cost', value: Math.round(annualCost), unit: 'GBP', basis, note: 'Users × monthly cost × 12.' },
      { label: 'Typical over-licensing', value: BENCHMARKS.m365WastePct.value * 100, unit: 'percent', basis: 'benchmark', note: BENCHMARKS.m365WastePct.note },
      { label: 'Recoverable annual spend', value: Math.round(value), unit: 'GBP', basis, note: 'Annual cost × waste rate.' },
    ],
    formula: 'users × cost_per_user_per_month × 12 × waste_rate',
    pointEstimate: value,
    implementationCost: 1_800,
    confidence: confidenceFor(ctx, 0.88, hasM365Indicator ? 0.55 : 0.42),
    effort: 0.2,
    risk: 'low',
    timeToValue: 30,
    evidence: [
      hasM365Indicator
        ? evidenceFromField(ctx, 'Microsoft productivity tooling detected in public technology indicators.', 'technologyEstate')
        : benchmarkEvidence('No direct Microsoft indicator found — the estate is assumed Microsoft-based, which is typical for UK SMEs.', 0.4),
      benchmarkEvidence(BENCHMARKS.m365WastePct.note, 0.6),
    ],
    assumptions: [
      ctx.hasLicenceData
        ? 'Licence counts read from the connected tenant.'
        : 'Licence count modelled from headcount. Connect Microsoft 365 to replace this with exact assigned-versus-consumed seats.',
    ],
    reasoningSummary:
      'The cheapest and fastest saving available in almost every SME estate. It requires no negotiation and no supplier change — only a licence review and a reclaim.',
    dependencies: ['Tenant admin access'],
    capabilities: ['buyonic'],
    requiredIntegrations: ['microsoft-365'],
    playbookId: 'microsoft-licence-optimisation',
    executionReadiness: ctx.hasLicenceData ? 0.9 : 0.55,
    approvalRequirements: ['Confirm seat removals with the customer before applying'],
  };
};

const saasRationalisation: Rule = (ctx) => {
  const spend = ctx.employees.value * BENCHMARKS.saasSpendPerEmployeePerYear.value;
  const value = spend * BENCHMARKS.saasDuplicationPct.value;
  if (value < 1_500) return null;

  const observedTools = ctx.technology.length;
  const basis = spendBasis(ctx);

  return {
    category: 'SPEND_LESS',
    subcategory: 'SaaS',
    title: 'SaaS rationalisation',
    summary: `Estimated SaaS spend of ${money(spend)} a year across ${ctx.employees.value} employees. ${observedTools} distinct tools are already visible from public signals alone.`,
    problem:
      'Departments buy their own tools on cards. Nobody holds the full register, so overlapping products are paid for in parallel and licences for leavers renew silently.',
    lines: [
      { label: 'Employees', value: ctx.employees.value, unit: 'count', basis: ctx.employees.basis, note: ctx.employees.note },
      { label: 'SaaS spend per employee per year', value: BENCHMARKS.saasSpendPerEmployeePerYear.value, unit: 'GBP', basis: 'benchmark', note: BENCHMARKS.saasSpendPerEmployeePerYear.note },
      { label: 'Estimated annual SaaS spend', value: Math.round(spend), unit: 'GBP', basis, note: 'Employees × per-employee spend.' },
      { label: 'Duplicated or unused share', value: BENCHMARKS.saasDuplicationPct.value * 100, unit: 'percent', basis: 'benchmark', note: BENCHMARKS.saasDuplicationPct.note },
      { label: 'Recoverable annual spend', value: Math.round(value), unit: 'GBP', basis, note: 'SaaS spend × duplication rate.' },
    ],
    formula: 'employees × saas_spend_per_employee × duplication_rate',
    pointEstimate: value,
    implementationCost: 3_500,
    confidence: confidenceFor(ctx, 0.85, 0.45),
    effort: 0.35,
    risk: 'low',
    timeToValue: 60,
    evidence: [
      observedTools > 0
        ? evidenceFromField(ctx, `${observedTools} tools detected from public markup: ${ctx.technology.slice(0, 6).map((t) => t.name).join(', ')}`, 'technologyEstate')
        : benchmarkEvidence('No public technology indicators found. Spend is modelled from headcount alone.', 0.35),
      benchmarkEvidence(BENCHMARKS.saasDuplicationPct.note, 0.6),
    ],
    assumptions: [
      ctx.hasFinancialData
        ? 'Spend read from connected financial records.'
        : 'Spend is a benchmark hypothesis. Connect accounting or a bank feed to convert this into a counted figure.',
    ],
    reasoningSummary:
      'A software register is the deliverable; the saving is the by-product. Most of the value comes from cancelling what nobody uses rather than renegotiating what they do.',
    dependencies: ['Accounts payable or card statement access'],
    capabilities: ['buyonic', 'sourcingai'],
    requiredIntegrations: ['accounting', 'banking'],
    playbookId: 'saas-rationalisation',
    executionReadiness: ctx.hasFinancialData ? 0.85 : 0.4,
    approvalRequirements: ['Confirm each cancellation with the business owner of the tool'],
  };
};

const cloudOptimisation: Rule = (ctx) => {
  const hasCloud = ctx.technology.some((t) => /cloud|CDN|Payments|Productivity/i.test(t.category)) || ctx.sectors.includes('Software');
  if (!hasCloud) return null;

  const mult = sectorMultiplier(ctx.sectors);
  const cloudSpend = ctx.itSpendEstimate * 0.3 * mult.itSpend;
  const value = cloudSpend * BENCHMARKS.cloudOverspendPct.value;
  if (value < 1_500) return null;

  return {
    category: 'SPEND_LESS',
    subcategory: 'Cloud',
    title: 'Cloud cost optimisation',
    summary: `Estimated cloud spend of ${money(cloudSpend)} a year. Unoptimised estates typically carry ${BENCHMARKS.cloudOverspendPct.value * 100}% waste in idle and oversized resource.`,
    problem:
      'Cloud resource is easy to create and nobody is accountable for switching it off. Spend grows monotonically because deletion requires a decision and provisioning does not.',
    lines: [
      { label: 'Estimated total IT spend', value: ctx.itSpendEstimate, unit: 'GBP', basis: spendBasis(ctx), note: `${BENCHMARKS.itSpendPctOfTurnover.note} Applied to ${money(ctx.turnover.value)} turnover.` },
      { label: 'Cloud share of IT spend', value: 30, unit: 'percent', basis: 'benchmark', note: 'Typical for an SME running hosted workloads.' },
      { label: 'Estimated cloud spend', value: Math.round(cloudSpend), unit: 'GBP', basis: spendBasis(ctx), note: 'IT spend × cloud share.' },
      { label: 'Unoptimised overspend', value: BENCHMARKS.cloudOverspendPct.value * 100, unit: 'percent', basis: 'benchmark', note: BENCHMARKS.cloudOverspendPct.note },
      { label: 'Recoverable annual spend', value: Math.round(value), unit: 'GBP', basis: spendBasis(ctx), note: 'Cloud spend × overspend rate.' },
    ],
    formula: 'it_spend × cloud_share × overspend_rate',
    pointEstimate: value,
    implementationCost: 4_000,
    confidence: confidenceFor(ctx, 0.8, 0.4),
    effort: 0.4,
    risk: 'low',
    timeToValue: 45,
    evidence: [
      evidenceFromField(ctx, `Cloud and hosting indicators: ${ctx.technology.filter((t) => /cloud|CDN|Productivity/i.test(t.category)).map((t) => t.name).join(', ') || 'inferred from sector'}`, 'cloudEstate'),
      benchmarkEvidence(BENCHMARKS.cloudOverspendPct.note, 0.6),
    ],
    assumptions: ['Cloud share of IT spend is a benchmark. Connect Azure or AWS billing for actual consumption.'],
    reasoningSummary:
      'Rightsizing and reservations are reversible and low risk, which is why this ranks above supplier renegotiation despite a similar size.',
    dependencies: ['Billing read access to the cloud tenant'],
    capabilities: ['buyonic', 'sixonic'],
    requiredIntegrations: ['azure', 'aws'],
    playbookId: 'cloud-cost-optimisation',
    executionReadiness: 0.5,
    approvalRequirements: ['Confirm resource changes with the technical owner'],
  };
};

const telecoms: Rule = (ctx) => {
  const spend = ctx.employees.value * BENCHMARKS.telecomsPerEmployeePerYear.value;
  const value = spend * 0.18;
  if (value < 1_200) return null;

  return {
    category: 'SPEND_LESS',
    subcategory: 'Telecoms',
    title: 'Telecoms and connectivity review',
    summary: `Estimated telecoms spend of ${money(spend)} a year. Unused lines, out-of-contract tariffs and leaver mobiles are the usual recovery.`,
    problem: 'Telecoms contracts roll over on out-of-contract rates and nobody reconciles the inventory against actual users.',
    lines: [
      { label: 'Employees', value: ctx.employees.value, unit: 'count', basis: ctx.employees.basis, note: ctx.employees.note },
      { label: 'Telecoms spend per employee per year', value: BENCHMARKS.telecomsPerEmployeePerYear.value, unit: 'GBP', basis: 'benchmark', note: BENCHMARKS.telecomsPerEmployeePerYear.note },
      { label: 'Estimated annual telecoms spend', value: Math.round(spend), unit: 'GBP', basis: spendBasis(ctx), note: 'Employees × per-employee spend.' },
      { label: 'Typical recovery', value: 18, unit: 'percent', basis: 'benchmark', note: 'Unused connections, out-of-contract tariffs, leaver devices.' },
      { label: 'Recoverable annual spend', value: Math.round(value), unit: 'GBP', basis: spendBasis(ctx), note: 'Telecoms spend × recovery rate.' },
    ],
    formula: 'employees × telecoms_spend_per_employee × recovery_rate',
    pointEstimate: value,
    implementationCost: 1_500,
    confidence: confidenceFor(ctx, 0.78, 0.38),
    effort: 0.25,
    risk: 'low',
    timeToValue: 60,
    evidence: [benchmarkEvidence(BENCHMARKS.telecomsPerEmployeePerYear.note, 0.45)],
    assumptions: ['No telecoms inventory is connected. This is a benchmark hypothesis.'],
    reasoningSummary: 'Small but reliable, low effort, and it produces an asset register the customer did not previously have.',
    dependencies: ['Copies of current telecoms bills'],
    capabilities: ['buyonic', 'sourcingai'],
    requiredIntegrations: ['telecoms'],
    playbookId: 'supplier-consolidation',
    executionReadiness: 0.45,
    approvalRequirements: ['Confirm line cancellations with the customer'],
  };
};

const processAutomation: Rule = (ctx) => {
  const hours = ctx.employees.value * BENCHMARKS.automatableAdminHoursPerEmployeePerWeek.value * 46;
  const value = hours * BENCHMARKS.processLabourCostPerHour.value * 0.55;
  if (value < 5_000) return null;

  return {
    category: 'SPEND_LESS',
    subcategory: 'Process automation',
    title: 'Automate manual administrative process',
    summary: `Roughly ${Math.round(hours).toLocaleString('en-GB')} administrative hours a year across the business. Automating the repeatable half is worth about ${money(value)}.`,
    problem:
      'Re-keying between systems, manual reporting and chasing consume capacity that never appears as a cost line, because it is absorbed by salaried staff.',
    lines: [
      { label: 'Employees', value: ctx.employees.value, unit: 'count', basis: ctx.employees.basis, note: ctx.employees.note },
      { label: 'Automatable admin hours per employee per week', value: BENCHMARKS.automatableAdminHoursPerEmployeePerWeek.value, unit: 'count', basis: 'benchmark', note: BENCHMARKS.automatableAdminHoursPerEmployeePerWeek.note },
      { label: 'Annual automatable hours', value: Math.round(hours), unit: 'count', basis: 'benchmark', note: 'Employees × weekly hours × 46 working weeks.' },
      { label: 'Fully-loaded cost per hour', value: BENCHMARKS.processLabourCostPerHour.value, unit: 'GBP', basis: 'benchmark', note: BENCHMARKS.processLabourCostPerHour.note },
      { label: 'Realisation rate', value: 55, unit: 'percent', basis: 'assumption', note: 'Not all recovered time converts to cash. Applied deliberately to avoid overstating.' },
      { label: 'Annual value', value: Math.round(value), unit: 'GBP', basis: 'benchmark', note: 'Hours × hourly cost × realisation rate.' },
    ],
    formula: 'employees × automatable_hours_per_week × 46 × hourly_cost × realisation_rate',
    pointEstimate: value,
    implementationCost: Math.max(8_000, value * 0.25),
    confidence: 0.45,
    effort: 0.6,
    risk: 'medium',
    timeToValue: 90,
    evidence: [
      benchmarkEvidence(BENCHMARKS.automatableAdminHoursPerEmployeePerWeek.note, 0.45),
      benchmarkEvidence('Realisation is capped at 55% because recovered time only becomes cash when it is redeployed or headcount is avoided.', 0.6),
    ],
    assumptions: [
      'Recovered time is redeployed rather than simply absorbed — otherwise the saving is capacity, not cash.',
    ],
    reasoningSummary:
      'The realisation rate is the honest part of this model. Time savings are frequently quoted gross; this figure is deliberately the net.',
    dependencies: ['Process walkthrough with the customer'],
    capabilities: ['sixonic'],
    requiredIntegrations: [],
    playbookId: 'process-automation',
    executionReadiness: 0.55,
    approvalRequirements: ['Approve process changes with the process owner'],
  };
};

const supplierConsolidation: Rule = (ctx) => {
  const addressable = ctx.itSpendEstimate * 1.8;
  const value = addressable * BENCHMARKS.supplierFragmentationSavingPct.value;
  if (value < 4_000) return null;

  return {
    category: 'SPEND_LESS',
    subcategory: 'Supplier consolidation',
    title: 'Consolidate fragmented supplier base',
    summary: `Roughly ${money(addressable)} of addressable third-party spend. Consolidating fragmented categories typically returns ${BENCHMARKS.supplierFragmentationSavingPct.value * 100}%.`,
    problem:
      'Buying the same category from several suppliers loses volume leverage and multiplies administration, invoices and renewal dates.',
    lines: [
      { label: 'Estimated addressable third-party spend', value: Math.round(addressable), unit: 'GBP', basis: spendBasis(ctx), note: 'Modelled as a multiple of estimated IT spend across all indirect categories.' },
      { label: 'Consolidation saving', value: BENCHMARKS.supplierFragmentationSavingPct.value * 100, unit: 'percent', basis: 'benchmark', note: BENCHMARKS.supplierFragmentationSavingPct.note },
      { label: 'Recoverable annual spend', value: Math.round(value), unit: 'GBP', basis: spendBasis(ctx), note: 'Addressable spend × consolidation saving.' },
    ],
    formula: 'addressable_third_party_spend × consolidation_saving_rate',
    pointEstimate: value,
    implementationCost: Math.max(6_000, value * 0.15),
    confidence: confidenceFor(ctx, 0.75, 0.35),
    effort: 0.55,
    risk: 'medium',
    timeToValue: 120,
    evidence: [benchmarkEvidence(BENCHMARKS.supplierFragmentationSavingPct.note, 0.5)],
    assumptions: [
      'Supplier fragmentation is assumed, not observed. Connect accounting or procurement to confirm before approaching any supplier.',
    ],
    reasoningSummary:
      'Ranked below the licence and SaaS work because it needs real supplier data before anyone should open a negotiation. Starting this without spend data risks the customer relationship.',
    dependencies: ['Supplier ledger', 'Contract register'],
    capabilities: ['buyonic', 'sourcingai'],
    requiredIntegrations: ['accounting', 'procurement'],
    playbookId: 'supplier-consolidation',
    executionReadiness: ctx.hasFinancialData ? 0.75 : 0.3,
    approvalRequirements: ['Customer approval before contacting any supplier'],
  };
};

const RULES: Rule[] = [
  microsoftLicences,
  saasRationalisation,
  cloudOptimisation,
  telecoms,
  processAutomation,
  supplierConsolidation,
];

export function spendLessOpportunities(ctx: AnalysisContext): Opportunity[] {
  const out: Opportunity[] = [];
  RULES.forEach((rule, i) => {
    const draft = rule(ctx);
    if (draft) out.push(makeOpportunity(ctx, ctx.twin.id, i, draft));
  });
  return out;
}
