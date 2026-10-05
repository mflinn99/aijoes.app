import { Router, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { getStore } from "../store.js";
import { isEmail } from "../../shared/board.js";
import {
  ACCOUNT_DATA_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  SESSION_COOKIE,
  accountRow,
  authConfigured,
  burnPasswordCheck,
  createSession,
  deleteAccount,
  findAccount,
  hashPassword,
  normaliseEmail,
  readAccountData,
  readSession,
  saveAccount,
  verifyPassword,
  writeAccountData,
  type Account,
} from "../auth.js";

// Sign up, sign in, sign out, and the account's saved workspace.

const router = Router();

// Without SESSION_SECRET in production, accounts are off rather than insecure.
router.use(["/auth", "/account"], (_req, res, next) => {
  if (authConfigured()) return next();
  res.status(503).json({ error: "Accounts aren't switched on yet. Please try again later." });
});

/** Saved keys are the browser's own storage names for the account's workspace. */
const DATA_KEY = /^[a-z0-9_]{1,80}$/;

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSession(res: Response, rowKey: string) {
  const { value, maxAgeMs } = createSession(rowKey);
  res.cookie(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeMs,
  });
}

function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
}

const publicAccount = (a: Account) => ({ id: a.id, email: a.email, name: a.name, createdAt: a.createdAt });

/**
 * Changes must come from this site as JSON: a form or image on another site
 * can't send JSON without the browser asking first, and an Origin from
 * elsewhere is refused outright.
 */
function sameSite(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch { /* refused below */ }
    if (host !== req.get("host")) {
      res.status(403).json({ error: "Requests must come from this site." });
      return;
    }
  }
  if (!req.is("application/json")) {
    res.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
}

async function requireAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const rowKey = readSession(cookies(req)[SESSION_COOKIE]);
    const account = rowKey ? await findAccount(getStore(), rowKey) : null;
    if (!account) {
      if (rowKey) clearSession(res);
      res.status(401).json({ error: "Your session has ended. Please sign in again." });
      return;
    }
    res.locals.account = account;
    next();
  } catch (err) {
    next(err);
  }
}

const account = (res: Response) => res.locals.account as Account;

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value.trim() : null;
}

router.post("/auth/signup", sameSite, async (req, res, next) => {
  try {
    const name = str(req.body?.name, 120);
    const email = str(req.body?.email, 254);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const fields: Record<string, string> = {};
    if (!name) fields.name = "Enter your name.";
    if (!email || !isEmail(email)) fields.email = "Enter a valid email address.";
    if (password.length < PASSWORD_MIN) fields.password = `Use at least ${PASSWORD_MIN} characters.`;
    else if (password.length > PASSWORD_MAX) fields.password = `Use at most ${PASSWORD_MAX} characters.`;
    if (Object.keys(fields).length) return res.status(422).json({ error: "Check the highlighted fields.", fields });

    const store = getStore();
    const row = accountRow(email!);
    if (await findAccount(store, row)) {
      return res.status(409).json({ error: "An account already exists for this email. Sign in instead.", fields: { email: "Already registered." } });
    }
    const created: Account = {
      id: randomBytes(12).toString("base64url"),
      email: normaliseEmail(email!),
      name: name!,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    await saveAccount(store, created);
    setSession(res, row);
    res.status(201).json({ account: publicAccount(created) });
  } catch (err) {
    next(err);
  }
});

router.post("/auth/signin", sameSite, async (req, res, next) => {
  try {
    const email = str(req.body?.email, 254) ?? "";
    const password = typeof req.body?.password === "string" ? req.body.password.slice(0, PASSWORD_MAX) : "";
    const found = email ? await findAccount(getStore(), accountRow(email)) : null;
    const ok = found ? await verifyPassword(password, found.passwordHash) : (await burnPasswordCheck(password), false);
    if (!found || !ok) return res.status(401).json({ error: "That email and password don't match an account." });
    setSession(res, accountRow(found.email));
    res.json({ account: publicAccount(found) });
  } catch (err) {
    next(err);
  }
});

router.post("/auth/signout", sameSite, (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/auth/me", requireAccount, (_req, res) => {
  res.json({ account: publicAccount(account(res)) });
});

router.get("/account/data", requireAccount, async (_req, res, next) => {
  try {
    res.json({ data: await readAccountData(getStore(), account(res)) });
  } catch (err) {
    next(err);
  }
});

router.put("/account/data", sameSite, requireAccount, async (req, res, next) => {
  try {
    const data = req.body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return res.status(422).json({ error: "data must be an object" });
    const clean: Record<string, string> = {};
    let size = 0;
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (!DATA_KEY.test(k) || typeof v !== "string") return res.status(422).json({ error: `invalid entry: ${k.slice(0, 80)}` });
      size += k.length + v.length;
      clean[k] = v;
    }
    if (size > ACCOUNT_DATA_MAX) return res.status(413).json({ error: "Your saved workspace is too large to store." });
    await writeAccountData(getStore(), account(res), clean);
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

router.delete("/account", sameSite, requireAccount, async (req, res, next) => {
  try {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!(await verifyPassword(password, account(res).passwordHash))) return res.status(401).json({ error: "That password is not correct." });
    await deleteAccount(getStore(), account(res));
    clearSession(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
