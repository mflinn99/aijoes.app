// Per-user namespacing for all client-side persisted data (KPIs, decisions,
// levers, risks, analysis session, decision log). AuthContext sets the active
// user id whenever the Supabase session changes, so each authenticated user
// reads and writes an isolated slice of localStorage. Signed-out access falls
// back to an "anon" namespace that never collides with a real account.

let currentUserId: string | null = null;

export function setStorageUser(id: string | null): void {
  currentUserId = id;
}

export function getStorageUser(): string | null {
  return currentUserId;
}

export function scopedKey(suffix: string): string {
  return `sixonic_${currentUserId ?? "anon"}_${suffix}`;
}
