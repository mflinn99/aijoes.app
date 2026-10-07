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
  clearFailedSignIns,
  createSession,
  deleteAccount,
  endAllSessions,
  endSession,
  findAccount,
  hashPassword,
  normaliseEmail,
  readAccountData,
  readSession,
  recordFailedSignIn,
  recordSession,
  saveAccount,
  sessionIsLive,
  signInLockedUntil,
  verifyPassword,
  writeAccountData,
  type Account,
} from "../auth.js";
import { passwordProblem } from "../password-policy.js";

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

const production = () => process.env.NODE_ENV === "production";

/** In production the cookie takes the __Host- prefix: HTTPS only, this host only, whole site. */
export const sessionCookieName = () => (production() ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE);

const cookieOptions = () => ({ httpOnly: true, sameSite: "lax" as const, secure: production(), path: "/" });

async function startSession(res: Response, account: Account) {
  const { value, sid, maxAgeMs, expiresAt } = createSession(accountRow(account.email));
  await recordSession(getStore(), account, sid, expiresAt);
  res.cookie(sessionCookieName(), value, { ...cookieOptions(), maxAge: maxAgeMs });
  return sid;
}

function clearSession(res: Response) {
  res.clearCookie(sessionCookieName(), cookieOptions());
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
    const claim = readSession(cookies(req)[sessionCookieName()]);
    const store = getStore();
    const found = claim ? await findAccount(store, claim.k) : null;
    const account = found && (await sessionIsLive(store, found, claim!.s)) ? found : null;
    if (!account) {
      if (claim) clearSession(res);
      res.status(401).json({ error: "Your session has ended. Please sign in again." });
      return;
    }
    res.locals.account = account;
    res.locals.sid = claim!.s;
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
    else {
      const problem = passwordProblem(password, { email: email ?? "", name: name ?? "" });
      if (problem) fields.password = problem;
    }
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
    await startSession(res, created);
    res.status(201).json({ account: publicAccount(created) });
  } catch (err) {
    next(err);
  }
});

const LOCKED = "Too many sign-in attempts for this account. Please wait 15 minutes and try again.";

router.post("/auth/signin", sameSite, async (req, res, next) => {
  try {
    const store = getStore();
    const email = str(req.body?.email, 254) ?? "";
    const password = typeof req.body?.password === "string" ? req.body.password.slice(0, PASSWORD_MAX) : "";
    if (email && (await signInLockedUntil(store, email))) {
      await burnPasswordCheck(password); // same timing as a real attempt
      return res.status(429).json({ error: LOCKED });
    }
    const found = email ? await findAccount(store, accountRow(email)) : null;
    const ok = found ? await verifyPassword(password, found.passwordHash) : (await burnPasswordCheck(password), false);
    if (!found || !ok) {
      if (email) await recordFailedSignIn(store, email);
      return res.status(401).json({ error: "That email and password don't match an account." });
    }
    await clearFailedSignIns(store, email);
    await startSession(res, found);
    res.json({ account: publicAccount(found) });
  } catch (err) {
    next(err);
  }
});

router.post("/auth/signout", sameSite, async (req, res, next) => {
  try {
    // End the server record too, so a copied cookie stops working.
    const claim = readSession(cookies(req)[sessionCookieName()]);
    const found = claim ? await findAccount(getStore(), claim.k) : null;
    if (found) await endSession(getStore(), found, claim!.s);
    clearSession(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Sign out on every device, this one included. */
router.post("/auth/signout-everywhere", sameSite, requireAccount, async (_req, res, next) => {
  try {
    const ended = await endAllSessions(getStore(), account(res));
    clearSession(res);
    res.json({ ok: true, ended });
  } catch (err) {
    next(err);
  }
});

/** Change the password: needs the current one, and ends every other session. */
router.post("/auth/password", sameSite, requireAccount, async (req, res, next) => {
  try {
    const me = account(res);
    const current = typeof req.body?.currentPassword === "string" ? req.body.currentPassword.slice(0, PASSWORD_MAX) : "";
    const chosen = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!(await verifyPassword(current, me.passwordHash))) {
      await recordFailedSignIn(getStore(), me.email);
      return res.status(401).json({ error: "That password is not correct.", fields: { currentPassword: "Not correct." } });
    }
    let problem: string | null = null;
    if (chosen.length < PASSWORD_MIN) problem = `Use at least ${PASSWORD_MIN} characters.`;
    else if (chosen.length > PASSWORD_MAX) problem = `Use at most ${PASSWORD_MAX} characters.`;
    else problem = passwordProblem(chosen, { email: me.email, name: me.name });
    if (problem) return res.status(422).json({ error: "Check the highlighted fields.", fields: { newPassword: problem } });

    const updated: Account = { ...me, passwordHash: await hashPassword(chosen) };
    const store = getStore();
    await saveAccount(store, updated);
    await endAllSessions(store, updated);
    await startSession(res, updated);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
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
