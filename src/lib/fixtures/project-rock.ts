/**
 * Project ROCK — demo company.
 *
 * Source: a confidential acquisition teaser for an anonymised Yorkshire managed
 * services provider, supplied directly by the user.
 *
 * WHY THIS ONE IS DIFFERENT FROM THE SYNTHETIC FIXTURES. The three synthetic
 * companies are invented, and every number in them is a shape rather than a
 * fact. Everything here is a real figure from a real document: revenue, gross
 * profit, EBITDA, net assets, customer count, device count, sector mix and
 * current trading. That makes it the first company in this platform where the
 * financial engines run on COUNTED inputs rather than benchmarks applied to an
 * inferred turnover — which is the whole point of the provenance model, and has
 * never actually been exercised against real numbers until now.
 *
 * WHAT IS DELIBERATELY ABSENT. The teaser is anonymised: there is no company
 * name, no registered number, no domain, no address beyond "West or North
 * Yorkshire", and no named person. None of that is inferred here. In particular
 * the engine cannot and must not contact this company — there is nobody to
 * contact, and a business in a confidential sale process is not an outreach
 * target. The outreach layer refuses it for exactly those reasons, and that
 * refusal is part of what this demo shows.
 *
 * CONFIDENTIALITY. The document is marked strictly private and confidential.
 * What is reproduced below is financial and operational shape with no
 * identifying detail, which is what the teaser itself is designed to disclose.
 */

import type { FinancialFacts } from '../db/repositories/facts';

export const PROJECT_ROCK_KEY = 'project-rock';

/** The financial year the headline figures belong to. */
const FY_START = '2025-04-01';
const FY_END = '2026-03-31';

export interface YearFigures {
  label: string;
  revenue: number;
  grossProfit: number;
  ebitda: number;
  netAssets: number;
}

/** Three years, exactly as the teaser states them. */
export const ROCK_HISTORY: YearFigures[] = [
  { label: 'FY23/24', revenue: 671_000, grossProfit: 231_000, ebitda: 185_000, netAssets: 216_000 },
  { label: 'FY24/25', revenue: 798_000, grossProfit: 297_000, ebitda: 228_000, netAssets: 263_000 },
  { label: 'FY25/26', revenue: 833_000, grossProfit: 260_000, ebitda: 211_000, netAssets: 283_000 },
];

/** Reconciled management figures for the four months to 31 July 2026. */
export const ROCK_CURRENT_TRADING = {
  months: 4,
  to: '2026-07-31',
  revenue: 271_000,
  grossProfit: 86_000,
};

export const ROCK_SECTOR_MIX: { sector: string; customers: number }[] = [
  { sector: 'Manufacturing & distribution', customers: 9 },
  { sector: 'Professional & business services', customers: 9 },
  { sector: 'Retail, leisure & consumer', customers: 7 },
  { sector: 'Charity & public sector', customers: 6 },
  { sector: 'Construction & property', customers: 6 },
  { sector: 'Healthcare & care', customers: 5 },
];

export const ROCK_DEVICE_BANDS: { band: string; customers: number; midpoint: number }[] = [
  { band: '1-9 devices', customers: 23, midpoint: 5 },
  { band: '10-24 devices', customers: 13, midpoint: 17 },
  { band: '25-49 devices', customers: 3, midpoint: 37 },
  { band: '50-100 devices', customers: 4, midpoint: 75 },
];

export const ROCK = {
  key: PROJECT_ROCK_KEY,
  /** The codename is the only name there is. Nothing is inferred about identity. */
  name: 'Project ROCK',
  description:
    'Anonymised Yorkshire managed services provider, 20+ years established, offered for 100% share sale. ' +
    'Service desk and on-site support, Microsoft cloud, cybersecurity, backup, connectivity, VoIP and technology supply.',
  employees: 5,
  teamSplit: { 'Service desk': 3, 'Technical account management': 1, 'Operations': 1 },
  yearsEstablished: 20,
  customers: 43,
  devices: 693,
  recurringShare: 0.73,
  largestCustomerShare: 0.12,
  geography: { 'West Yorkshire': 0.833, 'North Yorkshire': 0.167 },
  transaction: '100% share sale sought',
} as const;

const latest = ROCK_HISTORY[ROCK_HISTORY.length - 1]!;
const prior = ROCK_HISTORY[ROCK_HISTORY.length - 2]!;

