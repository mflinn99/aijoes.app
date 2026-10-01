import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import { loadOrganisation } from "@/lib/organisation";
import { ensureWorkspace, workspaceApi, type WorkspaceLink, type WorkspaceSettings } from "@/lib/workspace";
import {
  AGENT_PERSONAS,
  HORIZON_LIMITS,
  SCAN_INTERVALS_HOURS,
  SIGNAL_CATEGORIES,
  SIGNAL_HORIZON_LABELS,
  type Landscape,
  type Signal,
  type SignalCategory,
} from "../../shared/board";

// The horizon: how the platform keeps looking outward. The chair sets what to
// watch and where to look; the scanner runs on a schedule, keeps what matters
// as signals, and maintains the external landscape every agent reads.

const SUGGESTED_FEEDS = [
  { label: "GOV.UK news and communications", url: "https://www.gov.uk/search/news-and-communications.atom" },
  { label: "Bank of England news", url: "https://www.bankofengland.co.uk/rss/news" },
  { label: "BBC News: Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
];

const INTERVAL_LABELS: Record<number, string> = { 6: "Every 6 hours", 12: "Twice a day", 24: "Daily", 72: "Every 3 days", 168: "Weekly" };

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function HorizonPage() {
  const org = loadOrganisation();
  const [link, setLink] = useState<WorkspaceLink | null>(org.workspace ?? null);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [landscape, setLandscape] = useState<Landscape | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [topic, setTopic] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedLabel, setFeedLabel] = useState("");
  const [category, setCategory] = useState<SignalCategory | "all">("all");
  const [highOnly, setHighOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (l: WorkspaceLink) => {
    const h = await workspaceApi.horizon(l);
    setSettings(h.settings);
    setLandscape(h.landscape);
    setSignals(h.signals);
  }, []);

  useEffect(() => {
    ensureWorkspace()
      .then((l) => {
        setLink(l);
        if (l) return refresh(l);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "The horizon could not be loaded."));
  }, [refresh]);

  if (!org.name.trim()) {
    return (
      <WorkspaceShell title="The horizon">
        <p className="text-sm">
          Start by naming your organisation in{" "}
          <Link href="/organisation" className="font-semibold underline underline-offset-4">
            Your board
          </Link>
          .
        </p>
      </WorkspaceShell>
    );
  }

  async function run(key: string, fn: () => Promise<unknown>) {
    if (!link) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh(link);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const save = (patch: Partial<WorkspaceSettings>) => run("settings", () => workspaceApi.update(link!, patch));

  const shown = signals.filter((s) => (category === "all" || s.category === category) && (!highOnly || s.impact === "high"));
  const next = settings?.lastScanAt ? new Date(Date.parse(settings.lastScanAt) + settings.scanEveryHours * 3600_000) : null;

  return (
    <WorkspaceShell
      title="The horizon"
      actions={
        settings && (
          <Button onClick={() => run("scan", async () => {
            const r = await workspaceApi.scan(link!);
            setNotice(`Scan complete: ${r.kept} new signal${r.kept === 1 ? "" : "s"}. ${r.status !== "ok" ? r.note : ""}`);
          })} disabled={busy === "scan"} data-testid="button-scan">
            {busy === "scan" ? "Scanning…" : "Scan now"}
          </Button>
        )
      }
    >
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Sentinel<span className="sentinel-eight">8</span> keeps looking outward. On a schedule it reads the sources you choose and searches the web
        for your watch topics, keeps what bears on your organisation, and updates the external landscape that every agent reads before it advises.
        What it finds can be taught to the agents; nothing becomes part of their memory without you.
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

      {!settings ? (
        <p className="text-sm text-muted-foreground">{error ? "" : "Loading…"}</p>
      ) : (
        <>
          <Section title="Scanning" intro={settings.lastScanAt ? undefined : "No scan has run yet. The first runs within the hour, or scan now."}>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Last scan</dt>
                <dd data-testid="last-scan">
                  {settings.lastScanAt ? new Date(settings.lastScanAt).toLocaleString() : "Not yet"}
                  {settings.lastScanStatus && settings.lastScanStatus !== "ok" ? ` (${settings.lastScanStatus})` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next scan</dt>
                <dd>{next ? next.toLocaleString() : "Within the hour"}</dd>
              </div>
              <div>
                <Label htmlFor="scan-every" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  How often
                </Label>
                <select
                  id="scan-every"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={settings.scanEveryHours}
                  onChange={(e) => save({ scanEveryHours: Number(e.target.value) })}
                >
                  {SCAN_INTERVALS_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {INTERVAL_LABELS[h]}
                    </option>
                  ))}
                </select>
              </div>
            </dl>
            {settings.lastScanNote && <p className="mt-3 text-xs text-muted-foreground">{settings.lastScanNote}</p>}
          </Section>

          <div className="grid gap-8 lg:grid-cols-2">
            <Section title="Watch topics" intro="What the scanner searches the web for, alongside your sector and profile.">
              <ul className="mb-3 flex flex-wrap gap-2">
                {settings.watchTopics.map((t) => (
                  <li key={t} className="flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-sm">
                    {t}
                    <button aria-label={`Remove ${t}`} className="text-muted-foreground hover:text-foreground" onClick={() => save({ watchTopics: settings.watchTopics.filter((x) => x !== t) })}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (topic.trim()) save({ watchTopics: [...settings.watchTopics, topic.trim()] }).then(() => setTopic(""));
                }}
              >
                <Input aria-label="New watch topic" placeholder="Export controls on sensors" maxLength={HORIZON_LIMITS.topic} value={topic} onChange={(e) => setTopic(e.target.value)} />
                <Button type="submit" variant="outline" disabled={!topic.trim() || settings.watchTopics.length >= HORIZON_LIMITS.watchTopics}>
                  Add
                </Button>
              </form>
              <div className="mt-4 flex items-center gap-3">
                <Switch id="web-search" checked={settings.webSearch} onCheckedChange={(on) => save({ webSearch: on })} />
                <Label htmlFor="web-search" className="text-sm font-normal">
                  Search the web on each scan
                </Label>
              </div>
            </Section>

            <Section title={`Sources (${settings.feeds.length})`} intro="News, regulator and industry feeds (RSS or Atom) the scanner reads on every scan.">
              {settings.feeds.length > 0 && (
                <ul className="mb-3 divide-y divide-border rounded-md border border-border">
                  {settings.feeds.map((f) => (
                    <li key={f.url} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <span className="min-w-0">
                        <span className="font-semibold">{f.label || new URL(f.url).hostname}</span>
                        <span className="block truncate text-xs text-muted-foreground">{f.url}</span>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => save({ feeds: settings.feeds.filter((x) => x.url !== f.url) })}>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (feedUrl.trim()) save({ feeds: [...settings.feeds, { url: feedUrl.trim(), label: feedLabel.trim() }] }).then(() => { setFeedUrl(""); setFeedLabel(""); });
                }}
              >
                <Input aria-label="Feed address" placeholder="https://… (RSS or Atom)" maxLength={HORIZON_LIMITS.url} value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} />
                <Input aria-label="Feed name" placeholder="Name (optional)" maxLength={HORIZON_LIMITS.feedLabel} value={feedLabel} onChange={(e) => setFeedLabel(e.target.value)} />
                <Button type="submit" variant="outline" disabled={!feedUrl.trim() || settings.feeds.length >= HORIZON_LIMITS.feeds}>
                  Add
                </Button>
              </form>
              {SUGGESTED_FEEDS.some((s) => !settings.feeds.some((f) => f.url === s.url)) && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Suggestions:{" "}
                  {SUGGESTED_FEEDS.filter((s) => !settings.feeds.some((f) => f.url === s.url)).map((s, i) => (
                    <span key={s.url}>
                      {i > 0 && " · "}
                      <button className="underline underline-offset-2 hover:text-foreground" onClick={() => save({ feeds: [...settings.feeds, s] })}>
                        {s.label}
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </Section>
          </div>

          <Section title="The external landscape" intro="The briefing every agent reads before it advises. It is rewritten as new signals arrive.">
            {landscape ? (
              <>
                <p className="mb-2 text-xs text-muted-foreground">Updated {new Date(landscape.updatedAt).toLocaleString()}</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="briefing">
                  {landscape.briefing}
                </p>
                {landscape.trends.length > 0 && (
                  <table className="mt-4 w-full border-collapse text-sm">
                    <caption className="mb-2 text-left text-xs font-bold uppercase tracking-[0.14em]">Trends</caption>
                    <tbody>
                      {landscape.trends.map((t) => (
                        <tr key={t.title} className="border-t border-border">
                          <th scope="row" className="py-2 pr-3 text-left font-semibold">
                            {t.title}
                          </th>
                          <td className="py-2 pr-3 text-xs uppercase tracking-[0.1em] text-muted-foreground">
                            {t.direction === "rising" ? "↑ Rising" : t.direction === "falling" ? "↓ Falling" : "→ Steady"}
                          </td>
                          <td className="py-2">{t.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No briefing yet: it is written after the first scan.</p>
            )}
          </Section>

          <Section title={`Signals (${signals.length})`} intro="External developments the scanner kept because they bear on your organisation.">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Label htmlFor="signal-category" className="text-xs font-semibold uppercase tracking-[0.12em]">
                Category
              </Label>
              <select id="signal-category" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value as SignalCategory | "all")}>
                <option value="all">All</option>
                {SIGNAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={highOnly} onChange={(e) => setHighOnly(e.target.checked)} /> High impact only
              </label>
            </div>
            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">{signals.length ? "No signals match." : "No signals yet."}</p>
            ) : (
              <ul className="space-y-3" data-testid="signals">
                {shown.map((s) => (
                  <li key={s.id} className="rounded-md border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground underline-offset-4 hover:underline">
                        {s.title}
                      </a>
                      <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-semibold">
                        {titleCase(s.impact)} impact · {SIGNAL_HORIZON_LABELS[s.horizon]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {titleCase(s.category)} · {s.source} · {s.via === "web" ? "web search" : "feed"} · {new Date(s.publishedAt ?? s.foundAt).toLocaleDateString()}
                    </p>
                    {s.summary && <p className="mt-2 text-sm">{s.summary}</p>}
                    <p className="mt-1 text-sm">
                      <span className="font-semibold">For you: </span>
                      {s.implication}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Concerns: {s.agents.map((a) => AGENT_PERSONAS[a].persona).join(", ") || "no specific agent"}</span>
                      {s.agents.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === s.id}
                          onClick={() =>
                            run(s.id, async () => {
                              const r = await workspaceApi.teachSignal(link!, s.id);
                              setNotice(r.taught.length ? `Taught to ${r.taught.map((l) => AGENT_PERSONAS[l.agentId].persona).join(", ")}.` : "Those agents already know this.");
                            })
                          }
                        >
                          Teach the agents
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </WorkspaceShell>
  );
}
