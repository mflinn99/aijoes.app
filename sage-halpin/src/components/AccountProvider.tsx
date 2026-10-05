import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { PageLoader } from "@/components/PageLoader";
import { resumeSession, signOut as endSession, type Account } from "@/lib/account";

// Who is signed in, resolved before any page reads its saved data, so every
// page reads the right account's workspace from its first render.

interface AccountState {
  account: Account | null;
  setAccount: (account: Account | null) => void;
  signOut: () => Promise<void>;
  sessionEnded: boolean;
}

const AccountContext = createContext<AccountState | null>(null);

export function useAccount(): AccountState {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount must be used inside AccountProvider");
  return value;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    let live = true;
    resumeSession(() => setSessionEnded(true)).then((a) => {
      if (!live) return;
      setAccount(a);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await endSession();
    setAccount(null);
    setSessionEnded(false);
  }, []);

  if (!ready) return <PageLoader label="Opening Sentinel8" />;
  return (
    <AccountContext.Provider value={{ account, setAccount, signOut, sessionEnded }}>
      {sessionEnded && <SessionEndedBanner />}
      {children}
    </AccountContext.Provider>
  );
}

function SessionEndedBanner() {
  const [location] = useLocation();
  return (
    <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
      Your session has ended, so changes aren't being saved to your account.{" "}
      <Link href={`/signin?next=${encodeURIComponent(location)}`} className="font-semibold underline">
        Sign in again
      </Link>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/**
 * Sign in / account menu for page headers. `compact` fits crowded top bars: a
 * Sign in link when signed out, and when signed in a button with the person's
 * initials that opens their name, email and Sign out.
 */
export function AccountMenu({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { account, signOut } = useAccount();
  const [, setLocation] = useLocation();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function leave() {
    setBusy(true);
    await signOut();
    setLocation("/");
  }

  if (compact && !account) {
    return (
      <Link href="/signin" className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground no-underline hover:bg-muted hover:text-foreground ${className}`} data-testid="link-signin">
        Sign in
      </Link>
    );
  }
  if (compact && account) {
    return (
      <div ref={root} className={`relative ${className}`} data-testid="account-menu">
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`Account: ${account.name}`}
          title={account.email}
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold tracking-wide text-primary-foreground"
          data-testid="button-account"
        >
          {initials(account.name)}
        </button>
        {open && (
          <div id={panelId} className="absolute right-0 top-10 z-50 w-60 rounded-md border border-border bg-background p-3 text-xs shadow-lg">
            <p className="font-semibold text-foreground">{account.name}</p>
            <p className="mt-0.5 truncate text-muted-foreground">{account.email}</p>
            <button
              type="button"
              disabled={busy}
              onClick={leave}
              className="mt-3 w-full rounded border border-border px-3 py-1.5 font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              data-testid="button-signout"
            >
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        )}
      </div>
    );
  }
  if (!account) {
    return (
      <div className={`flex items-center gap-2 text-xs ${className}`}>
        <Link href="/signin" className="rounded px-3 py-1.5 font-semibold uppercase tracking-[0.14em] text-muted-foreground no-underline hover:bg-muted hover:text-foreground" data-testid="link-signin">
          Sign in
        </Link>
        <Link href="/signup" className="rounded bg-primary px-3 py-1.5 font-semibold uppercase tracking-[0.14em] text-primary-foreground no-underline" data-testid="link-signup">
          Create account
        </Link>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-3 text-xs ${className}`} data-testid="account-menu">
      <span className="text-muted-foreground" title={account.email}>
        Signed in as <span className="font-semibold text-foreground">{account.name}</span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={leave}
        className="rounded border border-border px-3 py-1.5 font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        data-testid="button-signout"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
