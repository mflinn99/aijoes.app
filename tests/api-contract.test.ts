/** Directive §27: API contract tests. Route handlers are exercised directly. */

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Route handlers use the shared session db, so point it at a scratch file.
process.env.METAMSP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'metamsp-')), 'test.db');

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  const { getDb } = await import('@/lib/db/client');
  const { DEMO_TENANT_ID, DEMO_USER_ID } = await import('@/lib/session');
  const raw = getDb();
  const now = new Date().toISOString();
  raw.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES (?, ?, 'MSP', ?) ON CONFLICT(id) DO NOTHING`).run(DEMO_TENANT_ID, 'Test MSP', now);
  raw.prepare(`INSERT INTO users (id, tenant_id, email, name, role, created_at) VALUES (?, ?, ?, ?, 'MSP_ADMIN', ?) ON CONFLICT(id) DO NOTHING`).run(DEMO_USER_ID, DEMO_TENANT_ID, 'test@example.com', 'Test', now);
});

describe('POST /api/jojo', () => {
  it('rejects a request with no objective', async () => {
    const { POST } = await import('@/app/api/jojo/route');
    const res = await POST(jsonRequest('http://test/api/jojo', {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/objective is required/);
  });

  it('returns the objective, steps, selection and answer', async () => {
    const { POST } = await import('@/app/api/jojo/route');
    const res = await POST(jsonRequest('http://test/api/jojo', { objective: 'find £10,000 of savings' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('objective.kind', 'find-savings');
    expect(body).toHaveProperty('steps');
    expect(Array.isArray(body.steps)).toBe(true);
    expect(body).toHaveProperty('answer');
    expect(body).toHaveProperty('achievable');
  });
});

describe('POST /api/analyse', () => {
  it('rejects an empty input', async () => {
    const { POST } = await import('@/app/api/analyse/route');
    const res = await POST(jsonRequest('http://test/api/analyse', { input: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns a run id that can then be polled to completion', async () => {
    const { POST } = await import('@/app/api/analyse/route');
    const { GET } = await import('@/app/api/analyse/[runId]/route');
    const { SYNTHETIC_COMPANIES } = await import('@/lib/fixtures/synthetic');

    const started = await POST(jsonRequest('http://test/api/analyse', { input: SYNTHETIC_COMPANIES[0]!.domain }));
    expect(started.status).toBe(200);
    const { runId } = await started.json();
    expect(typeof runId).toBe('string');

    let run: { status: string; stages: unknown[]; companyId: string | null } | null = null;
    for (let i = 0; i < 60; i++) {
      const polled = await GET(new Request('http://test'), { params: Promise.resolve({ runId }) });
      expect(polled.status).toBe(200);
      run = await polled.json();
      if (run!.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(run!.status).toBe('completed');
    expect(run!.stages).toHaveLength(11);
    expect(run!.companyId).toBeTruthy();
  });

  it('404s for an unknown run', async () => {
    const { GET } = await import('@/app/api/analyse/[runId]/route');
    const res = await GET(new Request('http://test'), { params: Promise.resolve({ runId: 'no-such-run' }) });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/execution', () => {
  it('404s for an unknown opportunity', async () => {
    const { POST } = await import('@/app/api/execution/route');
    const res = await POST(jsonRequest('http://test/api/execution', { action: 'plan', opportunityId: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('rejects an unknown action', async () => {
    const { POST } = await import('@/app/api/execution/route');
    const res = await POST(jsonRequest('http://test/api/execution', { action: 'launch-the-missiles' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 with the reason when authorising a plan that does not exist', async () => {
    const { POST } = await import('@/app/api/execution/route');
    const res = await POST(jsonRequest('http://test/api/execution', { action: 'authorise', planId: 'nope', rationale: 'x' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not found/);
  });

  it('plans, authorises and runs through the real contract', async () => {
    const { POST } = await import('@/app/api/execution/route');
    const { db } = await import('@/lib/session');
    const { listOpportunities } = await import('@/lib/db/repositories/company');
    const { startAvailable } = await import('@/lib/core/opportunity');

    const opportunity = listOpportunities(db()).find((o) => startAvailable(o).available);
    expect(opportunity).toBeDefined();

    const planned = await POST(jsonRequest('http://test/api/execution', { action: 'plan', opportunityId: opportunity!.id }));
    expect(planned.status).toBe(200);
    const preview = await planned.json();
    expect(preview).toHaveProperty('plan.id');
    expect(preview).toHaveProperty('summary.taskCount');
    expect(preview.plan.tasks.length).toBeGreaterThan(0);

    const authorised = await POST(jsonRequest('http://test/api/execution', { action: 'authorise', planId: preview.plan.id, rationale: 'contract test' }));
    expect(authorised.status).toBe(200);
    expect((await authorised.json()).status).toBe('AUTHORISED');

    const ran = await POST(jsonRequest('http://test/api/execution', { action: 'run', planId: preview.plan.id }));
    expect(ran.status).toBe(200);
    const result = await ran.json();
    expect(result).toHaveProperty('plan.status');
    expect(result).toHaveProperty('measuredValueGbp');
    expect(result).toHaveProperty('totalCostGbp');
  });
});

describe('POST /api/autonomy', () => {
  it('halts every grant and rejects anything else', async () => {
    const { POST } = await import('@/app/api/autonomy/route');
    const { db } = await import('@/lib/session');
    const { saveGrant, listGrants } = await import('@/lib/db/repositories/tenant-data');
    const { AutonomyLevel } = await import('@/lib/core/autonomy');

    saveGrant(db(), {
      id: 'api-test-grant', tenantId: db().ctx.tenantId, userId: null, actionType: null, capabilityId: null,
      level: AutonomyLevel.EXECUTE, monetaryThreshold: 1000, maxRisk: 'high',
      grantedBy: 'test', grantedAt: new Date().toISOString(), expiresAt: null,
    });

    const res = await POST(jsonRequest('http://test/api/autonomy', { action: 'halt' }));
    expect(res.status).toBe(200);
    expect(listGrants(db()).every((g) => g.level === 0)).toBe(true);

    const bad = await POST(jsonRequest('http://test/api/autonomy', { action: 'grant-everything' }));
    expect(bad.status).toBe(400);
  });
});
