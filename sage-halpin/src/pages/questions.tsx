import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import { loadOrganisation } from "@/lib/organisation";
import { api, rememberConsultation, savedConsultations } from "@/lib/consultations";
import { AGENT_PERSONAS, LIMITS, STANDARD_QUESTIONS, type AgentId } from "../../shared/board";

// Board questions: the list of questions put to the board, and the flow for
// asking a new one: the question, the people involved, the questionnaire, then
// invitations to each person.

export function QuestionList() {
  const list = savedConsultations();
  const org = loadOrganisation();
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

export function NewQuestion() {
  const [, setLocation] = useLocation();
  const org = loadOrganisation();
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [peopleIds, setPeopleIds] = useState<string[]>(org.people.map((p) => p.id));
  const [agents, setAgents] = useState<AgentId[]>(org.agents.filter((a) => a.seated).map((a) => a.id));
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const people = org.people.filter((p) => peopleIds.includes(p.id));
  const ready = org.name.trim() && org.leadName.trim() && org.people.length > 0;

  if (!ready) {
    return (
      <WorkspaceShell title="Ask the board">
        <p className="text-sm">
          Before asking a question, add your organisation, your name and at least one person in{" "}
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
    if (people.length === 0) return setError("Choose at least one person to ask.");
    const prompts = (questions ?? []).map((q) => q.trim()).filter(Boolean);
    setSending(true);
    try {
      const created = await api.create({
        organisation: org.name.trim(),
        leadName: org.leadName.trim(),
        question: question.trim(),
        context: context.trim(),
        dueDate,
        questions: prompts,
        agents,
        people: people.map((p) => ({ id: p.id, name: p.name, role: p.role, email: p.email })),
      });
      const saved = { id: created.id, adminToken: created.adminToken, question: question.trim(), createdAt: new Date().toISOString() };
      rememberConsultation(saved);
      await api.invite(saved);
      setLocation(`/questions/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The question could not be sent.");
      setSending(false);
    }
  }

  return (
    <WorkspaceShell title="Ask the board">
      <Section title="1. The question">
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
        </div>
      </Section>

      <Section title="2. Who is asked" intro="Each person you choose is emailed a questionnaire. The agents you choose form the shadow board for this question.">
        <div className="grid gap-6 md:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">People ({people.length})</legend>
            <ul className="space-y-2">
              {org.people.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`ask-${p.id}`}
                    checked={peopleIds.includes(p.id)}
                    onCheckedChange={(on) => setPeopleIds((ids) => (on ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                  />
                  <Label htmlFor={`ask-${p.id}`} className="text-sm font-normal">
                    <span className="font-semibold">{p.name}</span> · {p.role} · <span className="text-muted-foreground">{p.email}</span>
                  </Label>
                </li>
              ))}
            </ul>
          </fieldset>
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
        </div>
      </Section>

      <Section
        title="3. The questionnaire"
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

      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={send} disabled={sending} data-testid="button-send">
          {sending ? "Sending…" : `Send to ${people.length} ${people.length === 1 ? "person" : "people"}`}
        </Button>
        <p className="text-xs text-muted-foreground">
          The names, roles and emails of the people asked are stored with this question so they can answer it.
        </p>
      </div>
    </WorkspaceShell>
  );
}
