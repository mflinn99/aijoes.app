'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { jsonHeaders } from '@/lib/csrf-client';

interface StageResult {
  stage: string;
  produced: number;
  summary: string;
  blockedBy: string | null;
}

/**
 * Running a cycle is an action, so it says what it will and will not do before
 * it is pressed. Nothing here can send a message: the outreach layer refuses
 * without an approved provider, whoever presses this.
 */
export function RunLoopButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [stages, setStages] = useState<StageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setStages(null);
    try {
      const res = await fetch('/api/gtm/run', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ discover: 10, research: 10, outreach: 5 }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? 'You do not have permission to run the engine.' : `The run failed (${res.status}).`);
        return;
      }
      const report = (await res.json()) as { stages: StageResult[] };
      setStages(report.stages);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">Run a cycle</div>
      <p className="tiny faint">
        Discovers, researches, scores, generates hypotheses, drafts outreach for approval, updates the CRM record and
        moves the pipeline. It cannot send anything — messages stop at approval by design.
      </p>
      <button className="btn primary" disabled={busy} onClick={() => void run()} type="button">
        {busy ? 'Running…' : 'Run one cycle'}
      </button>

      {error ? <div className="note warn" style={{ marginTop: 10 }}>{error}</div> : null}

      {stages ? (
        <table className="table" style={{ marginTop: 12 }}>
          <tbody>
            {stages.map((s) => (
              <tr key={s.stage}>
                <td style={{ fontWeight: 600 }}>{s.stage.replace(/-/g, ' ')}</td>
                <td className="num">{s.produced}</td>
                <td className="tiny dim">
                  {s.summary}
                  {s.blockedBy ? <div className="warn-text">Blocked: {s.blockedBy}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
