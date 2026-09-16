/** Directive §12: "Never imply autonomy where authority has not been granted." */

import { describe, it, expect } from 'vitest';
import { AutonomyLevel, resolveAutonomy, haltAll, type ActionRequest } from '@/lib/core/autonomy';
import { grant } from './helpers';

const base: ActionRequest = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  actionType: 'execute-outreach',
  capabilityId: 'salesonic',
  monetaryImpact: 0,
  risk: 'low',
  external: false,
};

describe('autonomy policy', () => {
  it('denies by default when no grant matches', () => {
    const d = resolveAutonomy(base, []);
    expect(d.level).toBe(AutonomyLevel.OBSERVE);
    expect(d.mayExecute).toBe(false);
    expect(d.requiresApproval).toBe(true);
  });

  it('defaults a newly-introduced action type to Observe even when other actions are granted', () => {
    const grants = [grant('tenant-a', AutonomyLevel.AUTONOMOUS, { actionType: 'analyse-company' })];
    const d = resolveAutonomy({ ...base, actionType: 'brand-new-action' }, grants);
    expect(d.level).toBe(AutonomyLevel.OBSERVE);
  });

  it('ignores a grant belonging to another tenant', () => {
    const d = resolveAutonomy(base, [grant('tenant-b', AutonomyLevel.EXECUTE)]);
    expect(d.level).toBe(AutonomyLevel.OBSERVE);
  });

  it('ignores an expired grant', () => {
    const expired = grant('tenant-a', AutonomyLevel.EXECUTE, { expiresAt: '2020-01-01T00:00:00Z' });
    expect(resolveAutonomy(base, [expired]).level).toBe(AutonomyLevel.OBSERVE);
  });

  it('prefers the more specific grant, and breaks ties toward the lower level', () => {
    const wildcard = grant('tenant-a', AutonomyLevel.AUTONOMOUS);
    const specific = grant('tenant-a', AutonomyLevel.PREPARE, { actionType: 'execute-outreach', capabilityId: 'salesonic' });
    expect(resolveAutonomy(base, [wildcard, specific]).level).toBe(AutonomyLevel.PREPARE);
  });

  it('caps at Prepare when monetary impact exceeds the threshold', () => {
    const g = grant('tenant-a', AutonomyLevel.AUTONOMOUS, { monetaryThreshold: 5_000 });
    const d = resolveAutonomy({ ...base, monetaryImpact: 50_000 }, [g]);
    expect(d.level).toBe(AutonomyLevel.PREPARE);
    expect(d.mayExecute).toBe(false);
    expect(d.reason).toMatch(/exceeds the granted threshold/);
  });

  it('caps at Prepare when action risk exceeds the granted ceiling', () => {
    const g = grant('tenant-a', AutonomyLevel.EXECUTE, { maxRisk: 'low' });
    const d = resolveAutonomy({ ...base, risk: 'high' }, [g]);
    expect(d.mayExecute).toBe(false);
    expect(d.reason).toMatch(/exceeds the granted maximum/);
  });

  it('requires approval for anything external below Execute', () => {
    const g = grant('tenant-a', AutonomyLevel.PREPARE);
    const d = resolveAutonomy({ ...base, external: true }, [g]);
    expect(d.mayExecute).toBe(false);
    expect(d.reason).toMatch(/before anything leaves the platform/);
  });

  it('permits execution only at Execute or above, within all caps', () => {
    const g = grant('tenant-a', AutonomyLevel.EXECUTE, { monetaryThreshold: 10_000, maxRisk: 'medium' });
    const d = resolveAutonomy({ ...base, external: true, monetaryImpact: 5_000, risk: 'medium' }, [g]);
    expect(d.mayExecute).toBe(true);
  });

  it('halts every grant in one step', () => {
    const grants = [
      grant('tenant-a', AutonomyLevel.AUTONOMOUS),
      grant('tenant-a', AutonomyLevel.EXECUTE, { actionType: 'x' }),
      grant('tenant-b', AutonomyLevel.EXECUTE),
    ];
    const halted = haltAll(grants, 'tenant-a');
    expect(halted.filter((g) => g.tenantId === 'tenant-a').every((g) => g.level === AutonomyLevel.OBSERVE)).toBe(true);
    // Another tenant is untouched by a tenant-scoped halt.
    expect(halted.find((g) => g.tenantId === 'tenant-b')!.level).toBe(AutonomyLevel.EXECUTE);

    expect(haltAll(grants, null).every((g) => g.level === AutonomyLevel.OBSERVE)).toBe(true);
  });
});
