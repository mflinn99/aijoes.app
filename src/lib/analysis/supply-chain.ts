/**
 * Supply Chain Graph — Directive §9.
 *
 * "The objective is to allow JoJo to reason across relationships, not merely
 * analyse invoices individually."
 *
 * Without a connected ledger the graph is a hypothesis built from technology
 * indicators and category benchmarks — every edge says which it is.
 */

import type { AnalysisContext } from './context';
import { BENCHMARKS } from './benchmarks';
import type { TechnologyItem } from '../core/company-twin';

export type Criticality = 'low' | 'medium' | 'high' | 'business-critical';
export type SwitchingComplexity = 'trivial' | 'moderate' | 'complex' | 'entrenched';

export interface SupplierRelationship {
  id: string;
  tenantId: string;
  companyId: string;
  supplierName: string;
  category: string;
  products: string[];
  contractStart: string | null;
  contractEnd: string | null;
  renewalDate: string | null;
  annualSpend: number;
  /** 0..1 */
  spendConfidence: number;
  usage: string;
  businessOwner: string | null;
  dependencies: string[];
  alternatives: string[];
  switchingComplexity: SwitchingComplexity;
  criticality: Criticality;
  risk: string;
  savingsPotential: number;
  sourceRecords: string[];
  /** Whether spend is counted or modelled. */
  basis: 'observed' | 'benchmark' | 'connected';
}

interface CategoryProfile {
  category: string;
  shareOfItSpend: number;
  criticality: Criticality;
  switching: SwitchingComplexity;
  savingRate: number;
  alternatives: string[];
  risk: string;
  usage: string;
}

const CATEGORY_PROFILES: CategoryProfile[] = [
  { category: 'Microsoft licensing', shareOfItSpend: 0.28, criticality: 'business-critical', switching: 'entrenched', savingRate: BENCHMARKS.m365WastePct.value, alternatives: ['Direct CSP', 'Alternative CSP reseller', 'Google Workspace (full migration)'], risk: 'Single vendor dependency across identity, email and documents', usage: 'All staff, daily' },
  { category: 'Cloud infrastructure', shareOfItSpend: 0.22, criticality: 'business-critical', switching: 'complex', savingRate: BENCHMARKS.cloudOverspendPct.value, alternatives: ['Reserved capacity', 'Alternative hyperscaler', 'Colocation'], risk: 'Cost scales with usage and has no natural ceiling', usage: 'Continuous' },
  { category: 'Connectivity and telecoms', shareOfItSpend: 0.14, criticality: 'high', switching: 'moderate', savingRate: 0.18, alternatives: ['Alternative carrier', 'Aggregator', 'SD-WAN provider'], risk: 'Out-of-contract tariffs on auto-renewal', usage: 'All sites' },
  { category: 'Security tooling', shareOfItSpend: 0.12, criticality: 'high', switching: 'moderate', savingRate: 0.15, alternatives: ['Bundled Microsoft security', 'Consolidated platform'], risk: 'Overlapping products bought at different times', usage: 'All endpoints' },
  { category: 'Line-of-business software', shareOfItSpend: 0.16, criticality: 'business-critical', switching: 'entrenched', savingRate: 0.1, alternatives: ['Renegotiate at renewal', 'Tier downgrade'], risk: 'Deep operational dependency limits negotiating position', usage: 'Core operations' },
  { category: 'Backup and continuity', shareOfItSpend: 0.08, criticality: 'high', switching: 'moderate', savingRate: 0.2, alternatives: ['Consolidate with primary vendor', 'Alternative provider'], risk: 'Frequently unverified — recovery untested', usage: 'Continuous' },
];

function renewalFrom(index: number, now: Date): { start: string; end: string; renewal: string } {
  // Deterministic, spread across the year so the renewal calendar is usable.
  const monthsOut = 2 + ((index * 5) % 11);
  const end = new Date(now.getFullYear(), now.getMonth() + monthsOut, 1);
  const start = new Date(end.getFullYear() - 1, end.getMonth(), 1);
  const renewal = new Date(end.getFullYear(), end.getMonth() - 2, 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), renewal: iso(renewal) };
}

