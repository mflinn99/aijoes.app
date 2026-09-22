'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { jsonHeaders } from '@/lib/csrf-client';

interface Result {
  verified: boolean;
  verifiedValue: number;
  narrative: string;
  reason?: string;
  lines: { label: string; before: number; after: number; delta: number }[];
}

export function VerifyPanel({
  planId,
  hasBaseline,
  verifyAfter,
  alreadyVerified,
  verifiedValue,
  outcome,
}: {
  planId: string;
  hasBaseline: boolean;
  verifyAfter: string | null;
  alreadyVerified: boolean;
  verifiedValue: number | null;
  outcome: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/verification', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ executionPlanId: planId }),
      });
      const json = (await res.json()) as Result & { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Verification failed.');
        return;
      }
      setResult(json);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!hasBaseline) {
    return (
      <div className="card">
        <div className="card-title">Verification</div>
        <div className="note warn">
          No baseline was captured for this execution, so its value cannot be verified. Verification needs a connected
          system of record — Microsoft 365 for licence work, accounting for spend — connected <b>before</b> the plan is
          authorised. Realised value here stands as modelled only.
        </div>
      </div>
    );
  }

  const due = verifyAfter ? new Date(verifyAfter) : null;
  const dueYet = !due || due.getTime() <= Date.now();

  return (
    <div className="card" style={{ borderColor: alreadyVerified ? 'var(--make-more-dim)' : 'var(--border-strong)' }}>
      <div className="row between">
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>Verification</div>
          <div className="tiny dim">
            {alreadyVerified
              ? outcome
              : dueYet
                ? 'Compare the system of record against the baseline captured before this plan was authorised.'
                : `Scheduled for ${due!.toISOString().slice(0, 10)}, once the measurement window closes. You can run it now if the billing cycle has already turned.`}
          </div>
        </div>
        {alreadyVerified ? (
          <div className="right">
            <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Verified</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ok)' }}>
              £{(verifiedValue ?? 0).toLocaleString('en-GB')}
            </div>
          </div>
        ) : (
          <button className="btn primary" onClick={() => void verify()} disabled={busy}>
            {busy ? 'Comparing…' : 'Verify now'}
          </button>
        )}
      </div>

      {result ? (
        <>
          <div className={`note ${result.verified ? '' : 'warn'}`} style={{ marginTop: 14 }}>
            {result.narrative}
          </div>
          {result.lines.length > 0 ? (
            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th className="num">Before</th>
                  <th className="num">After</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.label}>
                    <td>{l.label}</td>
                    <td className="num faint">{l.before.toLocaleString('en-GB')}</td>
                    <td className="num">{l.after.toLocaleString('en-GB')}</td>
                    <td className="num" style={{ color: l.delta > 0 ? 'var(--ok)' : l.delta < 0 ? 'var(--danger)' : undefined }}>
                      {l.delta > 0 ? '−' : l.delta < 0 ? '+' : ''}{Math.abs(l.delta).toLocaleString('en-GB')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}

      {error ? <div className="note danger" style={{ marginTop: 12 }}>{error}</div> : null}
    </div>
  );
}
