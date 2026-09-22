/**
 * Session entry points.
 *
 * Iteration 1 resolved a fixed demo tenant here. It now resolves the signed-in
 * user's session; everything downstream already took a TenantContext, so this
 * file is the whole of the change.
 */

export { currentSession, requireSession, requirePermission, db, guardRoute, clientIp, CSRF_HEADER } from './auth/guard';
export { SESSION_COOKIE } from './auth/sessions';

/** Seed identifiers, used by the seed script and the first-run bootstrap. */
export const DEMO_TENANT_ID = 'tenant-onward-demo';
