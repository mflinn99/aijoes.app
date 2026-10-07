import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Store } from "./store.js";

// Accounts: an email and password per person, a signed session cookie, and the
// account's saved workspace (the organisation, its people and the links to its
// questions), encrypted at rest so it can follow the person to another device.
//
// Documents live in the "accounts" partition: one row per account keyed by a
// hash of the email address (so the address is never a key), and one encrypted
// data row per account.

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const ACCOUNTS = "accounts";
export const SESSION_COOKIE = "s8_session";
export const SESSION_DAYS = 14;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;
export const ACCOUNT_DATA_MAX = 1_000_000; // characters of saved workspace JSON

export interface Account {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export class AuthConfigError extends Error {}

let devSecret: string | null = null;

/** The secret that signs sessions and encrypts account data. Required in production. */
function secret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") throw new AuthConfigError("Set SESSION_SECRET (at least 32 characters) to enable accounts");
  // Development and tests: a fresh secret per process. Sessions end on restart.
  devSecret ??= randomBytes(32).toString("base64url");
  return devSecret;
}

/** Whether accounts can run here (production needs SESSION_SECRET). */
export function authConfigured(): boolean {
  try {
    secret();
    return true;
  } catch {
    return false;
  }
}

const key = (purpose: string) => Buffer.from(hkdfSync("sha256", secret(), "sentinel8", purpose, 32));

export const normaliseEmail = (email: string) => email.trim().toLowerCase();
export const accountRow = (email: string) => "a-" + createHash("sha256").update(normaliseEmail(email)).digest("hex");
const dataRow = (accountId: string) => `data-${accountId}`;

// ─── Passwords ──────────────────────────────────────────────────────────────

const N = 16384, R = 8, P = 1;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, 64, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, R, P, salt.toString("base64url"), derived.toString("base64url")].join(":");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const derived = await scryptAsync(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Spends the same time as a real check, so an unknown email can't be told from a wrong password. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
}

// ─── Sessions ───────────────────────────────────────────────────────────────
//
// The cookie carries the account's row key, a random session id and an expiry,
// signed so it can't be forged. Each session also has a record on the server
// (partition "sessions-<account id>", row = a hash of the session id), so a
// session ends for real when it is signed out, when the person signs out
// everywhere, changes their password or deletes the account, and when the
// record is removed by an operator. A cookie whose record is gone is refused.

const sign = (payload: string) => createHmac("sha256", key("session")).update(payload).digest("base64url");

export interface SessionClaim {
  k: string; // account row key
  s: string; // session id
}

export interface SessionRecord {
  createdAt: string;
  expiresAt: number;
}

export const sessionPartition = (accountId: string) => `sessions-${accountId}`;
const sessionRow = (sid: string) => createHash("sha256").update(sid).digest("hex");

export function createSession(accountRowKey: string, now = Date.now()): { value: string; sid: string; maxAgeMs: number; expiresAt: number } {
  const maxAgeMs = SESSION_DAYS * 24 * 60 * 60 * 1000;
  const sid = randomBytes(32).toString("base64url");
  const expiresAt = now + maxAgeMs;
  const payload = Buffer.from(JSON.stringify({ k: accountRowKey, s: sid, exp: expiresAt })).toString("base64url");
  return { value: `${payload}.${sign(payload)}`, sid, maxAgeMs, expiresAt };
}

/** The claim in a validly signed, unexpired session cookie, or null. Callers must still check the server record. */
export function readSession(value: string | undefined, now = Date.now()): SessionClaim | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { k, s, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { k?: unknown; s?: unknown; exp?: unknown };
    return typeof k === "string" && typeof s === "string" && typeof exp === "number" && exp > now ? { k, s } : null;
  } catch {
    return null;
  }
}

export async function recordSession(store: Store, account: Account, sid: string, expiresAt: number): Promise<void> {
  await store.put<SessionRecord>(sessionPartition(account.id), sessionRow(sid), { createdAt: new Date().toISOString(), expiresAt });
}

