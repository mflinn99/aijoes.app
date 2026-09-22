/**
 * HubSpot CRM connector — iteration 3.
 *
 * The last of the three promotions: dormancy and pipeline were the most heavily
 * modelled numbers left, and these tests hold the line that a connected CRM
 * replaces the model rather than decorating it.
 */

import { describe, it, expect } from 'vitest';
import { HubspotConnector, computeCrmFacts, CRM_DORMANT_MONTHS, type HubspotCredentials } from '@/lib/discovery/hubspot-connector';
import type { GraphTransport } from '@/lib/discovery/graph-client';
import { buildContext } from '@/lib/analysis/context';
import { makeMoreOpportunities } from '@/lib/analysis/engines/make-more';
import { createEmptyTwin } from '@/lib/core/company-twin';
import { addClaim, claim } from '@/lib/core/provenance';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const CREDENTIALS: HubspotCredentials = { accessToken: 'pat-na1-secret-token' };

const COMPANIES = Array.from({ length: 40 }, (_, i) => ({
  id: `co${i}`,
  properties: { name: `Company ${i}`, createdate: daysAgo(900) },
}));

const DEALS = [
  // 12 accounts bought recently: won inside the last 12 months.
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `d-recent-${i}`,
    properties: {
      amount: '32000', dealstage: 'closedwon', closedate: daysAgo(100),
      createdate: daysAgo(200), hs_lastmodifieddate: daysAgo(100),
      hs_is_closed: 'true', hs_is_closed_won: 'true',
    },
    associations: { companies: { results: [{ id: `co${i}` }] } },
  })),
  // 9 accounts bought long ago and never since: dormant.
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `d-old-${i}`,
    properties: {
      amount: '28000', dealstage: 'closedwon', closedate: daysAgo(700),
      createdate: daysAgo(800), hs_lastmodifieddate: daysAgo(700),
      hs_is_closed: 'true', hs_is_closed_won: 'true',
    },
    associations: { companies: { results: [{ id: `co${20 + i}` }] } },
  })),
  // 6 lost in the last 12 months.
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `d-lost-${i}`,
    properties: {
      amount: '25000', dealstage: 'closedlost', closedate: daysAgo(150),
      createdate: daysAgo(250), hs_lastmodifieddate: daysAgo(150),
      hs_is_closed: 'true', hs_is_closed_won: 'false',
    },
    associations: { companies: { results: [{ id: `co${i}` }] } },
  })),
  // 5 open, 2 of them stalled.
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `d-open-${i}`,
    properties: { amount: '40000', dealstage: 'proposal', createdate: daysAgo(30), hs_lastmodifieddate: daysAgo(5), hs_is_closed: 'false' },
    associations: { companies: { results: [{ id: `co${30 + i}` }] } },
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `d-stalled-${i}`,
    properties: { amount: '55000', dealstage: 'proposal', createdate: daysAgo(200), hs_lastmodifieddate: daysAgo(120), hs_is_closed: 'false' },
    associations: { companies: { results: [{ id: `co${35 + i}` }] } },
  })),
];

function transport(opts: { fail?: boolean } = {}): GraphTransport {
  return async (url, init) => {
    const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => '' });
    if (opts.fail) return respond({ message: 'unauthorized', token: CREDENTIALS.accessToken }, 401);
    expect(init.headers['authorization']).toBe(`Bearer ${CREDENTIALS.accessToken}`);
    if (url.includes('/objects/companies')) return respond({ results: COMPANIES });
    if (url.includes('/objects/deals')) return respond({ results: DEALS });
    return respond({}, 404);
  };
}

async function facts() {
  const connector = new HubspotConnector(CREDENTIALS, transport());
  return computeCrmFacts(await connector.fetch({ input: 'acme' }), NOW)!;
}

describe('hubspot connector', () => {
  it('reports not-configured with no credentials', async () => {
    const connector = new HubspotConnector(null);
    expect((await connector.discover()).status).toBe('not-configured');
    expect(await connector.fetch({ input: 'x' })).toEqual([]);
  });

  it('reports an error without leaking the token', async () => {
    const connector = new HubspotConnector(CREDENTIALS, transport({ fail: true }));
    const discovery = await connector.discover();
    expect(discovery.status).toBe('error');
    expect(discovery.detail).not.toContain('pat-na1-secret-token');
  });

  it('follows paging', async () => {
    let page = 0;
    const paging: GraphTransport = async (url) => {
      if (!url.includes('/objects/companies')) return { ok: true, status: 200, json: async () => ({ results: [] }), text: async () => '' };
      page++;
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => (page < 3
          ? { results: [{ id: `p${page}`, properties: {} }], paging: { next: { after: String(page) } } }
          : { results: [{ id: `p${page}`, properties: {} }] }),
      };
    };
    const records = await new HubspotConnector(CREDENTIALS, paging).fetch({ input: 'x' });
    expect((records[0]!.payload as unknown[]).length).toBe(3);
  });
});

