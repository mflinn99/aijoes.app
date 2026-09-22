import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { getOpportunity } from '@/lib/db/repositories/company';
import { listGrants, listConnectorConfigs } from '@/lib/db/repositories/tenant-data';
import { planExecution, authorisePlan, runExecution, approveTask, stopPlan } from '@/lib/execution/engine';
import type { Permission } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

type Body =
  | { action: 'plan'; opportunityId: string }
  | { action: 'authorise'; planId: string; rationale: string }
  | { action: 'run'; planId: string }
  | { action: 'approve'; planId: string; taskId: string; decision: 'APPROVED' | 'REJECTED'; rationale: string }
  | { action: 'stop'; planId: string; reason: string };

/**
 * Authorising a plan and approving a gate commit money and reach a customer, so
 * they need the "authorise" permission. Planning, running and stopping are the
 * work, and an MSP user does the work. Stopping is deliberately not privileged:
 * an emergency stop that needs an administrator is not an emergency stop.
 */
const PERMISSION: Record<Body['action'], Permission> = {
  plan: 'execute',
  authorise: 'authorise',
  approve: 'authorise',
  run: 'execute',
  stop: 'halt',
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const permission = PERMISSION[body.action];
  if (!permission) return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const guard = await guardRoute(request, permission);
  if (!guard.ok) return guard.response;
  const { db: database, session } = guard;
  const userId = session.context.userId;

  try {
    switch (body.action) {
      case 'plan': {
        const opportunity = getOpportunity(database, body.opportunityId);
        if (!opportunity) return NextResponse.json({ error: 'opportunity not found' }, { status: 404 });
        return NextResponse.json(
          planExecution(database, {
            opportunity,
            grants: listGrants(database),
            connectedIntegrations: listConnectorConfigs(database).filter((c) => c.enabled).map((c) => c.connectorId),
            userId,
          }),
        );
      }
      case 'authorise':
        return NextResponse.json(authorisePlan(database, body.planId, userId, body.rationale));
      case 'run':
        return NextResponse.json(await runExecution(database, body.planId, userId));
      case 'approve':
        return NextResponse.json(approveTask(database, body.planId, body.taskId, userId, body.decision, body.rationale));
      case 'stop':
        return NextResponse.json(stopPlan(database, body.planId, userId, body.reason));
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
