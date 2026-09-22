import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { getRun } from '@/lib/analysis/pipeline';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await guardRoute(request, 'read');
  if (!guard.ok) return guard.response;

  const { runId } = await params;
  const run = getRun(guard.db, runId);
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(run);
}
