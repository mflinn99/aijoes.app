// Authentication and roles. VIEWER reads. OPERATOR runs prospecting and can
// halt sending. Only ADMIN can switch live sending on, raise the threshold,
// lift a halt or change suppression and users.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Repo } from "./repo";
import { newId } from "./repo";
import type { Role } from "../shared/types";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const a = scryptSync(pw, Buffer.from(salt, "hex"), 64);
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createUser(repo: Repo, u: { email: string; name: string; role: Role; password: string }): User {
  if (u.password.length < 12) throw new Error("Passwords must be at least 12 characters");
  const user = { id: newId("usr"), email: u.email.trim().toLowerCase(), name: u.name, role: u.role };
  repo.db
    .prepare("INSERT INTO users (id,email,name,role,password_hash,created_at) VALUES (?,?,?,?,?,?)")
    .run(user.id, user.email, user.name, user.role, hashPassword(u.password), repo.now());
  return user;
}

const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
export const SESSION_COOKIE = "hj_session";
const SESSION_HOURS = 12;

export function login(repo: Repo, email: string, password: string): { token: string; user: User } | null {
  const r = repo.db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as any;
  // Always do the work, so timing does not reveal which emails exist.
  const ok = verifyPassword(password, r?.password_hash ?? "scrypt:00:00");
  if (!r || !ok) return null;
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(repo.clock.now().getTime() + SESSION_HOURS * 3600_000).toISOString();
  repo.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)").run(tokenHash(token), r.id, expires);
  return { token, user: { id: r.id, email: r.email, name: r.name, role: r.role } };
}

export function logout(repo: Repo, token: string): void {
  repo.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function userForToken(repo: Repo, token: string | undefined): User | null {
  if (!token) return null;
  const r = repo.db
    .prepare("SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
    .get(tokenHash(token)) as any;
  if (!r || r.expires_at < repo.now()) return null;
  return { id: r.id, email: r.email, name: r.name, role: r.role };
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

const RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

export function requireRole(min: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as User | undefined;
    if (!user) return res.status(401).json({ error: "Sign in required" });
    if (RANK[user.role] < RANK[min]) return res.status(403).json({ error: `Requires ${min}` });
    next();
  };
}

/** Simple fixed-window limiter for sign-in attempts, per address and per IP. */
export class AttemptLimiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(
    private max = 10,
    private windowMs = 15 * 60_000,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.until < now) {
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }
}
