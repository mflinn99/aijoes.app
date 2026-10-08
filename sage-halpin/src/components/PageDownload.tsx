import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { pageAsHtml, saveFile, slug, today } from "@/lib/downloads";

// The Download button on every page: what is relevant to the page (each page
// registers its own downloads: the board question's record, the decision
// log, the people, the signals…), and always the page itself as a Word or web
// document, or printed to PDF.

export interface PageDownloadItem {
  label: string;
  /** Shown under the label, e.g. the file type. */
  hint?: string;
  run: () => void | Promise<void>;
}

interface Registry {
  items: Map<string, PageDownloadItem[]>;
  set: (key: string, items: PageDownloadItem[] | null) => void;
}

const DownloadContext = createContext<Registry | null>(null);

export function PageDownloadProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState(new Map<string, PageDownloadItem[]>());
  const registry = useMemo<Registry>(
    () => ({
      items,
      set: (key, next) =>
        setItems((prev) => {
          const copy = new Map(prev);
          if (next) copy.set(key, next);
          else copy.delete(key);
          return copy;
        }),
    }),
    [items],
  );
  return <DownloadContext.Provider value={registry}>{children}</DownloadContext.Provider>;
}

/** Registers this page's downloads while it is shown. `items` is read when the menu is used. */
export function usePageDownloads(items: PageDownloadItem[]) {
  const registry = useContext(DownloadContext);
  const key = useId();
  const latest = useRef(items);
  latest.current = items;
  const labels = items.map((i) => `${i.label}·${i.hint ?? ""}`).join("|");
  useEffect(() => {
    if (!registry) return;
    registry.set(
      key,
      latest.current.map((item, n) => ({ ...item, run: () => latest.current[n]?.run() })),
    );
    return () => registry.set(key, null);
    // Re-register only when the set of downloads changes; run() always uses the latest data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels]);
}

const HIDDEN_ON = ["/signin", "/signup", "/reset-password"];

function pageTitle(): string {
  const h1 = document.querySelector("main h1, h1")?.textContent?.trim();
  return h1 || document.title.replace(/\s*[·|–-]\s*Sentinel8.*$/i, "") || "Sentinel8";
}

/** The Download button, fixed in the corner of every page. */
export function PageDownloadButton() {
  const registry = useContext(DownloadContext);
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!registry || HIDDEN_ON.some((p) => location.startsWith(p))) return null;
  const pageItems = [...registry.items.values()].flat();

  async function run(item: PageDownloadItem) {
    setError("");
    setBusy(item.label);
    try {
      await item.run();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The download could not be made.");
    } finally {
      setBusy("");
    }
  }

  const generic: PageDownloadItem[] = [
    {
      label: "This page as a Word document",
      hint: ".doc",
      run: () => {
        const title = pageTitle();
        saveFile(`${slug(title)}-${today()}.doc`, "application/msword", pageAsHtml(title));
      },
    },
    {
      label: "This page as a web page",
      hint: ".html",
      run: () => {
        const title = pageTitle();
        saveFile(`${slug(title)}-${today()}.html`, "text/html;charset=utf-8", pageAsHtml(title));
      },
    },
    { label: "Print or save as PDF", hint: "PDF", run: () => window.print() },
  ];

  const Item = ({ item }: { item: PageDownloadItem }) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => run(item)}
      disabled={!!busy}
      className="flex w-full items-baseline justify-between gap-4 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
      data-testid="download-item"
    >
      <span>{busy === item.label ? "Preparing…" : item.label}</span>
      {item.hint && <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
    </button>
  );

  return (
    <div ref={menu} className="fixed bottom-4 right-4 z-50 print:hidden" data-download-skip>
      {open && (
        <div role="menu" aria-label="Downloads" className="mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background p-2 shadow-lg" data-testid="download-menu">
          {pageItems.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">On this page</p>
              {pageItems.map((item) => (
                <Item key={item.label} item={item} />
              ))}
              <div className="my-1 border-t border-border" />
            </>
          )}
          <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">The page itself</p>
          {generic.map((item) => (
            <Item key={item.label} item={item} />
          ))}
          {error && (
            <p role="alert" className="px-3 py-1 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="shadow-lg" data-testid="button-download">
          Download
        </Button>
      </div>
    </div>
  );
}
