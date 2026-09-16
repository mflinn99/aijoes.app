import { NextResponse } from 'next/server';
import { db, DEMO_USER_ID } from '@/lib/session';
import { getOpportunity } from '@/lib/db/repositories/company';
import { listGrants, listConnectorConfigs } from '@/lib/db/repositories/tenant-data';
import { planExecution, authorisePlan, runExecution, approveTask, stopPlan } from '@/lib/execution/engine';

export const dynamic = 'force-dynamic';

type Body =
  | { action: 'plan'; opportunityId: string }
  | { action: 'authorise'; planId: string; rationale: string }
  | { action: 'run'; planId: string }
  | { action: 'approve'; planId: string; taskId: string; decision: 'APPROVED' | 'REJECTED'; rationale: string }
  | { action: 'stop'; planId: string; reason: string };

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const database = db();

  try {
    switch (body.action) {
      case 'plan': {
        const opportunity = getOpportunity(database, body.opportunityId);
        if (!opportunity) return NextResponse.json({ error: 'opportunity not found' }, { status: 404 });
        const preview = planExecution(database, {
          opportunity,
          grants: listGrants(database),
          connectedIntegrations: listConnectorConfigs(database).filter((c) => c.enabled).map((c) => c.connectorId),
          userId: DEMO_USER_ID,
        });
        return NextResponse.json(preview);
      }
      case 'authorise':
        return NextResponse.json(authorisePlan(database, body.planId, DEMO_USER_ID, body.rationale));
      case 'run':
        return NextResponse.json(await runExecution(database, body.planId, DEMO_USER_ID));
      case 'approve':
        return NextResponse.json(approveTask(database, body.planId, body.taskId, DEMO_USER_ID, body.decision, body.rationale));
      case 'stop':
        return NextResponse.json(stopPlan(database, body.planId, DEMO_USER_ID, body.reason));
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