export function buildSupplyChain(ctx: AnalysisContext, now = new Date()): SupplierRelationship[] {
  const tech = ctx.technology;
  const basis: SupplierRelationship['basis'] = ctx.hasFinancialData ? 'connected' : 'benchmark';
  const spendConfidence = ctx.hasFinancialData ? 0.9 : 0.35;

  const out: SupplierRelationship[] = CATEGORY_PROFILES.map((profile, i) => {
    const annualSpend = Math.round(ctx.itSpendEstimate * profile.shareOfItSpend);
    const dates = renewalFrom(i, now);
    const named = namedSuppliersFor(profile.category, tech);

    return {
      id: `${ctx.twin.id}-sup-${i}`,
      tenantId: ctx.twin.tenantId,
      companyId: ctx.twin.id,
      supplierName: named.supplier,
      category: profile.category,
      products: named.products,
      contractStart: dates.start,
      contractEnd: dates.end,
      renewalDate: dates.renewal,
      annualSpend,
      spendConfidence: named.observed ? Math.min(0.6, spendConfidence + 0.15) : spendConfidence,
      usage: profile.usage,
      businessOwner: null,
      dependencies: dependenciesFor(profile.category),
      alternatives: profile.alternatives,
      switchingComplexity: profile.switching,
      criticality: profile.criticality,
      risk: profile.risk,
      savingsPotential: Math.round(annualSpend * profile.savingRate),
      sourceRecords: named.observed ? ['website:technology-indicators'] : ['benchmark-library'],
      basis: (named.observed ? 'observed' : basis) as SupplierRelationship['basis'],
    };
  }).filter((s) => s.annualSpend > 500);

  return out.sort((a, b) => b.savingsPotential - a.savingsPotential);
}

function namedSuppliersFor(
  category: string,
  tech: TechnologyItem[],
): { supplier: string; products: string[]; observed: boolean } {
  const match = (re: RegExp) => tech.filter((t) => re.test(`${t.name} ${t.category}`));

  if (/Microsoft/i.test(category)) {
    const found = match(/Microsoft/i);
    return found.length > 0
      ? { supplier: 'Microsoft (via reseller)', products: found.map((f) => f.name), observed: true }
      : { supplier: 'Microsoft (assumed)', products: ['Microsoft 365'], observed: false };
  }
  if (/Cloud/i.test(category)) {
    const found = match(/cloud|CDN|Cloudflare|AWS|Azure/i);
    return found.length > 0
      ? { supplier: found.map((f) => f.name).join(' / '), products: found.map((f) => f.name), observed: true }
      : { supplier: 'Cloud provider (unidentified)', products: ['Hosting'], observed: false };
  }
  if (/software/i.test(category)) {
    const found = match(/CRM|Accounting|ERP|CMS|E-commerce/i);
    return found.length > 0
      ? { supplier: found.map((f) => f.name).join(' / '), products: found.map((f) => f.name), observed: true }
      : { supplier: 'Line-of-business vendor (unidentified)', products: [], observed: false };
  }
  if (/Security/i.test(category)) {
    const found = match(/security|Cloudflare/i);
    return found.length > 0
      ? { supplier: found.map((f) => f.name).join(' / '), products: found.map((f) => f.name), observed: true }
      : { supplier: 'Security vendor (unidentified)', products: [], observed: false };
  }
  return { supplier: `${category} supplier (unidentified)`, products: [], observed: false };
}

function dependenciesFor(category: string): string[] {
  if (/Microsoft/i.test(category)) return ['Identity', 'Email', 'Document storage', 'Every user'];
  if (/Cloud/i.test(category)) return ['Customer-facing systems', 'Internal applications'];
  if (/Connectivity/i.test(category)) return ['All sites', 'Remote workers', 'Voice'];
  if (/Security/i.test(category)) return ['Endpoints', 'Email filtering', 'Compliance posture'];
  if (/software/i.test(category)) return ['Core operational process', 'Reporting'];
  if (/Backup/i.test(category)) return ['Recovery objective', 'Regulatory obligations'];
  return [];
}

export interface SupplyChainSummary {
  totalAnnualSpend: number;
  totalSavingsPotential: number;
  supplierCount: number;
  businessCriticalCount: number;
  nextRenewal: { supplier: string; date: string } | null;
  basis: 'connected' | 'benchmark' | 'mixed';
}

export function summariseSupplyChain(suppliers: SupplierRelationship[]): SupplyChainSummary {
  const bases = new Set(suppliers.map((s) => s.basis));
  const upcoming = suppliers
    .filter((s) => s.renewalDate)
    .sort((a, b) => (a.renewalDate! < b.renewalDate! ? -1 : 1))[0];

  return {
    totalAnnualSpend: suppliers.reduce((sum, s) => sum + s.annualSpend, 0),
    totalSavingsPotential: suppliers.reduce((sum, s) => sum + s.savingsPotential, 0),
    supplierCount: suppliers.length,
    businessCriticalCount: suppliers.filter((s) => s.criticality === 'business-critical').length,
    nextRenewal: upcoming ? { supplier: upcoming.supplierName, date: upcoming.renewalDate! } : null,
    basis: bases.size > 1 ? 'mixed' : bases.has('connected') ? 'connected' : 'benchmark',
  };
}
