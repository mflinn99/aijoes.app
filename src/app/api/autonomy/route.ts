import { NextResponse } from 'next/server';
import { db, DEMO_USER_ID } from '@/lib/session';
import { haltTenant } from '@/lib/db/repositories/tenant-data';
import { audit } from '@/lib/observability/events';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as { action?: string };
  const database = db();

  if (body.action === 'halt') {
    const count = haltTenant(database);
    audit(database, {
      actor: DEMO_USER_ID,
      actorKind: 'human',
      action: 'autonomy.halted',
      subjectType: 'tenant',
      subjectId: database.ctx.tenantId,
      detail: { grantsAffected: count },
    });
    return NextResponse.json({ ok: true, grantsAffected: count });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
