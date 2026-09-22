/**
 * Account discovery sources — Directive Phase 4, the Market Agent's inputs.
 *
 * Each source declares whether it can run here. Two can; two cannot, and say so
 * precisely rather than failing at runtime. That distinction is what makes
 * BLOCKERS.md accurate instead of guesswork.
 */

import type { TenantDb } from '../db/tenant';
import { normaliseDomain } from '../discovery/http';

export interface DiscoveredAccount {
  name: string;
  domain: string | null;
  source: string;
  synthetic: boolean;
  /** Anything the source knows up front, folded into research later. */
  hints?: { sector?: string; employees?: number; note?: string };
}

export interface SourceAvailability {
  available: boolean;
  detail: string;
  /** What would have to change for this source to run. */
  requirement?: string;
}

export interface AccountSource {
  id: string;
  name: string;
  availability(): Promise<SourceAvailability>;
  discover(input: { limit: number; payload?: string }): Promise<DiscoveredAccount[]>;
}

/**
 * A list supplied by the MSP: their target list, an event attendee list, a
 * partner's customer base. The highest-quality source there is, because a human
 * who knows the market chose it.
 */
export class SeedListSource implements AccountSource {
  readonly id = 'seed-list';
  readonly name = 'Supplied target list';

  async availability(): Promise<SourceAvailability> {
    return { available: true, detail: 'Accepts a pasted or uploaded list at any time.' };
  }

  async discover({ payload }: { limit: number; payload?: string }): Promise<DiscoveredAccount[]> {
    if (!payload) return [];
    const out: DiscoveredAccount[] = [];
    const seen = new Set<string>();

    for (const line of payload.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const cells = trimmed.split(/[,\t]/).map((c) => c.trim());
      const first = cells[0] ?? '';
      const second = cells[1] ?? '';

      const domain = normaliseDomain(second) ?? normaliseDomain(first);
      const name = domain && first === second ? domain : first || domain || '';
      if (!name) continue;

      const key = (domain ?? name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ name, domain, source: this.id, synthetic: false, ...(cells[2] ? { hints: { sector: cells[2] } } : {}) });
    }
    return out;
  }
}

/**
 * Companies House. Real, free, and exactly the right source for a UK target
 * universe — filterable by SIC code, size proxy and incorporation date.
 * Requires an API key AND outbound access to the API host.
 */
export class CompaniesHouseSource implements AccountSource {
  readonly id = 'companies-house';
  readonly name = 'Companies House register';

  async availability(): Promise<SourceAvailability> {
    if (!process.env.COMPANIES_HOUSE_API_KEY) {
      return {
        available: false,
        detail: 'No COMPANIES_HOUSE_API_KEY is set.',
        requirement: 'A free Companies House API key, plus egress to api.company-information.service.gov.uk.',
      };
    }
    return { available: true, detail: 'API key present.' };
  }

  async discover(): Promise<DiscoveredAccount[]> {
    // Deliberately not implemented against a host this environment cannot
    // reach. Returning nothing is honest; a stub that fabricated companies
    // would not be.
    return [];
  }
}

/**
 * Public web research to expand a seed into a universe — competitors, directory
 * listings, sector indexes. Blocked here by the egress policy.
 */
export class WebDiscoverySource implements AccountSource {
  readonly id = 'web-discovery';
  readonly name = 'Public web discovery';

  async availability(): Promise<SourceAvailability> {
    return {
      available: false,
      detail: 'This environment’s egress policy returns 403 for every external host except GitHub, npm and the Anthropic API.',
      requirement: 'Outbound HTTPS to the public web.',
    };
  }

  async discover(): Promise<DiscoveredAccount[]> {
    return [];
  }
}

/**
 * A synthetic universe, used to prove the engine works at scale.
 *
 * Every account it produces is flagged `synthetic`, which bars it from every
 * outreach path in the system. These are not companies. They exist so that
 * scoring, deduplication, prioritisation and the pipeline can be exercised over
 * hundreds of records rather than three, and so the numbers in any report can
 * be labelled as what they are.
 */
