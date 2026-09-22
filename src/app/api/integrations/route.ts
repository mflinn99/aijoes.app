import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { putSecret, deleteSecret, vaultConfigured, VaultUnconfiguredError } from '@/lib/secrets/vault';
import { SECRET_REFS } from '@/lib/discovery/registry';
import { Microsoft365Connector } from '@/lib/discovery/microsoft365-connector';
import { XeroConnector } from '@/lib/discovery/xero-connector';
import { HubspotConnector } from '@/lib/discovery/hubspot-connector';
import { setConnectorConfig } from '@/lib/db/repositories/tenant-data';
import { audit } from '@/lib/observability/events';

export const dynamic = 'force-dynamic';

type Body =
  | { action: 'connect'; connectorId: 'microsoft-365'; tenantId: string; clientId: string; clientSecret: string }
  | { action: 'connect'; connectorId: 'accounting'; xeroTenantId: string; clientId: string; clientSecret: string }
  | { action: 'connect'; connectorId: 'crm'; accessToken: string }
  | { action: 'disconnect'; connectorId: string };

export async function POST(request: Request) {
  const guard = await guardRoute(request, 'administer');
  if (!guard.ok) return guard.response;
  const { db: database, session } = guard;

  const body = (await request.json().catch(() => ({}))) as Body;

  try {
    if (body.action === 'connect') {
      if (!vaultConfigured()) throw new VaultUnconfiguredError();
      if (body.connectorId === 'microsoft-365') {
        if (!body.tenantId || !body.clientId || !body.clientSecret) {
          return NextResponse.json({ error: 'Tenant id, client id and client secret are all required.' }, { status: 400 });
        }
        const credentials = { tenantId: body.tenantId, clientId: body.clientId, clientSecret: body.clientSecret };

        // Prove the credentials work before storing them, so a typo surfaces
        // here rather than as a failed analysis later.
        const probe = await new Microsoft365Connector(credentials).discover();
        if (probe.status !== 'available') {
          return NextResponse.json({ error: `Could not connect: ${probe.detail}` }, { status: 400 });
        }

        putSecret(database, SECRET_REFS.microsoft365, credentials);
        setConnectorConfig(database, 'microsoft-365', true, 'available');
        audit(database, {
          actor: session.email, actorKind: 'human', action: 'integration.connected',
          subjectType: 'connector', subjectId: 'microsoft-365',
          // The secret itself is never written to the audit log.
          detail: { microsoftTenantId: body.tenantId, clientId: body.clientId },
        });
        return NextResponse.json({ ok: true });
      }

      if (body.connectorId === 'accounting') {
        if (!body.xeroTenantId || !body.clientId || !body.clientSecret) {
          return NextResponse.json({ error: 'Xero tenant id, client id and client secret are all required.' }, { status: 400 });
        }
        const credentials = { xeroTenantId: body.xeroTenantId, clientId: body.clientId, clientSecret: body.clientSecret };

        const probe = await new XeroConnector(credentials).discover();
        if (probe.status !== 'available') {
          return NextResponse.json({ error: `Could not connect: ${probe.detail}` }, { status: 400 });
        }

        putSecret(database, SECRET_REFS.accounting, credentials);
        setConnectorConfig(database, 'accounting', true, 'available');
        audit(database, {
          actor: session.email, actorKind: 'human', action: 'integration.connected',
          subjectType: 'connector', subjectId: 'accounting',
          detail: { xeroTenantId: body.xeroTenantId, clientId: body.clientId },
        });
        return NextResponse.json({ ok: true });
      }

      if (body.connectorId === 'crm') {
        if (!body.accessToken) {
          return NextResponse.json({ error: 'A HubSpot private app access token is required.' }, { status: 400 });
        }
        const credentials = { accessToken: body.accessToken };

        const probe = await new HubspotConnector(credentials).discover();
        if (probe.status !== 'available') {
          return NextResponse.json({ error: `Could not connect: ${probe.detail}` }, { status: 400 });
        }

        putSecret(database, SECRET_REFS.crm, credentials);
        setConnectorConfig(database, 'crm', true, 'available');
        audit(database, {
          actor: session.email, actorKind: 'human', action: 'integration.connected',
          subjectType: 'connector', subjectId: 'crm',
          // The token is never written to the audit log.
          detail: { provider: 'hubspot' },
        });
        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ error: 'That connector cannot be configured here yet.' }, { status: 400 });
    }

    if (body.action === 'disconnect') {
      if (body.connectorId === 'microsoft-365') deleteSecret(database, SECRET_REFS.microsoft365);
      if (body.connectorId === 'accounting') deleteSecret(database, SECRET_REFS.accounting);
      if (body.connectorId === 'crm') deleteSecret(database, SECRET_REFS.crm);
      setConnectorConfig(database, body.connectorId, false, 'not-configured');
      audit(database, {
        actor: session.email,
        actorKind: 'human',
        action: 'integration.disconnected',
        subjectType: 'connector',
        subjectId: body.connectorId,
        detail: {},
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof VaultUnconfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
