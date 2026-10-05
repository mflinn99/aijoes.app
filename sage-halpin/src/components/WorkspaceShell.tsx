import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Mark } from "@/components/Mark";
import { CheckpointPill } from "@/components/CheckpointPill";
import { AccountMenu } from "@/components/AccountProvider";

// The frame for the board pages: brand, page title and the workspace
// navigation, then the page itself.

const NAV = [
  { href: "/dashboard", label: "Workspace" },
  { href: "/organisation", label: "Your board" },
  { href: "/agents", label: "Agents" },
  { href: "/horizon", label: "Horizon" },
  { href: "/questions", label: "Board questions" },
  { href: "/boardroom", label: "Shadow board" },
  { href: "/log", label: "Decision log" },
];

export function WorkspaceShell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
          <Link href="/" className="flex items-center gap-2 text-foreground no-underline">
            <Mark size={26} />
            <span className="text-xs font-bold uppercase tracking-[0.28em]">
              SENTINEL<span className="sentinel-eight">8</span>
            </span>
          </Link>
          <CheckpointPill className="order-last sm:order-none sm:ml-auto" />
          <nav aria-label="Workspace" className="flex flex-wrap gap-1 text-xs">
            {NAV.map((item) => {
              const active = location === item.href || (item.href !== "/dashboard" && location.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded px-3 py-1.5 font-semibold uppercase tracking-[0.14em] no-underline transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <AccountMenu className="sm:ml-auto" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-serif text-2xl font-light tracking-tight sm:text-3xl">{title}</h1>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}

export function Section({ title, intro, children, id }: { title: string; intro?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mb-8 rounded-md border border-border bg-card p-5 sm:p-6">
      <h2 className="text-sm font-bold uppercase tracking-[0.18em]">{title}</h2>
      {intro && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{intro}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
