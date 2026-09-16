/**
 * Benchmark library — Directive §8.
 *
 * "Where actual spend data is not connected, clearly label recommendations as
 * hypotheses or benchmark-led opportunities."
 *
 * Every figure here is a stated planning assumption for UK SMEs, not a measured
 * fact about any company. Each one carries its own note so the evidence view can
 * show the user exactly what was assumed and how wrong it might be. Once a
 * financial connector is attached, `promoteToObserved` replaces the benchmark
 * with the real number and the opportunity's epistemics move from hypothesis to
 * inferred-fact (§8: "promote hypotheses to quantified opportunities").
 */

export interface Benchmark {
  id: string;
  label: string;
  value: number;
  unit: string;
  note: string;
}

export const BENCHMARKS = {
  itSpendPctOfTurnover: {
    id: 'it-spend-pct',
    label: 'IT spend as % of turnover',
    value: 0.035,
    unit: 'ratio',
    note: 'UK SME average IT spend is typically 3–4% of turnover; professional services skew higher, manufacturing lower.',
  },
  m365CostPerUserPerMonth: {
    id: 'm365-cost-user-month',
    label: 'Microsoft 365 cost per user per month',
    value: 18,
    unit: 'GBP',
    note: 'Blended commercial rate across Business Premium and E3 estates.',
  },
  m365WastePct: {
    id: 'm365-waste-pct',
    label: 'Typical over-licensing in unmanaged M365 estates',
    value: 0.18,
    unit: 'ratio',
    note: 'Unassigned seats, leavers still licensed, and over-specified SKUs. Ranges 10–30% where no licence review has run.',
  },
  saasSpendPerEmployeePerYear: {
    id: 'saas-per-employee',
    label: 'SaaS spend per employee per year',
    value: 900,
    unit: 'GBP',
    note: 'Excludes core productivity suite. Higher in software and professional services.',
  },
  saasDuplicationPct: {
    id: 'saas-duplication-pct',
    label: 'SaaS spend lost to duplicate or unused tooling',
    value: 0.22,
    unit: 'ratio',
    note: 'Shadow IT and overlapping tools. Consistently 15–30% in estates without a software register.',
  },
  cloudOverspendPct: {
    id: 'cloud-overspend-pct',
    label: 'Unoptimised cloud overspend',
    value: 0.28,
    unit: 'ratio',
    note: 'Idle resource, oversized instances, no reservations or savings plans.',
  },
  telecomsPerEmployeePerYear: {
    id: 'telecoms-per-employee',
    label: 'Telecoms spend per employee per year',
    value: 380,
    unit: 'GBP',
    note: 'Mobile plus fixed line and connectivity, blended.',
  },
  dormantAccountPct: {
    id: 'dormant-pct',
    label: 'Share of customer records that are dormant',
    value: 0.35,
    unit: 'ratio',
    note: 'Customers with no transaction in 18 months, in a CRM that has run 3+ years.',
  },
  dormantReactivationRate: {
    id: 'dormant-reactivation-rate',
    label: 'Dormant accounts reactivated by a structured campaign',
    value: 0.07,
    unit: 'ratio',
    note: 'Prior relationship converts far better than cold outreach. Ranges 4–12%.',
  },
  averageCustomerValueRatio: {
    id: 'avg-customer-value',
    label: 'Average customer annual value as share of turnover',
    value: 0.02,
    unit: 'ratio',
    note: 'Implies roughly 50 meaningful customers. Adjusted by observed segment.',
  },
  crossSellUpliftPct: {
    id: 'cross-sell-uplift',
    label: 'Revenue uplift from a structured cross-sell programme',
    value: 0.08,
    unit: 'ratio',
    note: 'Applied to existing customer revenue where a second service line exists.',
  },
  pricingUpliftPct: {
    id: 'pricing-uplift',
    label: 'Achievable pricing uplift where pricing has not been reviewed',
    value: 0.03,
    unit: 'ratio',
    note: 'Near-pure margin. Assumes below-inflation historic increases.',
  },
  outboundMeetingsPerRepPerMonth: {
    id: 'outbound-meetings',
    label: 'Qualified meetings per month from a working outbound motion',
    value: 10,
    unit: 'count',
    note: 'Directive §13 uses 10 qualified appointments as the reference target.',
  },
  meetingToWinRate: {
    id: 'meeting-win-rate',
    label: 'Qualified meeting to closed-won rate',
    value: 0.2,
    unit: 'ratio',
    note: 'B2B services average. Longer cycles in enterprise.',
  },
  processLabourCostPerHour: {
    id: 'labour-cost-hour',
    label: 'Fully-loaded cost of an administrative hour',
    value: 24,
    unit: 'GBP',
    note: 'Salary, employer NI, pension and overhead.',
  },
  automatableAdminHoursPerEmployeePerWeek: {
    id: 'automatable-hours',
    label: 'Automatable admin hours per employee per week',
    value: 1.8,
    unit: 'hours',
    note: 'Re-keying, reporting, chasing, manual reconciliation.',
  },
  turnoverPerEmployee: {
    id: 'turnover-per-employee',
    label: 'Turnover per employee',
    value: 95_000,
    unit: 'GBP',
    note: 'Used only to infer turnover when no filing figure is available. Varies widely by sector.',
  },
  supplierFragmentationSavingPct: {
    id: 'supplier-consolidation',
    label: 'Saving from consolidating a fragmented category',
    value: 0.12,
    unit: 'ratio',
    note: 'Volume leverage plus reduced admin.',
  },
} as const satisfies Record<string, Benchmark>;

export type BenchmarkKey = keyof typeof BENCHMARKS;

/** Sector adjustments to the turnover-per-employee and IT-spend benchmarks. */
const SECTOR_MULTIPLIERS: Record<string, { turnoverPerEmployee: number; itSpend: number }> = {
  Software: { turnoverPerEmployee: 1.4, itSpend: 2.0 },
  'Managed IT services': { turnoverPerEmployee: 1.1, itSpend: 1.8 },
  'Financial services': { turnoverPerEmployee: 1.6, itSpend: 1.7 },
  'Professional services': { turnoverPerEmployee: 1.0, itSpend: 1.3 },
  Manufacturing: { turnoverPerEmployee: 1.3, itSpend: 0.6 },
  Construction: { turnoverPerEmployee: 1.5, itSpend: 0.5 },
  Logistics: { turnoverPerEmployee: 1.4, itSpend: 0.7 },
  Retail: { turnoverPerEmployee: 1.2, itSpend: 0.8 },
  Healthcare: { turnoverPerEmployee: 0.8, itSpend: 1.1 },
  Education: { turnoverPerEmployee: 0.6, itSpend: 1.0 },
  Recruitment: { turnoverPerEmployee: 1.3, itSpend: 1.2 },
};

export function sectorMultiplier(sectors: string[] | null): { turnoverPerEmployee: number; itSpend: number } {
  if (!sectors || sectors.length === 0) return { turnoverPerEmployee: 1, itSpend: 1 };
  const found = sectors.map((s) => SECTOR_MULTIPLIERS[s]).filter(Boolean);
  if (found.length === 0) return { turnoverPerEmployee: 1, itSpend: 1 };
  const avg = (key: 'turnoverPerEmployee' | 'itSpend') =>
    found.reduce((sum, m) => sum + m![key], 0) / found.length;
  return { turnoverPerEmployee: avg('turnoverPerEmployee'), itSpend: avg('itSpend') };
}

export function benchmark(key: BenchmarkKey): Benchmark {
  return BENCHMARKS[key];
}
