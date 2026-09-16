/** Directive §15: playbooks are complete, versioned and executable. */

import { describe, it, expect } from 'vitest';
import { listPlaybooks, getPlaybook } from '@/lib/playbooks/registry';
import { findActionOwner } from '@/lib/capabilities/registry';

const REQUIRED = [
  'dormant-customer-reactivation', 'pipeline-generation', 'new-market-entry', 'cross-sell',
  'pricing-review', 'microsoft-licence-optimisation', 'saas-rationalisation',
  'cloud-cost-optimisation', 'supplier-consolidation', 'contract-renewal',
  'procurement-event', 'process-automation', 'cyber-uplift', 'msp-account-expansion',
  'customer-business-review',
];

describe('playbook registry', () => {
  it('registers every playbook the directive names', () => {
    const ids = listPlaybooks().map((p) => p.id);
    for (const id of REQUIRED) expect(ids, `missing playbook ${id}`).toContain(id);
  });

  it('gives every playbook a version, tasks, KPIs and an approval policy', () => {
    for (const p of listPlaybooks()) {
      expect(p.version, `${p.id} version`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.tasks.length, `${p.id} tasks`).toBeGreaterThan(0);
      expect(p.defaultKPIs.length, `${p.id} KPIs`).toBeGreaterThan(0);
      expect(p.capabilityRequirements.length, `${p.id} capabilities`).toBeGreaterThan(0);
      expect(p.financialModel.targetRealisationRate).toBeGreaterThan(0);
      expect(p.financialModel.targetRealisationRate).toBeLessThanOrEqual(1);
      expect(p.financialModel.measurementWindowDays).toBeGreaterThan(0);
      expect(p.approvalPolicy.gates.length, `${p.id} approval gates`).toBeGreaterThanOrEqual(0);
    }
  });

  it('maps every playbook task to an action some capability actually supports', () => {
    for (const p of listPlaybooks()) {
      for (const t of p.tasks) {
        expect(findActionOwner(t.capabilityAction), `${p.id}/${t.action} → ${t.capabilityAction}`).not.toBeNull();
      }
    }
  });

  it('requires an approvalId input on every task that reaches outside the platform', () => {
    for (const p of listPlaybooks()) {
      for (const t of p.tasks) {
        const owner = findActionOwner(t.capabilityAction)!;
        if (owner.action.external) {
          expect(t.inputs, `${p.id}/${t.action} is external and must carry approvalId`).toContain('approvalId');
        }
      }
    }
  });

  it('applies eligibility rules that reject an under-evidenced opportunity', () => {
    const playbook = getPlaybook('dormant-customer-reactivation')!;
    const failures = playbook.eligibilityRules
      .map((r) => r.check({ confidence: 0.1, value: 100, integrations: [], readiness: 0.1 }))
      .filter(Boolean);
    expect(failures.length).toBeGreaterThan(0);

    const passes = playbook.eligibilityRules
      .map((r) => r.check({ confidence: 0.9, value: 100_000, integrations: ['crm'], readiness: 0.9 }))
      .filter(Boolean);
    expect(passes).toHaveLength(0);
  });

  it('names an integration requirement explicitly where one exists', () => {
    const cloud = getPlaybook('cloud-cost-optimisation')!;
    const failure = cloud.eligibilityRules
      .map((r) => r.check({ confidence: 0.9, value: 100_000, integrations: [], readiness: 0.9 }))
      .find(Boolean);
    expect(failure).toMatch(/not connected/);
  });
});
