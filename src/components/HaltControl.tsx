'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function HaltControl({ currentLevel }: { currentLevel: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function halt() {
    setBusy(true);
    try {
      await fetch('/api/autonomy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'halt' }) });
      setDone(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: currentLevel > 0 ? 'var(--border-strong)' : 'var(--border)' }}>
      <div className="row between">
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>Halt all autonomy</div>
          <div className="tiny dim">
            Drops every grant in this tenant to Observe in one step. In-flight executions stop at their next approval
            gate. Use it the moment something looks wrong — re-granting takes seconds.
          </div>
        </div>
        <button className="btn danger" onClick={() => void halt()} disabled={busy || currentLevel === 0}>
          {busy ? 'Halting…' : currentLevel === 0 ? 'Already at Observe' : 'HALT'}
        </button>
      </div>
      {done ? <div className="note" style={{ marginTop: 12 }}>All grants dropped to Observe.</div> : null}
    </div>
  );
}
