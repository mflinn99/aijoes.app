import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { verifyPlan } from '@/lib/verification/verify';

export const dynamic = 'force-dynamic';

/**
 * Verify now, rather than waiting for the measurement window. Used when the
 * customer's billing cycle has already turned, and by anyone who wants the
 * comparison on demand.
 */
export async function POST(request: Request) {
  const guard = await guardRoute(request, 'execute');
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as { executionPlanId?: string };
  if (!body.executionPlanId) {
    return NextResponse.json({ error: 'executionPlanId is required' }, { status: 400 });
  }

  return NextResponse.json(verifyPlan(guard.db, body.executionPlanId, guard.session.email));
}
