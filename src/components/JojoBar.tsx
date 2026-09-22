'use client';

import { useState } from 'react';
import Link from 'next/link';
import { jsonHeaders } from '@/lib/csrf-client';

const EXAMPLES = [
  'Find £100k of addressable annual savings across this company',
  'Show me the top five MSP expansion opportunities across my customer estate',
  'Start the top three low-risk opportunities',
];

interface JojoResult {
  answer: string;
  achievable: boolean;
  objective: { kind: string; measurableOutcome: string };
  steps: { step: string; detail: string; status: string }[];
  selected: { id: string; title: string; estimatedAnnualValue: number; category: string }[];
}

export function JojoBar({ companyId }: { companyId?: string }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JojoResult | null>(null);

  async function ask(objective: string) {
    if (!objective.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/jojo', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ objective, companyId }),
      });
      setResult((await res.json()) as JojoResult);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">Ask JoJo</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(value);
        }}
        className="row"
        style={{ gap: 8 }}
      >
        <input
          className="input"
          placeholder="What do you want to achieve?"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn primary" disabled={busy || !value.trim()} type="submit">
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {!result ? (
        <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="btn small" type="button" onClick={() => { setValue(ex); void ask(ex); }}>
              {ex}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div className={`note ${result.achievable ? '' : 'warn'}`}>{result.answer}</div>
          <div className="tiny faint" style={{ marginTop: 10, marginBottom: 6 }}>
            Measurable outcome: {result.objective.measurableOutcome}
          </div>
          <table className="table" style={{ marginTop: 6 }}>
            <tbody>
              {result.steps.map((s, i) => (
                <tr key={i}>
                  <td style={{ width: 240 }}>{s.step}</td>
                  <td className="dim">{s.detail}</td>
                  <td style={{ width: 90 }}>
                    <span className={`badge ${s.status === 'done' ? 'ok' : s.status === 'blocked' ? 'danger' : 'muted'}`}>
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.selected.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              {result.selected.slice(0, 8).map((o) => (
                <div key={o.id} className="row between" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                  <Link href={`/opportunity/${o.id}`}>{o.title}</Link>
                  <span className="mono tiny dim">£{Math.round(o.estimatedAnnualValue).toLocaleString('en-GB')}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
