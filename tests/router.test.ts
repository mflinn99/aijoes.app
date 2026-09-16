/** Directive §14 and §26: capability routing and proportionate execution. */

import { describe, it, expect } from 'vitest';
import { routeObjective } from '@/lib/capabilities/router';
import { listCapabilities, getAdapter, registerAdapter, findActionOwner } from '@/lib/capabilities/registry';
import { proportionate } from '@/lib/observability/events';
import { createMockAdapter, seedFrom } from '@/lib/capabilities/adapters/mock-adapter';

const inputs = ['companyId', 'tenantId', 'objective', 'approvalId', 'financialTarget'];

describe('capability router', () => {
  it('routes an exact action to a capability that supports it', () => {
    const r = routeObjective({ actionId: 'reactivate-dormant', objective: 'Reactivate dormant customers', availableInputs: inputs, valueAtStake: 100_000 });
    expect(r.recommended?.capabilityId).toBe('salesonic');
    expect(r.rationale).toContain('SaleSonic');
  });

  it('never recommends an unavailable capability', () => {
    const r = routeObjective({ actionId: 'monitor-signals', objective: 'Monitor company signals', availableInputs: inputs, valueAtStake: 50_000 });
    expect(r.recommended?.capabilityId).not.toBe('listeningpost');
    const listening = r.candidates.find((c) => c.capabilityId === 'listeningpost');
    if (listening) expect(listening.blockers.join(' ')).toMatch(/unavailable/);
  });

  it('demotes rather than hides a blocked candidate, so the UI can explain it', () => {
    const r = routeObjective({ actionId: 'execute-outreach', objective: 'Send outreach', availableInputs: ['companyId'], valueAtStake: 100_000 });
    const candidate = r.candidates.find((c) => c.actionId === 'execute-outreach');
    expect(candidate).toBeDefined();
    expect(candidate!.blockers.join(' ')).toMatch(/Missing input/);
  });

  it('blocks a capability whose unit cost exceeds the value at stake', () => {
    const r = routeObjective({ actionId: 'run-sourcing-event', objective: 'Run sourcing event', availableInputs: inputs, valueAtStake: 5 });
    const candidate = r.candidates.find((c) => c.actionId === 'run-sourcing-event')!;
    expect(candidate.blockers.join(' ')).toMatch(/disproportionate/i);
    expect(r.recommended?.actionId).not.toBe('run-sourcing-event');
  });

  it('exposes the full scoring breakdown', () => {
    const r = routeObjective({ actionId: 'analyse-company', objective: 'Analyse company', availableInputs: inputs, valueAtStake: 100_000 });
    const rec = r.recommended!;
    expect(rec.components.length).toBeGreaterThan(5);
    const recomputed = rec.components.reduce((s, c) => s + c.contribution, 0);
    expect(rec.total).toBeCloseTo(Math.round(recomputed * 10) / 10, 5);
  });

  it('returns a fallback distinct from the recommendation', () => {
    const r = routeObjective({ actionId: 'analyse-spend', objective: 'Analyse spend and cost', availableInputs: inputs, valueAtStake: 100_000 });
    if (r.recommended && r.fallback) expect(r.fallback).not.toBe(r.recommended);
  });

  it('reports honestly when no capability supports the action', () => {
    const r = routeObjective({ actionId: 'teleport-the-office', objective: 'zzzz', availableInputs: inputs, valueAtStake: 100 });
    expect(r.recommended).toBeNull();
    expect(r.rationale).toMatch(/No registered capability/);
  });

  it('accepts a new capability without any change to orchestration', () => {
    const before = routeObjective({ actionId: 'brand-new-capability-action', objective: 'x', availableInputs: inputs, valueAtStake: 10_000 });
    expect(before.recommended).toBeNull();

    registerAdapter(
      createMockAdapter({
        id: 'test-newco', name: 'NewCo', opco: 'NewCo', type: 'growth',
        description: 'A capability registered at runtime.',
        supportedActions: [{ id: 'brand-new-capability-action', name: 'Do the thing', description: 'Does the thing.', external: false, risk: 'low', unitCostGbp: 0.1, requiredInputs: ['companyId'], outputs: ['result'] }],
        apiEndpoint: null, authMethod: 'internal-mesh', maturity: 'production',
        executionMode: 'synchronous', requiredInputs: ['companyId'], outputs: ['result'],
        owner: 'Test', health: 'healthy', successRate: 1, typicalDurationSec: 1,
      }),
    );

    const after = routeObjective({ actionId: 'brand-new-capability-action', objective: 'x', availableInputs: inputs, valueAtStake: 10_000 });
    expect(after.recommended?.capabilityId).toBe('test-newco');
  });
});

describe('capability registry', () => {
  it('registers every AIGoGo opco named in the directive', () => {
    const ids = listCapabilities().map((c) => c.id);
    for (const expected of ['toleron', 'salesonic', 'listeningpost', 'sourcingai', 'buyonic', 'grothos', 'sixonic', 'strata-metamsp', 'onward', 'jojo']) {
      expect(ids).toContain(expected);
    }
  });

  it('states a reason for every mocked capability', () => {
    for (const c of listCapabilities().filter((x) => x.maturity === 'mock')) {
      expect(c.mockReason, `${c.id} must say why it is mocked`).toBeTruthy();
    }
  });

  it('finds the owner of an action', () => {
    expect(findActionOwner('negotiate-renewal')?.capability.id).toBe('buyonic');
    expect(findActionOwner('nonexistent')).toBeNull();
  });
});

describe('proportionate execution', () => {
  it('rejects spending disproportionately against the value at stake', () => {
    expect(proportionate(1_000, 500).ok).toBe(false);
    expect(proportionate(5, 100_000).ok).toBe(true);
    expect(proportionate(10, 0).ok).toBe(false);
  });
});

describe('mock adapters', () => {
  it('are deterministic for the same inputs', () => {
    expect(seedFrom('a:b:c')).toBe(seedFrom('a:b:c'));
    expect(seedFrom('a:b:c')).not.toBe(seedFrom('a:b:d'));
  });

  it('always flag their output as simulated', async () => {
    const outcome = await getAdapter('salesonic')!.invoke({
      capabilityId: 'salesonic', actionId: 'define-icp', tenantId: 't', companyId: 'c', inputs: { companyId: 'c' },
    });
    expect(outcome.simulated).toBe(true);
    expect(outcome.ok).toBe(true);
  });

  it('fail on an unsupported action rather than pretending to succeed', async () => {
    const outcome = await getAdapter('salesonic')!.invoke({
      capabilityId: 'salesonic', actionId: 'not-a-real-action', tenantId: 't', companyId: 'c', inputs: {},
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toMatch(/does not support/);
  });

  it('fail when a required input is missing', async () => {
    const outcome = await getAdapter('salesonic')!.invoke({
      capabilityId: 'salesonic', actionId: 'execute-outreach', tenantId: 't', companyId: 'c', inputs: { companyId: 'c' },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toMatch(/Missing required input/);
    expect(outcome.failure).toMatch(/approvalId/);
  });
});
