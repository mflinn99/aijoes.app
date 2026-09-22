/**
 * Xero accounting connector — iteration 2 priority 3.
 *
 * The connection with the widest promotion effect: it replaces the turnover
 * inference, the customer-count benchmark and the whole of the supplier-spend
 * model with counted figures. Uses a Xero Custom Connection (client
 * credentials), which is the right shape for an MSP holding delegated access to
 * one customer organisation.
 *
 * `transport` is injectable so the counted-fact path is tested against recorded
 * responses rather than a live organisation.
 */

import type { CompanyDataConnector, CompanyIdentity, DiscoveryResult, NormalisedRecord, SourceRecord } from './connector';
import { claim } from '../core/provenance';
import type { FinancialFacts } from '../db/repositories/facts';
import type { GraphTransport } from './graph-client';

export interface XeroCredentials {
  clientId: string;
  clientSecret: string;
  /** Xero tenant (organisation) id. */
  xeroTenantId: string;
}

const TOKEN_URL = 'https://identity.xero.com/connect/token';
const API = 'https://api.xero.com/api.xro/2.0';

/** Categories mapped from Xero account codes and contact names. */
const SOFTWARE_HINTS = /microsoft|adobe|atlassian|slack|zoom|hubspot|salesforce|xero|sage|dropbox|google|aws|azure|github|figma|docusign|monday|asana|notion|canva|mailchimp|zendesk|intercom|twilio|stripe/i;

const CATEGORY_HINTS: { category: string; test: RegExp }[] = [
  { category: 'Software and subscriptions', test: SOFTWARE_HINTS },
  { category: 'Telecoms', test: /vodafone|o2|ee\b|bt\b|three|telecom|mobile|broadband|gamma|daisy/i },
  { category: 'Insurance', test: /insurance|aviva|axa|hiscox|zurich|allianz/i },
  { category: 'Professional services', test: /accountant|solicitor|legal|consult|audit|advisory/i },
  { category: 'Utilities', test: /energy|electric|gas|water|utilit|octopus|british gas/i },
  { category: 'Logistics', test: /courier|dhl|dpd|ups\b|fedex|haulage|freight|royal mail/i },
  { category: 'Recruitment', test: /recruit|staffing|agency|hays|reed\b/i },
];

interface XeroReportCell { Value?: string | number }
interface XeroReportRow { RowType?: string; Title?: string; Cells?: XeroReportCell[]; Rows?: XeroReportRow[] }
interface XeroReport { Reports?: { Rows?: XeroReportRow[]; ReportDate?: string; ReportTitles?: string[] }[] }

interface XeroInvoice {
  Type: 'ACCPAY' | 'ACCREC';
  Contact: { ContactID: string; Name: string };
  Total: number;
  Date: string;
  Status: string;
}

