/**
 * Session issue, resolution and revocation.
 *
 * The session token is random and never stored: the database holds only its
 * SHA-256, so a database read does not yield a usable credential. Each session
 * carries its own CSRF token, which mutating requests must echo.
 *
 * Sessions are deliberately NOT written through TenantDb: resolving a session
 * is what establishes the tenant, so it cannot itself require one.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import type { TenantContext } from '../db/tenant';

export { SESSION_COOKIE } from './constants';
export const SESSION_TTL_HOURS = 12;
/** Re-issued on activity, so an active user is not signed out mid-task. */
const SLIDING_REFRESH_MINUTES = 30;

export interface SessionRecord {
  id: string;
  tenantId: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
}

export interface IssuedSession extends SessionRecord {
  /** Returned once, set as a cookie, never stored. */
  token: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueSession(
  identity: { userId: string; tenantId: string },
  meta: { userAgent?: string; ip?: string } = {},
  db: Database = getDb(),
): IssuedSession {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 3_600_000);
  const record: SessionRecord = {
    id: randomUUID(),
    tenantId: identity.tenantId,
    userId: identity.userId,
    csrfToken: randomBytes(24).toString('base64url'),
    expiresAt: expiresAt.toISOString(),
  };

  db.prepare(
    `INSERT INTO sessions (id, tenant_id, user_id, token_hash, csrf_token, created_at, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.tenantId,
    record.userId,
    hashToken(token),
    record.csrfToken,
    now.toISOString(),
    record.expiresAt,
    now.toISOString(),
    meta.userAgent ?? null,
    meta.ip ?? null,
  );

  return { ...record, token };
}

export interface ResolvedSession {
  session: SessionRecord;
  context: TenantContext;
  email: string;
  name: string;
}

export function resolveSession(token: string | undefined, db: Database = getDb()): ResolvedSession | null {
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT s.id, s.tenant_id, s.user_id, s.csrf_token, s.expires_at, s.revoked_at,
              u.email, u.name, u.role, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as
    | {
        id: string; tenant_id: string; user_id: string; csrf_token: string;
        expires_at: string; revoked_at: string | null;
        email: string; name: string; role: TenantContext['role']; status: string;
      }
    | undefined;

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.status !== 'active') return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  touch(row.id, row.expires_at, db);

  return {
    session: {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
    },
    context: { tenantId: row.tenant_id, userId: row.user_id, role: row.role },
    email: row.email,
    name: row.name,
  };
}

function touch(sessionId: string, expiresAt: string, db: Database): void {
  const now = Date.now();
  const remaining = new Date(expiresAt).getTime() - now;
  const shouldExtend = remaining < (SESSION_TTL_HOURS * 60 - SLIDING_REFRESH_MINUTES) * 60_000;
  const nextExpiry = shouldExtend
    ? new Date(now + SESSION_TTL_HOURS * 3_600_000).toISOString()
    : expiresAt;

  db.prepare(`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`).run(
    new Date(now).toISOString(),
    nextExpiry,
    sessionId,
  );
}

export function revokeSession(token: string, db: Database = getDb()): void {
  db.prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`).run(
    new Date().toISOString(),
    hashToken(token),
  );
}

/** Used when a password changes or an account is disabled. */
export function revokeAllForUser(userId: string, db: Database = getDb()): number {
  const result = db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), userId);
  return result.changes;
}

export function purgeExpiredSessions(db: Database = getDb()): number {
  return db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString()).changes;
}

/** Constant-time CSRF comparison. */
export function csrfMatches(expected: string, supplied: string | null | undefined): boolean {
  if (!supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
