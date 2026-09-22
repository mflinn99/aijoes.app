import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { getCustomer, setCustomerServices } from '@/lib/db/repositories/tenant-data';
import { MSP_SERVICES } from '@/lib/analysis/engines/msp-expand';
import { audit } from '@/lib/observability/events';

export const dynamic = 'force-dynamic';

type Body = { action: 'set-services'; customerId: string; services: string[] };

export async function POST(request: Request) {
  const guard = await guardRoute(request, 'analyse');
  if (!guard.ok) return guard.response;
  const { db: database, session } = guard;

  const body = (await request.json().catch(() => ({}))) as Body;
  if (body.action !== 'set-services') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  const customer = getCustomer(database, body.customerId);
  if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });

  const valid = new Set(MSP_SERVICES.map((s) => s.id));
  const services = (body.services ?? []).filter((s) => valid.has(s));

  setCustomerServices(database, body.customerId, services);

  audit(database, {
    actor: session.email,
    actorKind: 'human',
    action: 'customer.services-updated',
    subjectType: 'customer',
    subjectId: body.customerId,
    detail: { services },
  });

  return NextResponse.json({ ok: true, services });
}
