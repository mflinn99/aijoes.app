'use client';

import { useState } from 'react';

export function LoginForm({
  next,
  ssoProviders,
  initialError = null,
}: {
  next: string;
  ssoProviders: { id: string; name: string }[];
  initialError?: string | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Sign-in failed.');
        return;
      }
      // Full navigation so the server layout re-renders with the session.
      window.location.href = next.startsWith('/') ? next : '/';
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">AIGoGo MetaMSP</div>
        <div className="auth-sub">Land &amp; Expand Engine</div>

        <form onSubmit={submit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error ? <div className="note danger" style={{ marginBottom: 14 }}>{error}</div> : null}

          <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {ssoProviders.length > 0 ? (
          <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            {ssoProviders.map((p) => (
              <a key={p.id} className="btn" href={`/api/auth/sso/${p.id}?next=${encodeURIComponent(next)}`} style={{ width: '100%', justifyContent: 'center' }}>
                Continue with {p.name}
              </a>
            ))}
          </div>
        ) : (
          <div className="tiny faint" style={{ marginTop: 18 }}>
            Single sign-on is not configured on this deployment. Set{' '}
            <span className="mono">METAMSP_OIDC_ISSUER</span>, <span className="mono">METAMSP_OIDC_CLIENT_ID</span> and{' '}
            <span className="mono">METAMSP_OIDC_REDIRECT_URI</span> to enable it.
          </div>
        )}
      </div>
    </div>
  );
}
