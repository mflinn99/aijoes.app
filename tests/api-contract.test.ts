/**
 * Route handler contracts and route-level RBAC.
 *
 * These run the real handlers with a real session cookie, so they prove what
 * iteration 1 only claimed: a READ_ONLY user cannot mutate anything, an
 * MSP_USER cannot authorise, and no request works without CSRF.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.METAMSP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'metamsp-')), 'test.db');
process.env.METAMSP_DISABLE_WORKER = '1';

/** The cookie jar the mocked next/headers reads from. */
const jar = { token: '' as string };

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'metamsp_session' && jar.token ? { value: jar.token } : undefined) }),
  headers: async () => new Headers(),
}));

interface Actor {
  token: string;
  csrf: string;
  userId: string;
}

const actors: Record<string, Actor> = {};

function as(role: keyof typeof actors): void {
  jar.token = actors[role]!.token;
}

function req(url: string, body: unknown, opts: { role?: keyof typeof actors; csrf?: string | null; method?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const csrf = opts.csrf === null ? null : (opts.csrf ?? actors[opts.role ?? 'admin']!.csrf);
  if (csrf) headers['x-metamsp-csrf'] = csrf;
  return new Request(url, { method: opts.method ?? 'POST', headers, body: JSON.stringify(body) });
}

beforeAll(async () => {
  const { getDb } = await import('@/lib/db/client');
  const { createUser } = await import('@/lib/auth/users');
  const { issueSession } = await import('@/lib/auth/sessions');
  const { DEMO_TENANT_ID } = await import('@/lib/session');
  const { saveGrant, setConnectorConfig } = await import('@/lib/db/repositories/tenant-data');
  const { AutonomyLevel } = await import('@/lib/core/autonomy');

  const raw = getDb();
  raw.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES (?, 'Test MSP', 'MSP', ?) ON CONFLICT(id) DO NOTHING`)
    .run(DEMO_TENANT_ID, new Date().toISOString());

  for (const [key, role] of [['admin', 'MSP_ADMIN'], ['user', 'MSP_USER'], ['viewer', 'READ_ONLY']] as const) {
    const u = await createUser({
      tenantId: DEMO_TENANT_ID, email: `${key}@example.com`, name: key, role, password: 'a-long-enough-password',
    }, raw);
    const s = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, raw);
    actors[key] = { token: s.token, csrf: s.csrfToken, userId: u.id };
  }

  const { TenantDb } = await import('@/lib/db/tenant');
  const db = new TenantDb({ tenantId: DEMO_TENANT_ID, userId: actors['admin']!.userId, role: 'MSP_ADMIN' }, raw);
  saveGrant(db, {
    id: 'seed-grant', tenantId: DEMO_TENANT_ID, userId: null, actionType: null, capabilityId: null,
    level: AutonomyLevel.RECOMMEND, monetaryThreshold: 0, maxRisk: 'low',
    grantedBy: 'test', grantedAt: new Date().toISOString(), expiresAt: null,
  });
  setConnectorConfig(db, 'website', true, 'available');
});

// ---------------------------------------------------------------- auth ------

describe('authentication at the route layer', () => {
  it('refuses every route without a session', async () => {
    jar.token = '';
    const { POST: jojo } = await import('@/app/api/jojo/route');
    const { POST: execution } = await import('@/app/api/execution/route');
    const { POST: analyse } = await import('@/app/api/analyse/route');

    expect((await jojo(req('http://t/api/jojo', { objective: 'x' }, { csrf: 'anything' }))).status).toBe(401);
    expect((await execution(req('http://t/api/execution', { action: 'plan', opportunityId: 'x' }, { csrf: 'anything' }))).status).toBe(401);
    expect((await analyse(req('http://t/api/analyse', { input: 'x' }, { csrf: 'anything' }))).status).toBe(401);
  });

  it('refuses a mutating request with no CSRF token', async () => {
    as('admin');
    const { POST } = await import('@/app/api/analyse/route');
    const res = await POST(req('http://t/api/analyse', { input: 'example.com' }, { csrf: null }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/CSRF/i);
  });

  it('refuses a request carrying another session\'s CSRF token', async () => {
    as('admin');
    const { POST } = await import('@/app/api/analyse/route');
    const res = await POST(req('http://t/api/analyse', { input: 'example.com' }, { csrf: actors['user']!.csrf }));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------- RBAC ------

describe('READ_ONLY cannot mutate anything', () => {
  const cases: { name: string; module: string; body: unknown }[] = [
    { name: 'analyse', module: '@/app/api/analyse/route', body: { input: 'example.com' } },
    { name: 'plan an execution', module: '@/app/api/execution/route', body: { action: 'plan', opportunityId: 'x' } },
    { name: 'run an execution', module: '@/app/api/execution/route', body: { action: 'run', planId: 'x' } },
    { name: 'authorise a plan', module: '@/app/api/execution/route', body: { action: 'authorise', planId: 'x', rationale: 'r' } },
    { name: 'approve a gate', module: '@/app/api/execution/route', body: { action: 'approve', planId: 'x', taskId: 't', decision: 'APPROVED', rationale: 'r' } },
    { name: 'stop a plan', module: '@/app/api/execution/route', body: { action: 'stop', planId: 'x', reason: 'r' } },
    { name: 'halt autonomy', module: '@/app/api/autonomy/route', body: { action: 'halt' } },
    { name: 'grant autonomy', module: '@/app/api/autonomy/route', body: { action: 'grant', id: 'g', level: 3, monetaryThreshold: 1, maxRisk: 'low' } },
    { name: 'manage users', module: '@/app/api/users/route', body: { action: 'create', email: 'x@y.z', name: 'X', role: 'MSP_ADMIN', password: 'a-long-enough-password' } },
  ];

  for (const c of cases) {
    it(`cannot ${c.name}`, async () => {
      as('viewer');
      const { POST } = (await import(c.module)) as { POST: (r: Request) => Promise<Response> };
      const res = await POST(req('http://t/api', c.body, { role: 'viewer' }));
      expect(res.status, `${c.name} should be forbidden for READ_ONLY`).toBe(403);
      expect((await res.json()).requiredPermission).toBeTruthy();
    });
  }

  it('can still read', async () => {
    as('viewer');
    const { POST } = await import('@/app/api/jojo/route');
    const res = await POST(req('http://t/api/jojo', { objective: 'find £10,000 of savings' }, { role: 'viewer' }));
    expect(res.status).toBe(200);
  });
});

describe('MSP_USER can act but not authorise', () => {
  it('may analyse and plan', async () => {
    as('user');
    const { POST } = await import('@/app/api/analyse/route');
    const res = await POST(req('http://t/api/analyse', { input: 'northbridge-advisory.co.uk' }, { role: 'user' }));
    expect(res.status).toBe(200);
  });

  it('may halt autonomy — an emergency stop is not an administrator-only control', async () => {
    as('user');
    const { POST } = await import('@/app/api/autonomy/route');
    const res = await POST(req('http://t/api/autonomy', { action: 'halt' }, { role: 'user' }));
    expect(res.status).toBe(200);
  });

  it('may not authorise a plan or approve a gate', async () => {
    as('user');
    const { POST } = await import('@/app/api/execution/route');
    expect((await POST(req('http://t/api/execution', { action: 'authorise', planId: 'x', rationale: 'r' }, { role: 'user' }))).status).toBe(403);
    expect((await POST(req('http://t/api/execution', { action: 'approve', planId: 'x', taskId: 't', decision: 'APPROVED', rationale: 'r' }, { role: 'user' }))).status).toBe(403);
  });

  it('may not widen autonomy or manage users', async () => {
    as('user');
    const { POST: autonomy } = await import('@/app/api/autonomy/route');
    const { POST: users } = await import('@/app/api/users/route');
    expect((await autonomy(req('http://t/api/autonomy', { action: 'grant', id: 'g', level: 3, monetaryThreshold: 1, maxRisk: 'low' }, { role: 'user' }))).status).toBe(403);
    expect((await users(req('http://t/api/users', { action: 'create', email: 'a@b.c', name: 'A', role: 'MSP_USER', password: 'a-long-enough-password' }, { role: 'user' }))).status).toBe(403);
  });
});

// ------------------------------------------------------------ contracts -----

describe('POST /api/analyse', () => {
  it('rejects an empty input', async () => {
    as('admin');
    const { POST } = await import('@/app/api/analyse/route');
    expect((await POST(req('http://t/api/analyse', { input: '   ' }, { role: 'admin' }))).status).toBe(400);
  });

  it('queues a durable job and completes when the worker drains it', async () => {
    as('admin');
    const { POST } = await import('@/app/api/analyse/route');
    const { GET } = await import('@/app/api/analyse/[runId]/route');
    const { drain } = await import('@/lib/jobs/runner');
    const { SYNTHETIC_COMPANIES } = await import('@/lib/fixtures/synthetic');

    const started = await POST(req('http://t/api/analyse', { input: SYNTHETIC_COMPANIES[0]!.domain }, { role: 'admin' }));
    expect(started.status).toBe(200);
    const { runId } = await started.json();

    await drain();

    const polled = await GET(
      new Request('http://t', { headers: { 'x-metamsp-csrf': actors['admin']!.csrf } }),
      { params: Promise.resolve({ runId }) },
    );
    expect(polled.status).toBe(200);
    const run = await polled.json();
    expect(run.status).toBe('completed');
    expect(run.stages).toHaveLength(11);
    expect(run.companyId).toBeTruthy();
  });

  it('404s for an unknown run', async () => {
    as('admin');
    const { GET } = await import('@/app/api/analyse/[runId]/route');
    const res = await GET(
      new Request('http://t', { headers: { 'x-metamsp-csrf': actors['admin']!.csrf } }),
      { params: Promise.resolve({ runId: 'no-such-run' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/execution', () => {
  it('404s for an unknown opportunity and 400s for an unknown action', async () => {
    as('admin');
    const { POST } = await import('@/app/api/execution/route');
    expect((await POST(req('http://t/api/execution', { action: 'plan', opportunityId: 'nope' }, { role: 'admin' }))).status).toBe(404);
    expect((await POST(req('http://t/api/execution', { action: 'launch-the-missiles' }, { role: 'admin' }))).status).toBe(400);
  });

  it('plans, authorises and runs through the real contract', async () => {
    as('admin');
    const { POST } = await import('@/app/api/execution/route');
    const { db } = await import('@/lib/session');
    const { listOpportunities } = await import('@/lib/db/repositories/company');
    const { startAvailable } = await import('@/lib/core/opportunity');

    const opportunity = listOpportunities(await db()).find((o) => startAvailable(o).available);
    expect(opportunity).toBeDefined();

    const planned = await POST(req('http://t/api/execution', { action: 'plan', opportunityId: opportunity!.id }, { role: 'admin' }));
    expect(planned.status).toBe(200);
    const preview = await planned.json();
    expect(preview.plan.tasks.length).toBeGreaterThan(0);

    const authorised = await POST(req('http://t/api/execution', { action: 'authorise', planId: preview.plan.id, rationale: 'contract test' }, { role: 'admin' }));
    expect(authorised.status).toBe(200);
    expect((await authorised.json()).status).toBe('AUTHORISED');

    const ran = await POST(req('http://t/api/execution', { action: 'run', planId: preview.plan.id }, { role: 'admin' }));
    expect(ran.status).toBe(200);
    const result = await ran.json();
    expect(result).toHaveProperty('plan.status');
    expect(result).toHaveProperty('measuredValueGbp');
  });
});

describe('POST /api/users', () => {
  it('creates a user, rejects a duplicate and rejects a weak password', async () => {
    as('admin');
    const { POST } = await import('@/app/api/users/route');

    const created = await POST(req('http://t/api/users', { action: 'create', email: 'new@example.com', name: 'New', role: 'MSP_USER', password: 'a-long-enough-password' }, { role: 'admin' }));
    expect(created.status).toBe(200);

    const duplicate = await POST(req('http://t/api/users', { action: 'create', email: 'new@example.com', name: 'New', role: 'MSP_USER', password: 'a-long-enough-password' }, { role: 'admin' }));
    expect(duplicate.status).toBe(409);

    const weak = await POST(req('http://t/api/users', { action: 'create', email: 'weak@example.com', name: 'W', role: 'MSP_USER', password: 'short' }, { role: 'admin' }));
    expect(weak.status).toBe(400);
  });

  it('will not let an administrator demote or disable themselves', async () => {
    as('admin');
    const { POST } = await import('@/app/api/users/route');
    const demote = await POST(req('http://t/api/users', { action: 'set-role', userId: actors['admin']!.userId, role: 'READ_ONLY' }, { role: 'admin' }));
    expect(demote.status).toBe(400);
    const disable = await POST(req('http://t/api/users', { action: 'set-status', userId: actors['admin']!.userId, status: 'disabled' }, { role: 'admin' }));
    expect(disable.status).toBe(400);
  });
});

describe('POST /api/autonomy', () => {
  it('halts every grant for an administrator', async () => {
    as('admin');
    const { POST } = await import('@/app/api/autonomy/route');
    const { db } = await import('@/lib/session');
    const { listGrants } = await import('@/lib/db/repositories/tenant-data');

    const res = await POST(req('http://t/api/autonomy', { action: 'halt' }, { role: 'admin' }));
    expect(res.status).toBe(200);
    expect(listGrants(await db()).every((g) => g.level === 0)).toBe(true);
  });
});
