import { useCallback, useEffect, useState } from "react";
import { MissingData } from "@/components/MissingData";
import { markShadowBoardSeen } from "@/components/GettingStarted";
import { PageLoader } from "@/components/PageLoader";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import { loadOrganisation } from "@/lib/organisation";
import { ensureWorkspace, workspaceApi, type DecisionRecord, type TrackRecord, type WorkspaceLink } from "@/lib/workspace";
import {
  AGENT_IDS,
  AGENT_PERSONAS,
  LESSON_KINDS,
  LESSON_KIND_LABELS,
  LESSON_LIMITS,
  LESSON_SOURCE_LABELS,
  OUTCOMES,
  OUTCOME_LABELS,
  POSITION_LABELS,
  type AgentId,
  type Lesson,
  type LessonKind,
  type Outcome,
} from "../../shared/board";

// Agent development: the chair educates each agent, and sees how it learns in
// the company. Four ways in: taught by the chair, material it studies,
// feedback on its opinions, and decision outcomes; plus what horizon scanning
// brings from outside. Nothing the platform proposes reaches an agent until
// the chair approves it.

type AgentState = { id: AgentId; lessons: Lesson[]; record: TrackRecord };

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-serif text-2xl font-light tabular-nums">{value}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");

function ProposedLesson({ lesson, onDecide, busy }: { lesson: Lesson; onDecide: (status: "active" | "retired", text?: string) => void; busy: boolean }) {
  const [text, setText] = useState(lesson.text);
  const [editing, setEditing] = useState(false);
  return (
    <li className="rounded-md border border-border bg-background p-3" data-testid="proposed-lesson">
      <p className="text-xs text-muted-foreground">
        {LESSON_SOURCE_LABELS[lesson.source]} · {LESSON_KIND_LABELS[lesson.kind]}
        {lesson.ref ? ` · ${lesson.ref}` : ""}
      </p>
      {editing ? (
        <Textarea className="mt-2" rows={2} maxLength={LESSON_LIMITS.text} value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit lesson" />
      ) : (
        <p className="mt-1 text-sm">{lesson.text}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onDecide("active", text !== lesson.text ? text : undefined)} disabled={busy || !text.trim()}>
          {editing ? "Save and approve" : "Approve"}
        </Button>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onDecide("retired")} disabled={busy}>
          Reject
        </Button>
      </div>
    </li>
  );
}

function OutcomeReview({ d, link, onDone }: { d: DecisionRecord; link: WorkspaceLink; onDone: (proposed: number) => void }) {
  const [result, setResult] = useState<Outcome>("as_expected");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <li className="rounded-md border border-border p-4" data-testid="outcome-review">
      <p className="font-semibold">{d.decision}</p>
      <p className="text-xs text-muted-foreground">
        {d.question} · decided {new Date(d.decidedAt).toLocaleDateString()} ({POSITION_LABELS[d.position]}) ·{" "}
        <Link href={`/questions/${d.consultationId}`} className="underline">
          open the question
        </Link>
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor={`outcome-${d.consultationId}`} className="text-xs">
            How did it turn out?
          </Label>
          <select
            id={`outcome-${d.consultationId}`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={result}
            onChange={(e) => setResult(e.target.value as Outcome)}
          >
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`note-${d.consultationId}`} className="text-xs">
            What happened (optional)
          </Label>
          <Input id={`note-${d.consultationId}`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const res = await workspaceApi.outcome(link, d.consultationId, result, note.trim());
              onDone(res.proposed.length);
            } catch (e) {
              setError(e instanceof Error ? e.message : "The review failed.");
              setBusy(false);
            }
          }}
        >
          {busy ? "Reviewing…" : "Review with the agents"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </li>
  );
}

