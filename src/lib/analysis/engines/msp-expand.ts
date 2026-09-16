/**
 * MSP EXPANSION engine — Directive §10.
 *
 * "This is a critical differentiator. The system must simultaneously ask: given
 * what we now know about this company, what should its MSP reasonably offer
 * next?"
 *
 * Each service carries MSP economics — monthly charge, delivery cost, gross
 * margin — and a relationship-sensitivity rating, because the wrong
 * conversation at the wrong moment costs more than the service earns.
 */

import type { Opportunity } from '../../core/opportunity';
import type { AnalysisContext } from '../context';
import { benchmarkEvidence, evidenceFromField, makeOpportunity, money, type DraftInput } from './shared';
import { valueOf } from '../../core/provenance';
import type { Signal } from '../../core/company-twin';

export type RelationshipSensitivity = 'routine' | 'considered' | 'delicate';

export interface MspServiceDefinition {
  id: string;
  name: string;
  category: string;
  /** Monthly charge per unit. */
  pricePerUnit: number;
  unit: 'per-user' | 'per-device' | 'per-site' | 'fixed';
  /** MSP delivery cost as a share of the charge. */
  deliveryCostRatio: number;
  /** Minimum monthly charge regardless of size. */
  floorMonthly: number;
  customerProblem: string;
  customerBenefit: string;
  sensitivity: RelationshipSensitivity;
  effort: number;
  timeToValue: number;
  capabilities: string[];
  /** Only proposed when this returns true. */
  applies: (ctx: AnalysisContext) => boolean;
  /** Why this company specifically. */
  rationale: (ctx: AnalysisContext) => string;
}

