import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { askGtm } from '@/lib/gtm/ask';
import { ONWARD } from '@/config/msp/onward';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Asking only reads. A read-only user may do it.
  const guard = await guardRoute(request, 'read');
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as { question?: string };
  if (!body.question) return NextResponse.json({ error: 'question is required' }, { status: 400 });

  return NextResponse.json(askGtm(guard.db, body.question, ONWARD.id));
}
