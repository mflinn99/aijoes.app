/**
 * Company Digital Twin — Directive §3.
 *
 * The persistent company knowledge layer. Extensible: connectors added later
 * must not change this contract (§4).
 */

import { type ProvenancedField, emptyField, type Claim } from './provenance';

export interface Person {
  name: string;
  role?: string;
  appointedOn?: string;
}

export interface TechnologyItem {
  name: string;
  category: string;
  /** Where the indicator came from, e.g. "MX record", "script tag", "job ad". */
  indicator: string;
}

export interface SpendCategory {
  category: string;
  estimatedAnnualSpend: number;
  basis: 'benchmark' | 'observed' | 'connected';
}

export interface Signal {
  kind: string;
  summary: string;
  detectedAt: string;
  sourceLabel: string;
  locator?: string;
}

export interface CompanyTwin {
  id: string;
  tenantId: string;

  legalName: ProvenancedField<string>;
  tradingNames: ProvenancedField<string[]>;
  domain: ProvenancedField<string>;
  urls: ProvenancedField<string[]>;
  companyNumber: ProvenancedField<string>;
  status: ProvenancedField<string>;
  incorporationDate: ProvenancedField<string>;
  headquarters: ProvenancedField<string>;
  locations: ProvenancedField<string[]>;

  sectors: ProvenancedField<string[]>;
  industries: ProvenancedField<string[]>;
  sicCodes: ProvenancedField<string[]>;

  employeesEstimate: ProvenancedField<number>;
  turnoverEstimate: ProvenancedField<number>;
  growthEstimate: ProvenancedField<number>;

  ownership: ProvenancedField<string>;
  directors: ProvenancedField<Person[]>;
  keyPeople: ProvenancedField<Person[]>;

  products: ProvenancedField<string[]>;
  services: ProvenancedField<string[]>;
  customerSegments: ProvenancedField<string[]>;
  valuePropositions: ProvenancedField<string[]>;
  markets: ProvenancedField<string[]>;
  competitors: ProvenancedField<string[]>;
  partners: ProvenancedField<string[]>;

  technologyEstate: ProvenancedField<TechnologyItem[]>;
  softwareEstate: ProvenancedField<TechnologyItem[]>;
  cloudEstate: ProvenancedField<TechnologyItem[]>;
  cyberIndicators: ProvenancedField<Signal[]>;

  suppliers: ProvenancedField<string[]>;
  supplyChain: ProvenancedField<string[]>;
  knownContracts: ProvenancedField<string[]>;
  estimatedSpendCategories: ProvenancedField<SpendCategory[]>;

  salesChannels: ProvenancedField<string[]>;
  marketingChannels: ProvenancedField<string[]>;
  crmIndicators: ProvenancedField<TechnologyItem[]>;

  recruitmentSignals: ProvenancedField<Signal[]>;
  strategicSignals: ProvenancedField<Signal[]>;
  financialSignals: ProvenancedField<Signal[]>;
  operationalSignals: ProvenancedField<Signal[]>;
  externalEvents: ProvenancedField<Signal[]>;

  knownMSPRelationship: ProvenancedField<string>;
  currentMSPServices: ProvenancedField<string[]>;

  dataSources: string[];
  lastUpdatedAt: string;
}

/** Every provenanced key on the twin, in a form iteration can rely on. */
export const TWIN_FIELDS = [
  'legalName', 'tradingNames', 'domain', 'urls', 'companyNumber', 'status',
  'incorporationDate', 'headquarters', 'locations', 'sectors', 'industries',
  'sicCodes', 'employeesEstimate', 'turnoverEstimate', 'growthEstimate',
  'ownership', 'directors', 'keyPeople', 'products', 'services',
  'customerSegments', 'valuePropositions', 'markets', 'competitors', 'partners',
  'technologyEstate', 'softwareEstate', 'cloudEstate', 'cyberIndicators',
  'suppliers', 'supplyChain', 'knownContracts', 'estimatedSpendCategories',
  'salesChannels', 'marketingChannels', 'crmIndicators', 'recruitmentSignals',
  'strategicSignals', 'financialSignals', 'operationalSignals', 'externalEvents',
  'knownMSPRelationship', 'currentMSPServices',
] as const;

export type TwinFieldKey = (typeof TWIN_FIELDS)[number];

/**
 * Fields that carry the most analytical weight. Understanding % (§23) is a
 * weighted coverage score, not a flat count — knowing the turnover matters far
 * more than knowing the trading names.
 */
export const FIELD_WEIGHTS: Record<TwinFieldKey, number> = {
  legalName: 2, tradingNames: 1, domain: 2, urls: 1, companyNumber: 2,
  status: 1, incorporationDate: 1, headquarters: 1, locations: 1,
  sectors: 3, industries: 2, sicCodes: 2,
  employeesEstimate: 4, turnoverEstimate: 5, growthEstimate: 3,
  ownership: 1, directors: 2, keyPeople: 2,
  products: 3, services: 4, customerSegments: 3, valuePropositions: 3,
  markets: 2, competitors: 3, partners: 2,
  technologyEstate: 4, softwareEstate: 4, cloudEstate: 3, cyberIndicators: 2,
  suppliers: 3, supplyChain: 3, knownContracts: 2, estimatedSpendCategories: 4,
  salesChannels: 2, marketingChannels: 2, crmIndicators: 3,
  recruitmentSignals: 2, strategicSignals: 2, financialSignals: 3,
  operationalSignals: 2, externalEvents: 1,
  knownMSPRelationship: 3, currentMSPServices: 3,
};

export function createEmptyTwin(id: string, tenantId: string): CompanyTwin {
  const fields = Object.fromEntries(TWIN_FIELDS.map((k) => [k, emptyField()]));
  return {
    id,
    tenantId,
    ...fields,
    dataSources: [],
    lastUpdatedAt: new Date().toISOString(),
  } as unknown as CompanyTwin;
}

export function getField(twin: CompanyTwin, key: TwinFieldKey): ProvenancedField<unknown> {
  return twin[key] as ProvenancedField<unknown>;
}

/**
 * Directive §23: "Company understanding: 37%" — weighted, confidence-adjusted
 * coverage of the twin. A field populated at 30% confidence contributes 30% of
 * its weight, so a thin guess never reads as understanding.
 */
export function understandingScore(twin: CompanyTwin): number {
  let earned = 0;
  let total = 0;
  for (const key of TWIN_FIELDS) {
    const weight = FIELD_WEIGHTS[key];
    total += weight;
    const field = getField(twin, key);
    const c = field.current;
    if (!c) continue;
    if (Array.isArray(c.value) && c.value.length === 0) continue;
    earned += weight * c.confidence;
  }
  return total === 0 ? 0 : Math.round((earned / total) * 100);
}

/** Which unpopulated fields are dragging understanding down the most. */
export function understandingGaps(twin: CompanyTwin): { field: TwinFieldKey; weight: number }[] {
  return TWIN_FIELDS.filter((key) => {
    const c = getField(twin, key).current;
    if (!c) return true;
    if (Array.isArray(c.value) && c.value.length === 0) return true;
    return c.confidence < 0.4;
  })
    .map((field) => ({ field, weight: FIELD_WEIGHTS[field] }))
    .sort((a, b) => b.weight - a.weight);
}

export function latestClaims(twin: CompanyTwin): { field: TwinFieldKey; claim: Claim<unknown> }[] {
  const out: { field: TwinFieldKey; claim: Claim<unknown> }[] = [];
  for (const key of TWIN_FIELDS) {
    const c = getField(twin, key).current;
    if (c) out.push({ field: key, claim: c });
  }
  return out;
}
