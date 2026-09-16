import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { TenantDb, type TenantContext } from '@/lib/db/tenant';
import { AutonomyLevel, type AutonomyGrant } from '@/lib/core/autonomy';
import { saveGrant, upsertCustomer } from '@/lib/db/repositories/tenant-data';

export interface Harness {
  raw: Database;
  db: TenantDb;
  ctx: TenantContext;
}

export function harness(tenantId = 'tenant-a', role: TenantContext['role'] = 'MSP_ADMIN', raw?: Database): Harness {
  const database = raw ?? createTestDb();
  const now = new Date().toISOString();
  database
    .prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES (?, ?, 'MSP', ?) ON CONFLICT(id) DO NOTHING`)
    .run(tenantId, `Tenant ${tenantId}`, now);

  const ctx: TenantContext = { tenantId, userId: `user-${tenantId}`, role };
  database
    .prepare(`INSERT INTO users (id, tenant_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run(ctx.userId, tenantId, `${ctx.userId}@example.com`, 'Test User', role, now);

  return { raw: database, db: new TenantDb(ctx, database), ctx };
}

export function grant(tenantId: string, level: AutonomyLevel, overrides: Partial<AutonomyGrant> = {}): AutonomyGrant {
  return {
    id: `${tenantId}-grant-${level}-${overrides.actionType ?? 'all'}`,
    tenantId,
    userId: null,
    actionType: null,
    capabilityId: null,
    level,
    monetaryThreshold: 1_000_000,
    maxRisk: 'high',
    grantedBy: 'test',
    grantedAt: new Date().toISOString(),
    expiresAt: null,
    ...overrides,
  };
}

export function seedGrant(h: Harness, level: AutonomyLevel, overrides: Partial<AutonomyGrant> = {}): AutonomyGrant {
  const g = grant(h.ctx.tenantId, level, overrides);
  saveGrant(h.db, g);
  return g;
}

export function seedCustomer(h: Harness, id: string, name: string, domain: string, mrr = 1000): void {
  upsertCustomer(h.db, { id, name, domain, currentMrr: mrr, relationshipNote: null, renewalDate: null });
}
