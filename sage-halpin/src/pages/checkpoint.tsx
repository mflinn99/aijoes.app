import { useCallback, useEffect, useMemo, useState } from "react";
import { MissingData } from "@/components/MissingData";
import { PageLoader } from "@/components/PageLoader";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import { invalidateCheckpointPill } from "@/components/CheckpointPill";
import { loadOrganisation } from "@/lib/organisation";
import { store } from "@/lib/store";
import { peopleEntries, today } from "@/lib/checkpoint";
import { ensureWorkspace, workspaceApi, type CheckpointData, type WorkspaceLink } from "@/lib/workspace";
import { CHECKPOINT_KIND_LABELS, CHECKPOINT_YEARS, LOGGED_KINDS, compareEntries, type CheckpointEntry, type CheckpointKind, type LoggedKind } from "../../shared/board";

// The organisation on a page: its status now and the last three years in
// order (events, decisions and their plans, outcomes, achievements, people
// joining and leaving, what the agents learned, external signals), with
// insights. A checkpoint is a published, numbered snapshot of it.

const FILTERS: { key: string; label: string; kinds: CheckpointKind[] }[] = [
  { key: "all", label: "Everything", kinds: [] },
  { key: "decisions", label: "Decisions and plans", kinds: ["decision", "plan", "outcome"] },
  { key: "achievements", label: "Achievements", kinds: ["achievement"] },
  { key: "events", label: "Events and signals", kinds: ["event", "signal"] },
  { key: "people", label: "People joining and leaving", kinds: ["joined", "left"] },
  { key: "agents", label: "Agents", kinds: ["agent"] },
];

const LOGGED_LABELS: Record<LoggedKind, string> = { event: "Event", achievement: "Achievement", joined: "Someone joined", left: "Someone left" };

const fmtMonth = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function statusLines(org: ReturnType<typeof loadOrganisation>) {
  const k = store.getKPIs();
  const permanent = org.people.filter((p) => p.permanent).length;
  return [
    `Revenue £${k.revenue}k (previous £${k.revenuePrev}k)`,
    `Cash runway ${k.cashRunway} months`,
    `Churn ${k.churnRate}%`,
    `Pipeline coverage ${k.pipelineCoverage}x`,
    `${permanent} permanent members, ${org.people.length - permanent} people invited as needed, ${org.agents.filter((a) => a.seated).length} AI agents seated`,
  ];
}

