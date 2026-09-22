/**
 * OpenID Connect sign-in.
 *
 * Authorization code flow for a confidential client. The pieces that matter for
 * safety, and that a "works on my machine" implementation usually skips:
 *
 *  - `state` is single-use, stored server side, and expires in ten minutes.
 *  - `nonce` is bound to the state row and checked against the id_token.
 *  - the id_token's signature is verified against the issuer's JWKS, not
 *    decoded and trusted.
 *  - `iss`, `aud` and `exp` are all checked.
 *
 * Just-in-time provisioning is off unless a tenant is named in configuration,
 * because silently creating accounts from an unverified assertion is how an
 * SSO integration becomes an open door.
 */

import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import { getUserByEmail, createUser, type UserRecord } from './users';
import type { Role } from './rbac';

const STATE_TTL_MS = 10 * 60_000;

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** When set, a user authenticated by the IdP is provisioned into this tenant. */
  jitTenantId: string | null;
  jitRole: Role;
}

export function oidcConfig(): OidcConfig | null {
  const issuer = process.env.METAMSP_OIDC_ISSUER;
  const clientId = process.env.METAMSP_OIDC_CLIENT_ID;
  const clientSecret = process.env.METAMSP_OIDC_CLIENT_SECRET;
  const redirectUri = process.env.METAMSP_OIDC_REDIRECT_URI;
  if (!issuer || !clientId || !clientSecret || !redirectUri) return null;

  return {
    issuer: issuer.replace(/\/$/, ''),
    clientId,
    clientSecret,
    redirectUri,
    jitTenantId: process.env.METAMSP_OIDC_JIT_TENANT ?? null,
    jitRole: (process.env.METAMSP_OIDC_JIT_ROLE as Role | undefined) ?? 'READ_ONLY',
  };
}

export interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const defaultFetch: Fetcher = (url, init) => fetch(url, init) as unknown as ReturnType<Fetcher>;

const discoveryCache = new Map<string, { value: Discovery; expiresAt: number }>();

