import { useEffect, useState } from "react";
import { usePageDownloads } from "@/components/PageDownload";
import { saveFile, toCsv, today } from "@/lib/downloads";
import { MissingData } from "@/components/MissingData";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import { loadOrganisation } from "@/lib/organisation";
import { hasContactDetails } from "@/lib/missing";
import { api, rememberConsultation, savedConsultations } from "@/lib/consultations";
import { ensureWorkspace, workspaceApi, type DecisionRecord } from "@/lib/workspace";
import { Switch } from "@/components/ui/switch";
import { filesApi, formatSize, MAX_FILE_MB } from "@/lib/files";
import {
  AGENT_PERSONAS,
  DECISION_MODES,
  DECISION_MODE_DESCRIPTIONS,
  DECISION_MODE_LABELS,
  LIMITS,
  OUTCOME_LABELS,
  POSITION_LABELS,
  STANDARD_QUESTIONS,
  type AgentId,
  type DecisionMode,
} from "../../shared/board";

// Board questions: the list of questions put to the board, and the flow for
// asking a new one: the question, the people involved, the questionnaire, then
// invitations to each person.

export function QuestionList() {
  const list = savedConsultations();
  const org = loadOrganisation();
  usePageDownloads(
    list.length
      ? [
          {
            label: "Board questions asked",
            hint: "CSV",
            run: () => saveFile(`sentinel8-board-questions-${today()}.csv`, "text/csv;charset=utf-8", toCsv(["Asked", "Question"], list.map((q) => [q.createdAt.slice(0, 10), q.question]))),
          },
        ]
      : [],
  );
  return (
    <WorkspaceShell
      title="Board questions"
      actions={
        <Button asChild data-testid="button-new-question">
          <Link href="/questions/new">Ask a new question</Link>
        </Button>
      }
    >
      {org.people.length === 0 && (
        <p className="mb-6 rounded-md border border-border bg-card p-4 text-sm">
          Start by assembling <Link href="/organisation" className="font-semibold underline underline-offset-4">your board</Link>: your
          organisation and the people who take part in its decisions.
        </p>
      )}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No questions yet. Questions you ask from this browser appear here.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card" data-testid="question-list">
          {list.map((c) => (
            <li key={c.id}>
              <Link href={`/questions/${c.id}`} className="block p-4 no-underline hover:bg-muted">
                <p className="font-semibold text-foreground">{c.question}</p>
                <p className="text-xs text-muted-foreground">Asked {new Date(c.createdAt).toLocaleDateString()}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WorkspaceShell>
  );
}

/** The context for revisiting an earlier decision: what was decided, why, and how it turned out. */
function revisitContext(d: DecisionRecord): string {
  const parts = [
    `Revisiting the board's decision of ${d.decidedAt.slice(0, 10)}: "${d.decision}" (${POSITION_LABELS[d.position]}).`,
    d.rationale ? `Why: ${d.rationale}` : "",
    d.plan ? `Plan: ${d.plan}` : "",
    d.outcome ? `Outcome so far: ${OUTCOME_LABELS[d.outcome.result]}${d.outcome.note ? `: ${d.outcome.note}` : ""}.` : "Outcome not yet recorded.",
    d.context ? `Original context: ${d.context}` : "",
  ];
  return parts.filter(Boolean).join("\n").slice(0, LIMITS.context);
}

export function NewQuestion() {
  const [, setLocation] = useLocation();
  const org = loadOrganisation();
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [dueDate, setDueDate] = useState("");
  const permanentIds = org.people.filter((p) => p.permanent).map((p) => p.id);
  // Permanent members are always asked; others start ticked only when there are no permanent members.
  const [peopleIds, setPeopleIds] = useState<string[]>(permanentIds.length ? permanentIds : org.people.map((p) => p.id));
  const [agents, setAgents] = useState<AgentId[]>(org.agents.filter((a) => a.seated).map((a) => a.id));
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // With no people on the board yet, only the agents can be asked.
  const [mode, setMode] = useState<DecisionMode>(org.people.length ? "collaborative" : "agents");
  const [peopleWeight, setPeopleWeight] = useState(60);
  const [shareWithPeople, setShareWithPeople] = useState(true);
  // Background and supporting documents: attached once the question exists.
  const [docs, setDocs] = useState<File[]>([]);
  const [docsInstruction, setDocsInstruction] = useState("Background for this board question: summarise what matters for the decision.");
  const [shareDocs, setShareDocs] = useState(true);
  const [docsNote, setDocsNote] = useState("");
  const [sendingNote, setSendingNote] = useState("");

  const people = mode === "agents" ? [] : org.people.filter((p) => p.permanent || peopleIds.includes(p.id));
  const askPeople = mode !== "agents";
  const askAgents = mode !== "people";
  const ready = hasContactDetails(org);

  // "Revisit as a new question" from the decision log: start from that decision.
  const revisitId = new URLSearchParams(useSearch()).get("revisit");
  const [revisiting, setRevisiting] = useState<DecisionRecord | null>(null);
  useEffect(() => {
    const link = org.workspace;
    if (!revisitId || !link) return;
    workspaceApi
      .decisions(link)
      .then(({ decisions }) => {
        const d = decisions.find((x) => x.consultationId === revisitId);
        if (!d) return;
        setRevisiting(d);
        setQuestion((q) => q || d.question);
        setContext((c) => c || revisitContext(d));
      })
      .catch(() => undefined);
  }, [revisitId]);

  if (!ready) {
    return (
      <WorkspaceShell title="Ask the board">
        <p className="text-sm">
          Before asking a question, add your contact details (organisation name, your name and email) in{" "}
          <Link href="/organisation" className="font-semibold underline underline-offset-4">
            Your board
          </Link>
          .
        </p>
      </WorkspaceShell>
    );
  }

  async function draft() {
    setError("");
    if (!question.trim()) return setError("Write the question first.");
    setDrafting(true);
    try {
      const res = await api.draftQuestionnaire(question.trim(), context.trim(), people.map((p) => p.role));
      setQuestions(res.items.map((i) => i.prompt));
      setDraftNote(res.source === "ai" ? "Drafted for this question. Edit freely." : "A standard set of questions. Edit freely.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The questionnaire could not be drafted.");
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    setError("");
    if (!question.trim()) return setError("Write the question first.");
    if (askPeople && people.length === 0) return setError("Choose at least one person to ask.");
    const prompts = (questions ?? []).map((q) => q.trim()).filter(Boolean);
    setSending(true);
    try {
      const workspace = await ensureWorkspace(org).catch(() => null);
      const created = await api.create({
        mode,
        peopleWeight,
        shareWithPeople,
        workspace: workspace ? { id: workspace.id, token: workspace.adminToken } : null,
        organisation: org.name.trim(),
        leadName: org.leadName.trim(),
        question: question.trim(),
        context: context.trim(),
        dueDate,
        questions: prompts,
        agents,
        people: people.map((p) => ({ id: p.id, name: p.name, role: p.role, email: p.email, permanent: p.permanent === true })),
      });
      const saved = { id: created.id, adminToken: created.adminToken, question: question.trim(), createdAt: new Date().toISOString() };
      rememberConsultation(saved);
      const failed: string[] = [];
      for (const [i, file] of docs.entries()) {
        setSendingNote(`Sentinel is reading ${file.name} (${i + 1} of ${docs.length})…`);
        await filesApi
          .upload({ kind: "consultation", id: saved.id, token: saved.adminToken }, file, { instruction: docsInstruction, stage: "question", share: askPeople && shareDocs })
          .catch((e) => failed.push(`${file.name}: ${e instanceof Error ? e.message : "not attached"}`));
      }
      setSendingNote("");
      if (askPeople) await api.invite(saved);
      if (failed.length) window.alert(`The question was sent, but some documents could not be attached. Attach them again from the question.\n\n${failed.join("\n")}`);
      setLocation(`/questions/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The question could not be sent.");
      setSending(false);
    }
  }

  return (
    <WorkspaceShell title="Ask the board">
      {revisiting && (
        <p className="mb-6 rounded-md border border-border bg-card p-4 text-sm" data-testid="revisit-banner">
          <span className="font-semibold">Revisiting the decision of {new Date(revisiting.decidedAt).toLocaleDateString()}:</span> {revisiting.decision} (
          {POSITION_LABELS[revisiting.position]}). The question and context below start from it, and the agents also see it in the board's decision log.
        </p>
      )}
      <MissingData use="question" personIds={people.map((p) => p.id)} />
      <Section title="1. Who decides" intro="Choose whose input this decision rests on.">
        <div role="radiogroup" aria-label="Who decides" className="grid gap-3 md:grid-cols-3">
          {DECISION_MODES.map((m) => (
            <label
              key={m}
              className={`cursor-pointer rounded-md border p-4 text-sm transition-colors ${mode === m ? "border-primary bg-muted" : "border-border hover:bg-muted/50"}`}
              data-testid={`mode-${m}`}
            >
              <span className="flex items-center gap-2 font-semibold">
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} disabled={m !== "agents" && org.people.length === 0} />
                {DECISION_MODE_LABELS[m]}
              </span>
              <span className="mt-1 block text-muted-foreground">{DECISION_MODE_DESCRIPTIONS[m]}</span>
            </label>
          ))}
        </div>
        {mode === "collaborative" && (
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="q-weight" className="text-xs font-semibold uppercase tracking-[0.12em]">
                Weighting: people {peopleWeight}% · agents {100 - peopleWeight}%
              </Label>
              <input
                id="q-weight"
                type="range"
                min={0}
                max={100}
                step={10}
                value={peopleWeight}
                onChange={(e) => setPeopleWeight(Number(e.target.value))}
                className="w-full accent-[hsl(var(--primary))]"
                aria-valuetext={`People ${peopleWeight} percent, agents ${100 - peopleWeight} percent`}
              />
              <p className="text-xs text-muted-foreground">How much each side's views count in the combined view and the recommendation. Your people still decide.</p>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="q-share" checked={shareWithPeople} onCheckedChange={(on) => setShareWithPeople(on === true)} />
              <Label htmlFor="q-share" className="text-sm font-normal">
                <span className="font-semibold">Second round for people.</span> Once the shadow board has spoken, show people its positions and the Chair's
                recommendation on their questionnaire, so they can revise their answers.
              </Label>
            </div>
          </div>
        )}
      </Section>

      <Section title="2. The question">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="q-question" className="text-xs font-semibold uppercase tracking-[0.12em]">
              Question for the board
            </Label>
            <Textarea
              id="q-question"
              rows={3}
              maxLength={LIMITS.question}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Should we open a second factory in the Midlands next year?"
              data-testid="input-question"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-context" className="text-xs font-semibold uppercase tracking-[0.12em]">
              Context (optional)
            </Label>
            <Textarea id="q-context" rows={3} maxLength={LIMITS.context} value={context} onChange={(e) => setContext(e.target.value)} />
          </div>
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="q-due" className="text-xs font-semibold uppercase tracking-[0.12em]">
              Reply by (optional)
            </Label>
            <Input id="q-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <fieldset className="space-y-3 rounded-md border border-border p-4" data-testid="question-documents">
            <legend className="px-1 text-xs font-semibold uppercase tracking-[0.12em]">Background and supporting documents (optional)</legend>
            <p className="text-xs text-muted-foreground">
              Board papers, accounts, proposals, surveys, slides: any file up to {MAX_FILE_MB} MB. Sentinel reads each one and the board's agents use what
              matters. You can add more later from the question.
            </p>
            <label className="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted">
              Add documents
              <input
                type="file"
                multiple
                className="sr-only"
                data-testid="input-question-docs"
                onChange={(e) => {
                  const picked = [...(e.target.files ?? [])];
                  e.target.value = "";
                  const tooBig = picked.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
                  setDocsNote(tooBig.length ? `${tooBig.map((f) => f.name).join(", ")}: larger than ${MAX_FILE_MB} MB.` : "");
                  setDocs((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024)]);
                }}
              />
            </label>
            {docsNote && <p className="text-xs text-destructive">{docsNote}</p>}
            {docs.length > 0 && (
              <>
                <ul className="space-y-1 text-sm" data-testid="pending-docs">
                  {docs.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded border border-border px-3 py-1.5">
                      <span className="min-w-0 truncate">
                        {f.name} <span className="text-xs text-muted-foreground">· {formatSize(f.size)}</span>
                      </span>
                      <button type="button" className="text-xs underline" onClick={() => setDocs(docs.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1.5">
                  <Label htmlFor="q-docs-instruction" className="text-xs font-semibold uppercase tracking-[0.12em]">
                    Instructions for Sentinel
                  </Label>
                  <Textarea id="q-docs-instruction" rows={2} maxLength={2000} value={docsInstruction} onChange={(e) => setDocsInstruction(e.target.value)} />
                </div>
                {askPeople && (
                  <div className="flex items-center gap-2">
                    <Switch id="q-docs-share" checked={shareDocs} onCheckedChange={setShareDocs} />
                    <Label htmlFor="q-docs-share" className="text-sm font-normal">
                      Share them with the people asked
                    </Label>
                  </div>
                )}
              </>
            )}
          </fieldset>
        </div>
      </Section>

      <Section
        title="3. Who is asked"
        intro={
          mode === "people"
            ? "Each person you choose is emailed a questionnaire."
            : mode === "agents"
              ? "The agents you choose form the shadow board for this question. No one is emailed."
              : "Each person you choose is emailed a questionnaire. The agents you choose form the shadow board for this question."
        }
      >
        <div className="grid gap-6 md:grid-cols-2">
          {askPeople && (
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">People ({people.length})</legend>
            {[
              { title: "Permanent members (always asked)", list: org.people.filter((p) => p.permanent) },
              { title: "Invite as needed", list: org.people.filter((p) => !p.permanent) },
            ]
              .filter((g) => g.list.length)
              .map((g) => (
                <div key={g.title} className="mb-3">
                  <p className="mb-1 text-xs text-muted-foreground">{g.title}</p>
                  <ul className="space-y-2">
                    {g.list.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`ask-${p.id}`}
                          checked={p.permanent || peopleIds.includes(p.id)}
                          disabled={p.permanent}
                          onCheckedChange={(on) => setPeopleIds((ids) => (on ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                        />
                        <Label htmlFor={`ask-${p.id}`} className="text-sm font-normal">
                          <span className="font-semibold">{p.name}</span> · {p.role} · <span className="text-muted-foreground">{p.email}</span>
                        </Label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </fieldset>
          )}
          {askAgents && (
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Shadow board ({agents.length} agents)</legend>
            <ul className="space-y-2">
              {org.agents.map(({ id }) => {
                const a = AGENT_PERSONAS[id];
                const chair = id === "aquila";
                return (
                  <li key={id} className="flex items-center gap-2">
                    <Checkbox
                      id={`agent-${id}`}
                      checked={chair || agents.includes(id)}
                      disabled={chair}
                      onCheckedChange={(on) => setAgents((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)))}
                    />
                    <Label htmlFor={`agent-${id}`} className="text-sm font-normal">
                      <span className="font-semibold" style={{ color: a.colour }}>
                        {a.persona}
                      </span>{" "}
                      · {a.seat}
                      {chair ? " (always chairs)" : ""}
                    </Label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          )}
        </div>
      </Section>

      {askPeople && (
      <Section
        title="4. The questionnaire"
        intro="Every questionnaire asks for the person's position and confidence, so the people's view can be compared with the agents'. Add up to ten questions of your own."
      >
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
          {STANDARD_QUESTIONS.map((q) => (
            <li key={q.id}>
              {q.prompt} <span className="text-xs text-muted-foreground">(always asked)</span>
            </li>
          ))}
        </ol>
        {questions === null ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={draft} disabled={drafting} data-testid="button-draft">
              {drafting ? "Drafting…" : "Draft questions for me"}
            </Button>
            <Button variant="ghost" onClick={() => setQuestions([""])}>
              Write my own
            </Button>
          </div>
        ) : (
          <div className="space-y-3" data-testid="custom-questions">
            {draftNote && <p className="text-xs text-muted-foreground">{draftNote}</p>}
            {questions.map((q, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="pt-2 text-sm text-muted-foreground">{i + STANDARD_QUESTIONS.length + 1}.</span>
                <Textarea
                  rows={2}
                  aria-label={`Question ${i + STANDARD_QUESTIONS.length + 1}`}
                  maxLength={LIMITS.prompt}
                  value={q}
                  onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <Button variant="ghost" size="sm" aria-label={`Remove question ${i + STANDARD_QUESTIONS.length + 1}`} onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            ))}
            {questions.length < LIMITS.customQuestions && (
              <Button variant="outline" size="sm" onClick={() => setQuestions([...questions, ""])}>
                Add a question
              </Button>
            )}
          </div>
        )}
      </Section>
      )}

      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={send} disabled={sending} data-testid="button-send">
          {sending ? (sendingNote ? "Attaching documents…" : "Sending…") : askPeople ? `Send to ${people.length} ${people.length === 1 ? "person" : "people"}` : "Put it to the shadow board"}
        </Button>
        {sendingNote && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {sendingNote}
          </p>
        )}
        {askPeople && !sendingNote && (
          <p className="text-xs text-muted-foreground">
            The names, roles and emails of the people asked are stored with this question so they can answer it.
          </p>
        )}
      </div>
    </WorkspaceShell>
  );
}
