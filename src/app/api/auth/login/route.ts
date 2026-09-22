import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/users';
import { issueSession, SESSION_COOKIE, SESSION_TTL_HOURS } from '@/lib/auth/sessions';
import { rateLimit, LOGIN_LIMIT } from '@/lib/rate-limit';
import { audit } from '@/lib/observability/events';
import { TenantDb } from '@/lib/db/tenant';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const limit = rateLimit(`login:${ip ?? 'unknown'}`, LOGIN_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Please wait before trying again.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const outcome = await authenticate(body.email, body.password, ip);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason }, { status: outcome.locked ? 429 : 401 });
  }

  const session = issueSession(outcome.identity, {
    userAgent: request.headers.get('user-agent') ?? undefined,
    ip: ip ?? undefined,
  });

  audit(new TenantDb(
    { tenantId: outcome.identity.tenantId, userId: outcome.identity.userId, role: outcome.identity.role },
    getDb(),
  ), {
    actor: outcome.identity.email,
    actorKind: 'human',
    action: 'auth.signed-in',
    subjectType: 'user',
    subjectId: outcome.identity.userId,
    detail: { ip, idp: 'local' },
  });

  const response = NextResponse.json({
    ok: true,
    user: { name: outcome.identity.name, email: outcome.identity.email, role: outcome.identity.role },
  });

  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600,
  });

  return response;
}