export class XeroConnector implements CompanyDataConnector {
  readonly id = 'accounting';
  readonly name = 'Accounting (Xero)';
  readonly category = 'accounting' as const;
  readonly authType = 'oauth2' as const;
  readonly understandingUplift = 21;

  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly credentials: XeroCredentials | null,
    private readonly transport: GraphTransport = ((url, init) => fetch(url, init)) as GraphTransport,
  ) {}

  private async accessToken(): Promise<string> {
    if (!this.credentials) throw new Error('Xero is not connected.');
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const basic = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString('base64');
    const res = await this.transport(TOKEN_URL, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'accounting.reports.read accounting.transactions.read accounting.contacts.read' }).toString(),
    });

    if (!res.ok) {
      // Never echo the response body: it can contain the client secret.
      throw new Error(`Xero token request failed (${res.status}).`);
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('Xero token response contained no access token.');

    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 1800) * 1000 };
    return this.token.value;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.accessToken();
    const res = await this.transport(`${API}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'xero-tenant-id': this.credentials!.xeroTenantId,
        accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Xero request to ${path.split('?')[0]} failed (${res.status}).`);
    return (await res.json()) as T;
  }

  async discover(): Promise<DiscoveryResult> {
    if (!this.credentials) {
      return {
        status: 'not-configured',
        detail: 'No Xero credentials are stored for this tenant.',
        expectedUnderstandingUplift: this.understandingUplift,
      };
    }
    try {
      await this.accessToken();
      return { status: 'available', detail: 'Connected to Xero.', expectedUnderstandingUplift: this.understandingUplift };
    } catch (err) {
      return {
        status: 'error',
        detail: err instanceof Error ? err.message : 'Xero is unreachable.',
        expectedUnderstandingUplift: this.understandingUplift,
      };
    }
  }

  async fetch(_identity: CompanyIdentity): Promise<SourceRecord[]> {
    if (!this.credentials) return [];
    const retrievedAt = new Date().toISOString();

    const to = new Date();
    const from = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const [pnl, payables, receivables] = await Promise.all([
      this.get<XeroReport>(`/Reports/ProfitAndLoss?fromDate=${iso(from)}&toDate=${iso(to)}`),
      this.get<{ Invoices?: XeroInvoice[] }>(`/Invoices?where=Type=="ACCPAY"&page=1`),
      this.get<{ Invoices?: XeroInvoice[] }>(`/Invoices?where=Type=="ACCREC"&page=1`),
    ]);

    return [
      { connectorId: this.id, label: 'Xero profit and loss', locator: 'xero:/Reports/ProfitAndLoss', retrievedAt, payload: { report: pnl, from: iso(from), to: iso(to) } },
      { connectorId: this.id, label: 'Xero supplier bills', locator: 'xero:/Invoices/ACCPAY', retrievedAt, payload: payables.Invoices ?? [] },
      { connectorId: this.id, label: 'Xero customer invoices', locator: 'xero:/Invoices/ACCREC', retrievedAt, payload: receivables.Invoices ?? [] },
    ];
  }

  async normalise(records: SourceRecord[]): Promise<NormalisedRecord[]> {
    const facts = computeFinancialFacts(records);
    if (!facts) return [];

    const src = { connectorId: this.id, label: 'Xero', locator: 'xero:/Reports/ProfitAndLoss' };
    const out: NormalisedRecord[] = [
      { field: 'turnoverEstimate', claim: claim(facts.turnover, { ...src, method: 'connected-data', confidence: 0.97 }) },
    ];

    if (facts.supplierSpend.length > 0) {
      out.push({
        field: 'suppliers',
        claim: claim(facts.supplierSpend.map((s) => s.supplier), { ...src, method: 'connected-data', confidence: 0.96 }),
      });
      out.push({
        field: 'estimatedSpendCategories',
        claim: claim(
          aggregateByCategory(facts.supplierSpend).map((c) => ({
            category: c.category,
            estimatedAnnualSpend: c.annualSpend,
            basis: 'connected' as const,
          })),
          { ...src, method: 'connected-data', confidence: 0.95 },
        ),
      });
    }

    if (facts.customerCount !== null) {
      out.push({
        field: 'financialSignals',
        claim: claim(
          [
            {
              kind: 'customer-base',
              summary: `${facts.customerCount} invoiced customer(s) in the last 12 months, averaging £${Math.round(facts.averageCustomerValue ?? 0).toLocaleString('en-GB')} each.`,
              detectedAt: facts.retrievedAt,
              sourceLabel: 'Xero',
              locator: 'xero:/Invoices/ACCREC',
            },
          ],
          { ...src, method: 'connected-data', confidence: 0.95 },
        ),
      });
    }

    return out;
  }
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[£,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Walks the P&L row tree looking for a named total. */
function findReportValue(rows: XeroReportRow[] | undefined, pattern: RegExp): number | null {
  if (!rows) return null;
  for (const row of rows) {
    const label = row.Cells?.[0]?.Value ?? row.Title;
    if (typeof label === 'string' && pattern.test(label)) {
      const value = numeric(row.Cells?.[1]?.Value);
      if (value !== null) return value;
    }
    const nested = findReportValue(row.Rows, pattern);
    if (nested !== null) return nested;
  }
  return null;
}

export function computeFinancialFacts(records: SourceRecord[]): FinancialFacts | null {
  const pnlRecord = records.find((r) => r.locator === 'xero:/Reports/ProfitAndLoss');
  if (!pnlRecord) return null;

  const { report, from, to } = pnlRecord.payload as { report: XeroReport; from: string; to: string };
  const rows = report.Reports?.[0]?.Rows;

  const turnover = findReportValue(rows, /^(total )?(income|revenue|turnover|total operating income)$/i) ?? 0;
  const grossProfit = findReportValue(rows, /gross profit/i);

  const payables = (records.find((r) => r.locator === 'xero:/Invoices/ACCPAY')?.payload as XeroInvoice[] | undefined) ?? [];
  const receivables = (records.find((r) => r.locator === 'xero:/Invoices/ACCREC')?.payload as XeroInvoice[] | undefined) ?? [];

  const bySupplier = new Map<string, number>();
  for (const invoice of payables) {
    if (invoice.Status === 'DELETED' || invoice.Status === 'VOIDED') continue;
    bySupplier.set(invoice.Contact.Name, (bySupplier.get(invoice.Contact.Name) ?? 0) + invoice.Total);
  }

  const supplierSpend = [...bySupplier.entries()]
    .map(([supplier, annualSpend]) => ({ supplier, category: categoryFor(supplier), annualSpend: Math.round(annualSpend) }))
    .sort((a, b) => b.annualSpend - a.annualSpend);

  const softwareSubscriptions = payables
    .filter((i) => SOFTWARE_HINTS.test(i.Contact.Name) && i.Status !== 'DELETED' && i.Status !== 'VOIDED')
    .reduce<Map<string, { annualSpend: number; lastCharged: string }>>((acc, i) => {
      const existing = acc.get(i.Contact.Name) ?? { annualSpend: 0, lastCharged: i.Date };
      existing.annualSpend += i.Total;
      if (i.Date > existing.lastCharged) existing.lastCharged = i.Date;
      acc.set(i.Contact.Name, existing);
      return acc;
    }, new Map());

  const customers = new Map<string, number>();
  for (const invoice of receivables) {
    if (invoice.Status === 'DELETED' || invoice.Status === 'VOIDED') continue;
    customers.set(invoice.Contact.ContactID, (customers.get(invoice.Contact.ContactID) ?? 0) + invoice.Total);
  }

  const customerCount = customers.size > 0 ? customers.size : null;
  const customerTotal = [...customers.values()].reduce((s, v) => s + v, 0);

  return {
    turnover: Math.round(turnover),
    grossMargin: grossProfit !== null && turnover > 0 ? Math.round((grossProfit / turnover) * 1000) / 1000 : null,
    periodStart: from,
    periodEnd: to,
    supplierSpend,
    softwareSubscriptions: [...softwareSubscriptions.entries()].map(([supplier, v]) => ({
      supplier,
      annualSpend: Math.round(v.annualSpend),
      lastCharged: v.lastCharged,
    })),
    customerCount,
    averageCustomerValue: customerCount ? Math.round(customerTotal / customerCount) : null,
    retrievedAt: new Date().toISOString(),
  };
}

function categoryFor(supplier: string): string {
  return CATEGORY_HINTS.find((h) => h.test.test(supplier))?.category ?? 'Other suppliers';
}

export function aggregateByCategory(
  spend: { supplier: string; category: string; annualSpend: number }[],
): { category: string; annualSpend: number; supplierCount: number }[] {
  const map = new Map<string, { annualSpend: number; supplierCount: number }>();
  for (const s of spend) {
    const acc = map.get(s.category) ?? { annualSpend: 0, supplierCount: 0 };
    acc.annualSpend += s.annualSpend;
    acc.supplierCount += 1;
    map.set(s.category, acc);
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.annualSpend - a.annualSpend);
}
