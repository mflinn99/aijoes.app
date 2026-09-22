import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revokeSession, SESSION_COOKIE } from '@/lib/auth/sessions';

export const dynamic = 'force-dynamic';

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) revokeSession(token);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
