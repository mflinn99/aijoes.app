'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { jsonHeaders } from '@/lib/csrf-client';

export function ConnectMicrosoft({ connected, vaultReady }: { connected: boolean; vaultReady: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ tenantId: '', clientId: '', clientSecret: '' });

  async function post(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Request failed.');
        return false;
      }
      setOpen(false);
      setForm({ tenantId: '', clientId: '', clientSecret: '' });
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: connected ? 'var(--make-more-dim)' : 'var(--border-strong)' }}>
      <div className="row between">
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>Microsoft 365</div>
          <div className="tiny dim">
            {connected
              ? 'Connected. Licence counts, seat assignment and dormant accounts are read directly from the tenant, so the licence opportunity is counted rather than estimated.'
              : 'The highest-leverage connection: it replaces the headcount guess with a counted user population and the licence-waste benchmark with measured seats.'}
          </div>
        </div>
        {connected ? (
          <button className="btn danger" disabled={busy} onClick={() => void post({ action: 'disconnect', connectorId: 'microsoft-365' })}>
            Disconnect
          </button>
        ) : (
          <button className="btn primary" disabled={busy || !vaultReady} onClick={() => setOpen(!open)}>
            {open ? 'Cancel' : 'Connect'}
          </button>
        )}
      </div>

      {open && !connected ? (
        <form
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            void post({ action: 'connect', connectorId: 'microsoft-365', ...form });
          }}
        >
          <div className="note tiny" style={{ marginBottom: 14 }}>
            Register an application in the customer&rsquo;s Entra tenant with the application permissions{' '}
            <span className="mono">User.Read.All</span>, <span className="mono">Organization.Read.All</span> and{' '}
            <span className="mono">AuditLog.Read.All</span> (the last is what makes sign-in activity, and therefore
            dormancy, visible). Grant admin consent, then paste the values below. The secret is encrypted before
            storage and never appears in a log, an error or the audit trail.
          </div>

          <div className="grid-3" style={{ alignItems: 'end' }}>
            <div>
              <label className="auth-label">Directory (tenant) ID</label>
              <input className="input" required value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} placeholder="contoso.onmicrosoft.com" />
            </div>
            <div>
              <label className="auth-label">Application (client) ID</label>
              <input className="input" required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
            </div>
            <div>
              <label className="auth-label">Client secret</label>
              <input className="input" type="password" required value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} />
            </div>
          </div>

          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify and connect'}
            </button>
          </div>
          <div className="tiny faint" style={{ marginTop: 8 }}>
            The credentials are tested against Microsoft Graph before they are stored, so a typo surfaces here rather
            than as a failed analysis later.
          </div>
        </form>
      ) : null}

      {error ? <div className="note danger" style={{ marginTop: 12 }}>{error}</div> : null}
    </div>
  );
}
