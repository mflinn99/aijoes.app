import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePageDownloads } from "@/components/PageDownload";
import { escapeHtml, htmlDocument, saveFile, today } from "@/lib/downloads";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { WorkspaceShell, Section } from "@/components/WorkspaceShell";
import { loadOrganisation } from "@/lib/organisation";
import { hasContactDetails } from "@/lib/missing";
import { ensureWorkspace, workspaceApi, type DecisionRecord, type WorkspaceLink } from "@/lib/workspace";
import { savedConsultations } from "@/lib/consultations";
import { loadDecisionLog, saveLocalDecisions } from "@/lib/decisionLog";
import { OUTCOMES, OUTCOME_LABELS, POSITIONS, POSITION_LABELS, type Outcome, type Position } from "../../shared/board";

// The board's decision log: every decision, from board questions, the
// scenario analysis, or logged by hand, saved with the organisation's
// workspace. Outcomes are recorded here (the agents learn from them), any
// decision can be revisited as a new board question, and the log exports.

const SOURCE_LABELS: Record<NonNullable<DecisionRecord["source"]>, string> = {
  question: "Board question",
  analysis: "Scenario analysis",
  manual: "Logged",
};

const sourceOf = (d: DecisionRecord) => d.source ?? "question";
const day = (iso: string) => iso.slice(0, 10);

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function decisionsCsv(decisions: DecisionRecord[]): string {
  const head = ["Date", "Source", "Question", "Decision", "Direction", "Rationale", "Plan", "Context", "Outcome", "Outcome note", "Outcome recorded"];
  const rows = decisions.map((d) => [
    day(d.decidedAt),
    SOURCE_LABELS[sourceOf(d)],
    d.question,
    d.decision,
    POSITION_LABELS[d.position],
    d.rationale,
    d.plan ?? "",
    d.context ?? "",
    d.outcome ? OUTCOME_LABELS[d.outcome.result] : "",
    d.outcome?.note ?? "",
    d.outcome ? day(d.outcome.recordedAt) : "",
  ]);
  // Excel reads a leading = + - @ as a formula: neutralise them.
  return [head, ...rows].map((r) => r.map((v) => csvCell(/^[=+\-@]/.test(v) ? `'${v}` : v)).join(",")).join("\r\n");
}

function decisionsDocument(decisions: DecisionRecord[]): string {
  const body = decisions
    .map(
      (d) =>
        `<h2>${escapeHtml(day(d.decidedAt))} · ${escapeHtml(SOURCE_LABELS[sourceOf(d)])}</h2><h3>${escapeHtml(d.question)}</h3>` +
        [
          `Decided: ${d.decision} (${POSITION_LABELS[d.position]})`,
          d.rationale && `Why: ${d.rationale}`,
          d.plan && `Plan: ${d.plan}`,
          d.context && `Context: ${d.context}`,
          d.recommendation && `Shadow board chair: ${d.recommendation}`,
          d.documents?.length ? `Documents: ${d.documents.join(", ")}` : "",
          d.outcome ? `Outcome: ${OUTCOME_LABELS[d.outcome.result]}${d.outcome.note ? `: ${d.outcome.note}` : ""} (recorded ${day(d.outcome.recordedAt)})` : "Outcome not yet recorded",
        ]
          .filter(Boolean)
          .map((t) => `<p class="pre">${escapeHtml(String(t))}</p>`)
          .join(""),
    )
    .join("");
  return htmlDocument("Decision log", body);
}

interface DraftDecision {
  question: string;
  decision: string;
  position: Position;
  rationale: string;
  plan: string;
  context: string;
  decidedAt: string;
}

const BLANK: DraftDecision = { question: "", decision: "", position: "support", rationale: "", plan: "", context: "", decidedAt: new Date().toISOString().slice(0, 10) };

