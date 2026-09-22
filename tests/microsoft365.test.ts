/**
 * Microsoft 365 connector — iteration 2 priority 2.
 *
 * Driven against recorded Graph responses, so the counted-fact path is tested
 * without a live tenant. The point of these tests is the promotion: with a
 * tenant connected, the licence opportunity must stop being a hypothesis.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { TenantDb } from '@/lib/db/tenant';
import { Microsoft365Connector, computeLicenceFacts } from '@/lib/discovery/microsoft365-connector';
import { GraphClient, clearTokenCache, type GraphTransport } from '@/lib/discovery/graph-client';
import { buildContext } from '@/lib/analysis/context';
import { spendLessOpportunities } from '@/lib/analysis/engines/spend-less';
import { createEmptyTwin } from '@/lib/core/company-twin';
import { addClaim, claim } from '@/lib/core/provenance';
import { putFacts, getFacts } from '@/lib/db/repositories/facts';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const recent = new Date(NOW.getTime() - 5 * 86_400_000).toISOString();
const old = new Date(NOW.getTime() - 200 * 86_400_000).toISOString();

const USERS = [
  // 40 active, licensed, signing in.
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `u${i}`, displayName: `User ${i}`, userPrincipalName: `u${i}@acme.test`,
    accountEnabled: true, assignedLicenses: [{ skuId: 'sku-spb' }],
    signInActivity: { lastSignInDateTime: recent },
  })),
  // 6 leavers, disabled but still licensed.
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `d${i}`, displayName: `Leaver ${i}`, userPrincipalName: `d${i}@acme.test`,
    accountEnabled: false, assignedLicenses: [{ skuId: 'sku-spb' }],
    signInActivity: { lastSignInDateTime: old },
  })),
  // 4 dormant: enabled and licensed, no sign-in for 200 days.
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `z${i}`, displayName: `Dormant ${i}`, userPrincipalName: `z${i}@acme.test`,
    accountEnabled: true, assignedLicenses: [{ skuId: 'sku-spb' }],
    signInActivity: { lastSignInDateTime: old },
  })),
  // 3 enabled, unlicensed (shared mailboxes, service accounts).
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `s${i}`, displayName: `Service ${i}`, userPrincipalName: `s${i}@acme.test`,
    accountEnabled: true, assignedLicenses: [],
  })),
];

const SKUS = [
  { skuId: 'sku-spb', skuPartNumber: 'SPB', prepaidUnits: { enabled: 60, suspended: 0, warning: 0 }, consumedUnits: 50 },
  { skuId: 'sku-pbi', skuPartNumber: 'POWER_BI_PRO', prepaidUnits: { enabled: 10, suspended: 0, warning: 0 }, consumedUnits: 4 },
];

function recordedTransport(overrides: { failToken?: boolean; failUsers?: boolean } = {}): GraphTransport {
  return async (url, init) => {
    const respond = (body: unknown, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });

    if (url.includes('/oauth2/v2.0/token')) {
      if (overrides.failToken) return respond({ error: 'invalid_client' }, 401);
      expect(init.method).toBe('POST');
      return respond({ access_token: 'recorded-token', expires_in: 3600 });
    }
    if (url.includes('/users')) {
      if (overrides.failUsers) return respond({ error: {} }, 403);
      expect(init.headers['authorization']).toBe('Bearer recorded-token');
      return respond({ value: USERS });
    }
    if (url.includes('/subscribedSkus')) return respond({ value: SKUS });
    return respond({}, 404);
  };
}

const CREDENTIALS = { tenantId: 'contoso.onmicrosoft.com', clientId: 'client-abc', clientSecret: 'super-secret' };

let db: Database;
let tenantDb: TenantDb;

beforeEach(() => {
  clearTokenCache();
  db = createTestDb();
  db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t1', 'T1', 'MSP', '2026-01-01')`).run();
  db.prepare(
    `INSERT INTO company_twins (id, tenant_id, display_name, understanding, twin_json, created_at, last_updated_at)
     VALUES ('co1', 't1', 'Acme', 10, '{}', '2026-01-01', '2026-01-01')`,
  ).run();
  tenantDb = new TenantDb({ tenantId: 't1', userId: 'u1', role: 'MSP_ADMIN' }, db);
});

describe('graph client', () => {
  it('exchanges credentials for a token and caches it', async () => {
    let tokenCalls = 0;
    const transport: GraphTransport = async (url, init) => {
      if (url.includes('/oauth2/')) tokenCalls++;
      return recordedTransport()(url, init);
    };
    const client = new GraphClient(CREDENTIALS, transport);
    await client.getAll('/users');
    await client.getAll('/subscribedSkus');
    expect(tokenCalls).toBe(1);
  });

  it('never puts the client secret in an error', async () => {
    const client = new GraphClient(CREDENTIALS, recordedTransport({ failToken: true }));
    await expect(client.accessToken()).rejects.toThrow(/token request failed/i);
    await expect(client.accessToken()).rejects.not.toThrow(/super-secret/);
  });

  it('surfaces a Graph failure with its status', async () => {
    const client = new GraphClient(CREDENTIALS, recordedTransport({ failUsers: true }));
    await expect(client.getAll('/users')).rejects.toThrow(/403/);
  });

  it('follows paging to the end', async () => {
    let page = 0;
    const transport: GraphTransport = async (url) => {
      if (url.includes('/oauth2/')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }), text: async () => '' };
      }
      page++;
      return {
        ok: true,
        status: 200,
        json: async () => (page < 3
          ? { value: [{ id: `p${page}` }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=x' }
          : { value: [{ id: `p${page}` }] }),
        text: async () => '',
      };
    };
    const all = await new GraphClient(CREDENTIALS, transport).getAll('/users');
    expect(all).toHaveLength(3);
  });
});

describe('licence facts', () => {
  it('counts the estate exactly', () => {
    const facts = computeLicenceFacts(USERS as never, SKUS as never, NOW);

    expect(facts.totalUsers).toBe(53);
    expect(facts.enabledUsers).toBe(47);
    expect(facts.licensedUsers).toBe(50);
    expect(facts.licensedDisabledUsers).toBe(6);
    expect(facts.dormantLicensedUsers).toBe(4);
  });

  it('prices unassigned seats from the subscription, not a benchmark', () => {
    const facts = computeLicenceFacts(USERS as never, SKUS as never, NOW);
    const spb = facts.skus.find((s) => s.skuPartNumber === 'SPB')!;
    const pbi = facts.skus.find((s) => s.skuPartNumber === 'POWER_BI_PRO')!;

    expect(spb.purchased).toBe(60);
    expect(spb.assigned).toBe(50);
    expect(spb.unassigned).toBe(10);
    expect(spb.unassignedAnnualCostGbp).toBe(Math.round(10 * 18.6 * 12));
    expect(pbi.unassigned).toBe(6);
  });

  it('includes leavers and dormant accounts in the recoverable figure', () => {
    const facts = computeLicenceFacts(USERS as never, SKUS as never, NOW);
    const unassignedOnly = facts.skus.reduce((s, x) => s + x.unassignedAnnualCostGbp, 0);
    expect(facts.recoverableAnnualGbp).toBeGreaterThan(unassignedOnly);
  });

  it('does not treat a missing sign-in record as dormancy', () => {
    const noActivity = [
      { id: 'a', displayName: 'A', userPrincipalName: 'a@x', accountEnabled: true, assignedLicenses: [{ skuId: 'sku-spb' }] },
    ];
    expect(computeLicenceFacts(noActivity as never, SKUS as never, NOW).dormantLicensedUsers).toBe(0);
  });
});

describe('connector', () => {
  it('reports not-configured with no credentials, and never fetches', async () => {
    const connector = new Microsoft365Connector(null);
    expect((await connector.discover()).status).toBe('not-configured');
    expect(await connector.fetch({ input: 'acme' })).toEqual([]);
  });

  it('reports an error rather than pretending to connect', async () => {
    const connector = new Microsoft365Connector(CREDENTIALS, recordedTransport({ failToken: true }));
    const discovery = await connector.discover();
    expect(discovery.status).toBe('error');
    expect(discovery.detail).not.toContain('super-secret');
  });

  it('fetches users and subscriptions, and normalises to counted claims', async () => {
    const connector = new Microsoft365Connector(CREDENTIALS, recordedTransport());
    const records = await connector.fetch({ input: 'acme' });
    expect(records).toHaveLength(2);

    const claims = await connector.normalise(records);
    const headcount = claims.find((c) => c.field === 'employeesEstimate')!;
    expect(headcount.claim.value).toBe(47);
    expect(headcount.claim.method).toBe('connected-data');
    expect(headcount.claim.confidence).toBeGreaterThan(0.9);

    expect(claims.some((c) => c.field === 'softwareEstate')).toBe(true);
    expect(claims.some((c) => c.field === 'estimatedSpendCategories')).toBe(true);
    const signal = claims.find((c) => c.field === 'operationalSignals');
    expect(JSON.stringify(signal!.claim.value)).toMatch(/disabled account/);
  });
});

describe('promotion from hypothesis to counted fact', () => {
  it('replaces the benchmark model with measured seats', () => {
    const twin = createEmptyTwin('co1', 't1');
    twin.employeesEstimate = addClaim(twin.employeesEstimate, claim(50, { connectorId: 'user', label: 'user', method: 'user-supplied', confidence: 0.9 }));

    const benchmarked = spendLessOpportunities(buildContext(twin));
    const before = benchmarked.find((o) => o.subcategory === 'Microsoft licences')!;

    expect(before.epistemics).toBe('hypothesis');
    expect(before.confidence).toBeLessThanOrEqual(0.75);
    expect(before.financialModel.lines.some((l) => l.basis === 'benchmark')).toBe(true);

    const facts = computeLicenceFacts(USERS as never, SKUS as never, NOW);
    const connected = spendLessOpportunities(buildContext(twin, { licence: facts }));
    const after = connected.find((o) => o.subcategory === 'Microsoft licences')!;

    // This is the promotion the directive asks for, and it is mechanical:
    // every line is now `connected`, so deriveEpistemics concludes inferred-fact.
    expect(after.epistemics).toBe('inferred-fact');
    expect(after.confidence).toBeGreaterThan(before.confidence);
    expect(after.confidence).toBeGreaterThan(0.85);
    expect(after.financialModel.lines.every((l) => l.basis === 'connected')).toBe(true);
    expect(after.estimatedAnnualValue).toBe(facts.recoverableAnnualGbp);
    expect(after.executionReadiness).toBeGreaterThan(0.9);

    // And the estimate band tightens, because it is no longer a guess.
    const beforeBand = before.financialModel.highEstimate - before.financialModel.lowEstimate;
    const afterBand = after.financialModel.highEstimate - after.financialModel.lowEstimate;
    expect(afterBand / after.estimatedAnnualValue).toBeLessThan(beforeBand / before.estimatedAnnualValue);
  });

  it('uses the counted user population as headcount everywhere', () => {
    const twin = createEmptyTwin('co1', 't1');
    const facts = computeLicenceFacts(USERS as never, SKUS as never, NOW);
    const ctx = buildContext(twin, { licence: facts });

    expect(ctx.employees.value).toBe(47);
    expect(ctx.employees.basis).toBe('connected');
    expect(ctx.hasLicenceData).toBe(true);
  });

  it('round-trips facts through the store', () => {
    const facts = computeLicenceFacts(USERS as never, SKUS as never, NOW);
    putFacts(tenantDb, 'co1', 'licence', 'microsoft-365', facts);

    const loaded = getFacts(tenantDb, 'co1');
    expect(loaded.licence?.licensedUsers).toBe(50);
    expect(loaded.licence?.recoverableAnnualGbp).toBe(facts.recoverableAnnualGbp);

    // Another tenant sees nothing.
    db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t2', 'T2', 'MSP', '2026-01-01')`).run();
    const other = new TenantDb({ tenantId: 't2', userId: 'u2', role: 'MSP_ADMIN' }, db);
    expect(getFacts(other, 'co1').licence).toBeUndefined();
  });
});