export async function discover(config: OidcConfig, fetcher: Fetcher = defaultFetch): Promise<Discovery> {
  const cached = discoveryCache.get(config.issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const res = await fetcher(`${config.issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`Identity provider discovery failed (${res.status}).`);

  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error('Identity provider discovery document is incomplete.');
  }
  // The document must describe the issuer we asked for.
  if (doc.issuer && doc.issuer.replace(/\/$/, '') !== config.issuer) {
    throw new Error('Identity provider discovery document names a different issuer.');
  }

  discoveryCache.set(config.issuer, { value: doc, expiresAt: Date.now() + 3_600_000 });
  return doc;
}

export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

// --- state -----------------------------------------------------------------

export interface AuthRequest {
  state: string;
  nonce: string;
  url: string;
}

export async function beginAuth(
  config: OidcConfig,
  redirectTo: string,
  db: Database = getDb(),
  fetcher: Fetcher = defaultFetch,
): Promise<AuthRequest> {
  const doc = await discover(config, fetcher);
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const now = new Date();

  db.prepare(
    `INSERT INTO oidc_states (state, nonce, redirect_to, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    state,
    nonce,
    redirectTo.startsWith('/') ? redirectTo : '/',
    now.toISOString(),
    new Date(now.getTime() + STATE_TTL_MS).toISOString(),
  );

  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);

  return { state, nonce, url: url.toString() };
}

export interface ConsumedState {
  nonce: string;
  redirectTo: string;
}

/** Single use: a state already consumed, expired or unknown is rejected. */
export function consumeState(state: string, db: Database = getDb()): ConsumedState | null {
  const row = db
    .prepare(`SELECT nonce, redirect_to, expires_at, consumed_at FROM oidc_states WHERE state = ?`)
    .get(state) as { nonce: string; redirect_to: string; expires_at: string; consumed_at: string | null } | undefined;

  if (!row) return null;
  if (row.consumed_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  db.prepare(`UPDATE oidc_states SET consumed_at = ? WHERE state = ?`).run(new Date().toISOString(), state);
  return { nonce: row.nonce, redirectTo: row.redirect_to };
}

export function purgeExpiredStates(db: Database = getDb()): number {
  return db.prepare(`DELETE FROM oidc_states WHERE expires_at < ?`).run(new Date().toISOString()).changes;
}

// --- token verification -----------------------------------------------------

interface Jwk { kty: string; kid?: string; use?: string; alg?: string; n?: string; e?: string; crv?: string; x?: string; y?: string }

export interface IdTokenClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

const SUPPORTED_ALGS = new Set(['RS256', 'RS384', 'RS512', 'ES256']);

function base64urlJson<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
}

/**
 * Verify the id_token's signature against the issuer's JWKS, then its claims.
 * An unverified token is an assertion by whoever sent it, which is the whole
 * thing SSO is supposed to prevent.
 */
export async function verifyIdToken(
  idToken: string,
  config: OidcConfig,
  expectedNonce: string,
  fetcher: Fetcher = defaultFetch,
  now = Date.now(),
): Promise<IdTokenClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token.');

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  const header = base64urlJson<{ alg: string; kid?: string }>(headerB64);

  if (!SUPPORTED_ALGS.has(header.alg)) {
    // "none" and HMAC algorithms are exactly the confusion attacks worth refusing.
    throw new Error(`Unsupported id_token algorithm: ${header.alg}.`);
  }

  const doc = await discover(config, fetcher);
  const jwksRes = await fetcher(doc.jwks_uri);
  if (!jwksRes.ok) throw new Error('Could not retrieve the identity provider signing keys.');
  const jwks = (await jwksRes.json()) as { keys?: Jwk[] };

  const candidates = (jwks.keys ?? []).filter((k) => (header.kid ? k.kid === header.kid : true));
  if (candidates.length === 0) throw new Error('No signing key matches the id_token.');

  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, 'base64url');

  const verified = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk as never, format: 'jwk' });
      const algorithm = header.alg.startsWith('ES') ? 'sha256' : `sha${header.alg.slice(2)}`;
      const verifier = createVerify(algorithm);
      verifier.update(signingInput);
      verifier.end();
      return verifier.verify(
        header.alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' } : key,
        signature,
      );
    } catch {
      return false;
    }
  });

  if (!verified) throw new Error('The id_token signature is not valid.');

  const claims = base64urlJson<IdTokenClaims>(payloadB64);

  if (claims.iss.replace(/\/$/, '') !== config.issuer) throw new Error('id_token issuer does not match.');

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId)) throw new Error('id_token audience does not match.');

  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new Error('id_token has expired.');

  if (!claims.nonce || !constantTimeEqual(claims.nonce, expectedNonce)) {
    throw new Error('id_token nonce does not match this sign-in.');
  }

  return claims;
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function exchangeCode(
  config: OidcConfig,
  code: string,
  fetcher: Fetcher = defaultFetch,
): Promise<{ id_token: string }> {
  const doc = await discover(config, fetcher);
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const res = await fetcher(doc.token_endpoint, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }).toString(),
  });

  // The body can echo the client secret; never surface it.
  if (!res.ok) throw new Error(`Identity provider token exchange failed (${res.status}).`);

  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error('Identity provider returned no id_token.');
  return { id_token: json.id_token };
}

/**
 * Match the asserted identity to a local user.
 *
 * An unverified email is never matched, and provisioning happens only where a
 * tenant has been named for it.
 */
export async function resolveIdentity(
  claims: IdTokenClaims,
  config: OidcConfig,
  db: Database = getDb(),
): Promise<UserRecord> {
  const email = claims.email?.toLowerCase();
  if (!email) throw new Error('The identity provider did not assert an email address.');
  if (claims.email_verified === false) {
    throw new Error('The identity provider reports this email address as unverified.');
  }

  const existing = getUserByEmail(email, db);
  if (existing) {
    if (existing.status !== 'active') throw new Error('That account is disabled.');
    db.prepare(`UPDATE users SET idp = 'oidc', idp_subject = ?, last_login_at = ? WHERE id = ?`)
      .run(claims.sub, new Date().toISOString(), existing.id);
    return existing;
  }

  if (!config.jitTenantId) {
    throw new Error(
      'No account exists for that address, and just-in-time provisioning is not enabled on this deployment.',
    );
  }

  return createUser(
    {
      tenantId: config.jitTenantId,
      email,
      name: claims.name ?? email,
      role: config.jitRole,
      idp: 'oidc',
    },
    db,
  );
}

/** Stable identifier for logging without exposing the subject. */
export function subjectFingerprint(sub: string): string {
  return createHash('sha256').update(sub).digest('hex').slice(0, 12);
}
