import { useEffect, useState } from "react";
import { Link } from "wouter";
import { loadOrganisation } from "@/lib/organisation";
import { workspaceApi } from "@/lib/workspace";
import { peopleEntries } from "@/lib/checkpoint";

// The checkpoint pill at the top of every page: the latest checkpoint of the
// organisation, and how much has happened since it was published.

type Summary = { n: number | null; date: string | null; fresh: number };

let cache: { at: number; value: Summary } | null = null;

/** Called after publishing, so every pill picks up the new checkpoint. */
export function invalidateCheckpointPill() {
  cache = null;
  window.dispatchEvent(new Event("checkpoint-updated"));
}

async function load(): Promise<Summary | null> {
  const org = loadOrganisation();
  if (!org.workspace) return null;
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const cp = await workspaceApi.checkpoint(org.workspace);
  const ids = new Set(cp.latest?.entryIds ?? []);
  const all = [...cp.entries, ...peopleEntries(org)];
  const value = { n: cp.latest?.n ?? null, date: cp.latest?.createdAt ?? null, fresh: all.filter((e) => !ids.has(e.id)).length };
  cache = { at: Date.now(), value };
  return value;
}

export function CheckpointPill({ className = "" }: { className?: string }) {
  const [summary, setSummary] = useState<Summary | null>(cache?.value ?? null);
  const [hasWorkspace, setHasWorkspace] = useState(() => Boolean(loadOrganisation().workspace));

  useEffect(() => {
    let live = true;
    const refresh = () => {
      setHasWorkspace(Boolean(loadOrganisation().workspace));
      load()
        .then((s) => live && setSummary(s))
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("checkpoint-updated", refresh);
    return () => {
      live = false;
      window.removeEventListener("checkpoint-updated", refresh);
    };
  }, []);

  const label = !hasWorkspace
    ? "Checkpoint · set up your board"
    : summary?.n
      ? `Checkpoint ${summary.n} · ${new Date(summary.date as string).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
      : "Checkpoint · not yet published";

  return (
    <Link
      href={hasWorkspace ? "/checkpoint" : "/organisation"}
      className={`inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground no-underline transition-colors hover:bg-[#8C6A3E] ${className}`}
      data-testid="checkpoint-pill"
      title="Your organisation on a page: status and three years of history"
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-[#7FB692]" />
      {label}
      {summary && summary.fresh > 0 && (
        <span className="rounded-full bg-[#B28A56] px-2 py-px text-[10px] text-[#13232B]">{summary.fresh} new</span>
      )}
    </Link>
  );
}