export async function sessionIsLive(store: Store, account: Account, sid: string, now = Date.now()): Promise<boolean> {
  const record = await store.get<SessionRecord>(sessionPartition(account.id), sessionRow(sid));
  return record !== null && record.expiresAt > now;
}

export async function endSession(store: Store, account: Account, sid: string): Promise<void> {
  await store.remove(sessionPartition(account.id), sessionRow(sid));
}

/** Ends every session for the account, except `keepSid` when given. Also clears expired records. */
export async function endAllSessions(store: Store, account: Account, keepSid?: string): Promise<number> {
  const keep = keepSid ? sessionRow(keepSid) : null;
  let ended = 0;
  for (const { row } of await store.list<SessionRecord>(sessionPartition(account.id))) {
    if (row === keep) continue;
    await store.remove(sessionPartition(account.id), row);
    ended += 1;
  }
  return ended;
}

// ─── Sign-in throttling per account ─────────────────────────────────────────
//
// On top of the per-IP limit: after LOCK_AFTER failed sign-ins for one email
// address within LOCK_WINDOW_MS, sign-in for that address is refused for
// LOCK_FOR_MS, whatever the password, from any address. Tracked for unknown
// addresses too, so the answer never reveals whether an account exists.

export const THROTTLE = "throttle";
export const LOCK_AFTER = 10;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_FOR_MS = 15 * 60 * 1000;

interface Throttle {
  fails: number;
  windowStart: number;
  lockedUntil: number;
}

export async function signInLockedUntil(store: Store, email: string, now = Date.now()): Promise<number | null> {
  const t = await store.get<Throttle>(THROTTLE, accountRow(email));
  return t && t.lockedUntil > now ? t.lockedUntil : null;
}

export async function recordFailedSignIn(store: Store, email: string, now = Date.now()): Promise<void> {
  const row = accountRow(email);
  const t = (await store.get<Throttle>(THROTTLE, row)) ?? { fails: 0, windowStart: now, lockedUntil: 0 };
  if (now - t.windowStart > LOCK_WINDOW_MS) Object.assign(t, { fails: 0, windowStart: now });
  t.fails += 1;
  if (t.fails >= LOCK_AFTER) Object.assign(t, { lockedUntil: now + LOCK_FOR_MS, fails: 0, windowStart: now });
  await store.put(THROTTLE, row, t);
}

export async function clearFailedSignIns(store: Store, email: string): Promise<void> {
  await store.remove(THROTTLE, accountRow(email));
}

// ─── Saved workspace data, encrypted at rest ────────────────────────────────

function encrypt(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("account-data"), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

function decrypt(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key("account-data"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

// ─── Storage ────────────────────────────────────────────────────────────────

export async function findAccount(store: Store, rowKey: string): Promise<Account | null> {
  return store.get<Account>(ACCOUNTS, rowKey);
}

export async function saveAccount(store: Store, account: Account): Promise<void> {
  await store.put(ACCOUNTS, accountRow(account.email), account);
}

export async function readAccountData(store: Store, account: Account): Promise<Record<string, string>> {
  const row = await store.get<{ sealed: string }>(ACCOUNTS, dataRow(account.id));
  if (!row) return {};
  try {
    return JSON.parse(decrypt(row.sealed)) as Record<string, string>;
  } catch {
    // Sealed with an earlier SESSION_SECRET (rotated): unreadable, so the
    // account starts empty and the next save replaces it. Never block sign-in.
    console.warn(`Saved workspace for account ${account.id} could not be decrypted; starting empty`);
    return {};
  }
}

export async function deleteAccount(store: Store, account: Account): Promise<void> {
  await endAllSessions(store, account);
  await store.remove(ACCOUNTS, dataRow(account.id));
  await store.remove(ACCOUNTS, accountRow(account.email));
}

export async function writeAccountData(store: Store, account: Account, data: Record<string, string>): Promise<void> {
  await store.put(ACCOUNTS, dataRow(account.id), { sealed: encrypt(JSON.stringify(data)), updatedAt: new Date().toISOString() });
}