describe('CRM facts', () => {
  it('counts the account base and its deals', async () => {
    const f = await facts();
    expect(f.totalAccounts).toBe(40);
    expect(f.customersWithRevenue).toBe(21);
    expect(f.openDeals).toBe(5);
    expect(f.openPipelineValue).toBe(3 * 40_000 + 2 * 55_000);
  });

  it('counts dormancy from accounts that actually bought before', async () => {
    const f = await facts();
    // 9 bought 700 days ago and nothing since. The 19 accounts that never
    // bought at all are prospects, not dormant customers, and are excluded.
    expect(f.dormantAccounts).toBe(9);
  });

  it('counts stalled pipeline', async () => {
    const f = await facts();
    expect(f.stalledDeals).toBe(2);
    expect(f.stalledPipelineValue).toBe(110_000);
  });

  it('computes conversion rate and average deal value from closed deals', async () => {
    const f = await facts();
    expect(f.wonLast12m).toBe(12);
    expect(f.lostLast12m).toBe(6);
    expect(f.conversionRate).toBeCloseTo(12 / 18, 3);
    expect(f.averageDealValue).toBe(32_000);
  });

  it('returns no conversion rate when too few deals have closed', () => {
    const thin = [
      { connectorId: 'crm', label: 'c', locator: 'hubspot:/companies', retrievedAt: '', payload: [] },
      {
        connectorId: 'crm', label: 'd', locator: 'hubspot:/deals', retrievedAt: '',
        payload: [{ id: 'x', properties: { amount: '100', closedate: daysAgo(10), hs_is_closed: 'true', hs_is_closed_won: 'true' }, associations: { companies: { results: [{ id: 'c1' }] } } }],
      },
    ];
    // One closed deal is noise, not a measurement.
    expect(computeCrmFacts(thin, NOW)!.conversionRate).toBeNull();
  });

  it('normalises to counted claims including hygiene signals', async () => {
    const connector = new HubspotConnector(CREDENTIALS, transport());
    const claims = await connector.normalise(await connector.fetch({ input: 'x' }));
    expect(claims.some((c) => c.field === 'crmIndicators')).toBe(true);
    const signal = claims.find((c) => c.field === 'operationalSignals')!;
    expect(JSON.stringify(signal.claim.value)).toMatch(/no closed-won deal/);
  });
});

describe('promotion with a CRM connected', () => {
  function twin() {
    const t = createEmptyTwin('co1', 't1');
    t.employeesEstimate = addClaim(t.employeesEstimate, claim(45, { connectorId: 'user', label: 'user', method: 'user-supplied', confidence: 0.9 }));
    t.turnoverEstimate = addClaim(t.turnoverEstimate, claim(4_000_000, { connectorId: 'user', label: 'user', method: 'user-supplied', confidence: 0.9 }));
    return t;
  }

  it('counts dormant accounts instead of applying a share to a modelled base', async () => {
    const f = await facts();
    const before = makeMoreOpportunities(buildContext(twin())).find((o) => o.title === 'Dormant customer reactivation')!;
    const after = makeMoreOpportunities(buildContext(twin(), { crm: f })).find((o) => o.title === 'Dormant customer reactivation')!;

    const dormantLine = after.financialModel.lines.find((l) => l.label.includes('Dormant'))!;
    expect(dormantLine.value).toBe(9);
    expect(dormantLine.basis).toBe('connected');
    expect(after.confidence).toBeGreaterThan(before.confidence);
    expect(after.executionReadiness).toBeGreaterThan(before.executionReadiness);
    expect(after.summary).toMatch(new RegExp(`${CRM_DORMANT_MONTHS} months`));
  });

  it('uses the counted conversion rate and deal value for pipeline', async () => {
    const f = await facts();
    const before = makeMoreOpportunities(buildContext(twin())).find((o) => o.subcategory === 'New business')!;
    const after = makeMoreOpportunities(buildContext(twin(), { crm: f })).find((o) => o.subcategory === 'New business')!;

    const winLine = after.financialModel.lines.find((l) => l.label === 'Meeting to win rate')!;
    expect(winLine.basis).toBe('connected');
    expect(winLine.note).toMatch(/Counted: 12 won of 18/);

    const valueLine = after.financialModel.lines.find((l) => l.label === 'Average annual customer value')!;
    expect(valueLine.value).toBe(32_000);
    expect(after.confidence).toBeGreaterThan(before.confidence);
    expect(after.problem).toMatch(/open deal/);
  });

  it('marks the context as having CRM data', async () => {
    expect(buildContext(twin(), { crm: await facts() }).hasCrmData).toBe(true);
  });
});
