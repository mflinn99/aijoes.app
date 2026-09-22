/**
 * Authentication, sessions and RBAC — iteration 2 priority 1.
 *
 * Iteration 1 declared four roles and enforced none of them. These are the
 * tests that hold the enforcement in place.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { hashPassword, verifyPassword, assertPasswordAcceptable, WeakPasswordError, MIN_PASSWORD_LENGTH } from '@/lib/auth/passwords';
import { authenticate, createUser, setPassword, setStatus, getUserByEmail } from '@/lib/auth/users';
import { issueSession, resolveSession, revokeSession, revokeAllForUser, purgeExpiredSessions, csrfMatches, hashToken } from '@/lib/auth/sessions';
import { can, permissionsFor, assertCan, ForbiddenError, type Role, type Permission } from '@/lib/auth/rbac';
import { lockoutState, attemptKey } from '@/lib/auth/attempts';
import { rateLimit, resetRateLimits } from '@/lib/rate-limit';
import { LocalPasswordProvider, OidcProvider } from '@/lib/auth/identity';

let db: Database;

beforeEach(() => {
  db = createTestDb();
  db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t1', 'T1', 'MSP', '2026-01-01')`).run();
  db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t2', 'T2', 'MSP', '2026-01-01')`).run();
  resetRateLimits();
});

describe('passwords', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong horse battery staple', hash)).toBe(false);
  });

  it('never stores the password itself', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('produces a different hash each time', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
  });

  it('rejects a password that is too short or trivially guessable', () => {
    expect(() => assertPasswordAcceptable('short')).toThrow(WeakPasswordError);
    expect(() => assertPasswordAcceptable('aaaaaaaaaaaaaaa')).toThrow(WeakPasswordError);
    expect(() => assertPasswordAcceptable('password12345')).toThrow(WeakPasswordError);
    expect(() => assertPasswordAcceptable('x'.repeat(MIN_PASSWORD_LENGTH) + 'y')).not.toThrow();
  });

  it('returns false rather than throwing for a user with no password set', async () => {
    expect(await verifyPassword('anything at all', null)).toBe(false);
    expect(await verifyPassword('anything at all', 'garbage')).toBe(false);
  });
});

describe('authentication', () => {
  it('signs in a valid user', async () => {
    await createUser({ tenantId: 't1', email: 'a@example.com', name: 'A', role: 'MSP_USER', password: 'a-long-enough-password' }, db);
    const outcome = await authenticate('a@example.com', 'a-long-enough-password', '1.2.3.4', db);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.identity.role).toBe('MSP_USER');
  });

  it('is case-insensitive on email', async () => {
    await createUser({ tenantId: 't1', email: 'Mixed@Example.com', name: 'A', role: 'MSP_USER', password: 'a-long-enough-password' }, db);
    expect((await authenticate('mixed@example.com', 'a-long-enough-password', null, db)).ok).toBe(true);
  });

  it('gives the same message whether the user exists or the password is wrong', async () => {
    await createUser({ tenantId: 't1', email: 'a@example.com', name: 'A', role: 'MSP_USER', password: 'a-long-enough-password' }, db);
    const wrongPassword = await authenticate('a@example.com', 'not the password', null, db);
    const noSuchUser = await authenticate('nobody@example.com', 'not the password', null, db);
    expect(wrongPassword.ok).toBe(false);
    expect(noSuchUser.ok).toBe(false);
    if (!wrongPassword.ok && !noSuchUser.ok) expect(wrongPassword.reason).toBe(noSuchUser.reason);
  });

  it('refuses a disabled account', async () => {
    const user = await createUser({ tenantId: 't1', email: 'a@example.com', name: 'A', role: 'MSP_USER', password: 'a-long-enough-password' }, db);
    setStatus(user.id, 'disabled', db);
    expect((await authenticate('a@example.com', 'a-long-enough-password', null, db)).ok).toBe(false);
  });

  it('locks out after repeated failures and clears on success', async () => {
    await createUser({ tenantId: 't1', email: 'a@example.com', name: 'A', role: 'MSP_USER', password: 'a-long-enough-password' }, db);
    for (let i = 0; i < 8; i++) await authenticate('a@example.com', 'wrong', '9.9.9.9', db);

    const locked = await authenticate('a@example.com', 'a-long-enough-password', '9.9.9.9', db);
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.locked).toBe(true);

    // A different IP is not locked out by the first one's failures.
    expect((await authenticate('a@example.com', 'a-long-enough-password', '1.1.1.1', db)).ok).toBe(true);
    expect(lockoutState(attemptKey('a@example.com', '1.1.1.1'), db).locked).toBe(false);
  });
});

describe('sessions', () => {
  async function user(role: Role = 'MSP_USER', tenantId = 't1') {
    return createUser({ tenantId, email: `${role}-${tenantId}@example.com`, name: role, role, password: 'a-long-enough-password' }, db);
  }

  it('issues a session that resolves to its tenant and role', async () => {
    const u = await user('MSP_ADMIN');
    const issued = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);
    const resolved = resolveSession(issued.token, db);

    expect(resolved).not.toBeNull();
    expect(resolved!.context.tenantId).toBe('t1');
    expect(resolved!.context.role).toBe('MSP_ADMIN');
    expect(resolved!.context.userId).toBe(u.id);
  });

  it('stores only the hash of the token', async () => {
    const u = await user();
    const issued = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);
    const row = db.prepare(`SELECT token_hash FROM sessions WHERE id = ?`).get(issued.id) as { token_hash: string };
    expect(row.token_hash).not.toBe(issued.token);
    expect(row.token_hash).toBe(hashToken(issued.token));
  });

  it('rejects an unknown, revoked or expired token', async () => {
    const u = await user();
    const issued = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);

    expect(resolveSession('not-a-real-token', db)).toBeNull();
    expect(resolveSession(undefined, db)).toBeNull();

    revokeSession(issued.token, db);
    expect(resolveSession(issued.token, db)).toBeNull();

    const second = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);
    db.prepare(`UPDATE sessions SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?`).run(second.id);
    expect(resolveSession(second.token, db)).toBeNull();
  });

  it('stops resolving once the account is disabled', async () => {
    const u = await user();
    const issued = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);
    expect(resolveSession(issued.token, db)).not.toBeNull();
    setStatus(u.id, 'disabled', db);
    expect(resolveSession(issued.token, db)).toBeNull();
  });

  it('revokes every session when a password changes', async () => {
    const u = await user();
    const a = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);
    const b = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);

    await setPassword(u.id, 'a-different-long-password', db);

    expect(resolveSession(a.token, db)).toBeNull();
    expect(resolveSession(b.token, db)).toBeNull();
  });

  it('revokes all sessions for a user on demand', async () => {
    const u = await user();
    issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);
    issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);
    expect(revokeAllForUser(u.id, db)).toBe(2);
  });

  it('purges expired sessions', async () => {
    const u = await user();
    const issued = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);
    db.prepare(`UPDATE sessions SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?`).run(issued.id);
    expect(purgeExpiredSessions(db)).toBe(1);
  });

  it('carries a CSRF token that compares in constant time', async () => {
    const u = await user();
    const issued = issueSession({ userId: u.id, tenantId: u.tenantId }, {}, db);
    expect(csrfMatches(issued.csrfToken, issued.csrfToken)).toBe(true);
    expect(csrfMatches(issued.csrfToken, 'wrong')).toBe(false);
    expect(csrfMatches(issued.csrfToken, null)).toBe(false);
    expect(csrfMatches(issued.csrfToken, undefined)).toBe(false);
  });

  it('never resolves a session into another tenant', async () => {
    const one = await createUser({ tenantId: 't1', email: 'one@example.com', name: 'One', role: 'MSP_ADMIN', password: 'a-long-enough-password' }, db);
    const two = await createUser({ tenantId: 't2', email: 'two@example.com', name: 'Two', role: 'MSP_ADMIN', password: 'a-long-enough-password' }, db);

    const sessionOne = issueSession({ userId: one.id, tenantId: one.tenantId }, {}, db);
    const sessionTwo = issueSession({ userId: two.id, tenantId: two.tenantId }, {}, db);

    expect(resolveSession(sessionOne.token, db)!.context.tenantId).toBe('t1');
    expect(resolveSession(sessionTwo.token, db)!.context.tenantId).toBe('t2');
  });
});

describe('RBAC matrix', () => {
  const MUTATING: Permission[] = ['analyse', 'execute', 'halt', 'authorise', 'administer', 'platform'];

  it('gives READ_ONLY nothing but read', () => {
    expect(permissionsFor('READ_ONLY')).toEqual(['read']);
    for (const permission of MUTATING) {
      expect(can('READ_ONLY', permission), `READ_ONLY must not hold ${permission}`).toBe(false);
    }
  });

  it('lets MSP_USER do the work but not authorise it', () => {
    expect(can('MSP_USER', 'analyse')).toBe(true);
    expect(can('MSP_USER', 'execute')).toBe(true);
    expect(can('MSP_USER', 'authorise')).toBe(false);
    expect(can('MSP_USER', 'administer')).toBe(false);
  });

  it('keeps the emergency stop available to anyone who can act', () => {
    // An emergency stop that needs an administrator is not an emergency stop.
    expect(can('MSP_USER', 'halt')).toBe(true);
    expect(can('MSP_ADMIN', 'halt')).toBe(true);
    expect(can('READ_ONLY', 'halt')).toBe(false);
  });

  it('gives MSP_ADMIN everything but platform operations', () => {
    expect(can('MSP_ADMIN', 'authorise')).toBe(true);
    expect(can('MSP_ADMIN', 'administer')).toBe(true);
    expect(can('MSP_ADMIN', 'platform')).toBe(false);
    expect(can('PLATFORM_ADMIN', 'platform')).toBe(true);
  });

  it('throws a ForbiddenError naming the permission and role', () => {
    expect(() => assertCan('READ_ONLY', 'execute')).toThrow(ForbiddenError);
    try {
      assertCan('READ_ONLY', 'execute');
    } catch (err) {
      expect((err as ForbiddenError).permission).toBe('execute');
      expect((err as ForbiddenError).role).toBe('READ_ONLY');
    }
  });
});

describe('rate limiting', () => {
  it('allows a burst up to capacity then refuses', () => {
    const options = { capacity: 3, refillPerMinute: 1 };
    expect(rateLimit('k', options).allowed).toBe(true);
    expect(rateLimit('k', options).allowed).toBe(true);
    expect(rateLimit('k', options).allowed).toBe(true);
    const blocked = rateLimit('k', options);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills over time', () => {
    const options = { capacity: 1, refillPerMinute: 60 };
    const t0 = 1_000_000;
    expect(rateLimit('r', options, t0).allowed).toBe(true);
    expect(rateLimit('r', options, t0).allowed).toBe(false);
    expect(rateLimit('r', options, t0 + 2_000).allowed).toBe(true);
  });

  it('keys independently', () => {
    const options = { capacity: 1, refillPerMinute: 1 };
    expect(rateLimit('a', options).allowed).toBe(true);
    expect(rateLimit('b', options).allowed).toBe(true);
  });
});

describe('identity providers', () => {
  it('always has local password sign-in available', () => {
    expect(new LocalPasswordProvider().configured()).toBe(true);
  });

  it('reports SSO unconfigured rather than silently falling back', () => {
    expect(new OidcProvider(undefined, undefined, undefined).configured()).toBe(false);
    expect(new OidcProvider(undefined, undefined, undefined).authorizationUrl('state')).toBeNull();
  });

  it('builds an authorization URL once configured', () => {
    const provider = new OidcProvider('https://idp.example.com', 'client-123', 'https://app.example.com/cb', 'Acme SSO');
    expect(provider.configured()).toBe(true);
    const url = new URL(provider.authorizationUrl('xyz')!);
    expect(url.origin).toBe('https://idp.example.com');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('scope')).toContain('openid');
  });
});
