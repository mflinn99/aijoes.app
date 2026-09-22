'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { jsonHeaders } from '@/lib/csrf-client';

export function ServicesHeld({
  customerId,
  catalogue,
  held,
  editable,
}: {
  customerId: string;
  catalogue: { id: string; name: string; category: string }[];
  held: string[];
  editable: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(held);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  const dirty = selected.length !== held.length || selected.some((s) => !held.includes(s));

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await fetch('/api/customer', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ action: 'set-services', customerId, services: selected }),
      });
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row between">
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>Services this customer already buys</div>
          <div className="tiny dim">
            {held.length === 0
              ? 'None recorded. Expansion opportunities below may include services they already pay you for — record what they hold and the list re-ranks on the next analysis.'
              : `${held.length} service(s) recorded. These are excluded from expansion opportunities.`}
          </div>
        </div>
        {editable ? (
          <button className="btn" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit'}</button>
        ) : null}
      </div>

      {held.length > 0 && !open ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {held.map((id) => (
            <span key={id} className="badge ok">{catalogue.find((c) => c.id === id)?.name ?? id}</span>
          ))}
        </div>
      ) : null}

      {open ? (
        <>
          <div className="grid-3" style={{ marginTop: 14, gap: 8 }}>
            {catalogue.map((service) => {
              const on = selected.includes(service.id);
              return (
                <label
                  key={service.id}
                  className="row"
                  style={{
                    gap: 8, padding: '8px 10px', cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--make-more-dim)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-sm)', background: on ? 'var(--surface-2)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setSelected(e.target.checked ? [...selected, service.id] : selected.filter((s) => s !== service.id))
                    }
                  />
                  <span>
                    <span style={{ fontSize: 13.5 }}>{service.name}</span>
                    <span className="tiny faint" style={{ display: 'block' }}>{service.category}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => { setSelected(held); setOpen(false); }} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div className="tiny faint" style={{ marginTop: 8 }}>
            Saved services take effect on the next analysis of this company.
          </div>
        </>
      ) : null}

      {saved ? <div className="note" style={{ marginTop: 12 }}>Saved. Re-analyse this company to re-rank its expansion opportunities.</div> : null}
    </div>
  );
}
