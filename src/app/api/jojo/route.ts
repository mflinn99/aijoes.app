import { NextResponse } from 'next/server';
import { db } from '@/lib/session';
import { askJojo } from '@/lib/jojo/orchestrator';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as { objective?: string; companyId?: string };
  if (!body.objective) {
    return NextResponse.json({ error: 'objective is required' }, { status: 400 });
  }
  const result = askJojo(db(), body.objective, body.companyId);
  return NextResponse.json(result);
}
