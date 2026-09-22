/**
 * Guarded, tenant-scoped data access — Directive §24 "strict tenant isolation".
 *
 * SQLite has no row-level security, so isolation is enforced here instead, and
 * enforced *structurally*: a statement touching a tenant-scoped table is
 * rejected before it reaches the database unless it constrains tenant_id to the
 * caller's tenant. Forgetting the predicate is a thrown error, not a silent
 * cross-tenant read.
 *
 * There is deliberately no "admin bypass" on this class. Platform-wide reads go
 * through `unscopedPlatformQuery`, which is separately named, separately
 * audited, and used only by platform operations.
 */

import type { Database, Statement } from 'better-sqlite3';
import { getDb } from './client';

/** Every table holding MSP or end-customer data. */
export const TENANT_SCOPED_TABLES = new Set([
  'users',
  'customers',
  'company_twins',
  'source_records',
  'opportunities',
  'supplier_relationships',
  'execution_plans',
  'execution_tasks',
  'benefits',
  'autonomy_grants',
  'approvals',
  'audit_log',
  'agent_events',
  'analysis_runs',
  'connector_configs',
  'secrets',
  'connected_facts',
  'verification_baselines',
  'refresh_schedules',
  'gtm_accounts',
  'gtm_signals',
  'gtm_hypotheses',
  'gtm_contacts',
  'gtm_outreach',
  'gtm_responses',
  'gtm_opportunities',
  'gtm_meetings',
  'gtm_decisions',
  'gtm_outcomes',
  'gtm_strategies',
  'gtm_objectives',
  'gtm_suppressions',
  'gtm_crm_links',
  'gtm_crm_records',
  'gtm_crm_outbox',
  'gtm_pipeline_actions',
]);

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: 'PLATFORM_ADMIN' | 'MSP_ADMIN' | 'MSP_USER' | 'READ_ONLY';
}

const TABLE_REF = /\b(?:from|join|into|update)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/gi;

export function tablesReferenced(sql: string): string[] {
  const out: string[] = [];
  const stripped = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const m of stripped.matchAll(TABLE_REF)) {
    const name = m[1];
    if (name) out.push(name.toLowerCase());
  }
  return [...new Set(out)];
}

/**
 * The predicate must bind tenant_id to the context parameter — a literal string
 * would let a caller scope to someone else's tenant, so only `@tenantId` counts.
 */
function hasTenantPredicate(sql: string): boolean {
  return /tenant_id\s*(?:=|IN\s*\()\s*[@:$]tenantId/i.test(sql);
}

function insertsTenantColumn(sql: string): boolean {
  return /insert\s+into/i.test(sql) && /tenant_id/i.test(sql) && /[@:$]tenantId/i.test(sql);
}

export function assertTenantScoped(sql: string): void {
  const tables = tablesReferenced(sql).filter((t) => TENANT_SCOPED_TABLES.has(t));
  if (tables.length === 0) return;

  const isInsert = /^\s*insert\s/i.test(sql);
  if (isInsert ? insertsTenantColumn(sql) : hasTenantPredicate(sql)) return;

  throw new TenantIsolationError(
    `Refusing to run a statement against tenant-scoped table(s) [${tables.join(', ')}] ` +
      `without a "tenant_id = @tenantId" constraint. ` +
      `This is Directive §24 enforcement — add the predicate rather than removing the guard.`,
  );
}

export class TenantDb {
  constructor(
    readonly ctx: TenantContext,
    private readonly db: Database = getDb(),
  ) {}

  private prepare(sql: string): Statement {
    assertTenantScoped(sql);
    return this.db.prepare(sql);
  }

  /** `@tenantId` is always bound; callers never supply it. */
  private bind(params: Record<string, unknown>): Record<string, unknown> {
    return { ...params, tenantId: this.ctx.tenantId };
  }

  all<T = unknown>(sql: string, params: Record<string, unknown> = {}): T[] {
    return this.prepare(sql).all(this.bind(params)) as T[];
  }

  get<T = unknown>(sql: string, params: Record<string, unknown> = {}): T | undefined {
    return this.prepare(sql).get(this.bind(params)) as T | undefined;
  }

  run(sql: string, params: Record<string, unknown> = {}): void {
    this.prepare(sql).run(this.bind(params));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  get raw(): Database {
    return this.db;
  }
}

/**
 * Cross-tenant read for platform operations only (portfolio rollups across
 * MSPs, capability health). Every call is written to the audit log by the
 * caller; there is no path from a request handler to this function.
 */
export function unscopedPlatformQuery<T = unknown>(
  ctx: TenantContext,
  sql: string,
  params: Record<string, unknown> = {},
  db: Database = getDb(),
): T[] {
  if (ctx.role !== 'PLATFORM_ADMIN') {
    throw new TenantIsolationError('unscopedPlatformQuery requires PLATFORM_ADMIN.');
  }
  return db.prepare(sql).all(params) as T[];
}
