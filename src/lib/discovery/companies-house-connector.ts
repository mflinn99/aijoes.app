/**
 * Companies House connector — Directive §4.
 *
 * Live when COMPANIES_HOUSE_API_KEY is present. Absent, it reports
 * `not-configured` and contributes nothing, which is the honest behaviour: an
 * unconfigured registry lookup must not silently become a guess (§1, §23).
 */

import type { CompanyDataConnector, CompanyIdentity, DiscoveryResult, NormalisedRecord, SourceRecord } from './connector';
import { claim } from '../core/provenance';

const BASE = 'https://api.company-information.service.gov.uk';

interface ChCompany {
  company_name?: string;
  company_number?: string;
  company_status?: string;
  date_of_creation?: string;
  sic_codes?: string[];
  registered_office_address?: Record<string, string>;
  type?: string;
}

export class CompaniesHouseConnector implements CompanyDataConnector {
  readonly id = 'companies-house';
  readonly name = 'Companies House';
  readonly category = 'registry' as const;
  readonly authType = 'api-key' as const;
  readonly understandingUplift = 14;

  private get apiKey(): string | undefined {
    return process.env.COMPANIES_HOUSE_API_KEY || undefined;
  }

  async discover(): Promise<DiscoveryResult> {
    if (!this.apiKey) {
      return {
        status: 'not-configured',
        detail: 'COMPANIES_HOUSE_API_KEY is not set. Registry facts are unavailable.',
        expectedUnderstandingUplift: this.understandingUplift,
      };
    }
    return { status: 'available', detail: 'API key present.', expectedUnderstandingUplift: this.understandingUplift };
  }

  async fetch(identity: CompanyIdentity): Promise<SourceRecord[]> {
    const key = this.apiKey;
    if (!key) return [];
    const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
    const query = identity.companyNumber ?? identity.name ?? identity.input;

    try {
      const url = identity.companyNumber
        ? `${BASE}/company/${encodeURIComponent(identity.companyNumber)}`
        : `${BASE}/search/companies?q=${encodeURIComponent(query)}&items_per_page=1`;
      const res = await fetch(url, { headers: { authorization: auth, accept: 'application/json' } });
      if (!res.ok) return [];
      const json = (await res.json()) as unknown;

      const company: ChCompany | null = identity.companyNumber
        ? (json as ChCompany)
        : ((json as { items?: ChCompany[] }).items?.[0] ?? null);
      if (!company) return [];

      return [
        {
          connectorId: this.id,
          label: 'Companies House filing',
          locator: company.company_number ? `${BASE}/company/${company.company_number}` : undefined,
          retrievedAt: new Date().toISOString(),
          payload: company,
        },
      ];
    } catch {
      return [];
    }
  }

  async normalise(records: SourceRecord[]): Promise<NormalisedRecord[]> {
    const out: NormalisedRecord[] = [];
    for (const record of records) {
      const c = record.payload as ChCompany;
      const src = { connectorId: this.id, label: record.label, locator: record.locator };
      // Registry data is authoritative: these are facts, at high confidence.
      if (c.company_name) out.push({ field: 'legalName', claim: claim(c.company_name, { ...src, method: 'connected-data', confidence: 0.98 }) });
      if (c.company_number) out.push({ field: 'companyNumber', claim: claim(c.company_number, { ...src, method: 'connected-data', confidence: 0.99 }) });
      if (c.company_status) out.push({ field: 'status', claim: claim(c.company_status, { ...src, method: 'connected-data', confidence: 0.99 }) });
      if (c.date_of_creation) out.push({ field: 'incorporationDate', claim: claim(c.date_of_creation, { ...src, method: 'connected-data', confidence: 0.99 }) });
      if (c.sic_codes?.length) out.push({ field: 'sicCodes', claim: claim(c.sic_codes, { ...src, method: 'connected-data', confidence: 0.97 }) });
      if (c.registered_office_address) {
        const addr = Object.values(c.registered_office_address).filter(Boolean).join(', ');
        if (addr) out.push({ field: 'headquarters', claim: claim(addr, { ...src, method: 'connected-data', confidence: 0.95 }) });
      }
    }
    return out;
  }
}
