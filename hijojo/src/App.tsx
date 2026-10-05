import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { STAGE_GROUPS, type Epistemic, type ProfileItem, type ProspectingProfile } from "../shared/types";

// ---- tiny router & data hooks ------------------------------------------------------

function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

function useData<T>(path: string | null, intervalMs = 4000): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!path) return;
    api<T>(path)
      .then((d) => (setData(d), setError(null)))
      .catch((e) => setError(e.message));
  }, [path]);
  useEffect(() => {
    setData(null);
    load();
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);
  return { data, error, reload: load };
}

const go = (path: string) => (location.hash = `#/${path}`);
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "–");

// ---- shared bits -------------------------------------------------------------------------

function Badge({ status }: { status: Epistemic | string }) {
  return <span className={`badge badge-${status.toLowerCase().replace(/_/g, "-")}`}>{status.replace(/_/g, " ")}</span>;
}

function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header>
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  return error ? <p className="error">{error}</p> : null;
}

// ---- app shell ----------------------------------------------------------------------------

export function App() {
  const [me, setMe] = useState<any>(undefined);
  useEffect(() => {
    api("/me")
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
  }, []);
  if (me === undefined) return null;
  if (!me) return <Login onDone={setMe} />;
  return <Shell me={me} />;
}

function Login({ onDone }: { onDone: (u: any) => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await api("/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
      onDone(r.user);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <main className="login">
      <form onSubmit={submit} className="card">
        <h1>Hijojo</h1>
        <p className="muted">Agentic prospecting for AIGoGo OpCos</p>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <ErrorNote error={error} />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}

function Shell({ me }: { me: any }) {
  const route = useRoute();
  const { data: status, reload } = useData<any>("/status", 5000);
  async function halt() {
    if (!confirm("Halt all sending now?")) return;
    await api("/settings/halt", { method: "POST", body: { halted: true } });
    reload();
  }
  return (
    <>
      <nav className="top">
        <a href="#/" className="brand">
          Hijojo
        </a>
        <a href="#/">OpCos</a>
        <a href="#/metrics">Outcomes</a>
        <a href="#/settings">Settings</a>
        <span className="spacer" />
        {status && <ModeBadge status={status} />}
        {status && !status.halted && me.role !== "VIEWER" && (
          <button className="danger small" onClick={halt}>
            Halt sending
          </button>
        )}
        <span className="muted">
          {me.name} · {me.role.toLowerCase()}
        </span>
        <button
          className="link"
          onClick={async () => {
            await api("/auth/logout", { method: "POST" });
            location.reload();
          }}
        >
          Sign out
        </button>
      </nav>
      <main>
        {route[0] === "opco" && route[1] ? (
          <OpcoView id={route[1]} me={me} />
        ) : route[0] === "prospect" && route[1] ? (
          <ProspectView id={route[1]} me={me} simulated={!!status?.simulated} />
        ) : route[0] === "metrics" ? (
          <MetricsView />
        ) : route[0] === "settings" ? (
          <SettingsView me={me} status={status} reload={reload} />
        ) : (
          <OpcoList me={me} />
        )}
      </main>
    </>
  );
}

function ModeBadge({ status }: { status: any }) {
  if (status.halted) return <span className="mode mode-halted">HALTED</span>;
  if (status.simulated) return <span className="mode mode-sim" title={status.mail.detail}>SIMULATION · nothing is sent</span>;
  if (!status.sending.canSend) return <span className="mode mode-off" title={status.sending.reason}>LIVE · not sending</span>;
  return <span className="mode mode-live">LIVE</span>;
}

// ---- OpCos ----------------------------------------------------------------------------------

function OpcoList({ me }: { me: any }) {
  const { data, error, reload } = useData<any[]>("/opcos");
  const [formError, setFormError] = useState<string | null>(null);
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const o = await api("/opcos", {
        method: "POST",
        body: { name: f.get("name"), website: f.get("website"), introLink: f.get("introLink") || null, notes: f.get("notes") || "" },
      });
      form.reset();
      go(`opco/${o.id}`);
    } catch (err) {
      setFormError((err as Error).message);
    }
    reload();
  }
  return (
    <div className="grid two">
      <Card title="OpCos">
        <ErrorNote error={error} />
        {data?.length === 0 && <p className="muted">No OpCos yet. Add one to start.</p>}
        <ul className="list">
          {data?.map((o) => (
            <li key={o.id} onClick={() => go(`opco/${o.id}`)}>
              <div>
                <strong>{o.name}</strong> <Badge status={o.status} />
                <div className="muted">{o.website}</div>
              </div>
              <div className="counts">
                {STAGE_GROUPS.map((g) => (o.counts[g.label] ? <span key={g.label}>{g.label}: {o.counts[g.label]}</span> : null))}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {me.role !== "VIEWER" && (
        <Card title="Add OpCo">
          <form onSubmit={add} className="stack">
            <label>
              OpCo name
              <input name="name" required maxLength={120} />
            </label>
            <label>
              Website <span className="muted">(leave blank for a sale mandate or unlaunched OpCo)</span>
              <input name="website" type="url" placeholder="https://" />
            </label>
            <label>
              Intro / demo link <span className="muted">(defaults to the website; required without one, e.g. an NDA request page)</span>
              <input name="introLink" type="url" placeholder="https://" />
            </label>
            <label>
              Supporting information <span className="muted">(optional with a website; e.g. paste a teaser or information memorandum)</span>
              <textarea name="notes" rows={5} placeholder="Paste any documents or notes. They are stored as a source and cited like any page." />
            </label>
            <ErrorNote error={formError} />
            <button type="submit">Add and analyse</button>
            <p className="muted small">Hijojo researches the OpCo itself and builds the prospecting profile. You do not need to define criteria.</p>
          </form>
        </Card>
      )}
    </div>
  );
}

function Item({ label, item }: { label: string; item: ProfileItem }) {
  return (
    <div className="item">
      <div className="item-label">
        {label} <Badge status={item.status} />
      </div>
      <div>{item.text || <span className="muted">Unknown</span>}</div>
    </div>
  );
}

function ProfileCard({ profile }: { profile: ProspectingProfile }) {
  const icp = profile.icp;
  const size = icp.employeeMin != null || icp.employeeMax != null ? `${icp.employeeMin ?? "?"}–${icp.employeeMax ?? "?"} employees` : null;
  return (
    <Card title={`Prospecting Profile v${profile.version}`} actions={profile.complete ? <Badge status="COMPLETE" /> : <Badge status="INCOMPLETE" />}>
      {!profile.complete && <p className="error">Prospecting is blocked: {profile.gaps.join("; ")}</p>}
      <Item label="Proposition" item={profile.proposition} />
      <Item label="Problem" item={profile.problem} />
      <div className="item">
        <div className="item-label">ICP</div>
        <div>
          {[icp.sectors.join(", "), icp.subsectors.join(", "), icp.geographies.join(", "), size, icp.technology.length ? `Tech: ${icp.technology.join(", ")}` : null, icp.regulatory.length ? `Regulatory: ${icp.regulatory.join(", ")}` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="item">
        <div className="item-label">Buyer</div>
        <div className="roles">
          {(["economic", "operational", "technical", "influencer"] as const).map((k) =>
            profile.buyers[k].length ? (
              <div key={k}>
                <span className="muted">{k}:</span> {profile.buyers[k].join(", ")}
              </div>
            ) : null,
          )}
        </div>
      </div>
      <Item label="USP" item={profile.usp} />
      <Item label="Cost" item={profile.cost} />
      <div className="item">
        <div className="item-label">Buying signals</div>
        <ul className="signals">
          {profile.signals.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong> <span className="muted">{s.whyItMatters}</span>
            </li>
          ))}
        </ul>
      </div>
      <details>
        <summary>Exclusions ({profile.exclusions.length})</summary>
        <ul>
          {profile.exclusions.map((x, i) => (
            <li key={i}>
              {x.kind} <strong>{x.value}</strong>: {x.reason}
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function OpcoView({ id, me }: { id: string; me: any }) {
  const { data, error } = useData<any>(`/opcos/${id}`);
  const { data: prospects, reload } = useData<any[]>(`/opcos/${id}/prospects`);
  const [stage, setStage] = useState("Qualified");
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  const { opco, profile, claims } = data;
  const inStage = (prospects ?? []).filter((p) => p.stage === stage);

  async function addProspect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api(`/opcos/${id}/prospects`, { method: "POST", body: { name: f.get("name"), domain: f.get("domain") } });
      form.reset();
      setMsg("Added. It will be researched and qualified like any other prospect.");
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/" className="muted">
            ← OpCos
          </a>
          <h1>
            {opco.name} <Badge status={opco.status} />
          </h1>
          <div className="muted">
            {opco.website || "No website: analysed from supplied documents"} · intro link {opco.introLink}
          </div>
          {opco.statusDetail && <p className="error">{opco.statusDetail}</p>}
        </div>
        {me.role !== "VIEWER" && (
          <div className="actions">
            <button className="secondary" onClick={() => api(`/opcos/${id}/analyse`, { method: "POST" }).then(() => setMsg("Re-analysis queued"))}>
              Re-analyse
            </button>
            {profile?.complete && (
              <button onClick={() => api(`/opcos/${id}/discover`, { method: "POST" }).then(() => setMsg("Searching for prospects…"), (e) => setMsg(e.message))}>
                Find prospects
              </button>
            )}
          </div>
        )}
      </div>
      {msg && <p className="note">{msg}</p>}
      <div className="grid two wide-left">
        <div>
          {profile ? <ProfileCard profile={profile} /> : <Card title="Prospecting Profile"><p className="muted">{opco.status === "ANALYSING" || opco.status === "NEW" ? "Researching the OpCo…" : "Not available."}</p></Card>}
          <Card title={`Analysis (${claims.length} claims)`}>
            <table className="claims">
              <tbody>
                {claims.map((c: any) => (
                  <tr key={c.id}>
                    <td className="muted">{c.field}</td>
                    <td>
                      {c.statement}
                      {c.note && <div className="muted small">{c.note}</div>}
                      {c.basis && <div className="muted small">Basis: {c.basis}</div>}
                    </td>
                    <td>
                      <Badge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <Card title="Prospects">
          <div className="tabs">
            {STAGE_GROUPS.map((g) => {
              const n = (prospects ?? []).filter((p) => p.stage === g.label).length;
              return (
                <button key={g.label} className={stage === g.label ? "tab active" : "tab"} onClick={() => setStage(g.label)}>
                  {g.label} <span className="count">{n}</span>
                </button>
              );
            })}
          </div>
          {inStage.length === 0 && <p className="muted">None.</p>}
          <ul className="list">
            {inStage.map((p) => (
              <li key={p.id} onClick={() => go(`prospect/${p.id}`)}>
                <div>
                  <strong>{p.name}</strong> <span className="muted">{p.domain}</span>
                  <div className="muted small">{p.contact ? `${p.contact.name}, ${p.contact.title}` : "No decision-maker yet"}</div>
                  {p.statusReason && <div className="small">{p.statusReason}</div>}
                </div>
                {p.score && <div className={`score ${p.score.passed ? "pass" : "fail"}`}>{p.score.total}</div>}
              </li>
            ))}
          </ul>
          {me.role !== "VIEWER" && profile?.complete && (
            <details>
              <summary>Add a company you already know about</summary>
              <form onSubmit={addProspect} className="inline">
                <input name="name" placeholder="Company name" required />
                <input name="domain" placeholder="domain.com" required />
                <button type="submit">Add</button>
              </form>
            </details>
          )}
        </Card>
      </div>
    </>
  );
}

// ---- prospect -----------------------------------------------------------------------------------

function ProspectView({ id, me, simulated }: { id: string; me: any; simulated: boolean }) {
  const { data, error, reload } = useData<any>(`/prospects/${id}`, 3000);
  const [reply, setReply] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  const { prospect: p, opco, contact, findings, communications, inbound, handoffs, events } = data;
  const card = p.score;

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      setMsg(done);
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <a href={`#/opco/${opco.id}`} className="muted">
            ← {opco.name}
          </a>
          <h1>
            {p.name} <Badge status={p.status} />
          </h1>
          <div className="muted">
            {p.domain} · discovered via {p.discoveredVia}
            {p.statusReason ? ` · ${p.statusReason}` : ""}
          </div>
        </div>
      </div>
      {msg && <p className="note">{msg}</p>}
      <div className="grid two">
        <div>
          <Card title="Who">
            {contact ? (
              <div>
                <strong>{contact.name}</strong>, {contact.title}
                <div className="muted">
                  {contact.email} · <Badge status={contact.emailStatus} /> · source {contact.source}
                  {contact.sourceUrl && (
                    <>
                      {" "}
                      (<a href={contact.sourceUrl} target="_blank" rel="noreferrer noopener">
                        link
                      </a>
                      )
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted">No decision-maker identified yet.</p>
            )}
            {me.role !== "VIEWER" && ["RESEARCHING", "REJECTED"].includes(p.status) && <ContactForm prospectId={p.id} onDone={() => act(async () => {}, "Contact saved; re-qualifying")} />}
          </Card>
          <Card title="Why them">
            <p>{p.whyThem ?? <span className="muted">Not yet assessed</span>}</p>
            {p.attributes && (
              <p className="muted small">
                {[p.attributes.sector, p.attributes.employees ? `${p.attributes.employees} employees` : null, p.attributes.geography].filter(Boolean).join(" · ") || "Attributes unconfirmed"}
              </p>
            )}
          </Card>
          <Card title="Why now">
            <p>{p.whyNow ?? <span className="muted">No trigger established</span>}</p>
            {p.whyProposition && (
              <p className="muted">
                <strong>Why {opco.name}:</strong> {p.whyProposition}
              </p>
            )}
          </Card>
          <Card title="Score">
            {card ? (
              <>
                <div className="score-head">
                  <span className={`score big ${card.passed ? "pass" : "fail"}`}>{card.total}</span>
                  <span className="muted">
                    / 100 · threshold {card.threshold} · confidence {card.confidence}%
                  </span>
                </div>
                {Object.entries(card.dimensions).map(([k, d]: [string, any]) => (
                  <div key={k} className="dim">
                    <div className="dim-label">
                      <span>{LABELS[k]}</span>
                      <span>
                        {d.points}/{d.max}
                      </span>
                    </div>
                    <div className="bar">
                      <div style={{ width: `${(100 * d.points) / d.max}%` }} />
                    </div>
                    {d.rationale && <div className="muted small">{d.rationale}</div>}
                  </div>
                ))}
                {card.notes.length > 0 && (
                  <ul className="small muted">
                    {card.notes.map((n: string, i: number) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="muted">Not scored yet.</p>
            )}
          </Card>
          <Card title="Evidence">
            {findings.length === 0 && <p className="muted">No findings.</p>}
            <ul className="evidence">
              {findings.map((f: any) => (
                <li key={f.id}>
                  <div>
                    <Badge status={f.status} /> <span className="muted">{f.kind}</span> {f.statement}
                    {f.observedAt && <span className="muted"> · {f.observedAt.slice(0, 10)}</span>}
                  </div>
                  {f.evidence.map((e: any, i: number) => (
                    <blockquote key={i}>
                      “{e.quote}”{" "}
                      {e.url && (
                        <a href={e.url} target="_blank" rel="noreferrer noopener">
                          {e.url}
                        </a>
                      )}
                    </blockquote>
                  ))}
                  {f.note && <div className="muted small">{f.note}</div>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div>
          <Card title="Communication">
            {communications.length === 0 && <p className="muted">Nothing drafted.</p>}
            {communications.map((c: any) => (
              <div key={c.id} className="comm">
                <div className="comm-head">
                  <strong>{c.kind === "intro" ? "Introduction" : "Follow-up"}</strong> <span className="muted">attempt {c.attempt}</span> <Badge status={c.status} />
                  {c.sentAt && <span className="muted"> · sent {fmt(c.sentAt)}</span>}
                </div>
                {c.statusReason && <div className="small error">{c.statusReason}</div>}
                <div className="subject">Subject: {c.subject}</div>
                <pre className="body">{c.body}</pre>
                {c.qa.map((r: any) => (
                  <details key={r.id} open={r.verdict !== "PASS"}>
                    <summary>
                      Independent QA: <Badge status={r.verdict} /> <span className="muted">({r.reviewer})</span>
                    </summary>
                    <ul className="checks">
                      {r.checks.map((ch: any, i: number) => (
                        <li key={i} className={ch.passed ? "ok" : ch.severity}>
                          <span>{ch.passed ? "✓" : "✗"}</span> <strong>{ch.name}</strong> <span className="muted">{ch.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            ))}
          </Card>
          <Card title="Activity">
            {inbound.map((m: any) => (
              <div key={m.id} className="inbound">
                <div>
                  <strong>Reply from {m.fromEmail}</strong> <Badge status={m.classification ?? "UNCLASSIFIED"} /> <span className="muted">{fmt(m.receivedAt)}</span>
                </div>
                <pre className="body">{m.body}</pre>
              </div>
            ))}
            {handoffs.map((h: any) => (
              <div key={h.id} className="handoff">
                <div>
                  <strong>Passed to {h.to}</strong> <Badge status={h.status} /> {h.verdict && <Badge status={h.verdict} />}
                </div>
                {me.role !== "VIEWER" && !h.verdict && (
                  <div className="actions">
                    <button className="small" onClick={() => act(() => api(`/handoffs/${h.id}/verdict`, { method: "POST", body: { verdict: "ACCEPTED" } }), "Recorded")}>
                      Worth pursuing
                    </button>
                    <button className="small secondary" onClick={() => act(() => api(`/handoffs/${h.id}/verdict`, { method: "POST", body: { verdict: "DECLINED" } }), "Recorded")}>
                      Not worth pursuing
                    </button>
                  </div>
                )}
                <details>
                  <summary>Handoff email</summary>
                  <pre className="body">{h.body}</pre>
                </details>
              </div>
            ))}
            {simulated && me.role !== "VIEWER" && contact && ["CONTACTED", "FOLLOW_UP_DUE", "FOLLOWED_UP"].includes(p.status) && (
              <form
                className="sim-reply"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(() => api("/simulation/reply", { method: "POST", body: { prospectId: p.id, body: reply } }), "Simulated reply received").then(() => setReply(""));
                }}
              >
                <label>
                  Simulate a reply from {contact.name} <span className="muted">(simulation only)</span>
                  <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="e.g. Yes, let's talk next week." required />
                </label>
                <button type="submit">Receive reply</button>
              </form>
            )}
            <ul className="events">
              {events.map((e: any) => (
                <li key={e.id}>
                  <span className="muted">{fmt(e.at)}</span> {e.detail}
                </li>
              ))}
            </ul>
            {me.role !== "VIEWER" && ["CONTACTED", "FOLLOWED_UP", "RESPONDED", "PASSED_TO_MARK", "CLOSED"].includes(p.status) && (
              <div className="actions">
                <button className="small secondary" onClick={() => act(() => api(`/prospects/${p.id}/feedback`, { method: "POST", body: { falsePositive: true } }), "Recorded as a false positive")}>
                  Should not have been contacted
                </button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

const LABELS: Record<string, string> = {
  icpFit: "ICP fit",
  need: "Current need / trigger",
  buyer: "Buyer fit",
  timing: "Timing",
  commercial: "Commercial potential",
  evidence: "Evidence quality",
};

function ContactForm({ prospectId, onDone }: { prospectId: string; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api(`/prospects/${prospectId}/contact`, {
        method: "POST",
        body: { name: f.get("name"), title: f.get("title"), email: f.get("email"), sourceUrl: f.get("sourceUrl") || null, verified: f.get("verified") === "on" },
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <details>
      <summary>Set the decision-maker</summary>
      <form onSubmit={submit} className="stack">
        <input name="name" placeholder="Name" required />
        <input name="title" placeholder="Job title" required />
        <input name="email" type="email" placeholder="Work email" required />
        <input name="sourceUrl" type="url" placeholder="Where this was found (URL)" />
        <label className="check">
          <input type="checkbox" name="verified" /> Address deliverability verified
        </label>
        <ErrorNote error={error} />
        <button type="submit">Save and re-qualify</button>
      </form>
    </details>
  );
}

// ---- outcomes -------------------------------------------------------------------------------------

function Rate({ label, r }: { label: string; r: { n: number; of: number; rate: number | null } }) {
  return (
    <div className="stat">
      <div className="stat-value">{r.rate == null ? "–" : `${r.rate}%`}</div>
      <div className="stat-label">{label}</div>
      <div className="muted small">
        {r.n} of {r.of}
      </div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: any[] }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="muted">No contacts yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th />
              <th>Contacted</th>
              <th>Replied</th>
              <th>Engaged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.key}</td>
                <td>{r.contacted}</td>
                <td>{r.replied}</td>
                <td>{r.engaged}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function MetricsView() {
  const { data: m } = useData<any>("/metrics", 6000);
  if (!m) return <p className="muted">Loading…</p>;
  return (
    <>
      <h1>Outcomes</h1>
      <p className="muted">Measured by precision and useful conversations, not volume.</p>
      <div className="stats">
        <Rate label="Qualified prospect rate" r={m.qualifiedProspectRate} />
        <Rate label="Positive response rate" r={m.positiveReplies} />
        <Rate label="Human-accepted opportunities" r={m.humanAcceptedOpportunityRate} />
        <Rate label="False positive rate" r={m.falsePositiveRate} />
        <Rate label="Contact accuracy" r={m.contactAccuracy} />
        <Rate label="QA rejection rate" r={m.qaRejectionRate} />
        <Rate label="Reply rate" r={m.replies} />
        <Rate label="Delivered" r={m.delivered} />
        <Rate label="Unsubscribe rate" r={m.unsubscribeRate} />
      </div>
      <p className="muted small">
        Sent: {m.emailsSent.intro} introductions, {m.emailsSent.followup} follow-ups · bounced {m.bounced} · negative replies {m.negativeReplies} · {m.opensAndClicks}
        {m.suspendedSignals.length > 0 && ` · signals suspended for false positives: ${m.suspendedSignals.join(", ")}`}
      </p>
      <div className="grid three">
        <Breakdown title="By ICP" rows={m.byIcp} />
        <Breakdown title="By trigger" rows={m.byTrigger} />
        <Breakdown title="By message approach" rows={m.byApproach} />
      </div>
    </>
  );
}

// ---- settings ---------------------------------------------------------------------------------------

function SettingsView({ me, status, reload }: { me: any; status: any; reload: () => void }) {
  const { data: suppression, reload: reloadSup } = useData<any[]>("/suppression", 10000);
  const [msg, setMsg] = useState<string | null>(null);
  if (!status) return null;
  const admin = me.role === "ADMIN";
  const act = (fn: () => Promise<unknown>, done: string) =>
    fn().then(
      () => (setMsg(done), reload(), reloadSup()),
      (e) => setMsg(e.message),
    );
  return (
    <>
      <h1>Settings</h1>
      {msg && <p className="note">{msg}</p>}
      <div className="grid two">
        <Card title="Integrations">
          <table>
            <tbody>
              {[
                ["AI provider", status.ai],
                ["Research retrieval", status.research],
                ["Contact data", status.contacts],
                ["Mail (Outlook)", status.mail],
              ].map(([label, s]: any) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>
                    <Badge status={s.configured ? "CONFIGURED" : "NOT_CONFIGURED"} />
                  </td>
                  <td className="muted">{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Credentials are set in the server environment, never here.</p>
        </Card>
        <Card title="Sending">
          <p>
            {status.simulated ? (
              <>
                Mode: <strong>simulation</strong> · messages are recorded in a simulated outbox; nothing is sent
              </>
            ) : (
              <>
                Mode: <strong>live</strong> · {status.sending.canSend ? "sending to real recipients" : `not sending: ${status.sending.reason}`}
              </>
            )}
          </p>
          <p className="muted">
            Positive replies go to <strong>{status.handoffTo}</strong>. Daily cap {status.dailySendCap}. Threshold {status.threshold}/100.
          </p>
          {status.halted && admin && (
            <button onClick={() => act(() => api("/settings/halt", { method: "POST", body: { halted: false } }), "Sending resumed")}>Resume sending</button>
          )}
          {admin && !status.simulated && (
            <button
              className={status.liveSwitch ? "secondary" : "danger"}
              onClick={() => {
                if (!status.liveSwitch && !confirm("Switch on live sending to real prospects?")) return;
                act(() => api("/settings/live", { method: "POST", body: { on: !status.liveSwitch } }), "Updated");
              }}
            >
              {status.liveSwitch ? "Switch live sending off" : "Switch live sending on"}
            </button>
          )}
          {admin && (
            <form
              className="inline"
              onSubmit={(e) => {
                e.preventDefault();
                const v = Number(new FormData(e.currentTarget).get("t"));
                act(() => api("/settings/threshold", { method: "POST", body: { value: v } }), "Threshold updated");
              }}
            >
              <input name="t" type="number" min={status.threshold} max={100} defaultValue={status.threshold} />
              <button type="submit" className="secondary">
                Raise threshold
              </button>
            </form>
          )}
        </Card>
        <Card title={`Suppression list (${suppression?.length ?? 0})`}>
          {admin && (
            <form
              className="inline"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                act(() => api("/suppression", { method: "POST", body: { value: f.get("value"), kind: f.get("kind"), reason: f.get("reason") } }), "Suppressed").then(() => form.reset());
              }}
            >
              <input name="value" placeholder="email or domain" required />
              <select name="kind">
                <option value="email">email</option>
                <option value="domain">domain</option>
              </select>
              <input name="reason" placeholder="reason" required />
              <button type="submit">Add</button>
            </form>
          )}
          <ul className="events">
            {suppression?.map((s) => (
              <li key={s.value}>
                <strong>{s.value}</strong> <span className="muted">
                  {s.kind} · {s.reason} · {fmt(s.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
