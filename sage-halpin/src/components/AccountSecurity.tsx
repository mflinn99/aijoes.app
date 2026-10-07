import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/WorkspaceShell";
import { useAccount } from "@/components/AccountProvider";
import { AccountError, changePassword } from "@/lib/account";

// Change password (needs the current one) and sign out on every device.

export function AccountSecurity() {
  const { account, signOut } = useAccount();
  const [, setLocation] = useLocation();
  const [current, setCurrent] = useState("");
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  if (!account) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setFields({});
    try {
      await changePassword(current, chosen);
      setCurrent("");
      setChosen("");
      setMessage({ ok: true, text: "Password changed. You've been signed out on your other devices." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Something went wrong. Please try again." });
      if (err instanceof AccountError) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Sign-in and security">
      <form onSubmit={submit} className="grid max-w-md gap-3" data-testid="form-change-password">
        <div className="grid gap-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required aria-invalid={!!fields.currentPassword} />
          {fields.currentPassword && <p className="text-xs text-destructive">{fields.currentPassword}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={12} value={chosen} onChange={(e) => setChosen(e.target.value)} required aria-invalid={!!fields.newPassword} />
          <p className="text-xs text-muted-foreground">At least 12 characters. A few unrelated words work well.</p>
          {fields.newPassword && <p className="text-xs text-destructive">{fields.newPassword}</p>}
        </div>
        <div>
          <Button type="submit" disabled={busy} data-testid="button-change-password">
            {busy ? "Changing…" : "Change password"}
          </Button>
        </div>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? "text-emerald-700" : "text-destructive"}`}>
            {message.text}
          </p>
        )}
      </form>
      <div className="mt-6 max-w-3xl">
        <p className="text-sm text-muted-foreground">Lost a device, or signed in somewhere you shouldn't stay signed in? End every session, this one included.</p>
        <Button
          variant="outline"
          className="mt-3"
          data-testid="button-signout-everywhere"
          onClick={async () => {
            if (!window.confirm("Sign out on every device, including this one?")) return;
            try {
              await signOut({ everywhere: true });
              setLocation("/signin");
            } catch (err) {
              setMessage({ ok: false, text: err instanceof Error ? err.message : "Something went wrong. Please try again." });
            }
          }}
        >
          Sign out everywhere
        </Button>
      </div>
    </Section>
  );
}
