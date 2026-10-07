import { useCallback, useEffect, useState } from "react";
import { MissingData } from "@/components/MissingData";
import { PageLoader } from "@/components/PageLoader";
import { invalidateCheckpointPill } from "@/components/CheckpointPill";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import { DocumentList } from "@/components/Documents";
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
import {
  AGENT_PERSONAS,
  CHAIR_AGENT,
  DECISION_MODE_LABELS,
  POSITIONS,
  POSITION_LABELS,
  weightedTally,
  type AgentId,
  type Position,
} from "../../shared/board";

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

type Rating = "helpful" | "off_target";

function OpinionCard({
  o,
  feedback,
  onFeedback,
  learns,
}: {
  o: AgentOpinion;
  feedback?: { rating: Rating; note: string };
  onFeedback?: (rating: Rating, note: string) => Promise<void>;
  learns: boolean;
}) {
  const a = AGENT_PERSONAS[o.agentId];
  const chair = o.agentId === CHAIR_AGENT;
  const [rating, setRating] = useState<Rating | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
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
      {onFeedback && (
        <div className="mt-3 border-t border-border pt-3 text-sm">
          {feedback ? (
            <p className="text-xs text-muted-foreground">
              You rated this {feedback.rating === "helpful" ? "helpful" : "off target"}
              {feedback.note ? `: “${feedback.note}”${learns ? " (it has learned this)" : ""}` : "."}
            </p>
          ) : rating ? (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setSending(true);
                await onFeedback(rating, note.trim()).finally(() => setSending(false));
              }}
            >
              <label className="block text-xs font-semibold" htmlFor={`fb-${o.agentId}`}>
                {rating === "helpful" ? "What should it keep doing? (optional)" : "What did it get wrong? (optional)"}
                {learns && <span className="font-normal text-muted-foreground"> It will learn from what you write.</span>}
              </label>
              <textarea id={`fb-${o.agentId}`} rows={2} maxLength={500} className="w-full rounded-md border border-input bg-background p-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={sending}>
                  Send feedback
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setRating(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Was this useful?</span>
              <Button size="sm" variant="outline" onClick={() => setRating("helpful")} data-testid={`feedback-helpful-${o.agentId}`}>
                Helpful
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRating("off_target")} data-testid={`feedback-off-${o.agentId}`}>
                Off target
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** The combined weight behind each position, as the chair weighted it. */
function WeightedTally({ people, agents, peopleWeight }: { people: (Position | null)[]; agents: (Position | null)[]; peopleWeight: number }) {
  const tally = weightedTally(people, agents, peopleWeight);
  const top = Math.max(...tally.map((t) => t.score));
  return (
    <figure className="m-0" data-testid="tally-weighted">
      <figcaption className="mb-2 text-xs font-bold uppercase tracking-[0.14em]">
        Weighted view{" "}
        <span className="font-normal normal-case tracking-normal text-muted-foreground">
          people {peopleWeight}% · agents {100 - peopleWeight}%
        </span>
      </figcaption>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {tally.map((t) => (
            <tr key={t.position}>
              <th scope="row" className="w-48 py-1 pr-3 text-left font-normal">
                {POSITION_LABELS[t.position]}
                {t.score === top && top > 0 && <span className="ml-1 text-xs font-semibold">(leads)</span>}
              </th>
              <td className="py-1">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-sm bg-muted">
                    <div className="h-2 rounded-r bg-primary" style={{ width: `${t.score}%` }} />
                  </div>
                  <span className="w-10 text-right tabular-nums">{t.score}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
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
            {invitee.permanent && (
              <span className="ml-2 rounded bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-primary-foreground">Permanent</span>
            )}
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
  const [direction, setDirection] = useState<Position>("support");
  const [rationale, setRationale] = useState("");
  const [withoutPermanent, setWithoutPermanent] = useState(false);
  const [plan, setPlan] = useState("");

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
        {error ? (
          <p className="text-sm text-muted-foreground" role="alert">
            {error}
          </p>
        ) : (
          <PageLoader label="Loading the question" />
        )}
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
  const finalAgents = (c.shadow?.opinions ?? []).map((o) => c.challenge?.opinions.find((x) => x.agentId === o.agentId) ?? o);
  const agentVoices: Voice[] = (c.shadow?.opinions ?? []).map((o) => ({ label: o.persona, position: o.position, confidence: o.confidence }));
  const finalAgentVoices: Voice[] = finalAgents.map((o) => ({ label: o.persona, position: o.position, confidence: o.confidence }));
  const feedbackFor = (id: AgentId) => c.feedback.find((f) => f.agentId === id);
  const sendFeedback = (agentId: AgentId) => (rating: Rating, note: string) => run(`fb-${agentId}`, () => api.feedback(saved, { agentId, rating, note }));
  const showPeople = c.mode !== "agents";
  const missingPermanent = showPeople ? c.invitees.filter((i) => i.permanent && !i.respondedAt) : [];
  const showAgents = c.mode !== "people";

  async function recordDecision() {
    if (!decision.trim() || !c) return;
    await run("decide", async () => {
      await api.decide(saved!, { decision: decision.trim(), position: direction, rationale: rationale.trim(), plan: plan.trim(), proceedWithoutPermanent: withoutPermanent });
      invalidateCheckpointPill();
      store.setDecisions([
        {
          id: `d${Date.now()}`,
          title: decision.trim().slice(0, 200),
          owner: org.leadName || "Lead",
          deadline: c.dueDate ?? "",
          status: "not_started",
          impactArea: "strategy",
          notes: `Board question (${DECISION_MODE_LABELS[c.mode].toLowerCase()}): ${c.question}${rationale.trim() ? `\nWhy: ${rationale.trim()}` : ""}`,
          createdAt: new Date().toISOString(),
        },
        ...store.getDecisions(),
      ]);
      setRecorded(true);
    });
  }

  const shadowPanel = (
    <Section
      title={c.mode === "collaborative" ? "Round one: the shadow board" : "The shadow board"}
      intro="Each AI agent gives its own opinion through its persona, drawing on what it has learned in your organisation and the external landscape, without seeing the people's answers. The Chair hears the other agents, then recommends a resolution."
    >
      {c.shadow ? (
        <>
          <PositionTally title="Agents" voices={agentVoices} testId="tally-agents" />
          <div className="mt-6 space-y-3">
            {c.shadow.opinions.map((o) => (
              <OpinionCard key={o.agentId} o={o} feedback={feedbackFor(o.agentId)} onFeedback={sendFeedback(o.agentId)} learns={c.linkedToWorkspace} />
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
      {c.shadow && c.mode === "collaborative" && c.shareWithPeople && (
        <p className="mt-3 text-xs text-muted-foreground">People now see the agents' positions and the Chair's recommendation on their questionnaire, and can revise their answers.</p>
      )}
    </Section>
  );

  const peoplePanel = (
    <Section
      title={c.mode === "collaborative" ? "Round one: the people" : "The people's view"}
      intro="What the people asked said in their questionnaires, with no AI opinion added."
    >
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
  );

  return (
    <WorkspaceShell title="Board question">
      <section className="mb-8">
        <p className="font-serif text-xl leading-snug">{c.question}</p>
        {c.context && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">{c.context}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          {c.organisation} · asked by {c.leadName} {c.dueDate ? `· reply by ${c.dueDate}` : ""} · {c.status === "open" ? "open" : "closed"}
        </p>
        <p className="mt-3 inline-block rounded border border-border bg-card px-3 py-1 text-xs font-semibold" data-testid="mode-badge">
          Decided by: {DECISION_MODE_LABELS[c.mode]}
          {c.mode === "collaborative" ? ` · people ${c.peopleWeight}%, agents ${100 - c.peopleWeight}%` : ""}
        </p>
      </section>

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {showPeople && (
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
      )}

      {c.mode !== "people" && <MissingData use="decision" personIds={c.invitees.map((i) => i.personId)} />}

      <details open className="mb-8 rounded-md border border-border bg-card" data-testid="question-docs-section">
        <summary className="cursor-pointer px-5 py-4 text-sm font-bold uppercase tracking-[0.18em]">Background and supporting documents</summary>
        <div className="border-t border-border p-5">
          <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
            Attach any file, at any stage of this decision, with instructions for Sentinel. The shadow board reads what matters from each one; shared files
            appear on the people's questionnaires.
          </p>
          <DocumentList
            owner={{ kind: "consultation", id: saved.id, token: saved.adminToken }}
            stage="decision"
            shareOption={c.mode !== "agents"}
            defaultInstruction="Background for this board question: summarise what matters for the decision."
            emptyText="No documents attached to this question yet."
          />
        </div>
      </details>

      {c.mode === "people" && peoplePanel}
      {c.mode === "agents" && shadowPanel}
      {c.mode === "collaborative" && (
        <Tabs defaultValue="people">
          <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
            <TabsTrigger value="people" data-testid="tab-people">
              1 · People
            </TabsTrigger>
            <TabsTrigger value="agents" data-testid="tab-agents">
              1 · Shadow board
            </TabsTrigger>
            <TabsTrigger value="challenge" data-testid="tab-challenge">
              2 · Challenge
            </TabsTrigger>
            <TabsTrigger value="mixed" data-testid="tab-mixed">
              Combined view
            </TabsTrigger>
          </TabsList>

          <TabsContent value="people">{peoplePanel}</TabsContent>
          <TabsContent value="agents">{shadowPanel}</TabsContent>

          <TabsContent value="challenge">
            <Section
              title="Round two: the agents challenge the people"
              intro="Each agent reads the people's answers, says what they may have missed and what it missed itself, and whether its own view changes."
            >
              {c.challenge ? (
                <>
                  <PositionTally title="Agents after the challenge" voices={finalAgentVoices} testId="tally-challenge" />
                  <div className="mt-6 space-y-3">
                    {c.challenge.opinions.map((o) => {
                      const before = c.shadow?.opinions.find((x) => x.agentId === o.agentId)?.position;
                      return (
                        <div key={o.agentId}>
                          {before !== o.position && (
                            <p className="mb-1 text-xs font-semibold">
                              Changed its view: {before ? POSITION_LABELS[before] : "no position"} → {o.position ? POSITION_LABELS[o.position] : "no position"}
                            </p>
                          )}
                          <OpinionCard o={o} learns={c.linkedToWorkspace} />
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {!c.shadow ? "Convene the shadow board first." : answered === 0 ? "Wait for at least one person to answer." : "Not run yet."}
                </p>
              )}
              <Button
                className="mt-4"
                variant={c.challenge ? "outline" : "default"}
                onClick={() => run("challenge", () => api.challenge(saved, ctx))}
                disabled={busy === "challenge" || !c.shadow || answered === 0}
                data-testid="button-challenge"
              >
                {busy === "challenge" ? "Challenging…" : c.challenge ? "Run the challenge again" : "Run the challenge round"}
              </Button>
            </Section>
          </TabsContent>

          <TabsContent value="mixed">
            <Section
              title="People and agents together"
              intro="Both sides' positions, the weighted view you set, and a recommended resolution that reflects your weighting. Your people decide."
            >
              <div className="grid gap-6 md:grid-cols-2">
                <PositionTally title="People" voices={peopleVoices} testId="tally-mixed-people" />
                {c.shadow ? (
                  <PositionTally title={c.challenge ? "Agents (after the challenge)" : "Agents"} voices={finalAgentVoices} testId="tally-mixed-agents" />
                ) : (
                  <p className="text-sm text-muted-foreground">Convene the shadow board to compare.</p>
                )}
              </div>
              <div className="mt-6">
                <WeightedTally people={peopleVoices.map((v) => v.position)} agents={finalAgentVoices.map((v) => v.position)} peopleWeight={c.peopleWeight} />
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
      )}

      <Section
        title="Decide"
        intro={
          c.mode === "agents"
            ? "The shadow board advises; you adopt or reject its resolution. Record the decision."
            : "The people accountable for the organisation make the decision. Record it, and the agents learn from it when you review how it turned out."
        }
      >
        {c.decision ? (
          <div data-testid="decision-recorded">
            <p className="font-semibold">{c.decision.decision}</p>
            <p className="text-sm text-muted-foreground">
              {POSITION_LABELS[c.decision.position]} · decided {new Date(c.decision.decidedAt).toLocaleDateString()}
            </p>
            {c.decision.rationale && <p className="mt-2 whitespace-pre-wrap text-sm">{c.decision.rationale}</p>}
            {c.decision.plan && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em]">The plan</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.decision.plan}</p>
              </div>
            )}
            {c.linkedToWorkspace && (
              <p className="mt-3 text-sm">
                The decision{c.decision.plan ? " and its plan are" : " is"} in your organisation's record and will be in the next{" "}
                <Link href="/checkpoint" className="font-semibold underline underline-offset-4">
                  checkpoint
                </Link>
                .
              </p>
            )}
            {c.decision.withoutPermanent?.length ? (
              <p className="mt-2 text-sm text-muted-foreground">Decided without the answers of permanent members: {c.decision.withoutPermanent.join(", ")}.</p>
            ) : null}
            {c.linkedToWorkspace && (
              <p className="mt-3 text-sm">
                When you know how it turned out,{" "}
                <Link href="/agents" className="font-semibold underline underline-offset-4">
                  review the outcome with the agents
                </Link>{" "}
                so they learn from it.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-[1fr_260px]">
              <textarea
                aria-label="The decision"
                className="w-full rounded-md border border-input bg-background p-3 text-sm"
                rows={3}
                maxLength={500}
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
                placeholder="We will open the second factory in Q3, subject to the CFO's financing conditions."
              />
              <div className="space-y-1">
                <label htmlFor="decision-direction" className="text-xs font-semibold uppercase tracking-[0.12em]">
                  What it means
                </label>
                <select
                  id="decision-direction"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as Position)}
                >
                  <option value="support">Go ahead</option>
                  <option value="support_with_conditions">Go ahead, with conditions</option>
                  <option value="oppose">Do not go ahead</option>
                  <option value="need_more_information">Defer for more information</option>
                </select>
              </div>
            </div>
            <textarea
              aria-label="Why"
              className="mt-3 w-full rounded-md border border-input bg-background p-3 text-sm"
              rows={2}
              maxLength={2000}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Why (optional): what tipped it, and what you accepted."
            />
            <textarea
              aria-label="The plan"
              className="mt-3 w-full rounded-md border border-input bg-background p-3 text-sm"
              rows={3}
              maxLength={3000}
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="The plan (optional): actions, owners and dates, and the kill condition. Captured with the decision in the checkpoint."
              data-testid="input-plan"
            />
          </>
        )}
        {!c.decision && missingPermanent.length > 0 && (
          <div className="mt-3 rounded-md border border-[#D9A15F] bg-[#D9A15F]/10 p-3 text-sm" data-testid="missing-permanent">
            <p>
              <span className="font-semibold">Waiting for permanent members:</span> {missingPermanent.map((m) => `${m.name} (${m.role})`).join(", ")}.
              Permanent members take part in every decision that involves people.
            </p>
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={withoutPermanent} onChange={(e) => setWithoutPermanent(e.target.checked)} data-testid="confirm-without-permanent" />
              Decide without their answers (this is recorded with the decision)
            </label>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {!c.decision && (
            <Button
              onClick={recordDecision}
              disabled={!decision.trim() || recorded || busy === "decide" || (missingPermanent.length > 0 && !withoutPermanent)}
              data-testid="button-decide"
            >
              {recorded ? "Recorded" : "Record the decision"}
            </Button>
          )}
          {c.status === "open" && showPeople && (
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
          Answers are kept until {new Date(c.expiresAt).toLocaleDateString()}, then deleted automatically. The decision and its outcome stay with your
          agents' track records.
        </p>
      </Section>
    </WorkspaceShell>
  );
}
