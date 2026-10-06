// The API Microsoft 365 Copilot calls (via the Hijojo declarative agent and its
// API plugin; see copilot/). Authentication is an Entra ID bearer token for the
// signed-in user, who must already be a Hijojo user; their Hijojo role applies.
//
// The surface is deliberately narrow. From Copilot you can look at OpCos,
// profiles, prospects and outcomes, add an OpCo, record feedback and verdicts,
// and halt sending. You cannot send, resume sending, switch live sending on or
// change the threshold: those stay in the Hijojo app with an administrator.

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { Engine } from "./engine";
import type { User } from "./auth";
import { EntraAuthError, type EntraVerifier } from "./entra";
import { computeMetrics } from "./metrics";
import { OpcoInput, opcoInputProblem } from "./opco-input";
import { STAGE_GROUPS, type ProfileItem, type Role } from "../shared/types";

const RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

export function createCopilotRouter(engine: Engine, verify: EntraVerifier | null): Router {
  const repo = engine.d.repo;
  const r = Router();

  r.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!verify) return res.status(503).json({ error: "Copilot access is not configured (HIJOJO_ENTRA_TENANT_ID, HIJOJO_ENTRA_AUDIENCES)" });
    const m = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "");
    if (!m) return res.status(401).json({ error: "Bearer token required" });
    try {
      const id = await verify(m[1]);
      const row = repo.db.prepare("SELECT id, email, name, role FROM users WHERE email = ?").get(id.email) as User | undefined;
      if (!row) return res.status(403).json({ error: `${id.email} is not a Hijojo user. Ask an administrator to add you.` });
      (req as any).user = row;
      next();
    } catch (e) {
      if (e instanceof EntraAuthError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  });

  const can = (min: Role) => (req: Request, res: Response, next: NextFunction) =>
    RANK[((req as any).user as User).role] >= RANK[min] ? next() : res.status(403).json({ error: `Requires the ${min} role in Hijojo` });
  const who = (req: Request) => ((req as any).user as User).email;
  const stageOf = (status: string) => STAGE_GROUPS.find((g) => g.statuses.includes(status as any))?.label ?? status;
  const item = (i: ProfileItem) => ({ text: i.text, status: i.status });

  r.get("/opcos", (_req, res) => {
    res.json({
      opcos: repo.opcos().map((o) => {
        const ps = repo.prospects(o.id);
        return {
          id: o.id,
          name: o.name,
          website: o.website || null,
          status: o.status,
          statusDetail: o.statusDetail,
          stages: Object.fromEntries(STAGE_GROUPS.map((g) => [g.label, ps.filter((p) => g.statuses.includes(p.status)).length])),
        };
      }),
    });
  });

  r.get("/opcos/:opcoId", (req, res) => {
    const o = repo.opco(String(req.params.opcoId));
    if (!o) return res.status(404).json({ error: "No such OpCo" });
    const p = repo.profile(o.id);
    if (!p) return res.json({ id: o.id, name: o.name, status: o.status, statusDetail: o.statusDetail, profile: null });
    res.json({
      id: o.id,
      name: o.name,
      status: o.status,
      profileComplete: p.complete,
      gaps: p.gaps,
      proposition: item(p.proposition),
      problem: item(p.problem),
      usp: item(p.usp),
      cost: item(p.cost),
      icp: p.icp,
      buyers: p.buyers,
      buyingSignals: p.signals.map((s) => ({ name: s.name, whyItMatters: s.whyItMatters })),
      exclusions: p.exclusions,
    });
  });

  r.get("/opcos/:opcoId/prospects", (req, res) => {
    const o = repo.opco(String(req.params.opcoId));
    if (!o) return res.status(404).json({ error: "No such OpCo" });
    const stage = typeof req.query.stage === "string" ? req.query.stage : null;
    const list = repo
      .prospects(o.id)
      .filter((p) => !stage || stageOf(p.status).toLowerCase() === stage.toLowerCase())
      .map((p) => {
        const c = p.contactId ? repo.contact(p.contactId) : null;
        return {
          id: p.id,
          name: p.name,
          domain: p.domain,
          stage: stageOf(p.status),
          score: p.score?.total ?? null,
          contact: c ? `${c.name}, ${c.title}` : null,
          reason: p.statusReason,
        };
      });
    res.json({ opco: o.name, stage: stage ?? "all", prospects: list });
  });

  r.get("/prospects/:prospectId", (req, res) => {
    const p = repo.prospect(String(req.params.prospectId));
    if (!p) return res.status(404).json({ error: "No such prospect" });
    const c = p.contactId ? repo.contact(p.contactId) : null;
    const sources = new Map(repo.sourcesFor({ prospectId: p.id }).map((s) => [s.id, s]));
    res.json({
      id: p.id,
      name: p.name,
      domain: p.domain,
      opco: repo.opco(p.opcoId)?.name,
      stage: stageOf(p.status),
      statusReason: p.statusReason,
      who: c ? { name: c.name, title: c.title, email: c.email, emailStatus: c.emailStatus } : null,
      whyThem: p.whyThem,
      whyNow: p.whyNow,
      whyProposition: p.whyProposition,
      score: p.score
        ? {
            total: p.score.total,
            threshold: p.score.threshold,
            confidence: p.score.confidence,
            dimensions: Object.fromEntries(Object.entries(p.score.dimensions).map(([k, d]) => [k, `${d.points}/${d.max}`])),
          }
        : null,
      evidence: repo
        .findings(p.id)
        .filter((f) => f.status === "FACT")
        .slice(0, 8)
        .map((f) => ({ statement: f.statement, date: f.observedAt?.slice(0, 10) ?? null, quote: f.evidence[0]?.quote ?? null, url: sources.get(f.evidence[0]?.sourceId)?.url ?? null })),
      communications: repo.communications({ prospectId: p.id }).map((m) => {
        const qa = repo.qaReports(m.id).at(-1);
        return {
          kind: m.kind,
          status: m.status,
          subject: m.subject,
          sentAt: m.sentAt,
          qa: qa?.verdict ?? null,
          qaFailures: qa ? qa.checks.filter((x) => !x.passed).map((x) => `${x.name}: ${x.detail}`) : [],
        };
      }),
      replies: repo.inboundFor({ prospectId: p.id }).map((m) => ({ from: m.fromEmail, classification: m.classification, receivedAt: m.receivedAt })),
      handoffs: repo.handoffs({ prospectId: p.id }).map((h) => ({ id: h.id, to: h.to, status: h.status, verdict: h.verdict })),
      activity: repo.events({ prospectId: p.id, limit: 10 }).map((e) => `${e.at.slice(0, 16).replace("T", " ")} ${e.detail}`),
    });
  });

  r.get("/outcomes", (req, res) => {
    const m = computeMetrics(repo, typeof req.query.opcoId === "string" ? req.query.opcoId : undefined);
    const rate = (x: { n: number; of: number; rate: number | null }) => (x.rate == null ? "n/a" : `${x.rate}% (${x.n}/${x.of})`);
    res.json({
      emailsSent: m.emailsSent,
      qualifiedProspectRate: rate(m.qualifiedProspectRate),
      positiveResponseRate: rate(m.positiveReplies),
      humanAcceptedOpportunityRate: rate(m.humanAcceptedOpportunityRate),
      falsePositiveRate: rate(m.falsePositiveRate),
      contactAccuracy: rate(m.contactAccuracy),
      qaRejectionRate: rate(m.qaRejectionRate),
      unsubscribeRate: rate(m.unsubscribeRate),
      byTrigger: m.byTrigger,
      sending: engine.sendingState(),
    });
  });

  r.post("/opcos", can("OPERATOR"), (req, res) => {
    const parsed = OpcoInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const problem = opcoInputProblem(parsed.data);
    if (problem) return res.status(400).json({ error: problem });
    const opco = engine.addOpco(parsed.data);
    repo.event("user.action", `${who(req)} added OpCo ${opco.name} from Copilot`, { opcoId: opco.id });
    res.status(201).json({ id: opco.id, name: opco.name, status: opco.status, message: "Added. Hijojo is researching it and will build the prospecting profile." });
  });

  r.post("/prospects/:prospectId/feedback", can("OPERATOR"), (req, res) => {
    const b = z.object({ falsePositive: z.boolean(), note: z.string().max(2000).optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: "falsePositive (boolean) is required" });
    const p = repo.prospect(String(req.params.prospectId));
    if (!p) return res.status(404).json({ error: "No such prospect" });
    repo.setFeedback(p.id, b.data.falsePositive, b.data.note ?? null, who(req));
    repo.event("feedback", `${who(req)} (Copilot): ${b.data.falsePositive ? "should not have been contacted" : "good prospect"}`, { opcoId: p.opcoId, prospectId: p.id });
    res.json({ ok: true });
  });

  r.post("/handoffs/:handoffId/verdict", can("OPERATOR"), (req, res) => {
    const b = z.object({ verdict: z.enum(["ACCEPTED", "DECLINED"]) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: "verdict must be ACCEPTED or DECLINED" });
    const h = repo.handoff(String(req.params.handoffId));
    if (!h) return res.status(404).json({ error: "No such handoff" });
    repo.setHandoffVerdict(h.id, b.data.verdict);
    res.json({ ok: true });
  });

  r.post("/halt", can("OPERATOR"), (req, res) => {
    repo.setSetting("halted", "1");
    repo.event("control.halt", `${who(req)} halted sending from Copilot`);
    res.json({ halted: true, message: "All sending is halted. An administrator can resume it in the Hijojo app." });
  });

  r.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return r;
}
