import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { runLoop } from '@/lib/gtm/loop';
import { ONWARD } from '@/config/msp/onward';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Running the loop creates records and drafts messages, so it needs the
 * 'execute' permission — not 'read'. It cannot send anything: the outreach layer
 * refuses to send without an approved provider regardless of who asked.
 */
export async function POST(request: Request) {
  const guard = await guardRoute(request, 'execute');
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    discover?: number; research?: number; outreach?: number; sourceId?: string;
  };

  const report = await runLoop(guard.db, {
    mspId: ONWARD.id,
    profile: ONWARD,
    ...(body.sourceId ? { sourceId: body.sourceId } : {}),
    discover: Math.min(body.discover ?? 10, 100),
    research: Math.min(body.research ?? 10, 100),
    outreach: Math.min(body.outreach ?? 5, 25),
  });

  return NextResponse.json(report);
}
