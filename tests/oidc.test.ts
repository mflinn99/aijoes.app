/**
 * OpenID Connect sign-in — iteration 3.
 *
 * The tests that matter here are the ones covering what a careless
 * implementation skips: signature verification, nonce binding, single-use
 * state, and refusing to provision accounts from an unverified assertion.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import {
  discover, clearDiscoveryCache, beginAuth, consumeState, purgeExpiredStates,
  verifyIdToken, exchangeCode, resolveIdentity, type OidcConfig, type Fetcher,
} from '@/lib/auth/oidc';
import { createUser, getUserByEmail, setStatus } from '@/lib/auth/users';

const ISSUER = 'https://idp.example.com';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as Record<string, string>;
const KID = 'test-key-1';

const CONFIG: OidcConfig = {
  issuer: ISSUER,
  clientId: 'metamsp-client',
  clientSecret: 'client-secret-value',
  redirectUri: 'https://app.example.com/api/auth/callback',
  jitTenantId: null,
  jitRole: 'READ_ONLY',
};

function sign(claims: Record<string, unknown>, opts: { alg?: string; kid?: string; key?: typeof privateKey } = {}): string {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${encode(header)}.${encode(claims)}`;
  const signer = createSign('sha256');
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(opts.key ?? privateKey).toString('base64url')}`;
}

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    aud: CONFIG.clientId,
    sub: 'idp-subject-1',
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
    nonce: 'the-nonce',
    email: 'person@example.com',
    email_verified: true,
    name: 'A Person',
    ...overrides,
  };
}

const fetcher: Fetcher = async (url, init) => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  if (url.endsWith('/.well-known/openid-configuration')) {
    return ok({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
    });
  }
  if (url.endsWith('/jwks')) return ok({ keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] });
  if (url.endsWith('/token')) {
    expect(init?.headers?.['authorization']).toMatch(/^Basic /);
    return ok({ id_token: sign(validClaims()) });
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

let db: Database;

beforeEach(() => {
  clearDiscoveryCache();
  db = createTestDb();
  db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t1', 'T1', 'MSP', '2026-01-01')`).run();
});

describe('discovery', () => {
  it('reads the endpoints and caches them', async () => {
    let calls = 0;
    const counting: Fetcher = async (url, init) => { if (url.includes('.well-known')) calls++; return fetcher(url, init); };
    await discover(CONFIG, counting);
    await discover(CONFIG, counting);
    expect(calls).toBe(1);
  });

  it('refuses a document naming a different issuer', async () => {
    const wrong: Fetcher = async () => ({
      ok: true, status: 200,
      json: async () => ({ issuer: 'https://evil.example.com', authorization_endpoint: 'x', token_endpoint: 'y', jwks_uri: 'z' }),
    });
    await expect(discover(CONFIG, wrong)).rejects.toThrow(/different issuer/);
  });

  it('refuses an incomplete document', async () => {
    const partial: Fetcher = async () => ({ ok: true, status: 200, json: async () => ({ issuer: ISSUER }) });
    await expect(discover(CONFIG, partial)).rejects.toThrow(/incomplete/);
  });
});

describe('state', () => {
  it('builds an authorization URL carrying state and nonce', async () => {
    const auth = await beginAuth(CONFIG, '/company/123', db, fetcher);
    const url = new URL(auth.url);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get('state')).toBe(auth.state);
    expect(url.searchParams.get('nonce')).toBe(auth.nonce);
    expect(url.searchParams.get('client_id')).toBe(CONFIG.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
  });

  it('is single use', async () => {
    const auth = await beginAuth(CONFIG, '/', db, fetcher);
    expect(consumeState(auth.state, db)).not.toBeNull();
    expect(consumeState(auth.state, db)).toBeNull();
  });

  it('rejects an unknown or expired state', async () => {
    expect(consumeState('never-issued', db)).toBeNull();

    const auth = await beginAuth(CONFIG, '/', db, fetcher);
    db.prepare(`UPDATE oidc_states SET expires_at = '2020-01-01T00:00:00Z' WHERE state = ?`).run(auth.state);
    expect(consumeState(auth.state, db)).toBeNull();
  });

  it('will not carry an absolute URL as the post-login redirect', async () => {
    const auth = await beginAuth(CONFIG, 'https://evil.example.com/steal', db, fetcher);
    expect(consumeState(auth.state, db)!.redirectTo).toBe('/');
  });

  it('purges expired states', async () => {
    const auth = await beginAuth(CONFIG, '/', db, fetcher);
    db.prepare(`UPDATE oidc_states SET expires_at = '2020-01-01T00:00:00Z' WHERE state = ?`).run(auth.state);
    expect(purgeExpiredStates(db)).toBe(1);
  });
});

describe('id_token verification', () => {
  it('accepts a correctly signed token', async () => {
    const claims = await verifyIdToken(sign(validClaims()), CONFIG, 'the-nonce', fetcher);
    expect(claims.email).toBe('person@example.com');
  });

  it('rejects a token signed by a different key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = sign(validClaims(), { key: other.privateKey });
    await expect(verifyIdToken(forged, CONFIG, 'the-nonce', fetcher)).rejects.toThrow(/signature is not valid/);
  });

  it('rejects alg "none" and HMAC confusion', async () => {
    const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${encode({ alg: 'none' })}.${encode(validClaims())}.`;
    await expect(verifyIdToken(none, CONFIG, 'the-nonce', fetcher)).rejects.toThrow(/Unsupported id_token algorithm/);

    const hs = `${encode({ alg: 'HS256' })}.${encode(validClaims())}.c2ln`;
    await expect(verifyIdToken(hs, CONFIG, 'the-nonce', fetcher)).rejects.toThrow(/Unsupported id_token algorithm/);
  });

  it('rejects a mismatched nonce, issuer, audience or an expired token', async () => {
    await expect(verifyIdToken(sign(validClaims()), CONFIG, 'different-nonce', fetcher)).rejects.toThrow(/nonce/);
    await expect(verifyIdToken(sign(validClaims({ iss: 'https://other.example.com' })), CONFIG, 'the-nonce', fetcher)).rejects.toThrow(/issuer/);
    await expect(verifyIdToken(sign(validClaims({ aud: 'someone-else' })), CONFIG, 'the-nonce', fetcher)).rejects.toThrow(/audience/);
    await expect(verifyIdToken(sign(validClaims({ exp: Math.floor(Date.now() / 1000) - 10 })), CONFIG, 'the-nonce', fetcher)).rejects.toThrow(/expired/);
  });

  it('accepts an audience array containing the client id', async () => {
    const claims = await verifyIdToken(sign(validClaims({ aud: ['other', CONFIG.clientId] })), CONFIG, 'the-nonce', fetcher);
    expect(claims.sub).toBe('idp-subject-1');
  });

  it('rejects a malformed token', async () => {
    await expect(verifyIdToken('not.a.jwt.at.all', CONFIG, 'n', fetcher)).rejects.toThrow(/Malformed/);
  });
});

describe('token exchange', () => {
  it('returns the id_token', async () => {
    expect((await exchangeCode(CONFIG, 'the-code', fetcher)).id_token).toBeTruthy();
  });

  it('never surfaces the client secret on failure', async () => {
    const failing: Fetcher = async (url, init) =>
      url.endsWith('/token')
        ? { ok: false, status: 401, json: async () => ({ error: 'invalid_client', secret: CONFIG.clientSecret }) }
        : fetcher(url, init);
    await expect(exchangeCode(CONFIG, 'c', failing)).rejects.toThrow(/token exchange failed \(401\)/);
    await expect(exchangeCode(CONFIG, 'c', failing)).rejects.not.toThrow(/client-secret-value/);
  });
});

describe('identity resolution', () => {
  it('matches an existing user and records the provider', async () => {
    const user = await createUser({ tenantId: 't1', email: 'person@example.com', name: 'P', role: 'MSP_USER' }, db);
    const resolved = await resolveIdentity(validClaims() as never, CONFIG, db);

    expect(resolved.id).toBe(user.id);
    const row = db.prepare(`SELECT idp, idp_subject FROM users WHERE id = ?`).get(user.id) as { idp: string; idp_subject: string };
    expect(row.idp).toBe('oidc');
    expect(row.idp_subject).toBe('idp-subject-1');
  });

  it('refuses a disabled account', async () => {
    const user = await createUser({ tenantId: 't1', email: 'person@example.com', name: 'P', role: 'MSP_USER' }, db);
    setStatus(user.id, 'disabled', db);
    await expect(resolveIdentity(validClaims() as never, CONFIG, db)).rejects.toThrow(/disabled/);
  });

  it('refuses an unverified email address', async () => {
    await expect(resolveIdentity(validClaims({ email_verified: false }) as never, CONFIG, db)).rejects.toThrow(/unverified/);
  });

  it('refuses an assertion with no email at all', async () => {
    await expect(resolveIdentity(validClaims({ email: undefined }) as never, CONFIG, db)).rejects.toThrow(/did not assert an email/);
  });

  it('does not provision an account unless a tenant is named for it', async () => {
    await expect(resolveIdentity(validClaims() as never, CONFIG, db)).rejects.toThrow(/not enabled on this deployment/);
    expect(getUserByEmail('person@example.com', db)).toBeNull();
  });

  it('provisions into the configured tenant at the configured role', async () => {
    const jit: OidcConfig = { ...CONFIG, jitTenantId: 't1', jitRole: 'MSP_USER' };
    const user = await resolveIdentity(validClaims() as never, jit, db);
    expect(user.tenantId).toBe('t1');
    expect(user.role).toBe('MSP_USER');
    expect(user.idp).toBe('oidc');
  });

  it('a provisioned account has no password to sign in with', async () => {
    const jit: OidcConfig = { ...CONFIG, jitTenantId: 't1', jitRole: 'READ_ONLY' };
    await resolveIdentity(validClaims({ email: `${randomUUID()}@example.com` }) as never, jit, db);
    const row = db.prepare(`SELECT password_hash FROM users WHERE idp = 'oidc' LIMIT 1`).get() as { password_hash: string | null };
    expect(row.password_hash).toBeNull();
  });
});
