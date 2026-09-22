/**
 * Sign-in throttling. Counts recent failures per email+IP and locks the pair
 * out temporarily. Keyed on both so one attacker cannot lock out a real user by
 * guessing their address from elsewhere.
 */

import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 8;

export function attemptKey(email: string, ip: string | null): string {
  return `${email.toLowerCase()}|${ip ?? 'unknown'}`;
}

export function recordAttempt(key: string, succeeded: boolean, db: Database = getDb()): void {
  db.prepare(`INSERT INTO auth_attempts (id, key, at, succeeded) VALUES (?, ?, ?, ?)`).run(
    randomUUID(),
    key,
    new Date().toISOString(),
    succeeded ? 1 : 0,
  );
}

export interface LockoutState {
  locked: boolean;
  failures: number;
  retryAfterSeconds: number;
}

export function lockoutState(key: string, db: Database = getDb()): LockoutState {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const rows = db
    .prepare(`SELECT at, succeeded FROM auth_attempts WHERE key = ? AND at >= ? ORDER BY at DESC`)
    .all(key, since) as { at: string; succeeded: number }[];

  // A success inside the window clears the count.
  const failures: { at: string }[] = [];
  for (const row of rows) {
    if (row.succeeded === 1) break;
    failures.push(row);
  }

  if (failures.length < MAX_FAILURES) {
    return { locked: false, failures: failures.length, retryAfterSeconds: 0 };
  }

  const oldest = failures[failures.length - 1]!;
  const unlockAt = new Date(oldest.at).getTime() + WINDOW_MINUTES * 60_000;
  return {
    locked: true,
    failures: failures.length,
    retryAfterSeconds: Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000)),
  };
}

export function clearAttempts(key: string, db: Database = getDb()): void {
  db.prepare(`DELETE FROM auth_attempts WHERE key = ?`).run(key);
}