export const MSP_SERVICES: MspServiceDefinition[] = [
  {
    id: 'managed-microsoft',
    name: 'Managed Microsoft 365',
    category: 'Productivity',
    pricePerUnit: 12,
    unit: 'per-user',
    deliveryCostRatio: 0.42,
    floorMonthly: 250,
    customerProblem: 'The M365 tenant is unmanaged: licences drift, security defaults are untouched and nobody owns configuration.',
    customerBenefit: 'A managed tenant with licence control, security baselines and a named owner.',
    sensitivity: 'routine',
    effort: 0.3,
    timeToValue: 30,
    capabilities: ['strata-metamsp'],
    applies: (ctx) => ctx.employees.value >= 5,
    rationale: (ctx) =>
      ctx.technology.some((t) => /Microsoft/i.test(t.name))
        ? 'Microsoft tooling is visible in public indicators and no managed-service relationship is recorded for it.'
        : 'A Microsoft-based estate is the default assumption for a UK SME of this size and sector.',
  },
  {
    id: 'cyber-essentials',
    name: 'Cyber security and Cyber Essentials',
    category: 'Cyber',
    pricePerUnit: 9,
    unit: 'per-user',
    deliveryCostRatio: 0.38,
    floorMonthly: 400,
    customerProblem: 'No public evidence of security certification, while the customer holds data its own clients care about.',
    customerBenefit: 'Certification that unlocks tenders and insurance, plus a defensible security posture.',
    sensitivity: 'routine',
    effort: 0.4,
    timeToValue: 60,
    capabilities: ['strata-metamsp'],
    applies: (ctx) => {
      const indicators = (valueOf(ctx.twin.cyberIndicators) as Signal[] | null) ?? [];
      return !indicators.some((i) => /cyber essentials|iso\s*27001/i.test(i.summary));
    },
    rationale: () =>
      'No Cyber Essentials or ISO 27001 reference was found on the public website, which usually means neither is held.',
  },
  {
    id: 'backup-continuity',
    name: 'Backup and business continuity',
    category: 'Resilience',
    pricePerUnit: 7,
    unit: 'per-user',
    deliveryCostRatio: 0.45,
    floorMonthly: 200,
    customerProblem: 'Cloud data is assumed to be backed up by the cloud provider. It is not.',
    customerBenefit: 'Tested recovery for M365 and server data with a stated recovery objective.',
    sensitivity: 'routine',
    effort: 0.25,
    timeToValue: 30,
    capabilities: ['strata-metamsp'],
    applies: (ctx) => ctx.employees.value >= 5,
    rationale: () => 'Microsoft 365 backup is the most commonly missing control in SME estates and the easiest to evidence.',
  },
  {
    id: 'licence-management',
    name: 'Licence management as a service',
    category: 'Procurement',
    pricePerUnit: 3,
    unit: 'per-user',
    deliveryCostRatio: 0.3,
    floorMonthly: 150,
    customerProblem: 'Licence spend grows silently with joiners and never shrinks with leavers.',
    customerBenefit: 'Monthly true-up, with savings that typically exceed the fee.',
    sensitivity: 'routine',
    effort: 0.2,
    timeToValue: 30,
    capabilities: ['buyonic', 'strata-metamsp'],
    applies: (ctx) => ctx.employees.value >= 15,
    rationale: () => 'This service usually pays for itself out of the licence waste it removes, which makes it an easy first expansion.',
  },
  {
    id: 'cloud-management',
    name: 'Cloud management and optimisation',
    category: 'Cloud',
    pricePerUnit: 14,
    unit: 'per-user',
    deliveryCostRatio: 0.45,
    floorMonthly: 500,
    customerProblem: 'Cloud resource is provisioned ad hoc with no cost ownership.',
    customerBenefit: 'Managed, right-sized cloud with monthly cost reporting.',
    sensitivity: 'considered',
    effort: 0.45,
    timeToValue: 60,
    capabilities: ['strata-metamsp', 'buyonic'],
    applies: (ctx) => ctx.sectors.includes('Software') || ctx.technology.some((t) => /cloud|CDN/i.test(t.category)),
    rationale: () => 'Public indicators suggest hosted workloads, which is where unmanaged cloud spend accumulates.',
  },
  {
    id: 'device-management',
    name: 'Device management and endpoint security',
    category: 'Endpoint',
    pricePerUnit: 11,
    unit: 'per-device',
    deliveryCostRatio: 0.48,
    floorMonthly: 300,
    customerProblem: 'Devices are built by hand, patched inconsistently and not tracked when staff leave.',
    customerBenefit: 'Standardised, patched, recoverable endpoints with a live asset register.',
    sensitivity: 'routine',
    effort: 0.4,
    timeToValue: 45,
    capabilities: ['strata-metamsp'],
    applies: (ctx) => ctx.employees.value >= 10,
    rationale: (ctx) => `Roughly ${Math.round(ctx.employees.value * 1.2)} endpoints at ${ctx.employees.value} employees, typically unmanaged at this size.`,
  },
  {
    id: 'service-desk',
    name: 'Managed service desk',
    category: 'Support',
    pricePerUnit: 22,
    unit: 'per-user',
    deliveryCostRatio: 0.55,
    floorMonthly: 750,
    customerProblem: 'IT requests go to whoever is nearest, so nothing is measured and problems recur.',
    customerBenefit: 'A single route in, with SLAs and trend reporting that drives out repeat issues.',
    sensitivity: 'considered',
    effort: 0.55,
    timeToValue: 60,
    capabilities: ['strata-metamsp'],
    applies: (ctx) => ctx.employees.value >= 20,
    rationale: (ctx) => `At ${ctx.employees.value} employees the company is past the point where informal IT support scales.`,
  },
  {
    id: 'ai-governance',
    name: 'AI governance and enablement',
    category: 'AI',
    pricePerUnit: 6,
    unit: 'per-user',
    deliveryCostRatio: 0.35,
    floorMonthly: 400,
    customerProblem: 'Staff are already using AI tools with company data, under no policy and no oversight.',
    customerBenefit: 'A usable AI policy, approved tooling and monitoring — enabling use rather than banning it.',
    sensitivity: 'considered',
    effort: 0.35,
    timeToValue: 45,
    capabilities: ['strata-metamsp', 'sixonic'],
    applies: (ctx) => ctx.employees.value >= 15,
    rationale: () => 'Shadow AI use is near-universal and almost never governed, which creates a real and current data exposure.',
  },
  {
    id: 'fractional-it-leadership',
    name: 'Fractional IT leadership',
    category: 'Advisory',
    pricePerUnit: 0,
    unit: 'fixed',
    deliveryCostRatio: 0.5,
    floorMonthly: 1_200,
    customerProblem: 'Technology decisions are made reactively because there is no one accountable for the roadmap.',
    customerBenefit: 'A quarterly roadmap, budget ownership and a technology voice at management level.',
    sensitivity: 'delicate',
    effort: 0.3,
    timeToValue: 90,
    capabilities: ['strata-metamsp', 'grothos'],
    applies: (ctx) => ctx.employees.value >= 40,
    rationale: (ctx) => `At ${ctx.employees.value} employees the company is large enough to need a technology roadmap and usually too small to employ a CIO.`,
  },
  {
    id: 'growth-services',
    name: 'Growth and sales optimisation services',
    category: 'Growth',
    pricePerUnit: 0,
    unit: 'fixed',
    deliveryCostRatio: 0.45,
    floorMonthly: 1_500,
    customerProblem: 'The customer wants revenue growth, and their MSP is the supplier who best understands their systems.',
    customerBenefit: 'Pipeline and revenue services delivered through the existing trusted relationship.',
    sensitivity: 'delicate',
    effort: 0.6,
    timeToValue: 120,
    capabilities: ['salesonic', 'grothos'],
    applies: (ctx) => ctx.turnover.value >= 2_000_000,
    rationale: () =>
      'This is the AIGoGo differentiator: no conventional MSP can offer it, and it changes the relationship from cost centre to growth partner.',
  },
  {
    id: 'procurement-services',
    name: 'Procurement and supplier management',
    category: 'Procurement',
    pricePerUnit: 0,
    unit: 'fixed',
    deliveryCostRatio: 0.4,
    floorMonthly: 900,
    customerProblem: 'Nobody owns third-party spend, so renewals are missed and categories stay fragmented.',
    customerBenefit: 'Managed renewals and sourcing, usually self-funding from the savings delivered.',
    sensitivity: 'considered',
    effort: 0.45,
    timeToValue: 90,
    capabilities: ['buyonic', 'sourcingai'],
    applies: (ctx) => ctx.turnover.value >= 1_000_000,
    rationale: () => 'Self-funding services are the easiest expansion to justify because the customer sees the saving before the fee.',
  },
];

