/** Capability Health — Directive §5, §14, §19. */

import { listCapabilities } from '@/lib/capabilities/registry';
import { db } from '@/lib/session';
import { costSummary } from '@/lib/observability/events';
import { PageHead } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default function CapabilitiesPage() {
  const capabilities = listCapabilities();
  const costs = costSummary(db());
  const mocked = capabilities.filter((c) => c.maturity === 'mock');

  return (
    <>
      <PageHead
        title="Capability health"
        sub={`${capabilities.length} AIGoGo capabilities registered · ${mocked.length} simulated`}
      />

      <div className="note warn">
        <b>{mocked.length} of {capabilities.length} capabilities are simulated.</b> No AIGoGo group service is reachable
        from this environment — see <span className="mono">docs/current-state.md</span>. Each is registered with its
        real interface and a deterministic mock adapter, so replacing one with a live service is an adapter swap and a
        registry entry. Orchestration does not change.
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">The mesh</div>
        <table className="table">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Type</th>
              <th>Actions</th>
              <th>Maturity</th>
              <th>Health</th>
              <th className="num">Success rate</th>
              <th className="num">Spend</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((c) => {
              const spend = costs.byCapability.find((x) => x.capabilityId === c.id);
              return (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="tiny faint">{c.description}</div>
                    {c.mockReason ? <div className="tiny" style={{ color: 'var(--warn)' }}>{c.mockReason}</div> : null}
                  </td>
                  <td className="faint">{c.type}</td>
                  <td className="num faint">{c.supportedActions.length}</td>
                  <td>
                    <span className={`badge ${c.maturity === 'mock' ? 'warn' : c.maturity === 'planned' ? 'muted' : 'ok'}`}>
                      {c.maturity}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${c.health === 'healthy' ? 'ok' : c.health === 'unavailable' ? 'danger' : 'muted'}`}>
                      {c.health}
                    </span>
                  </td>
                  <td className="num">{Math.round(c.successRate * 100)}%</td>
                  <td className="num faint">{spend ? `£${spend.costGbp.toFixed(2)}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Actions the mesh exposes</div>
        <table className="table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Capability</th>
              <th>External</th>
              <th>Risk</th>
              <th className="num">Unit cost</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.flatMap((c) =>
              c.supportedActions.map((a) => (
                <tr key={`${c.id}:${a.id}`}>
                  <td>
                    <span className="mono tiny">{a.id}</span>
                    <div className="tiny faint">{a.description}</div>
                  </td>
                  <td className="faint">{c.name}</td>
                  <td>{a.external ? <span className="badge warn">external</span> : <span className="badge muted">internal</span>}</td>
                  <td className="faint">{a.risk}</td>
                  <td className="num faint">£{a.unitCostGbp.toFixed(2)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
