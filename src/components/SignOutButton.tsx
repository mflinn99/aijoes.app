'use client';

import { useState } from 'react';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="btn small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