export default function CheckpointPage() {
  const org = loadOrganisation();
  const [link, setLink] = useState<WorkspaceLink | null>(org.workspace ?? null);
  const [data, setData] = useState<CheckpointData | null>(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ev, setEv] = useState<{ date: string; kind: LoggedKind; title: string; detail: string }>({ date: today(), kind: "achievement", title: "", detail: "" });

  const refresh = useCallback(async (l: WorkspaceLink) => setData(await workspaceApi.checkpoint(l)), []);
  useEffect(() => {
    ensureWorkspace()
      .then((l) => {
        setLink(l);
        if (l) return refresh(l);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "The checkpoint could not be loaded."));
  }, [refresh]);

  const entries = useMemo<CheckpointEntry[]>(
    () => (data ? [...data.entries, ...peopleEntries(org)].sort(compareEntries) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  if (!org.name.trim()) {
    return (
      <WorkspaceShell title="Checkpoint">
        <p className="text-sm">
          Start by adding your contact details in{" "}
          <Link href="/organisation" className="font-semibold underline underline-offset-4">
            Your board
          </Link>
          .
        </p>
      </WorkspaceShell>
    );
  }

  if (!data && !error) {
    return (
      <WorkspaceShell title={`${org.name}, on a page`}>
        <PageLoader label="Loading the checkpoint" />
      </WorkspaceShell>
    );
  }

  const latest = data?.latest ?? null;
  const known = new Set(latest?.entryIds ?? []);
  const fresh = entries.filter((e) => !known.has(e.id));
  const kinds = FILTERS.find((f) => f.key === filter)?.kinds ?? [];
  const shown = entries.filter((e) => kinds.length === 0 || kinds.includes(e.kind));
  const count = (k: CheckpointKind) => entries.filter((e) => e.kind === k).length;
  const status = statusLines(org);

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    if (!link) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh(link);
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  function download() {
    const rows = entries
      .map((e) => `<tr><td>${esc(fmtMonth(e.date))}</td><td>${esc(CHECKPOINT_KIND_LABELS[e.kind])}</td><td><b>${esc(e.title)}</b>${e.detail ? `<br>${esc(e.detail)}` : ""}</td></tr>`)
      .join("");
    const ins = (latest?.insights ?? []).map((i) => `<li><b>${esc(i.title)}</b> ${esc(i.detail)}</li>`).join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(org.name)}: checkpoint ${latest?.n ?? "draft"}</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 16px;color:#13232B}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ddd;padding:8px;vertical-align:top;font-size:14px}td:first-child{white-space:nowrap;color:#555}li{margin:8px 0}</style></head><body><h1>${esc(org.name)}: checkpoint ${latest?.n ?? "(draft)"}</h1><p>${latest ? `Published ${esc(fmtDay(latest.createdAt))} by ${esc(latest.publishedBy)}.` : "Not yet published."} Status and the last ${CHECKPOINT_YEARS} years, exported from Sentinel8 on ${esc(fmtDay(new Date().toISOString()))}.</p>${latest?.summary ? `<p>${esc(latest.summary)}</p>` : ""}<h2>Status now</h2><ul>${status.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>${ins ? `<h2>Insights</h2><ul>${ins}</ul>` : ""}<h2>History</h2><table>${rows}</table></body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `${org.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-checkpoint-${latest?.n ?? "draft"}.html`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let year = "";
  return (
    <WorkspaceShell
      title={`${org.name}, on a page`}
      actions={
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            onClick={() =>
              run(
                "publish",
                async () => {
                  const cp = await workspaceApi.publish(link!, { publishedBy: org.leadName || "Lead", status: status.join("; "), people: peopleEntries(org) });
                  invalidateCheckpointPill();
                  setNotice(`Checkpoint ${cp.n} published, with ${cp.entryCount} entries.`);
                },
              )
            }
            disabled={busy === "publish" || !data || (latest !== null && fresh.length === 0)}
            data-testid="button-publish"
          >
            {busy === "publish" ? "Publishing…" : latest ? `Publish checkpoint ${latest.n + 1}` : "Publish the first checkpoint"}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            Print or save as PDF
          </Button>
          <Button variant="outline" onClick={download} disabled={!data} data-testid="button-download">
            Download (HTML)
          </Button>
        </div>
      }
    >
      <MissingData use="checkpoint" className="mb-6 print:hidden" />
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        {latest ? (
          <>
            <span className="font-semibold text-foreground">Checkpoint {latest.n}</span> was published {fmtDay(latest.createdAt)} by {latest.publishedBy}.{" "}
            {fresh.length ? `${fresh.length} ${fresh.length === 1 ? "entry has" : "entries have"} been added since.` : "Nothing has been added since."}
          </>
        ) : (
          "No checkpoint has been published yet."
        )}{" "}
        The status and last {CHECKPOINT_YEARS} years of the organisation, in order. Decisions and their plans are added the moment they are recorded;
        publish a checkpoint to take a numbered snapshot with fresh insights.
      </p>

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-md border border-[#7FB692] bg-[#7FB692]/10 p-3 text-sm">
          {notice}
        </p>
      )}

      <div className="mb-8 grid gap-3 sm:grid-cols-4">
        {[
          ["Permanent members", String(org.people.filter((p) => p.permanent).length), "on every decision"],
          ["Decisions", String(count("decision")), `in ${CHECKPOINT_YEARS} years`],
          ["People joined · left", `${count("joined")} · ${count("left")}`, "kept in the record"],
          ["Achievements", String(count("achievement")), `in ${CHECKPOINT_YEARS} years`],
        ].map(([label, value, detail]) => (
          <div key={label} className="rounded-md border border-border bg-card p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            <p className="mt-1 font-serif text-2xl font-light tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section title="History" intro={`Oldest first. ${entries.length} entries in the last ${CHECKPOINT_YEARS} years.`}>
          <div className="mb-4 flex flex-wrap gap-2 print:hidden" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`rounded-full border px-3 py-1 text-xs ${filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {!data ? (
            null
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing here yet. Decisions you record, outcomes you review, lessons you approve, high-impact signals and the events you log all appear here.</p>
          ) : (
            <ol className="space-y-0" data-testid="checkpoint-history">
              {shown.map((e) => {
                const y = e.date.slice(0, 4);
                const heading = y !== year ? ((year = y), <h3 className="mb-1 mt-6 font-serif text-xl font-light first:mt-0">{y}</h3>) : null;
                const isNew = latest !== null && !known.has(e.id);
                return (
                  <li key={e.id} className="break-inside-avoid">
                    {heading}
                    <div className={`grid grid-cols-[84px_minmax(0,1fr)] gap-3 border-t border-border py-3 ${isNew ? "rounded-md bg-[#F7F1E6] px-2" : ""}`}>
                      <span className="text-xs tabular-nums text-muted-foreground">{fmtMonth(e.date)}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold">{CHECKPOINT_KIND_LABELS[e.kind]}</span>
                          {isNew && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">New since checkpoint {latest?.n}</span>}
                          {e.id.startsWith("event-") && (
                            <button
                              className="ml-auto text-xs text-muted-foreground underline print:hidden"
                              onClick={() => run(e.id, () => workspaceApi.removeEvent(link!, e.id.slice("event-".length)))}
                              aria-label={`Remove ${e.title}`}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        <p className="mt-1 text-sm font-semibold">{e.title}</p>
                        {e.detail && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{e.detail}</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        <div className="space-y-8">
          <Section title="Status now">
            <ul className="space-y-1 text-sm">
              {status.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Section>
          <Section title={latest ? `Insights · checkpoint ${latest.n}` : "Insights"}>
            {latest ? (
              <>
                {latest.summary && <p className="mb-3 text-sm">{latest.summary}</p>}
                <ul className="space-y-3" data-testid="checkpoint-insights">
                  {latest.insights.map((i) => (
                    <li key={i.title} className="border-l-[3px] border-[#B28A56] pl-3 text-sm">
                      <p className="font-semibold">{i.title}</p>
                      <p className="text-muted-foreground">{i.detail}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Insights are written when a checkpoint is published.</p>
            )}
          </Section>
          <Section title="Add to the record" intro="Events, achievements, and people joining or leaving outside this board.">
            <form
              className="space-y-3 print:hidden"
              onSubmit={(e) => {
                e.preventDefault();
                run("event", async () => {
                  await workspaceApi.addEvent(link!, { ...ev, title: ev.title.trim(), detail: ev.detail.trim() });
                  setEv({ ...ev, title: "", detail: "" });
                  invalidateCheckpointPill();
                }, "Added to the record.");
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="ev-date" className="text-xs">
                    Date
                  </Label>
                  <Input id="ev-date" type="date" max={today()} value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ev-kind" className="text-xs">
                    Kind
                  </Label>
                  <select id="ev-kind" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value as LoggedKind })}>
                    {LOGGED_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {LOGGED_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Input aria-label="What happened" placeholder="Order book reaches seven months" maxLength={200} value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} data-testid="input-event-title" />
              <Input aria-label="Detail (optional)" placeholder="Detail (optional)" maxLength={1000} value={ev.detail} onChange={(e) => setEv({ ...ev, detail: e.target.value })} />
              <Button type="submit" variant="outline" disabled={!ev.title.trim() || busy === "event"} data-testid="button-add-event">
                Add to the record
              </Button>
            </form>
          </Section>
          {data && data.checkpoints.length > 0 && (
            <Section title="Published checkpoints">
              <ul className="space-y-1 text-sm">
                {data.checkpoints.map((c) => (
                  <li key={c.n}>
                    Checkpoint {c.n} · {fmtDay(c.createdAt)} · {c.entryCount} entries · {c.publishedBy}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
