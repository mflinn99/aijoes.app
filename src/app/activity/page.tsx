/** Activity & Audit — Directive §24 and §25. */

import { db } from '@/lib/session';
import { listAudit, listAgentEvents } from '@/lib/db/repositories/tenant-data';
import { costSummary } from '@/lib/observability/events';
import { getCapability } from '@/lib/capabilities/registry';
import { PageHead } from '@/components/Shell';
import { gbpExact, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function ActivityPage() {
  const database = db();
  const audit = listAudit(database, 80);
  const events = listAgentEvents(database, 80);
  const costs = costSummary(database);

  return (
    <>
      <PageHead
        title="Activity & audit"
        sub="Append-only record of every decision and every agent action. Updates and deletes are rejected at the database."
      />

      <div className="grid-4">
        <Stat label="Audit records" value={String(audit.length)} />
        <Stat label="Agent events" value={String(costs.eventCount)} />
        <Stat label="Execution cost" value={`£${costs.totalCostGbp.toFixed(2)}`} />
        <Stat label="Return on execution" value={costs.returnOnExecution > 0 ? `${costs.returnOnExecution}×` : '—'} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Agent events</div>
        {events.length === 0 ? (
          <div className="faint tiny">No agent activity yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Objective</th>
                <th>Capability</th>
                <th>Status</th>
                <th className="num">Duration</th>
                <th className="num">Cost</th>
                <th className="num">Benefit</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.objective}
                    {e.failure ? <div className="tiny" style={{ color: 'var(--danger)' }}>{e.failure}</div> : null}
                  </td>
                  <td className="faint">{e.capability_id ? (getCapability(e.capability_id)?.name ?? e.capability_id) : '—'}</td>
                  <td>
                    <span className={`badge ${e.status === 'succeeded' ? 'ok' : e.status === 'failed' ? 'danger' : 'muted'}`}>
                      {e.status}
                    </span>
                    {e.retry_count > 0 ? <div className="tiny faint">{e.retry_count} retries</div> : null}
                  </td>
                  <td className="num faint">{e.duration_ms ? `${Math.round(e.duration_ms)}ms` : '—'}</td>
                  <td className="num faint">£{e.cost_gbp.toFixed(2)}</td>
                  <td className="num" style={{ color: e.benefit_gbp > 0 ? 'var(--ok)' : undefined }}>
                    {e.benefit_gbp > 0 ? gbpExact(e.benefit_gbp) : <span className="faint">—</span>}
                  </td>
                  <td className="faint tiny">{relativeTime(e.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Audit log</div>
        <table className="table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <th>Subject</th>
              <th>Detail</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td className="mono tiny">{a.action}</td>
                <td>
                  {a.actor}
                  <span className={`badge ${a.actorKind === 'human' ? 'ok' : 'muted'}`} style={{ marginLeft: 6 }}>
                    {a.actorKind}
                  </span>
                </td>
                <td className="faint tiny">{a.subjectType} {a.subjectId.slice(0, 8)}</td>
                <td className="faint tiny mono" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {JSON.stringify(a.detail)}
                </td>
                <td className="faint tiny nowrap">{relativeTime(a.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
