'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { jsonHeaders } from '@/lib/csrf-client';
import type { Role } from '@/lib/auth/rbac';

interface Row {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'disabled';
  lastLogin: string;
}

const ROLES: Role[] = ['READ_ONLY', 'MSP_USER', 'MSP_ADMIN'];

export function UserAdmin({ users, currentUserId }: { users: Row[]; currentUserId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'MSP_USER' as Role, password: '' });

  async function post(body: unknown, note: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/users', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Request failed.');
        return false;
      }
      setMessage(note);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">People</div>
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th style={{ width: 160 }}>Role</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 130 }}>Last sign-in</th>
              <th style={{ width: 200 }} />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.name}</div>
                  <div className="tiny faint">{u.email}{u.id === currentUserId ? ' · you' : ''}</div>
                </td>
                <td>
                  <select
                    className="input"
                    style={{ padding: '5px 8px', fontSize: 13 }}
                    value={u.role}
                    disabled={busy}
                    onChange={(e) => void post({ action: 'set-role', userId: u.id, role: e.target.value }, `${u.email} is now ${e.target.value}.`)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r.replace('_', ' ').toLowerCase()}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={`badge ${u.status === 'active' ? 'ok' : 'danger'}`}>{u.status}</span>
                </td>
                <td className="faint tiny">{u.lastLogin}</td>
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => {
                        const password = window.prompt(`New password for ${u.email} (minimum 12 characters):`);
                        if (password) void post({ action: 'reset-password', userId: u.id, password }, `Password reset. ${u.email} has been signed out everywhere.`);
                      }}
                    >
                      Reset password
                    </button>
                    {u.id === currentUserId ? null : (
                      <button
                        className={`btn small ${u.status === 'active' ? 'danger' : ''}`}
                        disabled={busy}
                        onClick={() => void post(
                          { action: 'set-status', userId: u.id, status: u.status === 'active' ? 'disabled' : 'active' },
                          `${u.email} ${u.status === 'active' ? 'disabled' : 'enabled'}.`,
                        )}
                      >
                        {u.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-title">Add a user</div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await post({ action: 'create', ...form }, `${form.email} added.`);
            if (ok) setForm({ email: '', name: '', role: 'MSP_USER', password: '' });
          }}
        >
          <div className="grid-4" style={{ alignItems: 'end' }}>
            <div>
              <label className="auth-label">Email</label>
              <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="auth-label">Name</label>
              <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="auth-label">Role</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ').toLowerCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="auth-label">Initial password</label>
              <input className="input" type="text" required minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn primary" type="submit" disabled={busy}>Add user</button>
          </div>
        </form>
        <div className="tiny faint" style={{ marginTop: 10 }}>
          Minimum 12 characters. The user should change it after first sign-in; resetting a password signs that
          person out of every session.
        </div>
      </div>

      {message ? <div className="note">{message}</div> : null}
      {error ? <div className="note danger">{error}</div> : null}
    </>
  );
}
