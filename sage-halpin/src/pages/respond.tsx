import { useEffect, useState } from "react";
import { usePageDownloads } from "@/components/PageDownload";
import { htmlDocument, saveFile, section, table, today } from "@/lib/downloads";
import { formatSize } from "@/lib/files";
import { PageLoader } from "@/components/PageLoader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mark } from "@/components/Mark";
import { api } from "@/lib/consultations";
import { POSITIONS, POSITION_LABELS, type Answer, type QuestionnaireItem } from "../../shared/board";

// The questionnaire a person opens from their email link. It shows only their
// own question and answers, never anyone else's.

type Loaded = Awaited<ReturnType<typeof api.openQuestionnaire>>;

function Item({ item, value, onChange, disabled }: { item: QuestionnaireItem; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const legend = (
    <legend className="mb-2 text-sm font-semibold">
      {item.prompt}
      {item.required && <span className="text-muted-foreground"> (required)</span>}
    </legend>
  );
  if (item.type === "position") {
    return (
      <fieldset>
        {legend}
        <div className="grid gap-2 sm:grid-cols-2">
          {POSITIONS.map((p) => (
            <label key={p} className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${value === p ? "border-primary bg-muted" : "border-border"}`}>
              <input type="radio" name={item.id} value={p} checked={value === p} onChange={() => onChange(p)} disabled={disabled} />
              {POSITION_LABELS[p]}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (item.type === "scale") {
    return (
      <fieldset>
        {legend}
        <div className="flex flex-wrap gap-2">
          {["1", "2", "3", "4", "5"].map((n) => (
            <label key={n} className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border text-sm font-semibold ${value === n ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
              <input type="radio" className="sr-only" name={item.id} value={n} checked={value === n} onChange={() => onChange(n)} disabled={disabled} />
              {n}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <fieldset>
      {legend}
      <Textarea aria-label={item.prompt} rows={4} maxLength={4000} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </fieldset>
  );
}

export default function Respond({ params }: { params: { token: string } }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  usePageDownloads(
    data
      ? [
          {
            label: "This questionnaire and my answers",
            hint: "Word",
            run: () =>
              saveFile(
                `sentinel8-questionnaire-${today()}.doc`,
                "application/msword",
                htmlDocument(
                  `${data.organisation}: questionnaire`,
                  [
                    section("The question", data.question),
                    section("Context", data.context),
                    section("For", `${data.respondent.name}, ${data.respondent.role}. Asked by ${data.leadName}${data.dueDate ? `, reply by ${data.dueDate}` : ""}.`),
                    `<h2>Answers</h2>${table(["Question", "Answer"], data.questionnaire.map((q) => [q.prompt, values[q.id] ?? ""]))}`,
                    data.documents?.length ? section("Background documents", data.documents.map((d) => d.name).join(", ")) : "",
                  ].join(""),
                ),
              ),
          },
        ]
      : [],
  );

  useEffect(() => {
    api
      .openQuestionnaire(params.token)
      .then((d) => {
        setData(d);
        setValues(Object.fromEntries((d.response?.answers ?? []).map((a) => [a.questionId, a.value])));
        setSavedAt(d.response?.submittedAt ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "This questionnaire could not be opened."));
  }, [params.token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const missing = data.questionnaire.find((q) => q.required && !values[q.id]);
    if (missing) return setError(`Please answer: ${missing.prompt}`);
    setSaving(true);
    setError("");
    try {
      const answers: Answer[] = data.questionnaire.filter((q) => values[q.id]?.trim()).map((q) => ({ questionId: q.id, value: values[q.id] }));
      const res = await api.answer(params.token, answers);
      setSavedAt(res.submittedAt);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your answers could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const closed = data?.status === "closed";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-4">
          <Mark size={26} />
          <span className="text-xs font-bold uppercase tracking-[0.28em]">
            SENTINEL<span className="sentinel-eight">8</span>
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        {!data ? (
          error ? (
            <p role="alert" className="text-sm text-muted-foreground">
              {error}
            </p>
          ) : (
            <PageLoader label="Opening your questionnaire" />
          )
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {data.organisation} · for {data.respondent.name}, {data.respondent.role}
            </p>
            <h1 className="mt-2 font-serif text-2xl font-light leading-snug">{data.question}</h1>
            {data.context && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{data.context}</p>}
            <p className="mt-3 text-sm">
              {data.leadName} has asked for your input{data.dueDate ? ` by ${data.dueDate}` : ""}.
            </p>

            {data.documents && data.documents.length > 0 && (
              <section className="mt-6 rounded-md border border-border p-4" data-testid="respond-documents">
                <h2 className="text-xs font-bold uppercase tracking-[0.14em]">Background documents</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {data.documents.map((d) => (
                    <li key={d.id}>
                      <a
                        href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/respond/${encodeURIComponent(params.token)}/files/${d.id}`}
                        download={d.name}
                        className="font-semibold underline underline-offset-4"
                      >
                        {d.name}
                      </a>{" "}
                      <span className="text-xs text-muted-foreground">· {formatSize(d.size)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {savedAt && (
              <p role="status" className="mt-6 rounded-md border border-[#7FB692] bg-[#7FB692]/10 p-3 text-sm" data-testid="saved-note">
                Thank you. Your answers were saved {new Date(savedAt).toLocaleString()}.{" "}
                {closed ? "The questionnaire is now closed." : "You can change them below until the questionnaire closes."}
              </p>
            )}
            {closed && !savedAt && <p className="mt-6 rounded-md border border-border p-3 text-sm">This questionnaire has closed.</p>}

            {data.boardView && (
              <section className="mt-6 rounded-md border border-border bg-card p-4" data-testid="board-view">
                <h2 className="text-xs font-bold uppercase tracking-[0.16em]">Second round: the shadow board's view</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.leadName} has shared what the board's AI agents think, so you can test your answers against it. Change your answers below if
                  it moves you; keep them if it does not.
                </p>
                <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                  {data.boardView.agents.map((a) => (
                    <li key={a.seat}>
                      <span className="font-semibold">{a.persona}</span>: {a.position ? POSITION_LABELS[a.position] : "no position"}
                      {a.confidence ? ` (confidence ${a.confidence}/5)` : ""}
                    </li>
                  ))}
                </ul>
                {data.boardView.recommendation && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold">The Chair's recommendation</summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{data.boardView.recommendation}</p>
                  </details>
                )}
              </section>
            )}

            <form onSubmit={submit} className="mt-8 space-y-8" noValidate>
              {data.questionnaire.map((item) => (
                <Item key={item.id} item={item} value={values[item.id] ?? ""} disabled={closed} onChange={(v) => setValues((prev) => ({ ...prev, [item.id]: v }))} />
              ))}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {!closed && (
                <Button type="submit" disabled={saving} data-testid="button-submit-answers">
                  {saving ? "Saving…" : savedAt ? "Update my answers" : "Send my answers"}
                </Button>
              )}
            </form>

            <p className="mt-10 text-xs text-muted-foreground">
              Your answers go to {data.leadName}. They are compared with the views of the board's AI agents and summarised with AI to support the
              decision. The people accountable for {data.organisation} make the decision. Answers are deleted automatically after the consultation
              period ends.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
