import { NextResponse } from 'next/server';
import { db } from '@/lib/session';
import { getRun } from '@/lib/analysis/pipeline';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(db(), runId);
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(run);
}
