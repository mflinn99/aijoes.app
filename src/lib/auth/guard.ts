/**
 * Request guards.
 *
 * Pages redirect to the login screen; route handlers return a status. Both go
 * through the same resolution and the same permission matrix, so a page and its
 * API cannot drift apart.
 */

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { TenantDb } from '../db/tenant';
import { getDb } from '../db/client';
import { SESSION_COOKIE, csrfMatches, resolveSession, type ResolvedSession } from './sessions';
import { can, type Permission } from './rbac';

export { CSRF_HEADER } from './constants';
import { CSRF_HEADER } from './constants';

export async function currentSession(): Promise<ResolvedSession | null> {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value, getDb());
}

/** For pages. Redirects an unauthenticated visitor to sign in. */
export async function requireSession(returnTo?: string): Promise<ResolvedSession> {
  const session = await currentSession();
  if (!session) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  return session;
}

/** For pages. Redirects on no session; renders a 403 page on insufficient role. */
export async function requirePermission(permission: Permission): Promise<ResolvedSession> {
  const session = await requireSession();
  if (!can(session.context.role, permission)) {
    redirect(`/forbidden?permission=${permission}`);
  }
  return session;
}

/** Tenant-scoped database for the signed-in user. */
export async function db(): Promise<TenantDb> {
  const session = await requireSession();
  return new TenantDb(session.context, getDb());
}

export async function tenantDbFor(session: ResolvedSession): Promise<TenantDb> {
  return new TenantDb(session.context, getDb());
}

// --- route handlers --------------------------------------------------------

export interface GuardFailure {
  response: NextResponse;
}

export type GuardResult =
  | { ok: true; session: ResolvedSession; db: TenantDb }
  | { ok: false; response: NextResponse };

/**
 * Guard a route handler. `permission` is checked against the signed-in role,
 * and every mutating request must carry the session's CSRF token.
 */
export async function guardRoute(
  request: Request,
  permission: Permission,
  options: { requireCsrf?: boolean } = {},
): Promise<GuardResult> {
  const session = await currentSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }),
    };
  }

  const requireCsrf = options.requireCsrf ?? request.method !== 'GET';
  if (requireCsrf) {
    const supplied = request.headers.get(CSRF_HEADER);
    if (!csrfMatches(session.session.csrfToken, supplied)) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid or missing CSRF token.' }, { status: 403 }),
      };
    }
  }

  if (!can(session.context.role, permission)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Your role (${session.context.role}) cannot perform this action.`,
          requiredPermission: permission,
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session, db: new TenantDb(session.context, getDb()) };
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return h.get('x-real-ip');
}
