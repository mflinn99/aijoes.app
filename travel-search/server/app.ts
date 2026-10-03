import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError, z } from "zod";
import { renderHtml, renderText, type PrintExtras } from "./print.js";
import { providerSummary } from "./providers/index.js";
import { limitFromEnv, rateLimit } from "./rate-limit.js";
import { formatIssues, tripRequestSchema } from "./schema.js";
import { SearchInputError, type SearchResult } from "./search.js";
import { createSession, current, loadSession, NotFoundError, refineSession, RefineError, remixOption, type SearchSession } from "./sessions.js";
import { getStore } from "./store.js";
import {
  addReview,
  canReview,
  ConflictError,
  deleteTrip,
  GoneError,
  itineraryOf,
  loadSaved,
  openShare,
  revokeShare,
  reviewHistory,
  reviewSummary,
  saveTrip,
  shareTrip,
  travellerTrips,
  tripOption,
  tripStatus,
  updateTrip,
  type SavedTrip,
  type Share,
} from "./trips.js";

// The HTTP API. Every search response carries the same actions (refine,
// remix, save, print) so a front end can always offer them, whatever state it
// is in. A saved trip adds share, choose and review.

const TRAVELLER_HEADER = "x-traveller-key";

function actions(sessionId: string, version: number) {
  const base = `/api/searches/${sessionId}`;
  return {
    refine: { method: "POST", href: `${base}/refine` },
    replaceOption: { method: "POST", href: `${base}/options/{optionId}/replace` },
    remixOption: { method: "POST", href: `${base}/options/{optionId}/remix`, body: { lock: ["destination | dates | transport | stay"] } },
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
    keywords: r.keywords ?? [],
    remix: r.remix,
    providers: r.providers,
    searchedAt: r.searchedAt,
  };
}

function shareView(s: Share) {
  return { id: s.id, label: s.label, createdAt: s.createdAt, expiresAt: s.expiresAt, allowReviews: s.allowReviews, revokedAt: s.revokedAt };
}

/** The owner's view: everything, including shares and private notes. */
function savedView(t: SavedTrip) {
  const base = `/api/saved/${t.id}`;
  const reviews = t.reviews ?? [];
  return {
    id: t.id,
    name: t.name,
    savedAt: t.savedAt,
    updatedAt: t.updatedAt,
    status: tripStatus(t),
    from: { search: t.sessionId, version: t.version },
    chosenOptionId: t.chosenOptionId,
    myNotes: t.myNotes,
    itinerary: itineraryOf(t),
    ...resultView(t.result),
    shares: (t.shares ?? []).map(shareView),
    reviews,
    reviewSummary: reviewSummary(reviews),
    reviewsOpen: canReview(t),
    actions: {
      print: { method: "GET", href: `${base}/print`, text: `${base}/print?format=text` },
      update: { method: "PATCH", href: base, body: { name: "", myNotes: "", chosenOptionId: "" } },
      share: { method: "POST", href: `${base}/share`, body: { label: "", allowReviews: false, expiresInDays: 30 } },
      revokeShare: { method: "DELETE", href: `${base}/shares/{shareId}` },
      review: { method: "POST", href: `${base}/reviews`, body: { rating: 5, comment: "", aspects: { transport: 5, stay: 5, destination: 5, value: 5 }, wouldGoAgain: true } },
      delete: { method: "DELETE", href: base },
      refine: { method: "POST", href: `/api/searches/${t.sessionId}/refine` },
    },
  };
}

