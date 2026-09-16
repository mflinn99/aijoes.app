/** Directive §27: data-source failure, agent failure and retry. */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { harness, seedGrant } from './helpers';
import { analyseCompany } from '@/lib/analysis/pipeline';
import { WebsiteConnector } from '@/lib/discovery/website-connector';
import { CompaniesHouseConnector } from '@/lib/discovery/companies-house-connector';
import { normaliseDomain, looksLikeDomain, fetchText } from '@/lib/discovery/http';
import { extractSignals, detectTechnology } from '@/lib/discovery/html';
import { createMockAdapter } from '@/lib/capabilities/adapters/mock-adapter';
import { registerAdapter, getAdapter } from '@/lib/capabilities/registry';
import { AutonomyLevel } from '@/lib/core/autonomy';

afterEach(() => vi.restoreAllMocks());

describe('data source failure', () => {
  it('degrades to a low understanding score rather than throwing', async () => {
    const h = harness();
    const result = await analyseCompany(h.db, 'unreachable-company.invalid', { offline: true });
    expect(result.run.status).toBe('completed');
    expect(result.understanding).toBeLessThan(15);
  });

  it('marks the profile stage skipped when nothing is retrieved', async () => {
    const h = harness();
    const result = await analyseCompany(h.db, 'nothing-here.invalid', { offline: true });
    const profile = result.run.stages.find((s) => s.id === 'profile')!;
    expect(profile.status).toBe('skipped');
    expect(profile.detail).toMatch(/Understanding stays low/);
  });

  it('survives a connector that throws', async () => {
    const h = harness();
    vi.spyOn(WebsiteConnector.prototype, 'fetch').mockRejectedValue(new Error('network exploded'));
    const result = await analyseCompany(h.db, 'https://example.com');
    expect(result.run.status).toBe('completed');
  });

  it('returns an error result rather than throwing on a failed fetch', async () => {
    const result = await fetchText('https://this-domain-does-not-resolve.invalid', 1_500);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.body).toBe('');
  });

  it('reports not-configured rather than guessing when an API key is absent', async () => {
    delete process.env.COMPANIES_HOUSE_API_KEY;
    const connector = new CompaniesHouseConnector();
    const discovery = await connector.discover();
    expect(discovery.status).toBe('not-configured');
    expect(await connector.fetch({ input: 'Acme' })).toEqual([]);
  });

  it('distinguishes a domain from a company name', () => {
    expect(looksLikeDomain('claritas-solutions.co.uk')).toBe(true);
    expect(looksLikeDomain('https://www.example.com/page')).toBe(true);
    expect(looksLikeDomain('Claritas Solutions')).toBe(false);
    expect(normaliseDomain('https://WWW.Example.COM/x')).toBe('example.com');
    expect(normaliseDomain('')).toBeNull();
  });

  it('parses malformed HTML without crashing', () => {
    const broken = '<html><head><title>Unclosed<body><h1>Hi<a href="javascript:x">bad</a><a href="not a url">also bad</a>';
    const signals = extractSignals(broken, 'https://example.com');
    // An unterminated <title> yields no title rather than a guess at where it ended.
    expect(signals.title).toBeNull();
    // Unsafe and unparseable hrefs are dropped, not passed through.
    expect(signals.links.every((l) => l.href.startsWith('http'))).toBe(true);
    expect(signals.text).toContain('Hi');
    expect(() => detectTechnology(broken, signals)).not.toThrow();

    const closed = extractSignals('<title>Acme Ltd</title><h1>Welcome', 'https://example.com');
    expect(closed.title).toBe('Acme Ltd');
  });

  it('handles an empty document', () => {
    const signals = extractSignals('', 'https://example.com');
    expect(signals.title).toBeNull();
    expect(signals.headings).toEqual([]);
  });
});

describe('agent failure and retry', () => {
  it('retries a failing capability before giving up', async () => {
    let attempts = 0;
    const capability = {
      id: 'flaky-test', name: 'Flaky', opco: 'Test', type: 'automation' as const,
      description: 'Fails deterministically.',
      supportedActions: [{ id: 'flaky-action', name: 'Flaky action', description: '', external: false, risk: 'low' as const, unitCostGbp: 0.1, requiredInputs: [], outputs: [] }],
      apiEndpoint: null, authMethod: 'internal-mesh' as const, maturity: 'mock' as const,
      executionMode: 'synchronous' as const, requiredInputs: [], outputs: [],
      owner: 'Test', health: 'healthy' as const, successRate: 0.5, typicalDurationSec: 1,
      mockReason: 'test fixture',
    };

    registerAdapter({
      capability,
      async invoke(inv) {
        attempts++;
        return createMockAdapter(capability, { failWhen: () => (attempts < 3 ? 'transient failure' : null) }).invoke(inv);
      },
    });

    const adapter = getAdapter('flaky-test')!;
    const first = await adapter.invoke({ capabilityId: 'flaky-test', actionId: 'flaky-action', tenantId: 't', companyId: 'c', inputs: {} });
    expect(first.ok).toBe(false);
    const second = await adapter.invoke({ capabilityId: 'flaky-test', actionId: 'flaky-action', tenantId: 't', companyId: 'c', inputs: {} });
    expect(second.ok).toBe(false);
    const third = await adapter.invoke({ capabilityId: 'flaky-test', actionId: 'flaky-action', tenantId: 't', companyId: 'c', inputs: {} });
    expect(third.ok).toBe(true);
  });

  it('records a failure on the plan rather than reporting success', async () => {
    const { planExecution, authorisePlan, runExecution } = await import('@/lib/execution/engine');
    const { listGrants } = await import('@/lib/db/repositories/tenant-data');
    const { SYNTHETIC_COMPANIES } = await import('@/lib/fixtures/synthetic');
    const { seedCustomer } = await import('./helpers');
    const { startAvailable } = await import('@/lib/core/opportunity');

    const h = harness();
    seedGrant(h, AutonomyLevel.RECOMMEND);
    const fixture = SYNTHETIC_COMPANIES[2]!;
    seedCustomer(h, 'c1', fixture.name, fixture.domain);
    const result = await analyseCompany(h.db, fixture.domain, {
      customerId: 'c1', offline: true, seedRecords: fixture.records, userSupplied: fixture.userSupplied,
    });
    const opportunity = result.opportunities.find((o) => startAvailable(o).available)!;
    const preview = planExecution(h.db, { opportunity, grants: listGrants(h.db), connectedIntegrations: ['website'], userId: h.ctx.userId });
    authorisePlan(h.db, preview.plan.id, h.ctx.userId, 'test');

    // Break the first capability the plan uses.
    const target = preview.plan.tasks[0]!.assignedCapability;
    const original = getAdapter(target)!;
    registerAdapter({
      capability: original.capability,
      async invoke() {
        return { ok: false, simulated: true, outputs: {}, evidence: [], costGbp: 0.1, durationMs: 1, failure: 'capability is down' };
      },
    });

    const run = await runExecution(h.db, preview.plan.id, h.ctx.userId);
    expect(run.plan.status).toBe('FAILED');
    expect(run.plan.tasks[0]!.status).toBe('FAILED');
    expect(run.plan.tasks[0]!.outcome).toBe('capability is down');
    expect(run.plan.tasks[0]!.retryCount).toBeGreaterThan(0);

    registerAdapter(original);
  });
});