export interface MspEconomics {
  serviceId: string;
  serviceName: string;
  monthlyCharge: number;
  monthlyDeliveryCost: number;
  monthlyGrossMargin: number;
  grossMarginPct: number;
  annualRevenue: number;
  sensitivity: RelationshipSensitivity;
  nextBestConversation: string;
}

export function serviceEconomics(def: MspServiceDefinition, ctx: AnalysisContext): MspEconomics {
  const units =
    def.unit === 'per-user' ? ctx.employees.value
    : def.unit === 'per-device' ? Math.round(ctx.employees.value * 1.2)
    : def.unit === 'per-site' ? Math.max(1, ((valueOf(ctx.twin.locations) as string[] | null) ?? []).length || 1)
    : 1;

  const monthlyCharge = Math.max(def.floorMonthly, Math.round(units * def.pricePerUnit));
  const monthlyDeliveryCost = Math.round(monthlyCharge * def.deliveryCostRatio);
  const monthlyGrossMargin = monthlyCharge - monthlyDeliveryCost;

  return {
    serviceId: def.id,
    serviceName: def.name,
    monthlyCharge,
    monthlyDeliveryCost,
    monthlyGrossMargin,
    grossMarginPct: Math.round((monthlyGrossMargin / monthlyCharge) * 100),
    annualRevenue: monthlyCharge * 12,
    sensitivity: def.sensitivity,
    nextBestConversation: nextConversation(def, ctx),
  };
}

function nextConversation(def: MspServiceDefinition, ctx: AnalysisContext): string {
  switch (def.sensitivity) {
    case 'routine':
      return `Raise at the next service review: "${def.customerProblem}" — lead with the risk, not the fee.`;
    case 'considered':
      return `Book a dedicated 30 minutes. Bring evidence of the gap and a costed option, not a proposal.`;
    case 'delicate':
      return `Do not lead with this. Earn it by delivering a visible win first — ${
        ctx.hasFinancialData ? 'the savings work' : 'the licence review'
      } — then open the conversation from a position of proven value.`;
  }
}

