import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { askJojo } from '@/lib/jojo/orchestrator';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Asking JoJo only reads: a read-only user may do it.
  const guard = await guardRoute(request, 'read');
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as { objective?: string; companyId?: string };
  if (!body.objective) {
    return NextResponse.json({ error: 'objective is required' }, { status: 400 });
  }
  return NextResponse.json(askJojo(guard.db, body.objective, body.companyId));
}
