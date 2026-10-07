// Client for files the company admin attaches: the organisation's document
// library (any page) and a board question's background and supporting
// documents. Sentinel reads each file and follows the instruction given.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const MAX_FILE_MB = 20;

export interface SentinelAnswer {
  instruction: string;
  response: string;
  at: string;
}

export interface DocFile {
  id: string;
  name: string;
  type: string;
  kind: "pdf" | "image" | "text" | "office" | "other";
  size: number;
  uploadedAt: string;
  stage: string;
  useInBoard: boolean;
  shared: boolean;
  readable: boolean;
  status: "done" | "failed";
  note: string | null;
  digest: string;
  answers: SentinelAnswer[];
}

/** Whose files: the organisation's workspace, or one board question (its admin token). */
export interface FileOwner {
  kind: "workspace" | "consultation";
  id: string;
  token: string;
}

const root = (o: FileOwner) => `${BASE}/api/${o.kind === "workspace" ? "workspaces" : "consultations"}/${o.id}/files`;

async function json<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const auth = (o: FileOwner) => ({ Authorization: `Bearer ${o.token}` });

export const filesApi = {
  list: async (o: FileOwner) => (await json<{ files: DocFile[] }>(await fetch(root(o), { headers: auth(o) }))).files,

  upload: async (o: FileOwner, file: File, { instruction, stage, share }: { instruction: string; stage: string; share?: boolean }) => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${file.name} is larger than ${MAX_FILE_MB} MB.`);
    const res = await fetch(root(o), {
      method: "POST",
      headers: {
        ...auth(o),
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Type": file.type,
        "X-Stage": stage,
        ...(instruction.trim() ? { "X-Instruction": encodeURIComponent(instruction.trim()) } : {}),
        ...(share === undefined ? {} : { "X-Share": share ? "1" : "0" }),
      },
      body: file,
    });
    return (await json<{ file: DocFile }>(res)).file;
  },

  ask: async (o: FileOwner, fileId: string, instruction: string) =>
    (await json<{ file: DocFile }>(await fetch(`${root(o)}/${fileId}/ask`, { method: "POST", headers: { ...auth(o), "Content-Type": "application/json" }, body: JSON.stringify({ instruction }) }))).file,

  update: async (o: FileOwner, fileId: string, patch: { useInBoard?: boolean; shared?: boolean }) =>
    (await json<{ file: DocFile }>(await fetch(`${root(o)}/${fileId}`, { method: "PATCH", headers: { ...auth(o), "Content-Type": "application/json" }, body: JSON.stringify(patch) }))).file,

  remove: async (o: FileOwner, fileId: string) => json<void>(await fetch(`${root(o)}/${fileId}`, { method: "DELETE", headers: auth(o) })),

  /** Downloads with the admin token (a plain link can't send it). */
  download: async (o: FileOwner, file: DocFile) => {
    const res = await fetch(`${root(o)}/${file.id}`, { headers: auth(o) });
    if (!res.ok) throw new Error("The file could not be downloaded.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

/** Where in the process a file was attached, from the page it was attached on. */
export function stageFor(path: string): string {
  if (path.startsWith("/questions/new")) return "question";
  if (path.startsWith("/questions/")) return "decision";
  const map: [string, string][] = [
    ["/organisation", "organisation"],
    ["/agents", "agents"],
    ["/horizon", "horizon"],
    ["/questions", "questions"],
    ["/boardroom", "shadow-board"],
    ["/analysis", "analysis"],
    ["/log", "decision-log"],
    ["/checkpoint", "checkpoint"],
    ["/documents", "library"],
    ["/dashboard", "workspace"],
  ];
  return map.find(([prefix]) => path.startsWith(prefix))?.[1] ?? "general";
}

export const STAGE_LABELS: Record<string, string> = {
  organisation: "Your board",
  agents: "Agents",
  horizon: "Horizon",
  questions: "Board questions",
  question: "New board question",
  decision: "Board decision",
  "shadow-board": "Shadow board",
  analysis: "Scenario analysis",
  "decision-log": "Decision log",
  checkpoint: "Checkpoint",
  library: "Documents",
  workspace: "Workspace",
  general: "General",
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const INSTRUCTION_SUGGESTIONS = [
  "Summarise this for the board",
  "Keep this as background for our strategy",
  "Pull out the key figures and dates",
  "Flag the risks and red flags",
  "Compare this with what you know about us",
  "Draft questions the board should ask",
];
