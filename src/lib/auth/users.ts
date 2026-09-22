/**
 * User records and password authentication.
 *
 * Reads here bypass TenantDb on purpose: authentication is what establishes the
 * tenant, so it cannot be performed inside a tenant scope. Every query is
 * keyed on a unique identifier (email or id) and returns exactly one user.
 */

import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import { hashPassword, verifyPassword } from './passwords';
import type { Role } from './rbac';
import type { AuthOutcome } from './identity';
import { attemptKey, clearAttempts, lockoutState, recordAttempt } from './attempts';
import { revokeAllForUser } from './sessions';

export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'disabled';
  idp: string;
  lastLoginAt: string | null;
}

interface UserRow {
  id: string; tenant_id: string; email: string; name: string; role: Role;
  status: string; idp: string; last_login_at: string | null; password_hash: string | null;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    idp: row.idp,
    lastLoginAt: row.last_login_at,
  };
}

export async function createUser(
  input: { tenantId: string; email: string; name: string; role: Role; password?: string; idp?: string },
  db: Database = getDb(),
): Promise<UserRecord> {
  const id = randomUUID();
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, name, role, created_at, password_hash, status, idp)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(
    id,
    input.tenantId,
    input.email.toLowerCase(),
    input.name,
    input.role,
    new Date().toISOString(),
    passwordHash,
    input.idp ?? 'local',
  );
  return getUserById(id, db)!;
}

export function getUserById(id: string, db: Database = getDb()): UserRecord | null {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row ? toRecord(row) : null;
}

export function getUserByEmail(email: string, db: Database = getDb()): UserRecord | null {
  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as UserRow | undefined;
  return row ? toRecord(row) : null;
}

export function listUsersForTenant(tenantId: string, db: Database = getDb()): UserRecord[] {
  return (db.prepare(`SELECT * FROM users WHERE tenant_id = ? ORDER BY email`).all(tenantId) as UserRow[]).map(toRecord);
}

export async function setPassword(userId: string, password: string, db: Database = getDb()): Promise<void> {
  const hash = await hashPassword(password);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, userId);
  // A password change invalidates every existing session for that user.
  revokeAllForUser(userId, db);
}

export function setStatus(userId: string, status: 'active' | 'disabled', db: Database = getDb()): void {
  db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, userId);
  if (status === 'disabled') revokeAllForUser(userId, db);
}

export function setRole(userId: string, role: Role, db: Database = getDb()): void {
  db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, userId);
}

/**
 * Authenticate an email and password.
 *
 * Failure messages never distinguish "no such user" from "wrong password", and
 * the password comparison runs even when the user does not exist, so neither
 * the response nor its timing reveals whether an address is registered.
 */
export async function authenticate(
  email: string,
  password: string,
  ip: string | null,
  db: Database = getDb(),
): Promise<AuthOutcome> {
  const key = attemptKey(email, ip);
  const lock = lockoutState(key, db);
  if (lock.locked) {
    return {
      ok: false,
      locked: true,
      reason: `Too many failed attempts. Try again in ${Math.ceil(lock.retryAfterSeconds / 60)} minute(s).`,
    };
  }

  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as UserRow | undefined;
  const valid = await verifyPassword(password, row?.password_hash ?? null);

  if (!row || !valid || row.status !== 'active') {
    recordAttempt(key, false, db);
    return { ok: false, reason: 'Email or password is incorrect.' };
  }

  recordAttempt(key, true, db);
  clearAttempts(key, db);
  db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);

  return {
    ok: true,
    identity: {
      userId: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      name: row.name,
      role: row.role,
    },
  };
}
