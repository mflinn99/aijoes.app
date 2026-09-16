/**
 * Session and tenant context.
 *
 * Authentication is out of scope for this build (no IdP is available in this
 * environment), so the demo MSP tenant is resolved from a cookie-free default.
 * The important part is that everything downstream of here already takes a
 * TenantContext, so swapping this for a real IdP changes this file only.
 */

import { TenantDb, type TenantContext } from './db/tenant';
import { getDb } from './db/client';

export const DEMO_TENANT_ID = 'tenant-onward-demo';
export const DEMO_USER_ID = 'user-demo';

export function currentContext(): TenantContext {
  return { tenantId: DEMO_TENANT_ID, userId: DEMO_USER_ID, role: 'MSP_ADMIN' };
}

export function db(): TenantDb {
  return new TenantDb(currentContext(), getDb());
}