function DecisionForm({ initial, locked, onSave, onCancel, saveLabel }: { initial: DraftDecision; locked: boolean; onSave: (d: DraftDecision) => Promise<void>; onCancel: () => void; saveLabel: string }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof DraftDecision) => (e: { target: { value: string } }) => setD({ ...d, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!locked && (!d.question.trim() || !d.decision.trim())) return setError("Add the question and what was decided.");
    setBusy(true);
    setError("");
    try {
      await onSave(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The decision could not be saved.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-border bg-background p-4" data-testid="decision-form">
      {locked ? (
        <p className="text-xs text-muted-foreground">A board question's decision stays as recorded. You can add to its rationale, plan and context.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="d-question" className="text-xs font-semibold uppercase tracking-[0.12em]">The question</Label>
            <Input id="d-question" value={d.question} maxLength={1000} onChange={set("question")} placeholder="Should we renew the Leeds lease?" data-testid="input-decision-question" />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="d-decision" className="text-xs font-semibold uppercase tracking-[0.12em]">What was decided</Label>
              <Input id="d-decision" value={d.decision} maxLength={500} onChange={set("decision")} placeholder="Renew for five years, with a break at year three" data-testid="input-decision-decision" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-position" className="text-xs font-semibold uppercase tracking-[0.12em]">Direction</Label>
              <select id="d-position" value={d.position} onChange={set("position")} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>{POSITION_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-date" className="text-xs font-semibold uppercase tracking-[0.12em]">Decided on</Label>
              <Input id="d-date" type="date" value={d.decidedAt} max={new Date().toISOString().slice(0, 10)} onChange={set("decidedAt")} />
            </div>
          </div>
        </>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="d-rationale" className="text-xs font-semibold uppercase tracking-[0.12em]">Why (rationale)</Label>
        <Textarea id="d-rationale" rows={2} maxLength={2000} value={d.rationale} onChange={set("rationale")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="d-plan" className="text-xs font-semibold uppercase tracking-[0.12em]">Plan: actions, owners, dates</Label>
        <Textarea id="d-plan" rows={2} maxLength={3000} value={d.plan} onChange={set("plan")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="d-context" className="text-xs font-semibold uppercase tracking-[0.12em]">Context</Label>
        <Textarea id="d-context" rows={2} maxLength={4000} value={d.context} onChange={set("context")} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} data-testid="button-save-decision">{busy ? "Saving…" : saveLabel}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function OutcomeForm({ onSave }: { onSave: (result: Outcome, note: string) => Promise<void> }) {
  const [result, setResult] = useState<Outcome>("as_expected");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSave(result, note.trim());
        } catch (err) {
          setError(err instanceof Error ? err.message : "The outcome could not be saved.");
          setBusy(false);
        }
      }}
      data-testid="outcome-form"
    >
      <select aria-label="How it turned out" value={result} onChange={(e) => setResult(e.target.value as Outcome)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
        {OUTCOMES.map((o) => (
          <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
        ))}
      </select>
      <Input aria-label="What happened" className="min-w-0 flex-1" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened (optional)" />
      <Button size="sm" type="submit" disabled={busy} data-testid="button-record-outcome">{busy ? "Recording…" : "Record outcome"}</Button>
      {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}

function DecisionCard({ d, link, onChange, onRemove }: { d: DecisionRecord; link: WorkspaceLink; onChange: (d: DecisionRecord) => void; onRemove: () => void }) {
  const [, setLocation] = useLocation();
  const [editing, setEditing] = useState(false);
  const [learned, setLearned] = useState<number | null>(null);
  const source = sourceOf(d);
  const asked = savedConsultations().some((c) => c.id === d.consultationId);

  if (editing) {
    return (
      <DecisionForm
        initial={{ question: d.question, decision: d.decision, position: d.position, rationale: d.rationale, plan: d.plan ?? "", context: d.context ?? "", decidedAt: day(d.decidedAt) }}
        locked={source === "question"}
        saveLabel="Save changes"
        onCancel={() => setEditing(false)}
        onSave={async (draft) => {
          const body =
            source === "question"
              ? { rationale: draft.rationale, plan: draft.plan, context: draft.context }
              : { question: draft.question, decision: draft.decision, position: draft.position, rationale: draft.rationale, plan: draft.plan, context: draft.context, decidedAt: draft.decidedAt };
          onChange((await workspaceApi.updateDecision(link, d.consultationId, body)).decision);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <article className="rounded-md border border-border bg-background p-4" data-testid="decision-entry" data-source={source}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {new Date(d.decidedAt).toLocaleDateString()} ·{" "}
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]">{SOURCE_LABELS[source]}</span>
            {d.updatedAt && ` · updated ${new Date(d.updatedAt).toLocaleDateString()}`}
          </p>
          <p className="mt-1 font-semibold">{d.question}</p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">Decided:</span> {d.decision} <span className="text-muted-foreground">({POSITION_LABELS[d.position]})</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={() => setLocation(`/questions/new?revisit=${encodeURIComponent(d.consultationId)}`)} data-testid="button-revisit">
            Revisit as a new question
          </Button>
          {asked && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/questions/${d.consultationId}`}>Open the question</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="button-edit-decision">
            {source === "question" ? "Add notes" : "Edit"}
          </Button>
          {source !== "question" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!window.confirm("Delete this decision from the log?")) return;
                await workspaceApi.removeDecision(link, d.consultationId);
                onRemove();
              }}
              data-testid="button-delete-decision"
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      {d.rationale && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground"><span className="font-semibold text-foreground">Why:</span> {d.rationale}</p>}
      {d.plan && <p className="mt-2 whitespace-pre-wrap text-sm"><span className="font-semibold">Plan:</span> {d.plan}</p>}
      {(d.context || d.recommendation || d.documents?.length || d.calibration) && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">Context, recommendation and documents</summary>
          <div className="mt-2 space-y-2">
            {d.context && <p className="whitespace-pre-wrap"><span className="font-semibold">Context:</span> {d.context}</p>}
            {d.recommendation && <p className="whitespace-pre-wrap"><span className="font-semibold">Shadow board chair:</span> {d.recommendation}</p>}
            {d.documents?.length ? <p><span className="font-semibold">Documents:</span> {d.documents.join(", ")}</p> : null}
            {d.calibration && (
              <p>
                <span className="font-semibold">Calibration:</span> risk {Math.round(d.calibration.risk * 10)}/10, ambition {Math.round(d.calibration.ambition * 10)}/10, time {Math.round(d.calibration.time * 10)}/10, cost{" "}
                {Math.round(d.calibration.cost * 10)}/10
              </p>
            )}
          </div>
        </details>
      )}
      <div className="mt-3 border-t border-border pt-3">
        {d.outcome ? (
          <p className="text-sm" data-testid="decision-outcome">
            <span className="font-semibold">Outcome:</span> {OUTCOME_LABELS[d.outcome.result]}
            {d.outcome.note && ` · ${d.outcome.note}`} <span className="text-xs text-muted-foreground">(recorded {new Date(d.outcome.recordedAt).toLocaleDateString()})</span>
          </p>
        ) : (
          <div className="print:hidden">
            <p className="text-xs text-muted-foreground">How did it turn out? Recording it builds the board's track record{Object.keys(d.agentPositions).length ? ", and the agents propose lessons from it" : ""}.</p>
            <OutcomeForm
              onSave={async (result, note) => {
                const res = await workspaceApi.outcome(link, d.consultationId, result, note);
                setLearned(res.proposed.length);
                onChange(res.decision);
              }}
            />
          </div>
        )}
        {learned !== null && learned > 0 && (
          <p className="mt-2 text-sm" role="status">
            The agents proposed {learned} lesson{learned === 1 ? "" : "s"} from this.{" "}
            <Link href="/agents" className="font-semibold underline underline-offset-4">Review them in Agents</Link>
          </p>
        )}
      </div>
    </article>
  );
}

export default function DecisionLogPage() {
  const org = loadOrganisation();
  const ready = hasContactDetails(org) || !!org.workspace;
  const [link, setLink] = useState<WorkspaceLink | null>(null);
  const [decisions, setDecisions] = useState<DecisionRecord[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | NonNullable<DecisionRecord["source"]>>("all");
  const [outcome, setOutcome] = useState<"all" | "awaiting" | "recorded">("all");

  usePageDownloads(
    decisions?.length
      ? [
          { label: "The decision log", hint: "CSV", run: () => download(`sentinel8-decision-log-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8", `\uFEFF${decisionsCsv(decisions)}`) },
          { label: "The decision log as a document", hint: "Word", run: () => saveFile(`sentinel8-decision-log-${today()}.doc`, "application/msword", decisionsDocument(decisions)) },
          { label: "The decision log as data", hint: "JSON", run: () => download(`sentinel8-decision-log-${today()}.json`, "application/json", JSON.stringify(decisions, null, 2)) },
        ]
      : [],
  );

  const load = useCallback(async () => {
    try {
      const l = await ensureWorkspace();
      if (!l) return;
      setLink(l);
      const saved = await saveLocalDecisions();
      if (saved) setNotice(`${saved} decision${saved === 1 ? "" : "s"} from the scenario analysis, held only in this browser, ${saved === 1 ? "was" : "were"} saved to your decision log.`);
      setDecisions((await workspaceApi.decisions(l)).decisions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The decision log could not be loaded.");
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (decisions ?? []).filter(
      (d) =>
        (source === "all" || sourceOf(d) === source) &&
        (outcome === "all" || (outcome === "awaiting" ? !d.outcome : !!d.outcome)) &&
        (!q || [d.question, d.decision, d.rationale, d.plan ?? "", d.context ?? "", d.outcome?.note ?? ""].some((t) => t.toLowerCase().includes(q))),
    );
  }, [decisions, query, source, outcome]);

  const replace = (next: DecisionRecord) => setDecisions((prev) => (prev ?? []).map((x) => (x.consultationId === next.consultationId ? next : x)));
  const stamp = new Date().toISOString().slice(0, 10);

  if (!ready) {
    const local = loadDecisionLog();
    return (
      <WorkspaceShell title="Decision log">
        <p className="mb-4 text-sm">
          The decision log is saved with your organisation's workspace. First add your contact details in{" "}
          <Link href="/organisation" className="font-semibold underline underline-offset-4">Your board</Link>.
        </p>
        {local.length > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="local-only">
            {local.length} scenario-analysis decision{local.length === 1 ? " is" : "s are"} held only in this browser. {local.length === 1 ? "It is" : "They are"} saved to the log as soon as your contact details are added.
          </p>
        )}
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      title="Decision log"
      actions={
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button onClick={() => setAdding(true)} data-testid="button-log-decision">Log a decision</Button>
          <Button variant="outline" disabled={!decisions?.length} onClick={() => download(`sentinel8-decision-log-${stamp}.csv`, "text/csv;charset=utf-8", `﻿${decisionsCsv(shown)}`)} data-testid="button-export-csv">
            Export CSV
          </Button>
          <Button variant="outline" disabled={!decisions?.length} onClick={() => download(`sentinel8-decision-log-${stamp}.json`, "application/json", JSON.stringify(shown, null, 2))} data-testid="button-export-json">
            Export JSON
          </Button>
          <Button variant="outline" disabled={!decisions?.length} onClick={() => window.print()}>Print</Button>
        </div>
      }
    >
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Every decision the board takes: from board questions, the scenario analysis, or logged here when it was taken elsewhere. The log is saved with your
        organisation's workspace, follows your account to any device, and stays after a board question expires. The agents read it as the board's
        precedents when they advise. Record outcomes as they become clear, and revisit any decision as a new question.
      </p>
      {notice && <p className="mb-4 rounded-md border border-[#7FB692] bg-[#7FB692]/10 p-3 text-sm" role="status" data-testid="log-notice">{notice}</p>}
      {error && <p className="mb-4 text-sm text-destructive" role="alert">{error}</p>}

      {adding && link && (
        <Section title="Log a decision" intro="A decision taken at a board meeting, by email or anywhere else, so the record is complete.">
          <DecisionForm
            initial={BLANK}
            locked={false}
            saveLabel="Save to the log"
            onCancel={() => setAdding(false)}
            onSave={async (draft) => {
              const { decision } = await workspaceApi.logDecision(link, { source: "manual", ...draft });
              setDecisions((prev) => [decision, ...(prev ?? [])].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)));
              setAdding(false);
            }}
          />
        </Section>
      )}

      {decisions && decisions.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden" data-testid="log-filters">
          <Input aria-label="Search decisions" className="max-w-xs" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search decisions" data-testid="input-search-decisions" />
          <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" data-testid="filter-source">
            <option value="all">All sources</option>
            <option value="question">Board questions</option>
            <option value="analysis">Scenario analysis</option>
            <option value="manual">Logged</option>
          </select>
          <select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" data-testid="filter-outcome">
            <option value="all">Any outcome</option>
            <option value="awaiting">Awaiting outcome</option>
            <option value="recorded">Outcome recorded</option>
          </select>
          <span className="text-xs text-muted-foreground" data-testid="log-count">
            {shown.length} of {decisions.length} decision{decisions.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {decisions === null && !error && <p className="text-sm text-muted-foreground">Loading the decision log…</p>}
      {decisions && decisions.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground" data-testid="log-empty">
          No decisions yet. They are added when you record the decision on a{" "}
          <Link href="/questions" className="underline">board question</Link>, lock one in the{" "}
          <Link href="/analysis" className="underline">scenario analysis</Link>, or log one here.
        </p>
      )}
      <div className="space-y-3" data-testid="decision-list">
        {link &&
          shown.map((d) => (
            <DecisionCard key={d.consultationId} d={d} link={link} onChange={replace} onRemove={() => setDecisions((prev) => (prev ?? []).filter((x) => x.consultationId !== d.consultationId))} />
          ))}
      </div>
    </WorkspaceShell>
  );
}