export default function AgentsPage() {
  useEffect(() => markShadowBoardSeen(), []);
  const org = loadOrganisation();
  const [link, setLink] = useState<WorkspaceLink | null>(org.workspace ?? null);
  const [agents, setAgents] = useState<AgentState[] | null>(null);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [selected, setSelected] = useState<AgentId>("orion");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<LessonKind>("principle");
  const [lessonText, setLessonText] = useState("");
  const [studyTitle, setStudyTitle] = useState("");
  const [studyText, setStudyText] = useState("");

  const refresh = useCallback(async (l: WorkspaceLink) => {
    const [a, d] = await Promise.all([workspaceApi.agents(l), workspaceApi.decisions(l)]);
    setAgents(a.agents);
    setDecisions(d.decisions);
  }, []);

  useEffect(() => {
    ensureWorkspace()
      .then((l) => {
        setLink(l);
        if (l) return refresh(l);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Your agents could not be loaded."));
  }, [refresh]);

  if (!org.name.trim()) {
    return (
      <WorkspaceShell title="Agent development">
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

  // Show one loader until the agents and decisions have both arrived, then the whole page.
  if (!agents && !error) {
    return (
      <WorkspaceShell title="Agent development">
        <PageLoader label="Loading your agents" />
      </WorkspaceShell>
    );
  }

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

  const agent = agents?.find((a) => a.id === selected);
  const persona = AGENT_PERSONAS[selected];
  const proposed = agent?.lessons.filter((l) => l.status === "proposed") ?? [];
  const active = agent?.lessons.filter((l) => l.status === "active") ?? [];
  const retired = agent?.lessons.filter((l) => l.status === "retired") ?? [];
  const awaitingReview = decisions.filter((d) => !d.outcome);
  const waitingTotal = agents?.reduce((n, a) => n + a.lessons.filter((l) => l.status === "proposed").length, 0) ?? 0;

  return (
    <WorkspaceShell title="Agent development">
      <MissingData use="agents" />
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Develop each agent for your organisation. They learn in four ways: what you teach them, material you give them to study, your feedback
        on their opinions, and how the board's decisions turn out. They also read what horizon scanning finds outside. Anything the platform
        proposes waits here for your approval; only approved lessons shape an agent's advice.
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

      <div role="tablist" aria-label="Agents" className="mb-6 flex flex-wrap gap-2">
        {AGENT_IDS.map((id) => {
          const a = AGENT_PERSONAS[id];
          const waiting = agents?.find((x) => x.id === id)?.lessons.filter((l) => l.status === "proposed").length ?? 0;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={selected === id}
              onClick={() => setSelected(id)}
              className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${selected === id ? "border-primary bg-card" : "border-border hover:bg-muted"}`}
              style={{ borderLeft: `4px solid ${a.colour}` }}
              data-testid={`agent-tab-${id}`}
            >
              <span className="block font-bold uppercase tracking-[0.12em]" style={{ color: a.colour }}>
                {a.symbol} {a.persona}
              </span>
              <span className="text-muted-foreground">
                {a.short}
                {waiting ? ` · ${waiting} to review` : ""}
              </span>
            </button>
          );
        })}
      </div>

      {!agent ? (
        error ? null : <PageLoader />
      ) : (
        <>
          <Section title={`${persona.persona}: ${persona.seat}`} intro={persona.archetype}>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Questions advised" value={String(agent.record.consultations)} />
              <Stat label="Agreed with the board" value={pct(agent.record.aligned, agent.record.decisions)} detail={`${agent.record.aligned} of ${agent.record.decisions} decisions`} />
              <Stat
                label="Called it right"
                value={pct(agent.record.calledRight, agent.record.outcomesReviewed)}
                detail={`${agent.record.calledRight} of ${agent.record.outcomesReviewed} outcomes reviewed`}
              />
              <Stat label="Lessons it applies" value={`${active.length}`} detail={`of ${LESSON_LIMITS.activePerAgent} it can hold`} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              “Called it right” counts the times it agreed with a decision that worked, or disagreed with one that did not.
            </p>
          </Section>

          {proposed.length > 0 && (
            <Section title={`Waiting for your approval (${proposed.length})`} intro="Proposed from its study, decision outcomes or horizon scanning.">
              <ul className="space-y-3">
                {proposed.map((l) => (
                  <ProposedLesson
                    key={l.id}
                    lesson={l}
                    busy={busy === l.id}
                    onDecide={(status, text) => run(l.id, () => workspaceApi.setLesson(link!, l.id, status, text), status === "active" ? "Approved." : "Rejected.")}
                  />
                ))}
              </ul>
            </Section>
          )}

          <div className="grid gap-8 lg:grid-cols-2">
            <Section title="Teach it" intro="Something it should always apply when it advises your board.">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="lesson-kind" className="text-xs font-semibold uppercase tracking-[0.12em]">
                    Kind
                  </Label>
                  <select id="lesson-kind" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as LessonKind)}>
                    {LESSON_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {LESSON_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <Textarea
                  aria-label="Lesson"
                  rows={3}
                  maxLength={LESSON_LIMITS.text}
                  value={lessonText}
                  onChange={(e) => setLessonText(e.target.value)}
                  placeholder={selected === "solara" ? "Our hurdle rate for capital projects is 12%." : "We never take on a customer worth more than 20% of revenue."}
                  data-testid="input-lesson"
                />
                <Button
                  disabled={!lessonText.trim() || busy === "teach"}
                  onClick={() =>
                    run(
                      "teach",
                      async () => {
                        await workspaceApi.teach(link!, selected, kind, lessonText.trim());
                        setLessonText("");
                      },
                      `${persona.persona} will apply this from now on.`,
                    )
                  }
                  data-testid="button-teach"
                >
                  Teach {persona.persona}
                </Button>
              </div>
            </Section>

            <Section title="Give it something to study" intro="A policy, strategy, risk appetite or board paper. It proposes what to take from it, for you to approve.">
              <div className="space-y-3">
                <Input aria-label="Title" placeholder="Risk appetite statement 2026" maxLength={LESSON_LIMITS.studyTitle} value={studyTitle} onChange={(e) => setStudyTitle(e.target.value)} />
                <Textarea aria-label="Material" rows={4} maxLength={LESSON_LIMITS.studyText} value={studyText} onChange={(e) => setStudyText(e.target.value)} placeholder="Paste the text here." />
                <Button
                  variant="outline"
                  disabled={!studyTitle.trim() || !studyText.trim() || busy === "study"}
                  onClick={() =>
                    run(
                      "study",
                      async () => {
                        const res = await workspaceApi.study(link!, selected, studyTitle.trim(), studyText.trim());
                        setStudyTitle("");
                        setStudyText("");
                        setNotice(`${res.proposed.length} lesson${res.proposed.length === 1 ? "" : "s"} proposed for your approval.`);
                      },
                    )
                  }
                  data-testid="button-study"
                >
                  {busy === "study" ? "Studying…" : "Study it"}
                </Button>
              </div>
            </Section>
          </div>

          <Section title={`What it applies (${active.length})`} intro="Its approved lessons, which it brings to every question.">
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet. Teach it, or approve what it proposes.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border" data-testid="active-lessons">
                {active.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm">{l.text}</p>
                      <p className="text-xs text-muted-foreground">
                        {LESSON_KIND_LABELS[l.kind]} · {LESSON_SOURCE_LABELS[l.source]} · {new Date(l.decidedAt ?? l.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" disabled={busy === l.id} onClick={() => run(l.id, () => workspaceApi.setLesson(link!, l.id, "retired"))}>
                      Retire
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {retired.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-muted-foreground">Retired and rejected ({retired.length})</summary>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {retired.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3">
                      <span>{l.text}</span>
                      <Button size="sm" variant="ghost" onClick={() => run(l.id, () => workspaceApi.setLesson(link!, l.id, "active"))}>
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Section>
        </>
      )}

      <Section
        title={`Learn from outcomes (${awaitingReview.length} to review)`}
        intro="When you know how a decision turned out, review it: each agent that advised reflects on what it should learn, and proposes it here for your approval. Track records update too."
      >
        {awaitingReview.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions are waiting for an outcome. Decisions you record on board questions appear here.</p>
        ) : (
          <ul className="space-y-3">
            {awaitingReview.map((d) => (
              <OutcomeReview key={d.consultationId} d={d} link={link!} onDone={(n) => { setNotice(`Outcome recorded. ${n} lesson${n === 1 ? "" : "s"} proposed across the agents.`); refresh(link!); }} />
            ))}
          </ul>
        )}
        {waitingTotal > 0 && <p className="mt-3 text-xs text-muted-foreground">{waitingTotal} proposed lessons are waiting across all agents.</p>}
      </Section>
    </WorkspaceShell>
  );
}