/** What someone with a share link sees: the trip, read-only. No owner notes, no links back to the search or the owner. */
function sharedView(t: SavedTrip, s: Share, secret: string) {
  const base = `/api/shared/${secret}`;
  const reviews = t.reviews ?? [];
  const r = t.result;
  const chosen = tripOption(t);
  return {
    name: t.name,
    status: tripStatus(t),
    sharedAt: s.createdAt,
    expiresAt: s.expiresAt,
    itinerary: itineraryOf(t),
    chosenOptionId: chosen?.id,
    request: { travellers: r.request.travellers, dates: r.request.dates, vibe: r.request.vibe, keywords: r.request.keywords },
    resolved: r.resolved,
    options: r.options,
    reviews: reviews.map((x) => ({ by: x.by ?? (x.via === "owner" ? "The traveller" : "A companion"), rating: x.rating, comment: x.comment, aspects: x.aspects, wouldGoAgain: x.wouldGoAgain, createdAt: x.createdAt })),
    reviewSummary: reviewSummary(reviews),
    actions: {
      print: { method: "GET", href: `${base}/print`, text: `${base}/print?format=text` },
      ...(s.allowReviews ? { review: { method: "POST", href: `${base}/reviews`, body: { by: "", rating: 5, comment: "" }, open: canReview(t) } } : {}),
    },
  };
}

function tripSummary(t: SavedTrip) {
  const o = tripOption(t);
  return {
    id: t.id,
    name: t.name,
    savedAt: t.savedAt,
    status: tripStatus(t),
    destinations: t.result.options.map((x) => x.destination.name),
    chosen: o ? { destination: o.destination.name, depart: o.dates.depart, return: o.dates.return, mode: o.transport.mode, total: o.price.total, currency: o.price.currency } : null,
    reviewSummary: reviewSummary(t.reviews ?? []),
    activeShares: (t.shares ?? []).filter((s) => !s.revokedAt).length,
    href: `/api/saved/${t.id}`,
  };
}

function travellerKey(req: Request): string | undefined {
  const v = req.header(TRAVELLER_HEADER);
  return v ? v.trim() : undefined;
}

const saveSchema = z.object({
  name: z.string().max(120).optional(),
  version: z.number().int().positive().optional(),
  optionIds: z.array(z.string().max(32)).max(3).optional(),
});

const versionParam = z.coerce.number().int().positive().optional();

