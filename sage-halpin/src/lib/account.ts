import { getStorageUser, setStorageUser } from "./userScope";

// Accounts in the browser: sign up, sign in and out, and keeping the account's
// workspace (organisation, people, question links, decision log) saved on the
// server so it follows the person to another device.
//
// Everything the app keeps in the browser is stored under "sagehalpin_<user>_<name>"
// (see userScope). Signed out, <user> is "anon". Signed in, it is the account id,
// and those entries are mirrored to the account.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PREFIX = "sagehalpin_";
const NAME = /^[a-z0-9_]{1,80}$/;
const SYNC_EVERY_MS = 4000;

export interface Account {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export class AccountError extends Error {
  constructor(message: string, readonly status: number, readonly fields: Record<string, string> = {}) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      credentials: "same-origin",
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new AccountError("We couldn't reach Sentinel8. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
  if (!res.ok) throw new AccountError(data.error ?? `Something went wrong (${res.status}). Please try again.`, res.status, data.fields);
  return data as T;
}

// ─── Local copies ───────────────────────────────────────────────────────────

/** The account's entries currently in this browser, by name. */
function localEntries(userId: string): Record<string, string> {
  const out: Record<string, string> = {};
  const prefix = `${PREFIX}${userId}_`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const name = key.slice(prefix.length);
    const value = localStorage.getItem(key);
    if (NAME.test(name) && value !== null) out[name] = value;
  }
  return out;
}

function writeLocal(userId: string, data: Record<string, string>) {
  for (const [name, value] of Object.entries(data)) if (NAME.test(name)) localStorage.setItem(`${PREFIX}${userId}_${name}`, value);
}

// What this browser last saved to, or loaded from, the account: a short
// fingerprint per entry. On the next load it tells entries changed here since
// (not yet saved: the page was closed or reloaded within a few seconds) apart
// from ones changed on another device, so neither is lost.
const BASELINE = "sentinel8_synced_";

function fingerprint(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  return `${value.length}:${(h >>> 0).toString(36)}`;
}

function readBaseline(userId: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(BASELINE + userId);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function writeBaseline(userId: string, data: Record<string, string>) {
  const prints: Record<string, string> = {};
  for (const [name, value] of Object.entries(data)) prints[name] = fingerprint(value);
  try {
    localStorage.setItem(BASELINE + userId, JSON.stringify(prints));
  } catch {
    // Storage full: the next load falls back to the account's copy.
  }
}

/**
 * The account's copy, with this browser's unsaved changes on top: entries
 * added, changed or removed here since the last save win; everything else
 * comes from the account.
 */
function merge(server: Record<string, string>, local: Record<string, string>, baseline: Record<string, string>) {
  const out = { ...server };
  for (const [name, value] of Object.entries(local)) if (fingerprint(value) !== baseline[name]) out[name] = value;
  for (const name of Object.keys(baseline)) {
    if (name in local) continue;
    if (name in server && fingerprint(server[name]) === baseline[name]) delete out[name]; // removed here, unchanged there
  }
  return out;
}

function clearLocal(userId: string) {
  const prefix = `${PREFIX}${userId}_`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

// ─── Keeping the account in step ────────────────────────────────────────────

let lastSaved = "";
let timer: number | null = null;
let saving: Promise<void> | null = null;
let onSessionEnded: (() => void) | null = null;

/** Saves this browser's copy to the account if it has changed since the last save. */
export async function saveNow({ leaving = false } = {}): Promise<void> {
  const userId = getStorageUser();
  if (!userId) return;
  const data = localEntries(userId);
  const snapshot = JSON.stringify(data);
  if (snapshot === lastSaved) return;
  if (saving) await saving;
  const body = JSON.stringify({ data });
  // keepalive lets the save finish as the page closes (browsers cap it at 64 KB).
  saving = call("/account/data", { method: "PUT", body, keepalive: leaving && body.length < 60_000 })
    .then(() => {
      lastSaved = snapshot;
      writeBaseline(userId, data);
    })
    .catch((err: unknown) => {
      if (err instanceof AccountError && err.status === 401) onSessionEnded?.();
      // Anything else: try again on the next tick.
    })
    .finally(() => {
      saving = null;
    });
  await saving;
}

function startSync() {
  stopSync();
  timer = window.setInterval(() => void saveNow(), SYNC_EVERY_MS);
  document.addEventListener("visibilitychange", saveWhenHidden);
  window.addEventListener("pagehide", saveOnLeave);
}

function stopSync() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", saveWhenHidden);
  window.removeEventListener("pagehide", saveOnLeave);
}

function saveWhenHidden() {
  if (document.visibilityState === "hidden") void saveNow({ leaving: true });
}

function saveOnLeave() {
  void saveNow({ leaving: true });
}

/**
 * Makes the account active in this browser. The account's saved copy wins, so
 * work saved from another device is never overwritten by an older copy here;
 * only changes made in this browser since its last save are kept on top. On
 * sign-up, whatever was built while signed out moves into the new account.
 */
async function activate(account: Account, { adoptSignedOut = false } = {}) {
  setStorageUser(account.id);
  const { data } = await call<{ data: Record<string, string> }>("/account/data");
  const local = localEntries(account.id);
  const baseline = readBaseline(account.id);
  let next: Record<string, string> | null = null;
  if (Object.keys(data).length > 0) next = baseline ? merge(data, local, baseline) : data;
  else if (adoptSignedOut && Object.keys(local).length === 0) {
    next = localEntries("anon");
    clearLocal("anon");
  }
  if (next) {
    clearLocal(account.id);
    writeLocal(account.id, next);
  }
  writeBaseline(account.id, data);
  lastSaved = JSON.stringify(data);
  startSync();
  await saveNow();
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** The signed-in account, if any, made active. Call once when the app starts. */
export async function resumeSession(sessionEnded: () => void): Promise<Account | null> {
  onSessionEnded = sessionEnded;
  try {
    const { account } = await call<{ account: Account }>("/auth/me");
    await activate(account);
    return account;
  } catch {
    setStorageUser(null);
    return null;
  }
}

export async function signUp(name: string, email: string, password: string): Promise<Account> {
  const { account } = await call<{ account: Account }>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) });
  await activate(account, { adoptSignedOut: true });
  return account;
}

export async function signIn(email: string, password: string): Promise<Account> {
  const { account } = await call<{ account: Account }>("/auth/signin", { method: "POST", body: JSON.stringify({ email, password }) });
  await activate(account);
  return account;
}

/** Saves, signs out, and removes the account's copy from this browser. */
export async function signOut({ everywhere = false } = {}): Promise<void> {
  const userId = getStorageUser();
  await saveNow();
  if (everywhere) await call("/auth/signout-everywhere", { method: "POST", body: "{}" });
  stopSync();
  await call("/auth/signout", { method: "POST", body: "{}" }).catch(() => undefined);
  if (userId) {
    clearLocal(userId);
    localStorage.removeItem(BASELINE + userId);
  }
  lastSaved = "";
  setStorageUser(null);
}

/** Changes the password. Other devices are signed out; this one stays signed in. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await call("/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
}
