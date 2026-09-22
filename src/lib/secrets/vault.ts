/**
 * Per-tenant credential vault — Directive §24, iteration 2.
 *
 * Third-party credentials were previously read from the environment, which
 * cannot work once more than one MSP connects more than one customer tenant.
 * They are now encrypted at rest with AES-256-GCM under a master key supplied
 * by the environment (or, in production, a KMS).
 *
 * The vault refuses to store anything when no master key is configured rather
 * than silently writing plaintext. A connector then reports itself
 * unconfigured, which is the honest state.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import type { TenantDb } from '../db/tenant';

const ALGORITHM = 'aes-256-gcm';

export class VaultUnconfiguredError extends Error {
  constructor() {
    super(
      'No METAMSP_SECRET_KEY is configured, so credentials cannot be stored. ' +
        'Set a 32-byte key (base64 or hex) before connecting an integration.',
    );
    this.name = 'VaultUnconfiguredError';
  }
}

function masterKey(): Buffer | null {
  const raw = process.env.METAMSP_SECRET_KEY;
  if (!raw) return null;

  const decoded = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (decoded.length !== 32) return null;
  return decoded;
}

export function vaultConfigured(): boolean {
  return masterKey() !== null;
}

/** Identifies which key encrypted a record, so a key rotation is detectable. */
function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export function generateMasterKey(): string {
  return randomBytes(32).toString('base64');
}

export function putSecret(db: TenantDb, ref: string, value: unknown): void {
  const key = masterKey();
  if (!key) throw new VaultUnconfiguredError();

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const now = new Date().toISOString();

  db.raw
    .prepare(
      `INSERT INTO secrets (id, tenant_id, ref, ciphertext, iv, auth_tag, key_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, ref) DO UPDATE SET
         ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag,
         key_id = excluded.key_id, updated_at = excluded.updated_at`,
    )
    .run(
      randomUUID(),
      db.ctx.tenantId,
      ref,
      ciphertext.toString('base64'),
      iv.toString('base64'),
      authTag.toString('base64'),
      keyId(key),
      now,
      now,
    );
}

export function getSecret<T = unknown>(db: TenantDb, ref: string): T | null {
  const key = masterKey();
  if (!key) return null;

  const row = db.raw
    .prepare(`SELECT ciphertext, iv, auth_tag, key_id FROM secrets WHERE tenant_id = ? AND ref = ?`)
    .get(db.ctx.tenantId, ref) as
    | { ciphertext: string; iv: string; auth_tag: string; key_id: string }
    | undefined;

  if (!row) return null;
  if (row.key_id !== keyId(key)) {
    // Encrypted under a different master key: refuse rather than return
    // nonsense, so a rotation shows up as a connector needing reconnection.
    return null;
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

export function deleteSecret(db: TenantDb, ref: string): void {
  db.raw.prepare(`DELETE FROM secrets WHERE tenant_id = ? AND ref = ?`).run(db.ctx.tenantId, ref);
}

export function hasSecret(db: TenantDb, ref: string): boolean {
  const row = db.raw
    .prepare(`SELECT 1 AS present FROM secrets WHERE tenant_id = ? AND ref = ?`)
    .get(db.ctx.tenantId, ref);
  return Boolean(row);
}

export function listSecretRefs(db: TenantDb): string[] {
  return (
    db.raw.prepare(`SELECT ref FROM secrets WHERE tenant_id = ? ORDER BY ref`).all(db.ctx.tenantId) as {
      ref: string;
    }[]
  ).map((r) => r.ref);
}

/** Secrets never appear in an error, a log line or a prompt. */
export function redact(value: string, keep = 4): string {
  if (value.length <= keep) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(4, value.length - keep))}${value.slice(-keep)}`;
}

export type { Database };
