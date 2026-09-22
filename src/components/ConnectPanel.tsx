'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { jsonHeaders } from '@/lib/csrf-client';
import type { ConnectorSpec } from '@/lib/connector-specs';

export function ConnectPanel({
  spec,
  connected,
  vaultReady,
}: {
  spec: ConnectorSpec;
  connected: boolean;
  vaultReady: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  async function post(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Request failed.');
        return;
      }
      setOpen(false);
      setValues({});
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: connected ? 'var(--make-more-dim)' : 'var(--border)' }}>
      <div className="row between">
        <div style={{ paddingRight: 16 }}>
          <div className="card-title" style={{ marginBottom: 4 }}>
            {spec.name}
            {connected ? <span className="badge ok" style={{ marginLeft: 8 }}>connected</span> : null}
          </div>
          <div className="tiny dim">{connected ? spec.connectedBlurb : spec.pitch}</div>
        </div>
        {connected ? (
          <button className="btn danger" disabled={busy} onClick={() => void post({ action: 'disconnect', connectorId: spec.id })}>
            Disconnect
          </button>
        ) : (
          <button className="btn primary nowrap" disabled={busy || !vaultReady} onClick={() => setOpen(!open)}>
            {open ? 'Cancel' : 'Connect'}
          </button>
        )}
      </div>

      {open && !connected ? (
        <form
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            void post({ action: 'connect', connectorId: spec.id, ...values });
          }}
        >
          <div className="note tiny" style={{ marginBottom: 14 }}>{spec.setup}</div>

          <div className={spec.fields.length > 1 ? 'grid-3' : ''} style={{ alignItems: 'end' }}>
            {spec.fields.map((field) => (
              <div key={field.key}>
                <label className="auth-label">{field.label}</label>
                <input
                  className="input"
                  type={field.secret ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  required
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                />
              </div>
            ))}
          </div>

          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify and connect'}
            </button>
          </div>
          <div className="tiny faint" style={{ marginTop: 8 }}>
            Credentials are tested against the provider before they are stored, so a typo surfaces here rather than as
            a failed analysis later. They are encrypted at rest and never appear in a log, an error or the audit trail.
          </div>
        </form>
      ) : null}

      {error ? <div className="note danger" style={{ marginTop: 12 }}>{error}</div> : null}
    </div>
  );
}
