import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadOrganisation } from "@/lib/organisation";
import { ensureWorkspace } from "@/lib/workspace";
import {
  filesApi,
  formatSize,
  INSTRUCTION_SUGGESTIONS,
  MAX_FILE_MB,
  STAGE_LABELS,
  stageFor,
  type DocFile,
  type FileOwner,
} from "@/lib/files";

// Attach any file at any stage, tell Sentinel what to do with it, and see
// what it did. Used in the header of every board page (the organisation's
// library), on the Documents page, and on board questions (background and
// supporting documents).

/** The organisation's library, creating the workspace if it doesn't exist yet. */
export async function libraryOwner(): Promise<FileOwner | null> {
  const link = await ensureWorkspace(loadOrganisation());
  return link ? { kind: "workspace", id: link.id, token: link.adminToken } : null;
}

export function AttachPanel({
  owner,
  stage,
  onAttached,
  shareOption = false,
  defaultInstruction = "",
  testId = "attach-panel",
}: {
  owner: FileOwner | (() => Promise<FileOwner | null>);
  stage: string;
  onAttached: (file: DocFile) => void;
  /** Board questions: offer to share the files with the people asked. */
  shareOption?: boolean;
  defaultInstruction?: string;
  testId?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [instruction, setInstruction] = useState(defaultInstruction);
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function add(list: FileList | null) {
    if (!list) return;
    const picked = [...list];
    const tooBig = picked.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    setError(tooBig.length ? `${tooBig.map((f) => f.name).join(", ")} ${tooBig.length === 1 ? "is" : "are"} larger than ${MAX_FILE_MB} MB.` : "");
    setFiles((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024)]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  }

  async function attach() {
    setError("");
    if (!files.length) return setError("Choose a file first.");
    const target = typeof owner === "function" ? await owner().catch(() => null) : owner;
    if (!target) return setError("Add your contact details in Your board first, so the files have somewhere to live.");
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setBusy(`Sentinel is reading ${file.name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ""}…`);
      try {
        onAttached(await filesApi.upload(target, file, { instruction, stage, ...(shareOption ? { share } : {}) }));
      } catch (e) {
        failed.push(`${file.name}: ${e instanceof Error ? e.message : "could not be attached"}`);
      }
    }
    setBusy("");
    setFiles([]);
    if (failed.length) setError(failed.join(" "));
    else setInstruction(defaultInstruction);
  }

  return (
    <div className="space-y-3" data-testid={testId}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-md border-2 border-dashed p-4 text-center text-sm ${dragging ? "border-primary bg-muted" : "border-border"}`}
      >
        <p className="text-muted-foreground">Drop any file here: documents, spreadsheets, slides, PDFs, images, anything. Up to {MAX_FILE_MB} MB each.</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => input.current?.click()} data-testid="button-choose-files">
          Choose files
        </Button>
        <input ref={input} type="file" multiple className="sr-only" onChange={(e) => (add(e.target.files), (e.target.value = ""))} data-testid="input-files" />
        {files.length > 0 && (
          <ul className="mt-3 space-y-1 text-left text-sm" data-testid="chosen-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded border border-border bg-background px-3 py-1.5">
                <span className="min-w-0 truncate">
                  {f.name} <span className="text-xs text-muted-foreground">· {formatSize(f.size)}</span>
                </span>
                <button type="button" className="text-xs underline" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${testId}-instruction`} className="text-xs font-semibold uppercase tracking-[0.12em]">
          Instructions for Sentinel
        </Label>
        <Textarea
          id={`${testId}-instruction`}
          rows={2}
          maxLength={2000}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="What should Sentinel do with this? For example: summarise it for the board, pull out the figures, flag the risks."
          data-testid="input-instruction"
        />
        <div className="flex flex-wrap gap-1.5">
          {INSTRUCTION_SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => setInstruction(s)} className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-muted">
              {s}
            </button>
          ))}
        </div>
      </div>
      {shareOption && (
        <div className="flex items-center gap-2">
          <Switch id={`${testId}-share`} checked={share} onCheckedChange={setShare} />
          <Label htmlFor={`${testId}-share`} className="text-sm font-normal">
            Share with the people asked (they can open it from their questionnaire)
          </Label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" onClick={attach} disabled={!!busy} data-testid="button-attach">
        {busy ? "Sentinel is reading…" : files.length > 1 ? `Attach ${files.length} files` : "Attach and send to Sentinel"}
      </Button>
      {busy && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {busy}
        </p>
      )}
    </div>
  );
}

