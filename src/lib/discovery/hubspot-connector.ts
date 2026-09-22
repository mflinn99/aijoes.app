/**
 * HubSpot CRM connector — iteration 3.
 *
 * The last of the three big promotions. Dormancy and pipeline were the most
 * heavily modelled numbers left in the platform: how many customers have gone
 * quiet, how often a meeting becomes a customer, and what a deal is worth were
 * all benchmarks applied to an inferred turnover. With a CRM connected they are
 * counted from deals.
 */

import type { CompanyDataConnector, CompanyIdentity, DiscoveryResult, NormalisedRecord, SourceRecord } from './connector';
import { claim } from '../core/provenance';
import type { GraphTransport } from './graph-client';

export interface HubspotCredentials {
  /** Private app access token. */
  accessToken: string;
}

const API = 'https://api.hubapi.com';
const DORMANT_MONTHS = 18;
const STALLED_DAYS = 60;

interface HsCompany {
  id: string;
  properties: { name?: string; createdate?: string; lifecyclestage?: string };
}

interface HsDeal {
  id: string;
  properties: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    closedate?: string;
    createdate?: string;
    hs_lastmodifieddate?: string;
    hs_is_closed_won?: string;
    hs_is_closed?: string;
  };
  associations?: { companies?: { results?: { id: string }[] } };
}

/**
 * Counted CRM figures. Every number here is derived from deal records rather
 * than from a benchmark applied to turnover.
 */
export interface CrmFacts {
  totalAccounts: number;
  /** Accounts with no closed-won deal in the dormancy window. */
  dormantAccounts: number;
  customersWithRevenue: number;
  openDeals: number;
  openPipelineValue: number;
  /** Open deals untouched for 60 days. */
  stalledDeals: number;
  stalledPipelineValue: number;
  wonLast12m: number;
  wonValueLast12m: number;
  lostLast12m: number;
  /** Won ÷ (won + lost) over the last 12 months. Null when too few closed. */
  conversionRate: number | null;
  averageDealValue: number | null;
  retrievedAt: string;
}

export class HubspotConnector implements CompanyDataConnector {
  readonly id = 'crm';
  readonly name = 'CRM (HubSpot)';
  readonly category = 'crm' as const;
  readonly authType = 'oauth2' as const;
  readonly understandingUplift = 18;

  constructor(
    private readonly credentials: HubspotCredentials | null,
    private readonly transport: GraphTransport = ((url, init) => fetch(url, init)) as GraphTransport,
  ) {}

