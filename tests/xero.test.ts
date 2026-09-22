/**
 * Xero accounting connector — iteration 2 priority 3.
 *
 * Driven against recorded Xero responses. The point is the same as the
 * Microsoft tests: with accounting connected, figures that were derived from a
 * turnover ratio become counted from the ledger.
 */

import { describe, it, expect } from 'vitest';
import { XeroConnector, computeFinancialFacts, aggregateByCategory, type XeroCredentials } from '@/lib/discovery/xero-connector';
import type { GraphTransport } from '@/lib/discovery/graph-client';
import { buildContext } from '@/lib/analysis/context';
import { spendLessOpportunities } from '@/lib/analysis/engines/spend-less';
import { makeMoreOpportunities } from '@/lib/analysis/engines/make-more';
import { createEmptyTwin } from '@/lib/core/company-twin';
import { addClaim, claim } from '@/lib/core/provenance';

const CREDENTIALS: XeroCredentials = { clientId: 'xero-client', clientSecret: 'xero-secret', xeroTenantId: 'org-123' };

const PNL = {
  Reports: [
    {
      ReportTitles: ['Profit and Loss'],
      Rows: [
        { RowType: 'Header', Cells: [{ Value: '' }, { Value: '12 months' }] },
        {
          RowType: 'Section',
          Title: 'Income',
          Rows: [
            { RowType: 'Row', Cells: [{ Value: 'Sales' }, { Value: '3,900,000.00' }] },
            { RowType: 'SummaryRow', Cells: [{ Value: 'Total Income' }, { Value: '4,200,000.00' }] },
          ],
        },
        {
          RowType: 'Section',
          Title: 'Less Cost of Sales',
          Rows: [{ RowType: 'SummaryRow', Cells: [{ Value: 'Gross Profit' }, { Value: '1,680,000.00' }] }],
        },
      ],
    },
  ],
};

const today = new Date().toISOString().slice(0, 10);
const longAgo = new Date(Date.now() - 300 * 86_400_000).toISOString().slice(0, 10);

const PAYABLES = [
  { Type: 'ACCPAY', Contact: { ContactID: 'c1', Name: 'Microsoft Ireland' }, Total: 22_000, Date: today, Status: 'PAID' },
  { Type: 'ACCPAY', Contact: { ContactID: 'c2', Name: 'Adobe Systems' }, Total: 6_400, Date: today, Status: 'PAID' },
  { Type: 'ACCPAY', Contact: { ContactID: 'c3', Name: 'Atlassian Pty' }, Total: 4_100, Date: longAgo, Status: 'PAID' },
  { Type: 'ACCPAY', Contact: { ContactID: 'c4', Name: 'Vodafone Limited' }, Total: 18_000, Date: today, Status: 'PAID' },
  { Type: 'ACCPAY', Contact: { ContactID: 'c5', Name: 'O2 Business' }, Total: 9_500, Date: today, Status: 'PAID' },
  { Type: 'ACCPAY', Contact: { ContactID: 'c6', Name: 'Three Mobile' }, Total: 7_200, Date: today, Status: 'PAID' },
  { Type: 'ACCPAY', Contact: { ContactID: 'c7', Name: 'Deleted Supplier' }, Total: 99_999, Date: today, Status: 'DELETED' },
];

const RECEIVABLES = Array.from({ length: 30 }, (_, i) => ({
  Type: 'ACCREC' as const,
  Contact: { ContactID: `cust-${i % 15}`, Name: `Customer ${i % 15}` },
  Total: 14_000,
  Date: today,
  Status: 'PAID',
}));

function transport(opts: { failToken?: boolean } = {}): GraphTransport {
  return async (url, init) => {
    const respond = (body: unknown, status = 200) => ({
      ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body),
    });
    if (url.includes('identity.xero.com')) {
      if (opts.failToken) return respond({ error: 'invalid_client' }, 401);
      expect(init.headers['authorization']).toMatch(/^Basic /);
      return respond({ access_token: 'xero-token', expires_in: 1800 });
    }
    expect(init.headers['xero-tenant-id']).toBe('org-123');
    if (url.includes('/Reports/ProfitAndLoss')) return respond(PNL);
    if (url.includes('ACCPAY')) return respond({ Invoices: PAYABLES });
    if (url.includes('ACCREC')) return respond({ Invoices: RECEIVABLES });
    return respond({}, 404);
  };
}

async function facts() {
  const connector = new XeroConnector(CREDENTIALS, transport());
  return computeFinancialFacts(await connector.fetch({ input: 'acme' }))!;
}

