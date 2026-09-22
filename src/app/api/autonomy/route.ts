import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { haltTenant, saveGrant, listGrants } from '@/lib/db/repositories/tenant-data';
import { audit } from '@/lib/observability/events';
import type { AutonomyLevel } from '@/lib/core/autonomy';

export const dynamic = 'force-dynamic';

type Body =
  | { action: 'halt' }
  | {
      action: 'grant';
      id: string;
      level: AutonomyLevel;
      actionType?: string | null;
      capabilityId?: string | null;
      monetaryThreshold: number;
      maxRisk: 'low' | 'medium' | 'high';
    };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  // Halting is a safety control and stays available to anyone who can act.
  // Widening autonomy is an administrative decision.
  const permission = body.action === 'halt' ? 'halt' : body.action === 'grant' ? 'administer' : null;
  if (!permission) return NextResponse.json({ error: 'unknown action' }, { status: 400 });

  const guard = await guardRoute(request, permission);
  if (!guard.ok) return guard.response;
  const { db: database, session } = guard;

  if (body.action === 'halt') {
    const count = haltTenant(database);
    audit(database, {
      actor: session.email,
      actorKind: 'human',
      action: 'autonomy.halted',
      subjectType: 'tenant',
      subjectId: session.context.tenantId,
      detail: { grantsAffected: count },
    });
    return NextResponse.json({ ok: true, grantsAffected: count });
  }

  const existing = listGrants(database).find((g) => g.id === body.id);
  saveGrant(database, {
    id: body.id,
    tenantId: session.context.tenantId,
    userId: existing?.userId ?? null,
    actionType: body.actionType ?? existing?.actionType ?? null,
    capabilityId: body.capabilityId ?? existing?.capabilityId ?? null,
    level: body.level,
    monetaryThreshold: body.monetaryThreshold,
    maxRisk: body.maxRisk,
    grantedBy: session.email,
    grantedAt: new Date().toISOString(),
    expiresAt: existing?.expiresAt ?? null,
  });

  audit(database, {
    actor: session.email,
    actorKind: 'human',
    action: 'autonomy.granted',
    subjectType: 'autonomy_grant',
    subjectId: body.id,
    detail: { level: body.level, monetaryThreshold: body.monetaryThreshold, maxRisk: body.maxRisk },
  });

  return NextResponse.json({ ok: true });
}
