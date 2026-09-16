'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface StageState {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  detail: string;
}

interface Run {
  id: string;
  companyId: string | null;
  status: 'running' | 'completed' | 'failed';
  stages: StageState[];
  error: string | null;
}

export function AnalyseForm({
  examples,
}: {
  examples: { domain: string; name: string; description: string }[];
}) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function start(value: string) {
    if (!value.trim()) return;
    setError(null);
    setRun(null);

    const res = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: value }),
    });
    if (!res.ok) {
      setError('Could not start the analysis.');
      return;
    }
    const { runId } = (await res.json()) as { runId: string };

    pollRef.current = setInterval(async () => {
      const poll = await fetch(`/api/analyse/${runId}`, { cache: 'no-store' });
      if (!poll.ok) return;
      const next = (await poll.json()) as Run;
      setRun(next);
      if (next.status !== 'running') {
        if (pollRef.current) clearInterval(pollRef.current);
        if (next.status === 'completed' && next.companyId) {
          setTimeout(() => router.push(`/company/${next.companyId}`), 700);
        }
      }
    }, 400);
  }

  return (
    <>
      <div className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void start(input);
          }}
        >
          <label className="tiny faint" style={{ display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>
            Enter a company name or website
          </label>
          <div className="row" style={{ gap: 10 }}>
            <input
              className="input"
              placeholder="claritas-solutions.co.uk"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={run?.status === 'running'}
            />
            <button className="btn primary" type="submit" disabled={!input.trim() || run?.status === 'running'}>
              ANALYSE COMPANY
            </button>
          </div>
        </form>
        {error ? <div className="note danger" style={{ marginTop: 12 }}>{error}</div> : null}
      </div>

      {run ? (
        <div className="card">
          <div className="card-title">
            Analysis {run.status === 'running' ? 'in progress' : run.status}
          </div>
          {run.stages.map((stage) => (
            <div className={`stage ${stage.status}`} key={stage.id}>
              <span className="stage-dot" />
              <span className="stage-name">{stage.name}</span>
              <span className="stage-detail">{stage.detail}</span>
            </div>
          ))}
          {run.error ? <div className="note danger" style={{ marginTop: 12 }}>{run.error}</div> : null}
        </div>
      ) : null}

      {!run ? (
        <div className="card">
          <div className="card-title">Try a reference company</div>
          <p className="tiny faint" style={{ marginTop: -6 }}>
            Three synthetic companies with deterministic data, used to exercise the full pipeline without external
            calls. Any real domain also works — the platform will fetch and analyse the live website.
          </p>
          {examples.map((ex) => (
            <div key={ex.domain} className="row between" style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{ex.name}</div>
                <div className="tiny faint">{ex.description}</div>
              </div>
              <button className="btn small" type="button" onClick={() => { setInput(ex.domain); void start(ex.domain); }}>
                Analyse
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
