import { NextResponse } from 'next/server';
import { oidcConfig, beginAuth } from '@/lib/auth/oidc';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider !== 'oidc') {
    return NextResponse.json({ error: 'Unknown identity provider.' }, { status: 404 });
  }

  const config = oidcConfig();
  if (!config) {
    return NextResponse.json({ error: 'Single sign-on is not configured on this deployment.' }, { status: 503 });
  }

  const redirectTo = new URL(request.url).searchParams.get('next') ?? '/';

  try {
    const auth = await beginAuth(config, redirectTo);
    return NextResponse.redirect(auth.url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not start single sign-on.' },
      { status: 502 },
    );
  }
}
