import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError, z } from "zod";
import { renderHtml, renderText } from "./print.js";
import { providerSummary } from "./providers/index.js";
import { limitFromEnv, rateLimit } from "./rate-limit.js";
import { formatIssues, tripRequestSchema } from "./schema.js";
import { SearchInputError, type SearchResult } from "./search.js";
import { createSession, current, loadSaved, loadSession, NotFoundError, refineSession, RefineError, saveTrip, type SavedTrip, type SearchSession } from "./sessions.js";
import { getStore } from "./store.js";

// The HTTP API. Every search response carries the same three actions (refine,
// save, print) so a front end can always offer them, whatever state it is in.

function actions(sessionId: string, version: number) {
  const base = `/api/searches/${sessionId}`;
  return {
    refine: { method: "POST", href: `${base}/refine` },
    replaceOption: { method: "POST", href: `${base}/options/{optionId}/replace` },
    save: { method: "POST", href: `${base}/save`, body: { version } },
    print: { method: "GET", href: `${base}/print?version=${version}`, text: `${base}/print?version=${version}&format=text` },
  };
}

export function sessionView(s: SearchSession, versionNumber?: number) {
  const v = versionNumber ? s.versions.find((x) => x.number === versionNumber) : current(s);
  if (!v) throw new NotFoundError(`Version ${versionNumber} not found`);
  return {
    id: s.id,
    version: v.number,
    latestVersion: current(s).number,
    change: v.change,
    ...resultView(v.result),
    history: s.versions.map((x) => ({ version: x.number, createdAt: x.createdAt, kind: x.change.kind, understood: x.change.understood, options: x.result.options.map((o) => ({ id: o.id, destination: o.destination.name, total: o.price.total })) })),
    actions: actions(s.id, v.number),
  };
}

function resultView(r: SearchResult) {
  return {
    request: r.request,
    resolved: r.resolved,
    options: r.options,
    notes: r.notes,
    providers: r.providers,
    searchedAt: r.searchedAt,
  };
}

function savedView(t: SavedTrip) {
  return {
    id: t.id,
    name: t.name,
    savedAt: t.savedAt,
    from: { search: t.sessionId, version: t.version },
    ...resultView(t.result),
    actions: {
      print: { method: "GET", href: `/api/saved/${t.id}/print`, text: `/api/saved/${t.id}/print?format=text` },
      refine: { method: "POST", href: `/api/searches/${t.sessionId}/refine` },
    },
  };
}

const saveSchema = z.object({
  name: z.string().max(120).optional(),
  version: z.number().int().positive().optional(),
  optionIds: z.array(z.string().max(32)).max(3).optional(),
});

const versionParam = z.coerce.number().int().positive().optional();

function sendPrint(req: Request, res: Response, r: SearchResult, title: string) {
  const format = req.query.format === "text" ? "text" : "html";
  const filename = title.replace(/[^A-Za-z0-9 -]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "trip";
  if (req.query.download === "1") res.setHeader("Content-Disposition", `attachment; filename="${filename}.${format === "text" ? "txt" : "html"}"`);
  if (format === "text") {
    res.type("text/plain; charset=utf-8").send(renderText(r, title));
    return;
  }
  // A standalone printable page: no scripts at all, inline styles only.
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  res.type("text/html; charset=utf-8").send(renderHtml(r, title));
}

export function createApp() {
  const app = express();
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  if (process.env.CORS_ORIGIN) {
    const origin = process.env.CORS_ORIGIN;
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
      next();
    });
  }
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/readyz", (_req, res) => res.json({ status: "ready", providers: providerSummary() }));

  const windowMs = 10 * 60 * 1000;
  const searchLimit = rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_SEARCH_PER_10_MIN", 30), message: "Too many searches. Please wait a few minutes and try again." });
  app.post("/api/searches", searchLimit);
  app.post(/^\/api\/searches\/[^/]+\/(refine|options\/[^/]+\/replace)$/, searchLimit);
  app.use("/api", rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_API_PER_10_MIN", 300), message: "Too many requests. Please slow down." }));

  // --- search -------------------------------------------------------------------
  app.post("/api/searches", async (req, res) => {
    const request = tripRequestSchema.parse(req.body);
    const session = await createSession(getStore(), request);
    res.status(201).location(`/api/searches/${session.id}`).json(sessionView(session));
  });

  app.get("/api/searches/:id", async (req, res) => {
    const session = await loadSession(getStore(), req.params.id);
    res.json(sessionView(session, versionParam.parse(req.query.version)));
  });

  app.get("/api/searches/:id/versions", async (req, res) => {
    const session = await loadSession(getStore(), req.params.id);
    res.json(sessionView(session).history);
  });

  // --- refine, as many times as needed --------------------------------------------
  app.post("/api/searches/:id/refine", async (req, res) => {
    const session = await refineSession(getStore(), req.params.id, req.body ?? {});
    res.json(sessionView(session));
  });

  app.post("/api/searches/:id/options/:optionId/replace", async (req, res) => {
    const session = await refineSession(getStore(), req.params.id, { replace: [req.params.optionId] });
    res.json(sessionView(session));
  });

  // --- save -----------------------------------------------------------------------
  app.post("/api/searches/:id/save", async (req, res) => {
    const body = saveSchema.parse(req.body ?? {});
    const saved = await saveTrip(getStore(), req.params.id, body);
    res.status(201).location(`/api/saved/${saved.id}`).json(savedView(saved));
  });

  app.get("/api/saved/:id", async (req, res) => {
    res.json(savedView(await loadSaved(getStore(), req.params.id)));
  });

  // --- print ----------------------------------------------------------------------
  app.get("/api/searches/:id/print", async (req, res) => {
    const session = await loadSession(getStore(), req.params.id);
    const n = versionParam.parse(req.query.version);
    const v = n ? session.versions.find((x) => x.number === n) : current(session);
    if (!v) throw new NotFoundError(`Version ${n} not found`);
    const r = v.result;
    sendPrint(req, res, r, `Trip options from ${r.resolved.origin.name}${r.resolved.destination ? ` to ${r.resolved.destination.name}` : ""}`);
  });

  app.get("/api/saved/:id/print", async (req, res) => {
    const saved = await loadSaved(getStore(), req.params.id);
    sendPrint(req, res, saved.result, saved.name);
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Invalid request", issues: formatIssues(err) });
    } else if (err instanceof SearchInputError) {
      res.status(422).json({ error: err.message, field: err.field, suggestions: err.suggestions });
    } else if (err instanceof RefineError) {
      res.status(422).json({ error: err.message });
    } else if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
    } else if (err instanceof SyntaxError && "body" in (err as object)) {
      res.status(400).json({ error: "Body must be valid JSON" });
    } else {
      console.error("Unhandled error", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  });

  return app;
}
