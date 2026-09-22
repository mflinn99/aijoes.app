import { NextResponse } from 'next/server';
import { oidcConfig, consumeState, exchangeCode, verifyIdToken, resolveIdentity, subjectFingerprint } from '@/lib/auth/oidc';
import { issueSession, SESSION_TTL_HOURS } from '@/lib/auth/sessions';
import { SESSION_COOKIE } from '@/lib/auth/constants';
import { audit } from '@/lib/observability/events';
import { TenantDb } from '@/lib/db/tenant';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

function failure(reason: string): NextResponse {
  // The reason goes on the sign-in screen, not into an open redirect.
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(reason)}`, process.env.METAMSP_BASE_URL ?? 'http://localhost:3000'),
  );
}

export async function GET(request: Request) {
  const config = oidcConfig();
  if (!config) return failure('Single sign-on is not configured.');

  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) return failure(`The identity provider refused the sign-in (${error}).`);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return failure('The sign-in response was incomplete.');

  const consumed = consumeState(state);
  if (!consumed) return failure('That sign-in link has expired or was already used.');

  try {
    const { id_token } = await exchangeCode(config, code);
    const claims = await verifyIdToken(id_token, config, consumed.nonce);
    const user = await resolveIdentity(claims, config);

    const session = issueSession(
      { userId: user.id, tenantId: user.tenantId },
      { userAgent: request.headers.get('user-agent') ?? undefined },
    );

    audit(new TenantDb({ tenantId: user.tenantId, userId: user.id, role: user.role }, getDb()), {
      actor: user.email,
      actorKind: 'human',
      action: 'auth.signed-in',
      subjectType: 'user',
      subjectId: user.id,
      detail: { idp: 'oidc', subject: subjectFingerprint(claims.sub) },
    });

    const response = NextResponse.redirect(
      new URL(consumed.redirectTo, process.env.METAMSP_BASE_URL ?? url.origin),
    );
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_HOURS * 3600,
    });
    return response;
  } catch (err) {
    return failure(err instanceof Error ? err.message : 'Single sign-on failed.');
  }
}