export function mspExpandOpportunities(ctx: AnalysisContext): Opportunity[] {
  const currentServices = ((valueOf(ctx.twin.currentMSPServices) as string[] | null) ?? []).map((s) => s.toLowerCase());
  const out: Opportunity[] = [];

  MSP_SERVICES.filter((def) => def.applies(ctx))
    .filter((def) => !currentServices.some((s) => s.includes(def.id) || def.name.toLowerCase().includes(s)))
    .forEach((def, i) => {
      const econ = serviceEconomics(def, ctx);
      const draft: DraftInput = {
        category: 'MSP_EXPAND',
        subcategory: def.category,
        title: def.name,
        summary: `${money(econ.monthlyCharge)}/month (${money(econ.annualRevenue)} ARR) at ${econ.grossMarginPct}% gross margin. ${def.customerBenefit}`,
        problem: def.customerProblem,
        lines: [
          { label: 'Billable units', value: def.unit === 'fixed' ? 1 : def.unit === 'per-device' ? Math.round(ctx.employees.value * 1.2) : ctx.employees.value, unit: 'count', basis: ctx.employees.basis, note: `${def.unit} pricing. ${ctx.employees.note}` },
          { label: 'Monthly charge', value: econ.monthlyCharge, unit: 'GBP/month', basis: 'benchmark', note: def.unit === 'fixed' ? 'Fixed monthly fee for this service tier.' : `£${def.pricePerUnit} ${def.unit}, floored at £${def.floorMonthly}/month.` },
          { label: 'MSP delivery cost', value: econ.monthlyDeliveryCost, unit: 'GBP/month', basis: 'benchmark', note: `${Math.round(def.deliveryCostRatio * 100)}% of charge — tooling, licences and delivery time.` },
          { label: 'Monthly gross margin', value: econ.monthlyGrossMargin, unit: 'GBP/month', basis: 'benchmark', note: `${econ.grossMarginPct}% gross margin.` },
          { label: 'Annual recurring revenue', value: econ.annualRevenue, unit: 'GBP', basis: 'benchmark', note: 'Monthly charge × 12.' },
        ],
        formula: 'billable_units × unit_price × 12 (floored at minimum monthly charge)',
        pointEstimate: econ.annualRevenue,
        band: 0.3,
        implementationCost: Math.round(econ.monthlyCharge * 1.5),
        confidence: def.sensitivity === 'routine' ? 0.7 : def.sensitivity === 'considered' ? 0.55 : 0.4,
        effort: def.effort,
        risk: def.sensitivity === 'delicate' ? 'high' : def.sensitivity === 'considered' ? 'medium' : 'low',
        timeToValue: def.timeToValue,
        evidence: [
          evidenceFromField(ctx, def.rationale(ctx), 'technologyEstate'),
          benchmarkEvidence(`Pricing and delivery cost from the AIGoGo MSP service model. Gross margin ${econ.grossMarginPct}%.`, 0.6),
        ],
        assumptions: [
          `Billable units derived from headcount (${ctx.employees.note}).`,
          'Customer does not already buy this service elsewhere — confirm before proposing.',
        ],
        reasoningSummary: `${def.rationale(ctx)} Relationship sensitivity is ${def.sensitivity}: ${econ.nextBestConversation}`,
        dependencies: ['Confirmation of what the customer already buys'],
        capabilities: def.capabilities,
        requiredIntegrations: ['psa'],
        playbookId: 'msp-account-expansion',
        executionReadiness: def.sensitivity === 'routine' ? 0.85 : 0.6,
        approvalRequirements: ['MSP account owner approves the approach before any customer contact'],
      };
      out.push(makeOpportunity(ctx, ctx.twin.id, i, draft));
    });

  return out;
}

/** Directive §10 dashboard figures. */
export function mspExpansionSummary(
  opportunities: Opportunity[],
  currentMrr: number,
): { currentMrr: number; potentialMrr: number; expansionMrr: number; potentialAnnualIncrease: number } {
  const expansionMrr = opportunities
    .filter((o) => o.category === 'MSP_EXPAND')
    .reduce((sum, o) => sum + o.estimatedAnnualValue / 12, 0);
  return {
    currentMrr,
    potentialMrr: Math.round(currentMrr + expansionMrr),
    expansionMrr: Math.round(expansionMrr),
    potentialAnnualIncrease: Math.round(expansionMrr * 12),
  };
}