/**
 * Counted financial facts. These go in as `acquisition-teaser` rather than
 * `inferred`, because they are stated figures from a diligence document — the
 * strongest provenance this platform has short of a connected accounting system.
 *
 * Supplier and subscription spend are deliberately empty: the teaser gives cost
 * of sales only in aggregate, and breaking £573k of cost into named suppliers
 * would be invention. The engines will say they cannot itemise, which is true.
 */
export const ROCK_FINANCIAL_FACTS: FinancialFacts = {
  turnover: latest.revenue,
  grossMargin: latest.grossProfit / latest.revenue,
  periodStart: FY_START,
  periodEnd: FY_END,
  supplierSpend: [],
  softwareSubscriptions: [],
  customerCount: ROCK.customers,
  averageCustomerValue: Math.round(latest.revenue / ROCK.customers),
  retrievedAt: '2026-10-05T00:00:00.000Z',
};

/**
 * Facts for the Company Twin. Every one is stated in the teaser. Nothing here
 * is a guess, and the fields the teaser does not cover are left absent so the
 * understanding score reflects what is genuinely unknown.
 */
export const ROCK_USER_SUPPLIED: Record<string, unknown> = {
  legalName: 'Project ROCK (anonymised acquisition target)',
  employeesEstimate: ROCK.employees,
  turnoverEstimate: latest.revenue,
  growthEstimate: Math.round(((latest.revenue - prior.revenue) / prior.revenue) * 1000) / 10,
  headquarters: 'West Yorkshire',
  locations: ['West Yorkshire', 'North Yorkshire'],
  sectors: ['Managed IT services'],
  industries: ['Information technology services'],
  services: [
    'Managed service desk', 'On-site support', 'Microsoft cloud', 'Cybersecurity',
    'Backup', 'Connectivity', 'VoIP', 'Technology supply',
  ],
  customerSegments: ROCK_SECTOR_MIX.map((s) => s.sector),
  ownership: 'Privately held; 100% share sale sought',
  markets: ['West Yorkshire', 'North Yorkshire'],
  technologyEstate: [
    { name: 'PSA', category: 'Operations', indicator: 'Stated in the teaser as an established system' },
    { name: 'RMM / monitoring', category: 'Operations', indicator: 'Stated in the teaser as an established system' },
    { name: 'Security tooling', category: 'Security', indicator: 'Stated in the teaser as an established system' },
    { name: 'Automation', category: 'Operations', indicator: 'Stated in the teaser as an established system' },
  ],
  cloudEstate: [{ name: 'Microsoft 365', category: 'Cloud', indicator: 'Microsoft cloud is a stated service line' }],
  /**
   * The single most important commercial fact about this company, and the one
   * most easily lost: it is for sale. Recorded as a strategic signal with its
   * date and source rather than buried in a prose field, so the timing score
   * and the M&A archetype can both see it.
   */
  strategicSignals: [
    {
      kind: 'ownership-change',
      summary: 'Shareholders are seeking a 100% share sale. The business is in an active sale process.',
      detectedAt: '2026-10-05T00:00:00.000Z',
      sourceLabel: 'Project ROCK confidential acquisition teaser',
    },
    {
      kind: 'succession',
      summary: 'Adjusted EBITDA is stated before owner remuneration, which usually means an owner working in the business and leaving with the sale.',
      detectedAt: '2026-10-05T00:00:00.000Z',
      sourceLabel: 'Project ROCK confidential acquisition teaser',
    },
  ],
  financialSignals: [
    {
      kind: 'margin-erosion',
      summary: 'Gross margin fell from 37.2% to 31.2% between FY24/25 and FY25/26 while revenue grew 4.4%.',
      detectedAt: '2026-10-05T00:00:00.000Z',
      sourceLabel: 'Project ROCK confidential acquisition teaser',
    },
  ],
};