  private async getAll<T>(path: string, maxPages = 20): Promise<T[]> {
    if (!this.credentials) return [];
    const out: T[] = [];
    let after: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`${API}${path}`);
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);

      const res = await this.transport(url.toString(), {
        method: 'GET',
        headers: { authorization: `Bearer ${this.credentials.accessToken}`, accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HubSpot request to ${path} failed (${res.status}).`);

      const json = (await res.json()) as { results?: T[]; paging?: { next?: { after?: string } } };
      if (Array.isArray(json.results)) out.push(...json.results);
      after = json.paging?.next?.after;
      if (!after) break;
    }
    return out;
  }

  async discover(): Promise<DiscoveryResult> {
    if (!this.credentials) {
      return {
        status: 'not-configured',
        detail: 'No CRM credentials are stored for this tenant.',
        expectedUnderstandingUplift: this.understandingUplift,
      };
    }
    try {
      const res = await this.transport(`${API}/crm/v3/objects/companies?limit=1`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.credentials.accessToken}`, accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HubSpot rejected the token (${res.status}).`);
      return { status: 'available', detail: 'Connected to HubSpot.', expectedUnderstandingUplift: this.understandingUplift };
    } catch (err) {
      return {
        status: 'error',
        detail: err instanceof Error ? err.message : 'HubSpot is unreachable.',
        expectedUnderstandingUplift: this.understandingUplift,
      };
    }
  }

  async fetch(_identity: CompanyIdentity): Promise<SourceRecord[]> {
    if (!this.credentials) return [];
    const retrievedAt = new Date().toISOString();

    const [companies, deals] = await Promise.all([
      this.getAll<HsCompany>('/crm/v3/objects/companies?properties=name,createdate,lifecyclestage'),
      this.getAll<HsDeal>(
        '/crm/v3/objects/deals?properties=dealname,amount,dealstage,closedate,createdate,hs_lastmodifieddate,hs_is_closed,hs_is_closed_won&associations=companies',
      ),
    ]);

    return [
      { connectorId: this.id, label: 'CRM companies', locator: 'hubspot:/companies', retrievedAt, payload: companies },
      { connectorId: this.id, label: 'CRM deals', locator: 'hubspot:/deals', retrievedAt, payload: deals },
    ];
  }

  async normalise(records: SourceRecord[]): Promise<NormalisedRecord[]> {
    const facts = computeCrmFacts(records);
    if (!facts) return [];

    const src = { connectorId: this.id, label: 'HubSpot CRM', locator: 'hubspot:/deals' };
    const out: NormalisedRecord[] = [
      {
        field: 'crmIndicators',
        claim: claim(
          [{ name: 'HubSpot', category: 'CRM', indicator: `${facts.totalAccounts} account(s), ${facts.openDeals} open deal(s)` }],
          { ...src, method: 'connected-data', confidence: 0.98 },
        ),
      },
      {
        field: 'salesChannels',
        claim: claim(['Direct sales (CRM-tracked)'], { ...src, method: 'connected-data', confidence: 0.9 }),
      },
    ];

    if (facts.dormantAccounts > 0 || facts.stalledDeals > 0) {
      out.push({
        field: 'operationalSignals',
        claim: claim(
          [
            {
              kind: 'crm-hygiene',
              summary:
                `${facts.dormantAccounts} account(s) with no closed-won deal in ${DORMANT_MONTHS} months, and ` +
                `${facts.stalledDeals} open deal(s) untouched for ${STALLED_DAYS} days ` +
                `(£${facts.stalledPipelineValue.toLocaleString('en-GB')} of pipeline).`,
              detectedAt: facts.retrievedAt,
              sourceLabel: 'HubSpot CRM',
              locator: 'hubspot:/deals',
            },
          ],
          { ...src, method: 'connected-data', confidence: 0.95 },
        ),
      });
    }

    return out;
  }
}

export function computeCrmFacts(records: SourceRecord[], now = new Date()): CrmFacts | null {
  const companiesRecord = records.find((r) => r.locator === 'hubspot:/companies');
  const dealsRecord = records.find((r) => r.locator === 'hubspot:/deals');
  if (!companiesRecord || !dealsRecord) return null;

  const companies = companiesRecord.payload as HsCompany[];
  const deals = dealsRecord.payload as HsDeal[];

  const dormantBefore = new Date(now.getTime() - DORMANT_MONTHS * 30 * 86_400_000).getTime();
  const twelveMonthsAgo = new Date(now.getTime() - 365 * 86_400_000).getTime();
  const stalledBefore = new Date(now.getTime() - STALLED_DAYS * 86_400_000).getTime();

  const amountOf = (deal: HsDeal): number => {
    const n = Number(deal.properties.amount ?? '0');
    return Number.isFinite(n) ? n : 0;
  };
  const isClosed = (deal: HsDeal) => deal.properties.hs_is_closed === 'true';
  const isWon = (deal: HsDeal) => deal.properties.hs_is_closed_won === 'true';
  const companyIdsOf = (deal: HsDeal) => deal.associations?.companies?.results?.map((r) => r.id) ?? [];

  /** Most recent closed-won date per account. */
  const lastWonByCompany = new Map<string, number>();
  for (const deal of deals) {
    if (!isWon(deal)) continue;
    const closed = deal.properties.closedate ? new Date(deal.properties.closedate).getTime() : 0;
    for (const companyId of companyIdsOf(deal)) {
      lastWonByCompany.set(companyId, Math.max(lastWonByCompany.get(companyId) ?? 0, closed));
    }
  }

  const customersWithRevenue = lastWonByCompany.size;
  // An account that has never bought is a prospect, not a dormant customer;
  // counting it as dormant would inflate the reactivation opportunity with
  // people who were never customers.
  const dormantAccounts = [...lastWonByCompany.values()].filter((t) => t > 0 && t < dormantBefore).length;

  const open = deals.filter((d) => !isClosed(d));
  const stalled = open.filter((d) => {
    const touched = d.properties.hs_lastmodifieddate ? new Date(d.properties.hs_lastmodifieddate).getTime() : 0;
    return touched > 0 && touched < stalledBefore;
  });

  const closedRecently = deals.filter((d) => {
    if (!isClosed(d)) return false;
    const closed = d.properties.closedate ? new Date(d.properties.closedate).getTime() : 0;
    return closed >= twelveMonthsAgo;
  });
  const wonRecently = closedRecently.filter(isWon);
  const lostRecently = closedRecently.length - wonRecently.length;

  const wonValue = wonRecently.reduce((s, d) => s + amountOf(d), 0);

  return {
    totalAccounts: companies.length,
    dormantAccounts,
    customersWithRevenue,
    openDeals: open.length,
    openPipelineValue: Math.round(open.reduce((s, d) => s + amountOf(d), 0)),
    stalledDeals: stalled.length,
    stalledPipelineValue: Math.round(stalled.reduce((s, d) => s + amountOf(d), 0)),
    wonLast12m: wonRecently.length,
    wonValueLast12m: Math.round(wonValue),
    lostLast12m: lostRecently,
    // Below a handful of closed deals the rate is noise, not a measurement.
    conversionRate: closedRecently.length >= 5 ? Math.round((wonRecently.length / closedRecently.length) * 1000) / 1000 : null,
    averageDealValue: wonRecently.length > 0 ? Math.round(wonValue / wonRecently.length) : null,
    retrievedAt: now.toISOString(),
  };
}

export const CRM_DORMANT_MONTHS = DORMANT_MONTHS;
export const CRM_STALLED_DAYS = STALLED_DAYS;
