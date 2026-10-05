import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mark } from "@/components/Mark";
import { useAccount } from "@/components/AccountProvider";
import { AccountError, signIn, signUp } from "@/lib/account";

// Create an account and sign in. Accounts keep the workspace saved on the
// server so it follows the person to another device.

const PASSWORD_MIN = 12;

/** Only same-app paths: never send someone to another site after signing in. */
function safeNext(search: string, fallback: string): string {
  const next = new URLSearchParams(search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

function Frame({ title, intro, children, footer }: { title: string; intro: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-md items-center gap-2 px-4 py-4">
          <Link href="/" className="flex items-center gap-2 text-foreground no-underline">
            <Mark size={26} />
            <span className="text-xs font-bold uppercase tracking-[0.28em]">
              SENTINEL<span className="sentinel-eight">8</span>
            </span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl font-light tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{intro}</p>
        <div className="mt-8">{children}</div>
        <div className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">{footer}</div>
      </main>
    </div>
  );
}

function Field({ id, label, error, hint, ...input }: { id: string; label: string; error?: string; hint?: string } & React.ComponentProps<"input">) {
  const describedBy = [error ? `${id}-error` : "", hint ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <Input id={id} aria-invalid={!!error} aria-describedby={describedBy} className="h-11" {...input} />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function useAuthForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run(action: () => Promise<void>) {
    if (busy) return; // one submission at a time
    setBusy(true);
    setError("");
    setFields({});
    try {
      await action();
    } catch (err) {
      if (err instanceof AccountError) {
        setError(err.message);
        setFields(err.fields);
      } else setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, fields, setFields, run };
}

export function SignUpPage() {
  const { account, setAccount } = useAccount();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { busy, error, fields, setFields, run } = useAuthForm();
  const next = safeNext(search, "/organisation");

  useEffect(() => {
    if (account) setLocation(next);
  }, [account, next, setLocation]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const local: Record<string, string> = {};
    if (!name) local.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) local.email = "Enter a valid email address.";
    if (password.length < PASSWORD_MIN) local.password = `Use at least ${PASSWORD_MIN} characters.`;
    if (Object.keys(local).length) return setFields(local);
    void run(async () => setAccount(await signUp(name, email, password)));
  }

  return (
    <Frame
      title="Create your account"
      intro="Set up your organisation and board, and keep it saved to your account so you can pick up on any device."
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/signin${search ? `?${search}` : ""}`} className="font-semibold text-foreground underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5" data-testid="form-signup">
        <Field id="name" name="name" label="Your name" autoComplete="name" maxLength={120} error={fields.name} disabled={busy} />
        <Field id="email" name="email" type="email" label="Work email" autoComplete="email" maxLength={254} error={fields.email} disabled={busy} />
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          maxLength={200}
          hint={`At least ${PASSWORD_MIN} characters. A short phrase is easiest to remember.`}
          error={fields.password}
          disabled={busy}
        />
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive" data-testid="auth-error">
            {error}
          </p>
        )}
        <Button type="submit" className="h-11 w-full" disabled={busy} data-testid="button-signup">
          {busy ? "Creating your account…" : "Create account"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Anything you've already set up in this browser moves into your new account.
        </p>
      </form>
    </Frame>
  );
}

export function SignInPage() {
  const { account, setAccount } = useAccount();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { busy, error, fields, setFields, run } = useAuthForm();
  const next = safeNext(search, "/dashboard");

  useEffect(() => {
    if (account) setLocation(next);
  }, [account, next, setLocation]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const local: Record<string, string> = {};
    if (!email) local.email = "Enter your email address.";
    if (!password) local.password = "Enter your password.";
    if (Object.keys(local).length) return setFields(local);
    void run(async () => setAccount(await signIn(email, password)));
  }

  return (
    <Frame
      title="Sign in"
      intro="Welcome back. Sign in to open your organisation's board."
      footer={
        <>
          New to Sentinel8?{" "}
          <Link href={`/signup${search ? `?${search}` : ""}`} className="font-semibold text-foreground underline">
            Create an account
          </Link>
          <span className="mt-3 block">
            Forgotten your password? Email{" "}
            <a href="mailto:customer@sentinel8.ai" className="underline">
              customer@sentinel8.ai
            </a>{" "}
            and we'll help you back in.
          </span>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5" data-testid="form-signin">
        <Field id="email" name="email" type="email" label="Email" autoComplete="email" maxLength={254} error={fields.email} disabled={busy} />
        <Field id="password" name="password" type="password" label="Password" autoComplete="current-password" maxLength={200} error={fields.password} disabled={busy} />
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive" data-testid="auth-error">
            {error}
          </p>
        )}
        <Button type="submit" className="h-11 w-full" disabled={busy} data-testid="button-signin">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Frame>
  );
}
