'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { jsonHeaders } from '@/lib/csrf-client';

export function ExecutionControls({
  planId,
  status,
  awaitingTask,
}: {
  planId: string;
  status: string;
  awaitingTask: { id: string; name: string; capability: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function post(body: unknown, note: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/execution', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string; measuredValueGbp?: number };
      if (!res.ok) {
        setError(json.error ?? 'Request failed');
        return;
      }
      setMessage(
        json.measuredValueGbp !== undefined
          ? `${note} Measured value £${json.measuredValueGbp.toLocaleString('en-GB')}.`
          : note,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const runnable = status === 'AUTHORISED' || status === 'EXECUTING' || status === 'AWAITING_APPROVAL';
  const finished = status === 'COMPLETED' || status === 'STOPPED' || status === 'FAILED';
  const stoppable = status !== 'COMPLETED' && status !== 'STOPPED' && status !== 'FAILED';

  return (
    <div className="card" style={{ borderColor: 'var(--border-strong)' }}>
      <div className="card-title">Execution control</div>

      {awaitingTask ? (
        <div className="note warn" style={{ marginBottom: 12 }}>
          <b>Waiting for approval:</b> &ldquo;{awaitingTask.name}&rdquo; via {awaitingTask.capability}. This task
          affects systems outside the platform, so it cannot run until a named person approves it.
        </div>
      ) : null}

      {status === 'COMPLETED' ? (
        <div className="note" style={{ marginBottom: 12 }}>
          <b>Execution complete.</b> Every task finished and the realised value is recorded in the Benefits Ledger.
          Nothing further runs on this plan.
        </div>
      ) : null}
      {status === 'STOPPED' || status === 'FAILED' ? (
        <div className="note danger" style={{ marginBottom: 12 }}>
          This plan is {status.toLowerCase()}. Start a fresh plan from the opportunity to try again.
        </div>
      ) : null}

      <div className="row" style={{ gap: 8 }}>
        {finished ? null : (
        <button
          className="btn primary"
          disabled={busy || !runnable}
          onClick={() => void post({ action: 'run', planId }, 'Execution run complete.')}
        >
          {busy ? 'Running…' : status === 'AUTHORISED' ? 'Run execution' : 'Continue execution'}
        </button>
        )}

        {awaitingTask ? (
          <>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void post(
                  { action: 'approve', planId, taskId: awaitingTask.id, decision: 'APPROVED', rationale: 'Approved from execution monitoring.' },
                  'Task approved. Run execution to continue.',
                )
              }
            >
              Approve task
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() =>
                void post(
                  { action: 'approve', planId, taskId: awaitingTask.id, decision: 'REJECTED', rationale: 'Rejected from execution monitoring.' },
                  'Task rejected.',
                )
              }
            >
              Reject task
            </button>
          </>
        ) : null}

        <div style={{ flex: 1 }} />

        {stoppable ? (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => void post({ action: 'stop', planId, reason: 'Stopped by operator.' }, 'Execution stopped.')}
          >
            Stop
          </button>
        ) : null}
      </div>

      {message ? <div className="note" style={{ marginTop: 12 }}>{message}</div> : null}
      {error ? <div className="note danger" style={{ marginTop: 12 }}>{error}</div> : null}
    </div>
  );
}