function sendPrint(req: Request, res: Response, r: SearchResult, title: string, extras: PrintExtras = {}) {
  const format = req.query.format === "text" ? "text" : "html";
  const filename = title.replace(/[^A-Za-z0-9 -]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "trip";
  if (req.query.download === "1") res.setHeader("Content-Disposition", `attachment; filename="${filename}.${format === "text" ? "txt" : "html"}"`);
  if (format === "text") {
    res.type("text/plain; charset=utf-8").send(renderText(r, title, extras));
    return;
  }
  // A standalone printable page: no scripts at all, inline styles only.
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  res.type("text/html; charset=utf-8").send(renderHtml(r, title, extras));
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
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Traveller-Key");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
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
  app.post(/^\/api\/searches\/[^/]+\/(refine|options\/[^/]+\/(replace|remix))$/, searchLimit);
  app.use("/api", rateLimit({ windowMs, max: limitFromEnv("RATE_LIMIT_API_PER_10_MIN", 300), message: "Too many requests. Please slow down." }));

  // --- search -------------------------------------------------------------------
  app.post("/api/searches", async (req, res) => {
    const request = tripRequestSchema.parse(req.body);
    const session = await createSession(getStore(), request, { history: await reviewHistory(getStore(), travellerKey(req)) });
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
    const session = await refineSession(getStore(), req.params.id, req.body ?? {}, { history: await reviewHistory(getStore(), travellerKey(req)) });
    res.json(sessionView(session));
  });

  app.post("/api/searches/:id/options/:optionId/replace", async (req, res) => {
    const session = await refineSession(getStore(), req.params.id, { replace: [req.params.optionId] }, { history: await reviewHistory(getStore(), travellerKey(req)) });
    res.json(sessionView(session));
  });

  // --- lock elements of one option, remix the rest ---------------------------------
  app.post("/api/searches/:id/options/:optionId/remix", async (req, res) => {
    const session = await remixOption(getStore(), req.params.id, req.params.optionId, req.body ?? {}, { history: await reviewHistory(getStore(), travellerKey(req)) });
    res.json(sessionView(session));
  });

  // --- save, and my trips ----------------------------------------------------------
  // Saving ties the trip to a traveller key (sent as X-Traveller-Key). Without
  // one, a new key is issued and returned once: keep it to list your trips.
  app.post("/api/searches/:id/save", async (req, res) => {
    const body = saveSchema.parse(req.body ?? {});
    const { trip, traveller } = await saveTrip(getStore(), req.params.id, { ...body, travellerKey: travellerKey(req) });
    res
      .status(201)
      .location(`/api/saved/${trip.id}`)
      .json({ ...savedView(trip), traveller: traveller.created ? { key: traveller.key, note: "Keep this key: send it as X-Traveller-Key to list your saved trips and to save more to the same list." } : undefined });
  });

  app.get("/api/travellers/me/trips", async (req, res) => {
    const key = travellerKey(req);
    if (!key) throw new RefineError("Send your traveller key in the X-Traveller-Key header");
    res.json((await travellerTrips(getStore(), key)).map(tripSummary));
  });

  app.get("/api/saved/:id", async (req, res) => {
    res.json(savedView(await loadSaved(getStore(), req.params.id)));
  });

  // Rename, add notes, or choose the option you're going with (it becomes the itinerary).
  app.patch("/api/saved/:id", async (req, res) => {
    res.json(savedView(await updateTrip(getStore(), req.params.id, req.body ?? {})));
  });

  app.delete("/api/saved/:id", async (req, res) => {
    await deleteTrip(getStore(), req.params.id);
    res.status(204).end();
  });

  // --- share ----------------------------------------------------------------------
  app.post("/api/saved/:id/share", async (req, res) => {
    const { token, share } = await shareTrip(getStore(), req.params.id, req.body ?? {});
    const href = `/api/shared/${token}`;
    res.status(201).json({
      share: shareView(share),
      href,
      print: `${href}/print`,
      note: "This link is shown once. Anyone with it can view the trip (and review it, if allowed). Revoke it any time.",
    });
  });

  app.delete("/api/saved/:id/shares/:shareId", async (req, res) => {
    res.json(savedView(await revokeShare(getStore(), req.params.id, req.params.shareId)));
  });

  app.get("/api/shared/:token", async (req, res) => {
    const { trip, share } = await openShare(getStore(), req.params.token);
    res.json(sharedView(trip, share, req.params.token));
  });

  // --- review, after the trip -----------------------------------------------------
  app.post("/api/saved/:id/reviews", async (req, res) => {
    const trip = await loadSaved(getStore(), req.params.id);
    const review = await addReview(getStore(), trip, req.body ?? {}, "owner");
    res.status(201).json({ review, trip: savedView(trip) });
  });

  app.post("/api/shared/:token/reviews", async (req, res) => {
    const { trip, share } = await openShare(getStore(), req.params.token);
    if (!share.allowReviews) throw new RefineError("This link is view-only. Ask the traveller for a link that allows reviews.");
    const review = await addReview(getStore(), trip, req.body ?? {}, "share");
    res.status(201).json({ review: { by: review.by, rating: review.rating, comment: review.comment, createdAt: review.createdAt }, trip: sharedView(trip, share, req.params.token) });
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
    sendPrint(req, res, saved.result, saved.name, { itinerary: itineraryOf(saved), reviews: saved.reviews });
  });

  app.get("/api/shared/:token/print", async (req, res) => {
    const { trip } = await openShare(getStore(), req.params.token);
    const reviews = (trip.reviews ?? []).map((x) => ({ ...x, by: x.by ?? (x.via === "owner" ? "The traveller" : "A companion") }));
    sendPrint(req, res, trip.result, trip.name, { itinerary: itineraryOf(trip), reviews });
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
    } else if (err instanceof GoneError) {
      res.status(410).json({ error: err.message });
    } else if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
    } else if (err instanceof SyntaxError && "body" in (err as object)) {
      res.status(400).json({ error: "Body must be valid JSON" });
    } else {
      console.error("Unhandled error", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  });

  return app;
}