describe('xero connector', () => {
  it('reports not-configured with no credentials', async () => {
    const connector = new XeroConnector(null);
    expect((await connector.discover()).status).toBe('not-configured');
    expect(await connector.fetch({ input: 'x' })).toEqual([]);
  });

  it('reports an error without leaking the secret', async () => {
    const connector = new XeroConnector(CREDENTIALS, transport({ failToken: true }));
    const discovery = await connector.discover();
    expect(discovery.status).toBe('error');
    expect(discovery.detail).not.toContain('xero-secret');
  });

  it('fetches the P&L, payables and receivables', async () => {
    const records = await new XeroConnector(CREDENTIALS, transport()).fetch({ input: 'acme' });
    expect(records.map((r) => r.locator)).toEqual([
      'xero:/Reports/ProfitAndLoss',
      'xero:/Invoices/ACCPAY',
      'xero:/Invoices/ACCREC',
    ]);
  });

  it('reads turnover and gross margin from the report tree', async () => {
    const f = await facts();
    expect(f.turnover).toBe(4_200_000);
    expect(f.grossMargin).toBeCloseTo(0.4, 2);
  });

  it('aggregates supplier spend and ignores deleted invoices', async () => {
    const f = await facts();
    expect(f.supplierSpend.find((s) => s.supplier === 'Deleted Supplier')).toBeUndefined();
    expect(f.supplierSpend[0]!.supplier).toBe('Microsoft Ireland');
    expect(f.supplierSpend.find((s) => s.supplier === 'Vodafone Limited')!.category).toBe('Telecoms');
  });

  it('identifies software subscriptions and when each was last charged', async () => {
    const f = await facts();
    const names = f.softwareSubscriptions.map((s) => s.supplier);
    expect(names).toContain('Microsoft Ireland');
    expect(names).toContain('Adobe Systems');
    expect(names).not.toContain('Vodafone Limited');
    expect(f.softwareSubscriptions.find((s) => s.supplier === 'Atlassian Pty')!.lastCharged).toBe(longAgo);
  });

  it('counts distinct customers and their average value', async () => {
    const f = await facts();
    expect(f.customerCount).toBe(15);
    expect(f.averageCustomerValue).toBe(28_000);
  });

  it('aggregates categories with supplier counts', async () => {
    const f = await facts();
    const categories = aggregateByCategory(f.supplierSpend);
    const telecoms = categories.find((c) => c.category === 'Telecoms')!;
    expect(telecoms.supplierCount).toBe(3);
    expect(telecoms.annualSpend).toBe(18_000 + 9_500 + 7_200);
  });

  it('normalises to counted claims', async () => {
    const connector = new XeroConnector(CREDENTIALS, transport());
    const claims = await connector.normalise(await connector.fetch({ input: 'acme' }));
    const turnover = claims.find((c) => c.field === 'turnoverEstimate')!;
    expect(turnover.claim.value).toBe(4_200_000);
    expect(turnover.claim.method).toBe('connected-data');
    expect(claims.some((c) => c.field === 'suppliers')).toBe(true);
  });
});

describe('promotion with accounting connected', () => {
  function twinWithHeadcount(n: number) {
    const twin = createEmptyTwin('co1', 't1');
    twin.employeesEstimate = addClaim(twin.employeesEstimate, claim(n, { connectorId: 'user', label: 'user', method: 'user-supplied', confidence: 0.9 }));
    return twin;
  }

  it('counts SaaS spend from the ledger instead of modelling it from headcount', async () => {
    const twin = twinWithHeadcount(45);
    const f = await facts();

    const before = spendLessOpportunities(buildContext(twin)).find((o) => o.subcategory === 'SaaS')!;
    const after = spendLessOpportunities(buildContext(twin, { financial: f })).find((o) => o.subcategory === 'SaaS')!;

    expect(before.financialModel.lines.some((l) => l.basis === 'benchmark')).toBe(true);
    expect(after.confidence).toBeGreaterThan(before.confidence);
    expect(after.financialModel.lines.some((l) => l.label === 'Counted annual software spend' && l.basis === 'connected')).toBe(true);
    expect(after.summary).toMatch(/software supplier/);
  });

  it('names the actual fragmented category and its suppliers', async () => {
    const twin = twinWithHeadcount(45);
    const after = spendLessOpportunities(buildContext(twin, { financial: await facts() }))
      .find((o) => o.subcategory === 'Supplier consolidation')!;

    expect(after.title).toMatch(/telecoms/i);
    expect(JSON.stringify(after.evidence)).toMatch(/Vodafone Limited/);
    expect(after.executionReadiness).toBeGreaterThan(0.8);
  });

  it('uses the counted customer base for dormant reactivation', async () => {
    const twin = twinWithHeadcount(45);
    const f = await facts();

    const before = makeMoreOpportunities(buildContext(twin)).find((o) => o.subcategory === 'Existing customer expansion')!;
    const after = makeMoreOpportunities(buildContext(twin, { financial: f })).find((o) => o.subcategory === 'Existing customer expansion')!;

    const countedLine = after.financialModel.lines.find((l) => l.label === 'Invoiced customers in the last 12 months')!;
    expect(countedLine.value).toBe(15);
    expect(countedLine.basis).toBe('connected');
    expect(after.financialModel.lines.find((l) => l.label === 'Average annual customer value')!.value).toBe(28_000);
    expect(after.confidence).toBeGreaterThan(before.confidence);
  });

  it('replaces the inferred turnover with the counted one everywhere', async () => {
    const ctx = buildContext(twinWithHeadcount(45), { financial: await facts() });
    expect(ctx.turnover.value).toBe(4_200_000);
    expect(ctx.turnover.basis).toBe('connected');
    expect(ctx.hasFinancialData).toBe(true);
  });
});
