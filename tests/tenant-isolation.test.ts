/** Directive §24: strict tenant isolation. */

import { describe, it, expect } from 'vitest';
import { harness, seedCustomer } from './helpers';
import { TenantDb, TenantIsolationError, assertTenantScoped, tablesReferenced, unscopedPlatformQuery } from '@/lib/db/tenant';
import { listCustomers } from '@/lib/db/repositories/tenant-data';
import { analyseCompany } from '@/lib/analysis/pipeline';
import { listOpportunities, listCompanies } from '@/lib/db/repositories/company';
import { SYNTHETIC_COMPANIES } from '@/lib/fixtures/synthetic';

describe('tenant isolation', () => {
  it('refuses a query against a scoped table with no tenant predicate', () => {
    expect(() => assertTenantScoped('SELECT * FROM customers')).toThrow(TenantIsolationError);
    expect(() => assertTenantScoped('SELECT * FROM opportunities WHERE score > 10')).toThrow(TenantIsolationError);
    expect(() => assertTenantScoped('DELETE FROM benefits')).toThrow(TenantIsolationError);
  });

  it('refuses a tenant predicate bound to a literal rather than the context parameter', () => {
    // The dangerous case: a caller scoping to someone else's tenant.
    expect(() => assertTenantScoped(`SELECT * FROM customers WHERE tenant_id = 'tenant-b'`)).toThrow(TenantIsolationError);
  });

  it('allows a query that binds tenant_id to the context parameter', () => {
    expect(() => assertTenantScoped('SELECT * FROM customers WHERE tenant_id = @tenantId')).not.toThrow();
    expect(() => assertTenantScoped('SELECT * FROM opportunities WHERE tenant_id = @tenantId AND id = @id')).not.toThrow();
  });

  it('allows unscoped queries against tables that hold no tenant data', () => {
    expect(() => assertTenantScoped('SELECT * FROM tenants')).not.toThrow();
  });

  it('requires an insert to carry the tenant column', () => {
    expect(() => assertTenantScoped('INSERT INTO customers (id, name) VALUES (@id, @name)')).toThrow(TenantIsolationError);
    expect(() =>
      assertTenantScoped('INSERT INTO customers (id, tenant_id, name) VALUES (@id, @tenantId, @name)'),
    ).not.toThrow();
  });

  it('identifies every table a statement touches', () => {
    expect(tablesReferenced('SELECT * FROM a JOIN b ON b.id = a.id')).toEqual(['a', 'b']);
    expect(tablesReferenced('UPDATE opportunities SET x = 1')).toEqual(['opportunities']);
  });

  it('never returns another tenant\'s rows through the scoped API', () => {
    const a = harness('tenant-a');
    const b = harness('tenant-b', 'MSP_ADMIN', a.raw);

    seedCustomer(a, 'cust-a', 'Alpha Ltd', 'alpha.example', 5000);
    seedCustomer(b, 'cust-b', 'Bravo Ltd', 'bravo.example', 7000);

    expect(listCustomers(a.db).map((c) => c.name)).toEqual(['Alpha Ltd']);
    expect(listCustomers(b.db).map((c) => c.name)).toEqual(['Bravo Ltd']);
  });

  it('cannot reach another tenant\'s analysis, even knowing its id', async () => {
    const a = harness('tenant-a');
    const b = harness('tenant-b', 'MSP_ADMIN', a.raw);
    const fixture = SYNTHETIC_COMPANIES[0]!;

    seedCustomer(a, 'cust-a', fixture.name, fixture.domain);
    const result = await analyseCompany(a.db, fixture.domain, {
      customerId: 'cust-a',
      offline: true,
      seedRecords: fixture.records,
      userSupplied: fixture.userSupplied,
    });

    expect(result.opportunities.length).toBeGreaterThan(0);
    // Tenant B knows the company id and still sees nothing.
    expect(listCompanies(b.db)).toHaveLength(0);
    expect(listOpportunities(b.db, result.twin.id)).toHaveLength(0);
  });

  it('gates the platform-wide escape hatch on PLATFORM_ADMIN', () => {
    const a = harness('tenant-a');
    seedCustomer(a, 'cust-a', 'Alpha Ltd', 'alpha.example');

    expect(() => unscopedPlatformQuery(a.ctx, 'SELECT * FROM customers', {}, a.raw)).toThrow(TenantIsolationError);

    const platform = new TenantDb({ tenantId: 'platform', userId: 'ops', role: 'PLATFORM_ADMIN' }, a.raw);
    expect(unscopedPlatformQuery(platform.ctx, 'SELECT * FROM customers', {}, a.raw)).toHaveLength(1);
  });

  it('rejects updates and deletes on the audit log', () => {
    const a = harness('tenant-a');
    a.raw
      .prepare(
        `INSERT INTO audit_log (id, tenant_id, actor, actor_kind, action, subject_type, subject_id, detail_json, at)
         VALUES ('a1', 'tenant-a', 'u', 'human', 'test', 'thing', 'x', '{}', '2026-01-01T00:00:00Z')`,
      )
      .run();

    expect(() => a.raw.prepare(`UPDATE audit_log SET action = 'tampered' WHERE id = 'a1'`).run()).toThrow(/append-only/);
    expect(() => a.raw.prepare(`DELETE FROM audit_log WHERE id = 'a1'`).run()).toThrow(/append-only/);
  });
});
