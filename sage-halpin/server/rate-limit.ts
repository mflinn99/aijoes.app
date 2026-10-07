import type { Request, Response } from "express";
import expressRateLimit from "express-rate-limit";

// Fixed-window limit per client IP for the public AI endpoints and for
// accounts. Each board session fans out to several model calls, so this caps
// cost and abuse. It is per replica (in memory); Azure Front Door WAF rate
// limiting in front gives the global cap, and sign-in also has a per-account
// lock stored in the database (server/auth.ts).

export function rateLimit({ windowMs, max, message = "Too many board sessions. Please wait before convening again." }: { windowMs: number; max: number; message?: string }) {
  return expressRateLimit({
    windowMs,
    limit: max,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const seconds = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : Math.ceil(windowMs / 1000);
      res.setHeader("Retry-After", String(seconds));
      res.status(429).json({ error: message });
    },
  });
}

export function limitFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
