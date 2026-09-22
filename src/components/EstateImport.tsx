'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { jsonHeaders } from '@/lib/csrf-client';

interface Row { line: number; name: string; domain: string | null; currentMrr: number; renewalDate: string | null }
interface Problem { line: number; raw: string; reason: string }
interface Preview { rows: Row[]; problems: Problem[]; headers: string[] | null; willQueue: number }
interface Result { created: number; updated: number; queued: number; skipped: Problem[] }

const EXAMPLE = `name,domain,mrr,renewal,services
Acme Engineering,acme-engineering.co.uk,2400,2027-03-31,managed-microsoft; backup-continuity
Northern Logistics,northernlogistics.com,1850,2026-11-30,device-management
Bright Dental Group,brightdental.co.uk,,,`;

export function EstateImport() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [analyse, setAnalyse] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/estate', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Request failed.');
        return null;
      }
      return json;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Import customers</div>
        <p className="tiny faint" style={{ marginTop: -6 }}>
          Paste a CSV, a tab-separated export, or one customer per line. Columns are matched by header name where there
          is one, and by position otherwise: name, domain, MRR, renewal date, note. Every line is checked before
          anything is created.
        </p>

        <textarea
          className="input"
          style={{ minHeight: 160, fontFamily: 'var(--mono)', fontSize: 13, resize: 'vertical' }}
          placeholder={EXAMPLE}
          value={input}
          onChange={(e) => { setInput(e.target.value); setPreview(null); setResult(null); }}
        />

        <div className="row between" style={{ marginTop: 12 }}>
          <label className="row tiny dim" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={analyse} onChange={(e) => setAnalyse(e.target.checked)} />
            Analyse each customer after import (one queued analysis each)
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn"
              disabled={busy || !input.trim()}
              onClick={async () => {
                const p = (await post({ action: 'preview', input })) as Preview | null;
                if (p) { setPreview(p); setResult(null); }
              }}
            >
              {busy ? 'Checking…' : 'Check'}
            </button>
            <button
              className="btn primary"
              disabled={busy || !preview || preview.rows.length === 0}
              onClick={async () => {
                const r = (await post({ action: 'import', input, analyse })) as Result | null;
                if (r) { setResult(r); setPreview(null); setInput(''); router.refresh(); }
              }}
            >
              Import {preview ? `${preview.rows.length} customer(s)` : ''}
            </button>
          </div>
        </div>

        {error ? <div className="note danger" style={{ marginTop: 12 }}>{error}</div> : null}

        {result ? (
          <div className="note" style={{ marginTop: 12 }}>
            <b>{result.created} created, {result.updated} updated.</b>{' '}
            {result.queued > 0 ? `${result.queued} analysis job(s) queued — watch them on Background work.` : 'No analysis queued.'}
            {result.skipped.length > 0 ? ` ${result.skipped.length} line(s) skipped.` : ''}
          </div>
        ) : null}
      </div>

      {preview ? (
        <div className="card">
          <div className="card-title">
            {preview.rows.length} customer(s) ready{preview.problems.length > 0 ? `, ${preview.problems.length} line(s) with problems` : ''}
          </div>

          {preview.problems.length > 0 ? (
            <div className="note warn" style={{ marginBottom: 12 }}>
              These lines will be skipped. Nothing is imported from them.
              <table className="table" style={{ marginTop: 8 }}>
                <tbody>
                  {preview.problems.slice(0, 20).map((p) => (
                    <tr key={p.line}>
                      <td className="faint num" style={{ width: 50 }}>line {p.line}</td>
                      <td className="mono tiny" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.raw}</td>
                      <td className="tiny">{p.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Domain</th>
                <th className="num">MRR</th>
                <th>Renewal</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 50).map((r) => (
                <tr key={r.line}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td className="dim">{r.domain ?? <span className="faint">none — analysis will be weaker</span>}</td>
                  <td className="num">{r.currentMrr ? `£${r.currentMrr.toLocaleString('en-GB')}` : <span className="faint">—</span>}</td>
                  <td className="faint tiny">{r.renewalDate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.rows.length > 50 ? <div className="tiny faint" style={{ marginTop: 8 }}>Showing the first 50 of {preview.rows.length}.</div> : null}
        </div>
      ) : null}
    </>
  );
}