export interface RockFinding {
  id: string;
  /** What the number is. */
  headline: string;
  /** The arithmetic, so it can be checked rather than believed. */
  workings: string;
  /** What it means commercially. */
  soWhat: string;
  /** Positive, negative or neutral for an acquirer. */
  direction: 'strength' | 'risk' | 'neutral';
  /** Money attached, where there is any. */
  valueGbp: number | null;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

/**
 * What the teaser's own numbers say, computed rather than asserted.
 *
 * The teaser is a sales document and leads with its strengths, which is normal
 * and not a criticism. The job here is to read the same figures without that
 * incentive — so the gross margin line below, which the narrative does not
 * mention, comes out alongside the recurring revenue line, which it does.
 */
export function rockFindings(): RockFinding[] {
  const findings: RockFinding[] = [];

  const marginNow = latest.grossProfit / latest.revenue;
  const marginPrior = prior.grossProfit / prior.revenue;
  const marginDelta = marginNow - marginPrior;
  const gpLostVsPriorMargin = prior.grossProfit / prior.revenue * latest.revenue - latest.grossProfit;

  findings.push({
    id: 'gross-margin-erosion',
    headline: `Gross margin fell from ${pct(marginPrior)} to ${pct(marginNow)} while revenue grew.`,
    workings:
      `FY24/25: ${gbp(prior.grossProfit)} on ${gbp(prior.revenue)} = ${pct(marginPrior)}. ` +
      `FY25/26: ${gbp(latest.grossProfit)} on ${gbp(latest.revenue)} = ${pct(marginNow)}. ` +
      `At the prior margin, FY25/26 revenue would have produced ${gbp(prior.grossProfit / prior.revenue * latest.revenue)} of gross profit.`,
    soWhat:
      `${gbp(gpLostVsPriorMargin)} of gross profit did not arrive, which is more than the ${gbp(prior.ebitda - latest.ebitda)} EBITDA decline. ` +
      `Revenue grew ${pct((latest.revenue - prior.revenue) / prior.revenue)} and gross profit fell ${pct((prior.grossProfit - latest.grossProfit) / prior.grossProfit)}. ` +
      `The teaser leads on revenue growth and does not mention this. It is the first thing to ask about.`,
    direction: 'risk',
    valueGbp: Math.round(gpLostVsPriorMargin),
  });

  const annualised = ROCK_CURRENT_TRADING.revenue * (12 / ROCK_CURRENT_TRADING.months);
  const currentMargin = ROCK_CURRENT_TRADING.grossProfit / ROCK_CURRENT_TRADING.revenue;
  findings.push({
    id: 'current-trading',
    headline:
      annualised < latest.revenue
        ? `Current trading annualises to ${gbp(annualised)}, below the ${gbp(latest.revenue)} headline.`
        : `Current trading annualises to ${gbp(annualised)}, ahead of the ${gbp(latest.revenue)} headline.`,
    workings:
      `${gbp(ROCK_CURRENT_TRADING.revenue)} in the ${ROCK_CURRENT_TRADING.months} months to ${ROCK_CURRENT_TRADING.to}, ` +
      `× ${12 / ROCK_CURRENT_TRADING.months} = ${gbp(annualised)}. Gross margin ${pct(currentMargin)}.`,
    soWhat:
      `Margin has stabilised at the lower level rather than recovering — ${pct(currentMargin)} now against ${pct(marginNow)} last year and ${pct(marginPrior)} the year before. ` +
      `Four months is a short run and MSP revenue is seasonal in product resale, so this is an indicator rather than a trend.`,
    direction: annualised < latest.revenue ? 'risk' : 'strength',
    valueGbp: Math.round(Math.abs(annualised - latest.revenue)),
  });

  const growthNow = (latest.revenue - prior.revenue) / prior.revenue;
  const growthPrior = (prior.revenue - ROCK_HISTORY[0]!.revenue) / ROCK_HISTORY[0]!.revenue;
  findings.push({
    id: 'growth-deceleration',
    headline: `Revenue growth slowed from ${pct(growthPrior)} to ${pct(growthNow)}.`,
    workings:
      `${gbp(ROCK_HISTORY[0]!.revenue)} → ${gbp(prior.revenue)} = ${pct(growthPrior)}. ` +
      `${gbp(prior.revenue)} → ${gbp(latest.revenue)} = ${pct(growthNow)}.`,
    soWhat:
      'Three years of growth is accurate, but the rate has fallen by roughly three quarters. ' +
      'For a five-person business this is as likely to be capacity as demand — which is the acquirer’s opportunity, not just a risk.',
    direction: 'risk',
    valueGbp: null,
  });

  const recurringRevenue = latest.revenue * ROCK.recurringShare;
  findings.push({
    id: 'recurring-base',
    headline: `${pct(ROCK.recurringShare)} recurring is ${gbp(recurringRevenue)} of contracted income.`,
    workings: `${gbp(latest.revenue)} × ${pct(ROCK.recurringShare)} = ${gbp(recurringRevenue)}, or ${gbp(recurringRevenue / 12)} a month.`,
    soWhat:
      `This is the asset. Recurring income covers the ${gbp(latest.revenue - latest.grossProfit)} cost of sales roughly ${(recurringRevenue / (latest.revenue - latest.grossProfit)).toFixed(2)}× over ` +
      'and is what makes a five-person business worth buying rather than hiring.',
    direction: 'strength',
    valueGbp: Math.round(recurringRevenue),
  });

  const largestCustomer = latest.revenue * ROCK.largestCustomerShare;
  findings.push({
    id: 'customer-concentration',
    headline: `The largest customer is about ${pct(ROCK.largestCustomerShare)} of revenue, roughly ${gbp(largestCustomer)}.`,
    workings:
      `${gbp(latest.revenue)} × ${pct(ROCK.largestCustomerShare)} = ${gbp(largestCustomer)}. ` +
      `At the current ${pct(marginNow)} gross margin that is ${gbp(largestCustomer * marginNow)} of gross profit.`,
    soWhat:
      `Losing it would remove ${pct((largestCustomer * marginNow) / latest.ebitda)} of EBITDA. ` +
      '12% is low concentration for a 43-customer MSP and is a genuine strength; it is still the single largest identified risk in the customer base.',
    direction: 'neutral',
    valueGbp: Math.round(largestCustomer),
  });

  const longTail = ROCK_DEVICE_BANDS[0]!;
  const topBands = ROCK_DEVICE_BANDS.slice(2).reduce((s, b) => s + b.customers, 0);
  const revenuePerDevice = latest.revenue / ROCK.devices;
  findings.push({
    id: 'long-tail',
    headline: `${longTail.customers} of ${ROCK.customers} customers have fewer than 10 devices.`,
    workings:
      `${longTail.customers} customers in the 1-9 band against ${topBands} with 25 or more. ` +
      `Revenue per device across the estate is ${gbp(revenuePerDevice)} a year; at the 1-9 band midpoint of ${longTail.midpoint} devices ` +
      `that implies roughly ${gbp(revenuePerDevice * longTail.midpoint)} a year each.`,
    soWhat:
      `${pct(longTail.customers / ROCK.customers)} of the customer count plausibly carries a small share of the revenue while generating service desk load. ` +
      'This is where an acquirer either raises price, raises the minimum, or accepts the drag — and it is a question the teaser does not answer because it reports counts, not revenue by band.',
    direction: 'risk',
    valueGbp: null,
  });

  const revenuePerHead = latest.revenue / ROCK.employees;
  findings.push({
    id: 'revenue-per-head',
    headline: `${gbp(revenuePerHead)} of revenue per employee.`,
    workings: `${gbp(latest.revenue)} ÷ ${ROCK.employees} = ${gbp(revenuePerHead)}. Service desk is ${ROCK.teamSplit['Service desk']} of the ${ROCK.employees}.`,
    soWhat:
      'High for a managed services business, which usually means either good automation or an owner carrying work that the EBITDA adjustment adds back. ' +
      'Adjusted EBITDA is stated as before owner remuneration, so the second should be assumed until diligence says otherwise.',
    direction: 'neutral',
    valueGbp: null,
  });

  const devicesPerHead = ROCK.devices / ROCK.employees;
  findings.push({
    id: 'devices-per-head',
    headline: `${Math.round(devicesPerHead)} supported devices per employee.`,
    workings: `${ROCK.devices} ÷ ${ROCK.employees} = ${Math.round(devicesPerHead)}, or ${Math.round(ROCK.devices / ROCK.teamSplit['Service desk'])} per service desk head.`,
    soWhat:
      'At the upper end of what a small MSP runs without heavy tooling, which supports the teaser’s claim about its platform. ' +
      'It also means there is little slack: an acquirer adding customers adds headcount before it adds margin.',
    direction: 'neutral',
    valueGbp: null,
  });

  return findings;
}

// --- loading it into the platform ------------------------------------------

/**
 * Analyse Project ROCK through the real pipeline.
 *
 * It is NOT seeded as a website fixture, because there is no website to fetch
 * and inventing page content would put invented facts into the twin. Instead
 * the teaser's figures go in as supplied facts citing the document, and the
 * counted financials go in as connected facts under the `acquisition-teaser`
 * connector — so the financial engines take the counted path rather than
 * applying benchmarks to an inferred turnover.
 */
export const ROCK_SOURCE = {
  label: 'Project ROCK confidential acquisition teaser',
  locator: 'Project-ROCK-Teaser-Information-Memorandum (supplied 2026-10-05)',
  /**
   * Higher than the 0.9 default for user-supplied facts. These are stated
   * figures in a document prepared for diligence, with three years of history
   * that reconcile; they are not a recollection. They are still unaudited and
   * the teaser says so itself, which is why this is not 1.0.
   */
  confidence: 0.95,
} as const;