export function DocumentCard({ owner, file, onChange, onRemove, shareOption = false }: { owner: FileOwner; file: DocFile; onChange: (f: DocFile) => void; onRemove: () => void; shareOption?: boolean }) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = file.answers.at(-1);

  async function act(work: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-md border border-border bg-background p-4" data-testid="document-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold" data-testid="document-name">
            {file.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatSize(file.size)} · attached {new Date(file.uploadedAt).toLocaleDateString()} at {STAGE_LABELS[file.stage] ?? file.stage}
            {!file.readable && " · Sentinel can't read this format; it is kept and can be downloaded"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => act(() => filesApi.download(owner, file))}>
            Download
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.confirm(`Delete ${file.name}?`) && act(async () => (await filesApi.remove(owner, file.id), onRemove()))}
            aria-label={`Delete ${file.name}`}
          >
            Delete
          </Button>
        </div>
      </div>

      {file.status === "failed" && file.note && (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          {file.note}
        </p>
      )}
      {latest && (
        <div className="mt-3 rounded border border-border bg-card p-3" data-testid="sentinel-response">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sentinel · “{latest.instruction}”</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{latest.response}</p>
        </div>
      )}
      {file.answers.length > 1 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">Earlier instructions ({file.answers.length - 1})</summary>
          <ul className="mt-2 space-y-2">
            {file.answers.slice(0, -1).reverse().map((a) => (
              <li key={a.at} className="rounded border border-border p-2">
                <p className="text-xs font-semibold text-muted-foreground">“{a.instruction}” · {new Date(a.at).toLocaleString()}</p>
                <p className="mt-1 whitespace-pre-wrap">{a.response}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {file.digest && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">What the board takes from it</summary>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{file.digest}</p>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Switch id={`board-${file.id}`} checked={file.useInBoard} onCheckedChange={(on) => act(async () => onChange(await filesApi.update(owner, file.id, { useInBoard: on })))} />
          <Label htmlFor={`board-${file.id}`} className="text-sm font-normal">
            The board uses it when advising
          </Label>
        </div>
        {shareOption && (
          <div className="flex items-center gap-2">
            <Switch id={`share-${file.id}`} checked={file.shared} onCheckedChange={(on) => act(async () => onChange(await filesApi.update(owner, file.id, { shared: on })))} />
            <Label htmlFor={`share-${file.id}`} className="text-sm font-normal">
              Shared with the people asked
            </Label>
          </div>
        )}
      </div>

      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!instruction.trim()) return;
          act(async () => {
            onChange(await filesApi.ask(owner, file.id, instruction.trim()));
            setInstruction("");
          });
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          value={instruction}
          maxLength={2000}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Ask Sentinel to do something else with this file"
          aria-label={`Instruction for Sentinel about ${file.name}`}
          data-testid="input-ask"
        />
        <Button size="sm" type="submit" disabled={busy || !instruction.trim()} data-testid="button-ask">
          {busy ? "Working…" : "Ask Sentinel"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}

/** A list of files for one owner, with the attach panel above it. */
export function DocumentList({ owner, stage, shareOption = false, emptyText, defaultInstruction }: { owner: FileOwner; stage: string; shareOption?: boolean; emptyText: string; defaultInstruction?: string }) {
  const [files, setFiles] = useState<DocFile[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    filesApi
      .list(owner)
      .then(setFiles)
      .catch((e) => setError(e instanceof Error ? e.message : "The documents could not be loaded."));
  }, [owner.id, owner.token]);
  useEffect(load, [load]);

  return (
    <div className="space-y-5">
      <AttachPanel owner={owner} stage={stage} shareOption={shareOption} defaultInstruction={defaultInstruction} onAttached={(f) => setFiles((prev) => [...(prev ?? []), f])} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {files && files.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      <div className="space-y-3" data-testid="document-list">
        {[...(files ?? [])].reverse().map((f) => (
          <DocumentCard
            key={f.id}
            owner={owner}
            file={f}
            shareOption={shareOption}
            onChange={(next) => setFiles((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)))}
            onRemove={() => setFiles((prev) => (prev ?? []).filter((x) => x.id !== f.id))}
          />
        ))}
      </div>
    </div>
  );
}

/** The header's Attach button: any page, any file, straight to Sentinel. */
export function AttachButton() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [attached, setAttached] = useState<DocFile[]>([]);
  const [owner, setOwner] = useState<FileOwner | null>(null);
  const hasContact = !!loadOrganisation().name.trim();

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => (setAttached([]), setOpen(true))} data-testid="button-attach-anywhere">
        Attach
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Attach a file for Sentinel</DialogTitle>
            <DialogDescription>
              Any file, at any stage. Tell Sentinel what to do with it: it reads the file, answers, and keeps what matters for the board. Attached from{" "}
              {STAGE_LABELS[stageFor(location)] ?? "this page"}.
            </DialogDescription>
          </DialogHeader>
          {hasContact ? (
            <AttachPanel
              owner={async () => {
                const o = owner ?? (await libraryOwner());
                setOwner(o);
                return o;
              }}
              stage={stageFor(location)}
              testId="attach-dialog"
              onAttached={(f) => setAttached((prev) => [...prev, f])}
            />
          ) : (
            <p className="text-sm">
              First add your contact details in{" "}
              <Link href="/organisation" className="font-semibold underline underline-offset-4" onClick={() => setOpen(false)}>
                Your board
              </Link>
              . Everything else can be skipped.
            </p>
          )}
          {owner &&
            attached.map((f) => (
              <DocumentCard
                key={f.id}
                owner={owner}
                file={f}
                onChange={(next) => setAttached((prev) => prev.map((x) => (x.id === next.id ? next : x)))}
                onRemove={() => setAttached((prev) => prev.filter((x) => x.id !== f.id))}
              />
            ))}
          {attached.length > 0 && (
            <p className="text-sm">
              <Link href="/documents" className="font-semibold underline underline-offset-4" onClick={() => setOpen(false)}>
                See all documents
              </Link>
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
