/**
 * Password hashing. scrypt from node:crypto — no dependency, memory-hard, and
 * the parameters are stored with the hash so they can be raised later without
 * invalidating existing passwords.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 12;

export class WeakPasswordError extends Error {}

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  // Length is the control that matters; a long passphrase beats a short
  // scrambled one. Reject only the cases that are trivially guessable.
  if (/^(.)\1+$/.test(password)) {
    throw new WeakPasswordError('Password must not be a single repeated character.');
  }
  if (/^(password|letmein|changeme|welcome)/i.test(password)) {
    throw new WeakPasswordError('Password must not begin with a common word.');
  }
}

/** Format: scrypt$N$r$p$salt$hash — all base64url. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Still spend the time, so a missing password hash is not detectable by
    // response latency.
    await scrypt(password, randomBytes(16), KEY_LENGTH, PARAMS);
    return false;
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');

  const derived = await scrypt(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
