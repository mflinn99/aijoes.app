/** Integrations — Directive §4 and §23. */

import { requirePermission } from '@/lib/session';
import { CONNECTOR_CATALOGUE, connectorsFor, SECRET_REFS } from '@/lib/discovery/registry';
import { listConnectorConfigs } from '@/lib/db/repositories/tenant-data';
import { hasSecret, vaultConfigured } from '@/lib/secrets/vault';
import { can } from '@/lib/auth/rbac';
import { PageHead } from '@/components/Shell';
import { ConnectMicrosoft } from '@/components/ConnectMicrosoft';
import { TenantDb } from '@/lib/db/tenant';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  const session = await requirePermission('read');
  const database = new TenantDb(session.context, getDb());

  const configs = listConnectorConfigs(database);
  const live = connectorsFor(database);

  const discovery = await Promise.all(live.map(async (c) => ({ id: c.id, result: await c.discover() })));
  const m365Connected = hasSecret(database, SECRET_REFS.microsoft365);
  const mayAdminister = can(session.context.role, 'administer');

  return (
    <>
      <PageHead
        title="Integrations"
        sub="The platform becomes more valuable as connections increase — and cost hypotheses become counted facts."
      />

      {!vaultConfigured() ? (
        <div className="note danger">
          <b>No credential vault key is configured.</b> Credentials cannot be stored, so credentialled connectors are
          unavailable. Set <span className="mono">METAMSP_SECRET_KEY</span> to a 32-byte key (base64 or hex) and
          restart. The platform refuses to store a credential in plaintext rather than degrading quietly.
        </div>
      ) : null}

      {mayAdminister ? <ConnectMicrosoft connected={m365Connected} vaultReady={vaultConfigured()} /> : null}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Connectors</div>
        <table className="table">
          <thead>
            <tr>
              <th>Connector</th>
              <th>Category</th>
              <th>Auth</th>
              <th>Status</th>
              <th className="num">Understanding uplift</th>
              <th>What it unlocks</th>
            </tr>
          </thead>
          <tbody>
            {CONNECTOR_CATALOGUE.map((c) => {
              const config = configs.find((x) => x.connectorId === c.id);
              const disc = discovery.find((d) => d.id === c.id);
              const status = disc?.result.status ?? (c.implemented ? (config?.status ?? 'not-configured') : 'planned');
              return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td className="faint">{c.category}</td>
                  <td className="faint tiny">{c.authType}</td>
                  <td>
                    <span className={`badge ${status === 'available' ? 'ok' : status === 'planned' ? 'muted' : status === 'error' ? 'danger' : 'warn'}`}>
                      {status}
                    </span>
                    {disc?.result.detail ? <div className="tiny faint">{disc.result.detail}</div> : null}
                    {!c.implemented ? <div className="tiny faint">Interface defined, adapter not yet built</div> : null}
                  </td>
                  <td className="num" style={{ color: 'var(--make-more)' }}>+{c.understandingUplift}%</td>
                  <td className="dim tiny">{c.unlocks}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginTop: 14 }}>
        Uplift figures are estimates derived from the Company Twin field weights each connector can populate. Three
        connectors are implemented; the rest declare the interface so the ingestion contract is fixed now and adapters
        can be added without changing the Company Twin or any analysis engine.
      </div>
    </>
  );
}
