'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { jsonHeaders } from '@/lib/csrf-client';

interface Preview {
  plan: {
    id: string;
    objective: string;
    financialTarget: number;
    status: string;
    blockers: string[];
    autonomyReason: string;
    rollbackPlan: string;
    stopConditions: string[];
    approvals: string[];
    metrics: { id: string; name: string; unit: string; measurement: string }[];
    tasks: {
      id: string;
      seq: number;
      name: string;
      assignedCapabilityName: string;
      routingRationale: string;
      approvalRequired: boolean;
      simulated: boolean;
      status: string;
    }[];
  };
  summary: {
    taskCount: number;
    externalTaskCount: number;
    approvalsRequired: number;
    estimatedCostGbp: number;
    financialTarget: number;
    proportionality: string;
    simulatedCapabilities: string[];
  };
}

export function StartPanel({
  opportunityId,
  available,
  reason,
  existingPlanId,
  existingPlanStatus,
}: {
  opportunityId: string;
  available: boolean;
  reason: string;
  existingPlanId: string | null;
  existingPlanStatus: string | null;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/execution', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Request failed');
        return null;
      }
      return json;
    } finally {
      setBusy(false);
    }
  }

  async function onStart() {
    const result = (await post({ action: 'plan', opportunityId })) as Preview | null;
    if (result) setPreview(result);
  }

  async function onAuthorise() {
    if (!preview) return;
    const ok = await post({
      action: 'authorise',
      planId: preview.plan.id,
      rationale: 'Authorised from the execution preview.',
    });
    if (ok) router.push(`/execution/${preview.plan.id}`);
  }

  if (existingPlanId) {
    return (
      <div className="card" style={{ borderColor: 'var(--border-strong)' }}>
        <div className="card-title">Execution</div>
        <div className="row between">
          <div className="dim">
            An execution plan already exists for this opportunity — currently {existingPlanStatus?.replace(/_/g, ' ').toLowerCase()}.
          </div>
          <a className="btn primary" href={`/execution/${existingPlanId}`}>
            Open execution
          </a>
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="card" style={{ borderColor: 'var(--border-strong)' }}>
        <div className="card-title">Execution</div>
        <div className="row between">
          <div className="dim">
            {available
              ? 'START generates a real execution plan: tasks routed to capabilities, approvals identified, and a preview you authorise before anything runs.'
              : reason}
          </div>
          <button className="btn primary" onClick={() => void onStart()} disabled={!available || busy}>
            {busy ? 'Building plan…' : 'START'}
          </button>
        </div>
        {error ? <div className="note danger" style={{ marginTop: 12 }}>{error}</div> : null}
      </div>
    );
  }

  const blocked = preview.plan.blockers.length > 0;

  return (
    <div className="card" style={{ borderColor: 'var(--border-strong)' }}>
      <div className="card-title">Execution preview</div>

      {blocked ? (
        <div className="note danger" style={{ marginBottom: 14 }}>
          <b>This plan cannot be authorised.</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {preview.plan.blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <Mini label="Tasks" value={String(preview.summary.taskCount)} />
        <Mini label="Approval gates" value={String(preview.summary.externalTaskCount)} />
        <Mini label="Execution cost" value={`£${preview.summary.estimatedCostGbp.toFixed(2)}`} />
        <Mini label="Financial target" value={`£${preview.summary.financialTarget.toLocaleString('en-GB')}`} />
      </div>

      <div className="note tiny" style={{ marginBottom: 14 }}>{preview.summary.proportionality}</div>

      {preview.summary.simulatedCapabilities.length > 0 ? (
        <div className="note warn" style={{ marginBottom: 14 }}>
          <b>Simulated capabilities:</b> {preview.summary.simulatedCapabilities.join(', ')}. No live AIGoGo opco
          service is reachable from this environment, so these tasks produce modelled outcomes. Value they report
          reaches the Benefits Ledger as <b>realised</b> but never as <b>verified</b>.
        </div>
      ) : null}

      <table className="table" style={{ marginBottom: 14 }}>
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>Task</th>
            <th>Routed to</th>
            <th>Why</th>
            <th style={{ width: 100 }}>Gate</th>
          </tr>
        </thead>
        <tbody>
          {preview.plan.tasks.map((t) => (
            <tr key={t.id}>
              <td className="faint num">{t.seq + 1}</td>
              <td style={{ fontWeight: 600 }}>{t.name}</td>
              <td>
                {t.assignedCapabilityName}
                {t.simulated ? <span className="badge warn" style={{ marginLeft: 6 }}>sim</span> : null}
              </td>
              <td className="tiny faint">{t.routingRationale}</td>
              <td>{t.approvalRequired ? <span className="badge warn">approval</span> : <span className="badge muted">auto</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid-2">
        <div>
          <div className="card-title">Autonomy</div>
          <div className="tiny dim">{preview.plan.autonomyReason}</div>
          <div className="card-title" style={{ marginTop: 14 }}>Approval gates</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} className="dim">
            {preview.plan.approvals.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
        <div>
          <div className="card-title">Rollback plan</div>
          <div className="tiny dim">{preview.plan.rollbackPlan}</div>
          <div className="card-title" style={{ marginTop: 14 }}>Stop conditions</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} className="dim">
            {preview.plan.stopConditions.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      </div>

      <div className="card-title" style={{ marginTop: 16 }}>How this will be measured</div>
      <table className="table">
        <tbody>
          {preview.plan.metrics.map((m) => (
            <tr key={m.id}>
              <td style={{ width: 240, fontWeight: 600 }}>{m.name}</td>
              <td className="dim">{m.measurement}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {error ? <div className="note danger" style={{ marginTop: 12 }}>{error}</div> : null}

      <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => setPreview(null)} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void onAuthorise()} disabled={busy || blocked}>
          {busy ? 'Authorising…' : 'Authorise execution'}
        </button>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
