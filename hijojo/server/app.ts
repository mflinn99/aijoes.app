// HTTP API. Every route needs a session; writes also need the X-Hijojo header,
// which a cross-site form cannot send.

import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { Engine } from "./engine";
import type { Repo } from "./repo";
import { AttemptLimiter, login, logout, readCookie, requireRole, SESSION_COOKIE, userForToken, type User } from "./auth";
import { computeMetrics } from "./metrics";
import { checkUrl } from "./research/netguard";
import { bareDomain, effectiveThreshold } from "./qualification";
import { SimMailbox } from "./mail/transport";
import { STAGE_GROUPS } from "../shared/types";
import { OpcoInput, opcoInputProblem } from "./opco-input";
import { createCopilotRouter } from "./copilot";
import type { EntraVerifier } from "./entra";

export interface AppStatus {
  ai: { configured: boolean; detail: string };
  research: { configured: boolean; detail: string };
  contacts: { configured: boolean; detail: string };
  mail: { configured: boolean; detail: string };
}

export function createApp(engine: Engine, status: AppStatus, opts: { secureCookies?: boolean; entra?: EntraVerifier | null } = {}) {
  const repo: Repo = engine.d.repo;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "200kb" }));
  app.use((_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    next();
  });

  // Probes for Azure Container Apps (no authentication, no data).
  app.get("/api/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/api/readyz", (_req, res) => {
    try {
      repo.db.prepare("SELECT 1").get();
      res.json({ ok: true, sending: engine.sendingState().mode });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Microsoft 365 Copilot: Entra ID bearer tokens only, so no cookie session and no CSRF exposure.
  app.use("/api/copilot", createCopilotRouter(engine, opts.entra ?? null));

  // Session and CSRF.
  app.use("/api", (req, res, next) => {
    (req as any).user = userForToken(repo, readCookie(req, SESSION_COOKIE));
    if (req.method !== "GET" && req.method !== "HEAD" && req.get("x-hijojo") !== "1") {
      return res.status(403).json({ error: "Missing X-Hijojo header" });
    }
    next();
  });

  const limiter = new AttemptLimiter();
  const user = (req: Request) => (req as any).user as User;
  const parse = <T>(schema: z.ZodType<T>, body: unknown, res: Response): T | null => {
    const r = schema.safeParse(body);
    if (!r.success) {
      res.status(400).json({ error: "Invalid request", issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      return null;
    }
    return r.data;
  };
  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

  // ---- auth --------------------------------------------------------------------
  app.post("/api/auth/login", (req, res) => {
    const b = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body, res);
    if (!b) return;
    if (!limiter.allow(`ip:${req.ip}`) || !limiter.allow(`email:${b.email.toLowerCase()}`)) return res.status(429).json({ error: "Too many attempts" });
    const r = login(repo, b.email, b.password);
    if (!r) return res.status(401).json({ error: "Incorrect email or password" });
    res.cookie(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: "strict", secure: opts.secureCookies ?? false, path: "/", maxAge: 12 * 3600_000 });
    res.json({ user: r.user });
  });

  app.post("/api/auth/logout", (req, res) => {
    const t = readCookie(req, SESSION_COOKIE);
    if (t) logout(repo, t);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/me", requireRole("VIEWER"), (req, res) => res.json({ user: user(req) }));

  // ---- status --------------------------------------------------------------------
  app.get("/api/status", requireRole("VIEWER"), (_req, res) => {
    const sending = engine.sendingState();
    res.json({
      ...status,
      sending,
      halted: engine.halted(),
      liveSwitch: repo.setting("live_sending") === "on",
      threshold: engine.threshold(),
      handoffTo: engine.d.config.handoffTo,
      transport: engine.d.transport.name,
      simulated: !engine.d.transport.live,
      dailySendCap: engine.d.config.dailySendCap,
    });
  });

  // ---- OpCos ---------------------------------------------------------------------
  app.get("/api/opcos", requireRole("VIEWER"), (_req, res) => {
    res.json(
      repo.opcos().map((o) => {
        const ps = repo.prospects(o.id);
        return { ...o, counts: Object.fromEntries(STAGE_GROUPS.map((g) => [g.label, ps.filter((p) => g.statuses.includes(p.status)).length])) };
      }),
    );
  });

  app.post("/api/opcos", requireRole("OPERATOR"), (req, res) => {
    const b = parse(OpcoInput, req.body, res);
    if (!b) return;
    const problem = opcoInputProblem(b);
    if (problem) return res.status(400).json({ error: problem });
    const opco = engine.addOpco(b);
    repo.event("user.action", `${user(req).email} added OpCo ${opco.name}`, { opcoId: opco.id });
    res.status(201).json(opco);
  });

  app.get("/api/opcos/:id", requireRole("VIEWER"), (req, res) => {
    const opco = repo.opco(String(req.params.id));
    if (!opco) return res.status(404).json({ error: "Not found" });
    res.json({
      opco,
      profile: repo.profile(opco.id),
      claims: repo.claims(opco.id),
      sources: repo.sourcesFor({ opcoId: opco.id }).map(({ text, ...s }) => ({ ...s, chars: text.length })),
      events: repo.events({ opcoId: opco.id, limit: 50 }),
    });
  });

  app.post("/api/opcos/:id/analyse", requireRole("OPERATOR"), (req, res) => {
    const opco = repo.opco(String(req.params.id));
    if (!opco) return res.status(404).json({ error: "Not found" });
    engine.jobs.enqueue("analyse_opco", { opcoId: opco.id }, { key: `analyse_opco:${opco.id}:${repo.now()}` });
    res.json({ ok: true });
  });

  app.post("/api/opcos/:id/discover", requireRole("OPERATOR"), (req, res) => {
    const opco = repo.opco(String(req.params.id));
    if (!opco) return res.status(404).json({ error: "Not found" });
    if (!repo.profile(opco.id)?.complete) return res.status(409).json({ error: "The prospecting profile is incomplete" });
    engine.jobs.enqueue("discover", { opcoId: opco.id }, { key: `discover:${opco.id}:${repo.now()}` });
    res.json({ ok: true });
  });

  // ---- prospects -------------------------------------------------------------------
  app.get("/api/opcos/:id/prospects", requireRole("VIEWER"), (req, res) => {
    res.json(
      repo.prospects(String(req.params.id)).map((p) => {
        const contact = p.contactId ? repo.contact(p.contactId) : null;
        return {
          ...p,
          stage: STAGE_GROUPS.find((g) => g.statuses.includes(p.status))?.label ?? p.status,
          contact: contact ? { name: contact.name, title: contact.title } : null,
        };
      }),
    );
  });

  app.post("/api/opcos/:id/prospects", requireRole("OPERATOR"), (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(200), domain: z.string().trim().min(3).max(253), urls: z.array(z.string().max(500)).max(10).optional() }), req.body, res);
    if (!b) return;
    const opcoId = String(req.params.id);
    if (!repo.profile(opcoId)?.complete) return res.status(409).json({ error: "The prospecting profile is incomplete" });
    for (const u of [`https://${bareDomain(b.domain)}`, ...(b.urls ?? [])]) {
      const c = checkUrl(u);
      if (!c.ok) return res.status(400).json({ error: `${u}: ${c.error}` });
    }
    const p = engine.addProspect(opcoId, b);
    if (!p) return res.status(409).json({ error: "Already a prospect for this OpCo" });
    res.status(201).json(p);
  });

  app.get("/api/prospects/:id", requireRole("VIEWER"), (req, res) => {
    const p = repo.prospect(String(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    const sources = new Map(repo.sourcesFor({ prospectId: p.id }).map((s) => [s.id, s]));
    res.json({
      prospect: p,
      opco: repo.opco(p.opcoId),
      contact: p.contactId ? repo.contact(p.contactId) : null,
      findings: repo.findings(p.id).map((f) => ({
        ...f,
        evidence: f.evidence.map((e) => ({ ...e, url: sources.get(e.sourceId)?.url ?? null, publishedAt: sources.get(e.sourceId)?.publishedAt ?? null })),
      })),
      communications: repo.communications({ prospectId: p.id }).map((c) => ({ ...c, qa: repo.qaReports(c.id) })),
      inbound: repo.inboundFor({ prospectId: p.id }),
      handoffs: repo.handoffs({ prospectId: p.id }),
      events: repo.events({ prospectId: p.id, limit: 100 }),
    });
  });

  app.post("/api/prospects/:id/contact", requireRole("OPERATOR"), (req, res) => {
    const b = parse(
      z.object({
        name: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(200),
        email: z.string().trim().email(),
        sourceUrl: z.string().trim().max(500).optional().nullable(),
        verified: z.boolean().optional(),
      }),
      req.body,
      res,
    );
    if (!b) return;
    const p = repo.prospect(String(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    if (!["RESEARCHING", "REJECTED"].includes(p.status)) return res.status(409).json({ error: `Cannot change the contact of a ${p.status} prospect` });
    const contact = repo.addContact({
      prospectId: p.id,
      name: b.name,
      title: b.title,
      email: b.email,
      emailStatus: b.verified ? "verified" : "unverified",
      employerDomain: p.domain,
      source: `manual (${user(req).email})`,
      sourceUrl: b.sourceUrl ?? null,
    });
    repo.updateProspect(p.id, { contactId: contact.id });
    repo.setProspectStatus(p.id, "RESEARCHING", "Contact added; re-qualifying");
    repo.event("contact.manual", `${user(req).email} set ${contact.name}, ${contact.title}`, { opcoId: p.opcoId, prospectId: p.id });
    engine.jobs.enqueue("qualify", { prospectId: p.id }, { key: `qualify:${p.id}:${repo.now()}` });
    res.status(201).json(contact);
  });

  app.post("/api/prospects/:id/feedback", requireRole("OPERATOR"), (req, res) => {
    const b = parse(z.object({ falsePositive: z.boolean(), note: z.string().max(2000).optional() }), req.body, res);
    if (!b) return;
    const p = repo.prospect(String(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    repo.setFeedback(p.id, b.falsePositive, b.note ?? null, user(req).email);
    repo.event("feedback", `${user(req).email}: ${b.falsePositive ? "should not have been contacted" : "good prospect"}`, { opcoId: p.opcoId, prospectId: p.id });
    res.json({ ok: true });
  });

  app.post("/api/handoffs/:id/verdict", requireRole("OPERATOR"), (req, res) => {
    const b = parse(z.object({ verdict: z.enum(["ACCEPTED", "DECLINED"]) }), req.body, res);
    if (!b) return;
    const h = repo.handoff(String(req.params.id));
    if (!h) return res.status(404).json({ error: "Not found" });
    repo.setHandoffVerdict(h.id, b.verdict);
    res.json({ ok: true });
  });

  // ---- metrics -------------------------------------------------------------------------
  app.get("/api/metrics", requireRole("VIEWER"), (req, res) => {
    res.json(computeMetrics(repo, typeof req.query.opcoId === "string" ? req.query.opcoId : undefined));
  });

  // ---- controls --------------------------------------------------------------------------
  // Anyone who can act can halt. Only an administrator can resume.
  app.post("/api/settings/halt", requireRole("OPERATOR"), (req, res) => {
    const b = parse(z.object({ halted: z.boolean() }), req.body, res);
    if (!b) return;
    if (!b.halted && user(req).role !== "ADMIN") return res.status(403).json({ error: "Only an administrator can resume sending" });
    repo.setSetting("halted", b.halted ? "1" : "0");
    repo.event("control.halt", `${user(req).email} ${b.halted ? "halted" : "resumed"} sending`);
    res.json({ halted: engine.halted() });
  });

  app.post("/api/settings/live", requireRole("ADMIN"), (req, res) => {
    const b = parse(z.object({ on: z.boolean() }), req.body, res);
    if (!b) return;
    if (b.on && !engine.d.transport.live) return res.status(409).json({ error: "No live mail transport is configured" });
    repo.setSetting("live_sending", b.on ? "on" : "off");
    repo.event("control.live", `${user(req).email} switched live sending ${b.on ? "on" : "off"}`);
    res.json(engine.sendingState());
  });

  app.post("/api/settings/threshold", requireRole("ADMIN"), (req, res) => {
    const b = parse(z.object({ value: z.number() }), req.body, res);
    if (!b) return;
    if (b.value < engine.threshold()) return res.status(400).json({ error: "The threshold can be raised, never lowered" });
    repo.setSetting("threshold", String(effectiveThreshold(b.value)));
    repo.event("control.threshold", `${user(req).email} set the threshold to ${engine.threshold()}`);
    res.json({ threshold: engine.threshold() });
  });

  app.get("/api/suppression", requireRole("VIEWER"), (_req, res) => res.json(repo.suppressionList()));
  app.post("/api/suppression", requireRole("ADMIN"), (req, res) => {
    const b = parse(z.object({ value: z.string().trim().min(3).max(320), kind: z.enum(["email", "domain"]), reason: z.string().trim().min(1).max(500) }), req.body, res);
    if (!b) return;
    repo.suppress(b.kind === "domain" ? bareDomain(b.value) : b.value, b.kind, `${b.reason} (${user(req).email})`);
    res.status(201).json({ ok: true });
  });

  // ---- simulation only ----------------------------------------------------------------------
  const sim = engine.d.transport instanceof SimMailbox ? engine.d.transport : null;
  app.get("/api/simulation/outbox", requireRole("VIEWER"), (_req, res) => {
    if (!sim) return res.status(404).json({ error: "Not in simulation mode" });
    res.json([...sim.sent].reverse());
  });
  app.post("/api/simulation/reply", requireRole("OPERATOR"), wrap(async (req, res) => {
    if (!sim) return res.status(404).json({ error: "Not in simulation mode" });
    const b = parse(z.object({ prospectId: z.string(), body: z.string().trim().min(1).max(5000), fromEmail: z.string().email().optional() }), req.body, res);
    if (!b) return;
    const p = repo.prospect(b.prospectId);
    const contact = p?.contactId ? repo.contact(p.contactId) : null;
    if (!p || !contact) return res.status(404).json({ error: "No contacted prospect" });
    sim.replyFrom(b.fromEmail ?? contact.email, b.body, { fromName: contact.name });
    await engine.syncInbox();
    res.json({ ok: true });
  }));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  });
  return app;
}