export class SyntheticUniverseSource implements AccountSource {
  readonly id = 'synthetic';
  readonly name = 'Synthetic universe (engine proving only)';

  async availability(): Promise<SourceAvailability> {
    return { available: true, detail: 'Generates labelled synthetic accounts. Never contactable.' };
  }

  async discover({ limit }: { limit: number }): Promise<DiscoveredAccount[]> {
    return buildSyntheticUniverse(limit);
  }
}

const SECTOR_PATTERNS = [
  { sector: 'Legal', suffixes: ['Legal', 'Solicitors', 'Law'], employees: [18, 140] },
  { sector: 'Accountancy', suffixes: ['Accountants', 'Advisory', 'Audit'], employees: [22, 180] },
  { sector: 'Technology and software', suffixes: ['Software', 'Digital', 'Systems', 'Labs'], employees: [15, 220] },
  { sector: 'IT consultancies', suffixes: ['IT Services', 'Technology Partners', 'Consulting'], employees: [12, 90] },
  { sector: 'Manufacturing', suffixes: ['Engineering', 'Precision', 'Manufacturing'], employees: [40, 400] },
  { sector: 'Professional services', suffixes: ['Consultancy', 'Partners', 'Group'], employees: [20, 200] },
  { sector: 'Healthcare', suffixes: ['Healthcare', 'Medical', 'Care'], employees: [30, 300] },
  { sector: 'Public sector', suffixes: ['Council', 'Trust', 'Academy Trust'], employees: [80, 900] },
  { sector: 'Logistics', suffixes: ['Logistics', 'Freight', 'Distribution'], employees: [35, 350] },
  { sector: 'Financial services', suffixes: ['Financial', 'Wealth', 'Insurance'], employees: [25, 250] },
];

const PLACES = [
  'Northgate', 'Beaumont', 'Calder', 'Ashford', 'Ravensworth', 'Marlow', 'Pendle', 'Sherwood',
  'Aldgate', 'Kingsbridge', 'Thornbury', 'Westfield', 'Harbourne', 'Clifton', 'Oakmere',
  'Bramley', 'Foxton', 'Linford', 'Waverley', 'Stanmore', 'Ellesmere', 'Ravenhill', 'Denby',
  'Harlow', 'Greystone', 'Waltham',
];

/** Deterministic: the same limit always produces the same universe. */
export function buildSyntheticUniverse(limit: number): DiscoveredAccount[] {
  const out: DiscoveredAccount[] = [];
  let i = 0;

  while (out.length < limit) {
    const pattern = SECTOR_PATTERNS[i % SECTOR_PATTERNS.length]!;
    const place = PLACES[Math.floor(i / SECTOR_PATTERNS.length) % PLACES.length]!;
    const suffix = pattern.suffixes[i % pattern.suffixes.length]!;
    const generation = Math.floor(i / (SECTOR_PATTERNS.length * PLACES.length));

    const name = generation === 0 ? `${place} ${suffix}` : `${place} ${suffix} ${generation + 1}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const [minEmp, maxEmp] = pattern.employees as [number, number];
    const employees = minEmp + ((i * 37) % (maxEmp - minEmp));

    out.push({
      name,
      domain: `${slug}.synthetic.invalid`,
      source: 'synthetic',
      synthetic: true,
      hints: { sector: pattern.sector, employees, note: 'Synthetic account. Not a real company. Barred from outreach.' },
    });
    i++;
  }

  return out;
}

export function allSources(): AccountSource[] {
  return [new SeedListSource(), new CompaniesHouseSource(), new WebDiscoverySource(), new SyntheticUniverseSource()];
}

export async function sourceAvailability(): Promise<{ id: string; name: string; availability: SourceAvailability }[]> {
  return Promise.all(allSources().map(async (s) => ({ id: s.id, name: s.name, availability: await s.availability() })));
}

export function sourceById(id: string): AccountSource | undefined {
  return allSources().find((s) => s.id === id);
}

export type { TenantDb };
