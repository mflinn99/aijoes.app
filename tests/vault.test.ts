/** Per-tenant credential vault — Directive §24. */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { TenantDb } from '@/lib/db/tenant';
import {
  putSecret, getSecret, deleteSecret, hasSecret, listSecretRefs,
  vaultConfigured, generateMasterKey, VaultUnconfiguredError, redact,
} from '@/lib/secrets/vault';

let db: Database;
let one: TenantDb;
let two: TenantDb;
const original = process.env.METAMSP_SECRET_KEY;

beforeEach(() => {
  process.env.METAMSP_SECRET_KEY = generateMasterKey();
  db = createTestDb();
  for (const id of ['t1', 't2']) {
    db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES (?, ?, 'MSP', '2026-01-01')`).run(id, id);
  }
  one = new TenantDb({ tenantId: 't1', userId: 'u1', role: 'MSP_ADMIN' }, db);
  two = new TenantDb({ tenantId: 't2', userId: 'u2', role: 'MSP_ADMIN' }, db);
});

afterEach(() => {
  if (original === undefined) delete process.env.METAMSP_SECRET_KEY;
  else process.env.METAMSP_SECRET_KEY = original;
});

describe('vault', () => {
  it('round-trips a credential', () => {
    putSecret(one, 'connector:x', { clientId: 'abc', clientSecret: 'shhh' });
    expect(getSecret(one, 'connector:x')).toEqual({ clientId: 'abc', clientSecret: 'shhh' });
  });

  it('never stores the plaintext', () => {
    putSecret(one, 'connector:x', { clientSecret: 'a-very-distinctive-secret' });
    const row = db.prepare(`SELECT ciphertext FROM secrets WHERE tenant_id = 't1'`).get() as { ciphertext: string };
    expect(row.ciphertext).not.toContain('a-very-distinctive-secret');
    expect(Buffer.from(row.ciphertext, 'base64').toString('utf8')).not.toContain('a-very-distinctive-secret');
  });

  it('isolates tenants', () => {
    putSecret(one, 'connector:x', { secret: 'one' });
    putSecret(two, 'connector:x', { secret: 'two' });

    expect(getSecret(one, 'connector:x')).toEqual({ secret: 'one' });
    expect(getSecret(two, 'connector:x')).toEqual({ secret: 'two' });
    expect(listSecretRefs(one)).toEqual(['connector:x']);
  });

  it('overwrites on re-put rather than accumulating', () => {
    putSecret(one, 'connector:x', { v: 1 });
    putSecret(one, 'connector:x', { v: 2 });
    expect(getSecret(one, 'connector:x')).toEqual({ v: 2 });
    const count = db.prepare(`SELECT COUNT(*) AS n FROM secrets WHERE tenant_id = 't1'`).get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('deletes and reports presence', () => {
    putSecret(one, 'connector:x', { v: 1 });
    expect(hasSecret(one, 'connector:x')).toBe(true);
    deleteSecret(one, 'connector:x');
    expect(hasSecret(one, 'connector:x')).toBe(false);
    expect(getSecret(one, 'connector:x')).toBeNull();
  });

  it('refuses to store anything with no master key, rather than writing plaintext', () => {
    delete process.env.METAMSP_SECRET_KEY;
    expect(vaultConfigured()).toBe(false);
    expect(() => putSecret(one, 'connector:x', { v: 1 })).toThrow(VaultUnconfiguredError);
  });

  it('rejects a master key of the wrong length', () => {
    process.env.METAMSP_SECRET_KEY = Buffer.from('too short').toString('base64');
    expect(vaultConfigured()).toBe(false);
  });

  it('returns null rather than nonsense when the master key has rotated', () => {
    putSecret(one, 'connector:x', { v: 1 });
    process.env.METAMSP_SECRET_KEY = generateMasterKey();
    // A rotation shows up as a connector needing reconnection, not a crash.
    expect(getSecret(one, 'connector:x')).toBeNull();
  });

  it('detects tampering through the auth tag', () => {
    putSecret(one, 'connector:x', { v: 1 });
    const row = db.prepare(`SELECT id, ciphertext FROM secrets WHERE tenant_id = 't1'`).get() as { id: string; ciphertext: string };
    const bytes = Buffer.from(row.ciphertext, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    db.prepare(`UPDATE secrets SET ciphertext = ? WHERE id = ?`).run(bytes.toString('base64'), row.id);
    expect(getSecret(one, 'connector:x')).toBeNull();
  });

  it('redacts a value for display', () => {
    expect(redact('super-secret-value')).toMatch(/^•+alue$/);
    expect(redact('abc')).toBe('•••');
  });
});
