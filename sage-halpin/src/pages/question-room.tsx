import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import { loadOrganisation, boardContext } from "@/lib/organisation";
import { store } from "@/lib/store";
import {
  api,
  forgetConsultation,
  linksFor,
  mailtoFor,
  respondUrl,
  savedConsultations,
  type AgentOpinion,
  type ConsultationView,
  type Invitee,
  type SavedConsultation,
  type Synthesis,
} from "@/lib/consultations";
import { AGENT_PERSONAS, CHAIR_AGENT, POSITIONS, POSITION_LABELS, type Position } from "../../shared/board";

// One board question: who has been asked and who has answered, then the
// decision seen three ways: the people only, the shadow board of agents only,
// and people and agents together.

type Voice = { label: string; position: Position | null; confidence: number | null };

/** Counts of each position for one group, drawn as thin labelled bars. */
function PositionTally({ title, voices, testId }: { title: string; voices: Voice[]; testId: string }) {
  const stated = voices.filter((v) => v.position);
  const max = Math.max(1, ...POSITIONS.map((p) => stated.filter((v) => v.position === p).length));
  const confidences = stated.map((v) => v.confidence).filter((c): c is number => c !== null);
  const mean = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
  return (
    <figure className="m-0" data-testid={testId}>
      <figcaption className="mb-2 text-xs font-bold uppercase tracking-[0.14em]">
        {title}{" "}
        <span className="font-normal normal-case tracking-normal text-muted-foreground">
          {stated.length} of {voices.length} stated a position{mean !== null ? ` · mean confidence ${mean.toFixed(1)} of 5` : ""}
        </span>
      </figcaption>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {POSITIONS.map((p) => {
            const who = stated.filter((v) => v.position === p);
            return (
              <tr key={p} title={who.length ? who.map((v) => v.label).join(", ") : "No one"}>
                <th scope="row" className="w-48 py-1 pr-3 text-left font-normal">
                  {POSITION_LABELS[p]}
                </th>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-sm bg-muted">
                      <div className="h-2 rounded-r bg-primary" style={{ width: `${(who.length / max) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right tabular-nums">{who.length}</span>
                  </div>
                  {who.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{who.map((v) => v.label).join(", ")}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

function Prose({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>;
}

function PositionBadge({ position, confidence }: { position: Position | null; confidence: number | null }) {
  if (!position) return <span className="text-xs text-muted-foreground">Position not stated</span>;
  return (
    <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-semibold">
      {POSITION_LABELS[position]}
      {confidence ? ` · confidence ${confidence}/5` : ""}
    </span>
  );
}

function SynthesisPanel({ synthesis, label, busy, onRun, disabledReason }: { synthesis: Synthesis | null; label: string; busy: boolean; onRun: () => void; disabledReason?: string }) {
  return (
    <div className="mt-6 rounded-md border border-border bg-background p-4">
      {synthesis ? (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            Prepared {new Date(synthesis.createdAt).toLocaleString()} from {synthesis.responses} {synthesis.responses === 1 ? "answer" : "answers"}.
          </p>
          <Prose text={synthesis.content} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{disabledReason ?? "Not prepared yet."}</p>
      )}
      <Button className="mt-4" variant={synthesis ? "outline" : "default"} onClick={onRun} disabled={busy || Boolean(disabledReason)}>
        {busy ? "Preparing…" : synthesis ? `Prepare again` : label}
      </Button>
    </div>
  );
}

function OpinionCard({ o }: { o: AgentOpinion }) {
  const a = AGENT_PERSONAS[o.agentId];
  const chair = o.agentId === CHAIR_AGENT;
  return (
    <article className={`rounded-md border border-border p-4 ${chair ? "bg-muted/40" : "bg-card"}`} style={{ borderLeft: `4px solid ${a.colour}` }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: a.colour }}>
            {a.symbol} {o.persona}
          </p>
          <p className="text-xs text-muted-foreground">AI agent · {o.seat}</p>
        </div>
        <div className="flex items-center gap-2">
          {chair && <span className="rounded bg-[#F3EBDD] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#13232B]">Recommended resolution</span>}
          <PositionBadge position={o.position} confidence={o.confidence} />
        </div>
      </div>
      <Prose text={o.content} />
    </article>
  );
}

function InviteRow({ invitee, c, link, onReissue, busy }: { invitee: Invitee; c: ConsultationView; link: string | null; onReissue: () => void; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  let status: string;
  if (invitee.respondedAt) status = `Answered ${new Date(invitee.respondedAt).toLocaleDateString()}`;
  else if (invitee.emailStatus === "sent") status = "Emailed, awaiting answer";
  else if (invitee.emailStatus === "failed") status = "Email failed: send the link yourself";
  else if (invitee.emailStatus === "manual") status = "Link ready: send it to them";
  else status = "Not invited yet";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`invitee-${invitee.personId}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`mt-1.5 inline-block h-2.5 w-2.5 rounded-full ${invitee.respondedAt ? "bg-[#7FB692]" : "border border-muted-foreground"}`} />
        <div>
          <p className="font-semibold">
            {invitee.name} <span className="font-normal text-muted-foreground">· {invitee.role}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {invitee.email} · <span className="text-foreground">{status}</span>
          </p>
        </div>
      </div>
      {c.status === "open" && !invitee.respondedAt && (
        <div className="flex flex-wrap gap-2">
          {link && (
            <>
              <Button size="sm" asChild>
                <a href={mailtoFor(invitee, c, link)}>Email them</a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard?.writeText(link);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={onReissue} disabled={busy}>
            {link ? "New link" : c.emailProvider === "acs" ? "Email again" : "Issue link"}
          </Button>
        </div>
      )}
    </li>
  );
}

export default function QuestionRoom({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const saved: SavedConsultation | undefined = savedConsultations().find((s) => s.id === params.id);
  const org = loadOrganisation();
  const [c, setC] = useState<ConsultationView | null>(null);
  const [links, setLinks] = useState<Record<string, string>>(() => linksFor(params.id));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [decision, setDecision] = useState("");
  const [recorded, setRecorded] = useState(false);

  const refresh = useCallback(async () => {
    if (!saved) return;
    try {
      setC(await api.get(saved));
      setLinks(linksFor(saved.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "This question could not be loaded.");
    }
  }, [saved?.id]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!saved) {
    return (
      <WorkspaceShell title="Board question">
        <p className="text-sm">
          This question was not asked from this browser, so it cannot be opened here. <Link href="/questions" className="underline">See your questions</Link>.
        </p>
      </WorkspaceShell>
    );
  }
  if (!c) {
    return (
      <WorkspaceShell title="Board question">
        <p className="text-sm text-muted-foreground" role={error ? "alert" : undefined}>
          {error || "Loading…"}
        </p>
      </WorkspaceShell>
    );
  }

  const ctx = boardContext(org, c.invitees.map((i) => i.personId));
  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const answered = c.invitees.filter((i) => i.respondedAt).length;
  const peopleVoices: Voice[] = c.invitees.map((i) => {
    const answers = c.responses[i.personId]?.answers ?? [];
    const position = (answers.find((a) => a.questionId === "position")?.value ?? null) as Position | null;
    const confidence = Number(answers.find((a) => a.questionId === "confidence")?.value) || null;
    return { label: `${i.name} (${i.role})`, position, confidence };
  });
  const agentVoices: Voice[] = (c.shadow?.opinions ?? []).map((o) => ({ label: o.persona, position: o.position, confidence: o.confidence }));

  function recordDecision() {
    if (!decision.trim()) return;
    const decisions = store.getDecisions();
    store.setDecisions([
      {
        id: `d${Date.now()}`,
        title: decision.trim().slice(0, 200),
        owner: org.leadName || "Lead",
        deadline: c?.dueDate ?? "",
        status: "not_started",
        impactArea: "strategy",
        notes: `Board question: ${c?.question}\nAnswered by ${answered} of ${c?.invitees.length} people${c?.shadow ? "; shadow board convened" : ""}.`,
        createdAt: new Date().toISOString(),
      },
      ...decisions,
    ]);
    setRecorded(true);
  }

  return (
    <WorkspaceShell title="Board question">
      <section className="mb-8">
        <p className="font-serif text-xl leading-snug">{c.question}</p>
        {c.context && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">{c.context}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          {c.organisation} · asked by {c.leadName} {c.dueDate ? `· reply by ${c.dueDate}` : ""} · {c.status === "open" ? "open for answers" : "closed"}
        </p>
      </section>

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <Section
        title={`The people (${answered} of ${c.invitees.length} answered)`}
        intro={
          c.emailProvider === "acs"
            ? "Each person was emailed their own questionnaire link."
            : "Email isn't set up for this app yet, so send each person their own link: “Email them” opens a ready-written email in your mail app."
        }
      >
        <ul className="divide-y divide-border rounded-md border border-border">
          {c.invitees.map((i) => (
            <InviteRow
              key={i.personId}
              invitee={i}
              c={c}
              link={links[i.personId] ? respondUrl(links[i.personId]) : null}
              busy={busy === `invite-${i.personId}`}
              onReissue={() => run(`invite-${i.personId}`, () => api.invite(saved, [i.personId]))}
            />
          ))}
        </ul>
      </Section>

      <Tabs defaultValue="people">
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="people" data-testid="tab-people">
            People only
          </TabsTrigger>
          <TabsTrigger value="agents" data-testid="tab-agents">
            Shadow board (agents only)
          </TabsTrigger>
          <TabsTrigger value="mixed" data-testid="tab-mixed">
            People and agents
          </TabsTrigger>
        </TabsList>

        <TabsContent value="people">
          <Section title="The people's view" intro="What the people asked said in their questionnaires, with no AI opinion added.">
            <PositionTally title="People" voices={peopleVoices} testId="tally-people" />
            <div className="mt-6 space-y-4">
              {c.invitees
                .filter((i) => c.responses[i.personId])
                .map((i) => (
                  <details key={i.personId} className="rounded-md border border-border p-4">
                    <summary className="cursor-pointer font-semibold">
                      {i.name} <span className="font-normal text-muted-foreground">· {i.role}</span>
                    </summary>
                    <dl className="mt-3 space-y-3 text-sm">
                      {c.questionnaire.map((q) => {
                        const a = c.responses[i.personId].answers.find((x) => x.questionId === q.id);
                        if (!a) return null;
                        return (
                          <div key={q.id}>
                            <dt className="font-semibold">{q.prompt}</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap">{q.type === "position" ? POSITION_LABELS[a.value as Position] : a.value}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                ))}
            </div>
            <SynthesisPanel
              synthesis={c.syntheses.people}
              label="Summarise the people's view"
              busy={busy === "people"}
              disabledReason={answered === 0 ? "No one has answered yet." : undefined}
              onRun={() => run("people", () => api.synthesis(saved, "people", ctx))}
            />
          </Section>
        </TabsContent>

        <TabsContent value="agents">
          <Section
            title="The shadow board"
            intro="Each AI agent gives its own opinion through its persona, without seeing the people's answers. The Chair hears the other agents, then recommends a resolution."
          >
            {c.shadow ? (
              <>
                <PositionTally title="Agents" voices={agentVoices} testId="tally-agents" />
                <div className="mt-6 space-y-3">
                  {c.shadow.opinions.map((o) => (
                    <OpinionCard key={o.agentId} o={o} />
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Convened {new Date(c.shadow.createdAt).toLocaleString()}.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">The shadow board has not been convened for this question yet.</p>
            )}
            <Button className="mt-4" variant={c.shadow ? "outline" : "default"} onClick={() => run("shadow", () => api.shadowBoard(saved, ctx))} disabled={busy === "shadow"} data-testid="button-convene">
              {busy === "shadow" ? "Convening…" : c.shadow ? "Convene again" : "Convene the shadow board"}
            </Button>
          </Section>
        </TabsContent>

        <TabsContent value="mixed">
          <Section title="People and agents together" intro="Where the people and the shadow board agree and differ, and a recommended resolution that gives the people's judgement its proper weight.">
            <div className="grid gap-6 md:grid-cols-2">
              <PositionTally title="People" voices={peopleVoices} testId="tally-mixed-people" />
              {c.shadow ? (
                <PositionTally title="Agents" voices={agentVoices} testId="tally-mixed-agents" />
              ) : (
                <p className="text-sm text-muted-foreground">Convene the shadow board to compare.</p>
              )}
            </div>
            <SynthesisPanel
              synthesis={c.syntheses.mixed}
              label="Prepare the combined view"
              busy={busy === "mixed"}
              disabledReason={answered === 0 ? "No one has answered yet." : !c.shadow ? "Convene the shadow board first." : undefined}
              onRun={() => run("mixed", () => api.synthesis(saved, "mixed", ctx))}
            />
          </Section>
        </TabsContent>
      </Tabs>

      <Section title="Decide" intro="The people accountable for the organisation make the decision. Record it on the workspace's decisions board.">
        <textarea
          aria-label="The decision"
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
          rows={3}
          maxLength={200}
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          placeholder="We will open the second factory in Q3, subject to the CFO's financing conditions."
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={recordDecision} disabled={!decision.trim() || recorded}>
            {recorded ? "Recorded on the decisions board" : "Record the decision"}
          </Button>
          {c.status === "open" && (
            <Button variant="outline" onClick={() => run("close", () => api.close(saved))} disabled={busy === "close"}>
              Close the questionnaire
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              if (!window.confirm("Delete this question, everyone's answers and the board's views? Their links stop working.")) return;
              setBusy("delete");
              api
                .remove(saved)
                .then(() => {
                  forgetConsultation(saved.id);
                  setLocation("/questions");
                })
                .catch((e) => {
                  setError(e instanceof Error ? e.message : "The question could not be deleted.");
                  setBusy(null);
                });
            }}
          >
            Delete question and answers
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Answers are kept until {new Date(c.expiresAt).toLocaleDateString()}, then deleted automatically.
        </p>
      </Section>
    </WorkspaceShell>
  );
}
