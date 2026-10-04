// Assembles QA's view of a communication from the database, independently of
// whatever produced it, runs the checks and records the report.

import { z } from "zod/v4";
import type { Repo } from "../repo";
import type { Config } from "../config";
import type { Llm } from "../llm/client";
import { UNTRUSTED_NOTICE } from "../llm/client";
import { bareDomain } from "../qualification";
import { runQa, type QaContext } from "./qa";
import type { QaCheck, QaReport } from "../../shared/types";

export function buildQaContext(repo: Repo, config: Config, commId: string): QaContext {
  const comm = repo.communication(commId);
  if (!comm) throw new Error(`No communication ${commId}`);
  const prospect = repo.prospect(comm.prospectId)!;
  const opco = repo.opco(prospect.opcoId)!;
  const contact = repo.contact(comm.contactId)!;
  const domain = bareDomain(prospect.domain);
  const now = repo.clock.now();

  const outbound = [
    ...repo.outboundFor({ prospectId: prospect.id }),
    ...repo.outboundFor({ email: contact.email }).filter((o) => o.prospectId !== prospect.id),
  ].filter((o) => o.kind !== "handoff");

  const windowStart = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const domainOutboundOtherOpcos = repo
    .prospectsByDomain(domain)
    .filter((p) => p.opcoId !== prospect.opcoId)
    .flatMap((p) => repo.outboundFor({ prospectId: p.id }))
    .filter((o) => o.kind !== "handoff" && (o.status === "SENT" || o.status === "SENDING" || o.status === "UNCERTAIN") && o.createdAt >= windowStart);

  const inbound = [...repo.inboundFor({ prospectId: prospect.id }), ...repo.inboundFor({ email: contact.email }), ...repo.inboundFor({ domain })];
  const uniqueInbound = [...new Map(inbound.map((m) => [m.id, m])).values()];

  const intro = comm.kind === "followup" ? (repo.communications({ prospectId: prospect.id }).find((c) => c.kind === "intro" && c.status === "SENT") ?? null) : null;
  const introFindings = intro ? intro.evidence.map((e) => repo.finding(e.findingId)).filter((f): f is NonNullable<typeof f> => !!f) : [];
  const otherBodies = repo
    .communications({ opcoId: opco.id })
    .filter((c) => c.prospectId !== prospect.id && (c.status === "SENT" || c.status === "QA_PASS" || c.status === "SENDING"))
    .map((c) => c.body);

  return {
    comm,
    opco,
    otherOpcoNames: repo.opcos().filter((o) => o.id !== opco.id).map((o) => o.name),
    prospect,
    profile: repo.profile(opco.id)!,
    contact,
    findings: repo.findings(prospect.id),
    sources: (id) => repo.source(id),
    claims: repo.claims(opco.id),
    suppressed: repo.isSuppressed(contact.email),
    history: { outbound, inbound: uniqueInbound, intro, introFindings, otherBodies, domainOutboundOtherOpcos },
    now,
    config,
  };
}

const ReviewSchema = z.object({
  concerns: z.array(z.object({ issue: z.string(), severity: z.enum(["reject", "rework"]) })),
});

/**
 * An optional second, model-based reviewer. It can only add objections: it
 * never turns a failed rule into a pass.
 */
export async function modelReview(llm: Llm, ctx: QaContext): Promise<QaCheck[]> {
  const out = await llm.run({
    task: "qa_review",
    effort: "medium",
    system: `You are an independent reviewer of one outbound sales email. You did not write it. Object to anything a reasonable recipient would find generic, misleading, presumptuous, unsupported by the evidence listed, or inappropriate. ${UNTRUSTED_NOTICE}`,
    prompt: `Recipient: ${ctx.contact.name}, ${ctx.contact.title} at ${ctx.prospect.name}\nEvidence:\n${ctx.findings
      .filter((f) => f.status === "FACT")
      .map((f) => `- ${f.statement}`)
      .join("\n")}\n\n<email>\nSubject: ${ctx.comm.subject}\n\n${ctx.comm.body}\n</email>\n\nList concerns; an empty list means none.`,
    context: { comm: ctx.comm },
    schema: ReviewSchema,
  });
  return out.concerns.map((c) => ({ name: "review.model", passed: false, severity: c.severity, scope: "communication" as const, detail: c.issue }));
}

export async function qaCommunication(deps: { repo: Repo; config: Config; reviewer: Llm | null }, commId: string): Promise<QaReport> {
  const ctx = buildQaContext(deps.repo, deps.config, commId);
  const result = runQa(ctx);
  let reviewer = "rules";
  if (deps.reviewer && result.verdict === "PASS") {
    try {
      const extra = await modelReview(deps.reviewer, ctx);
      result.checks.push(...extra);
      if (extra.some((c) => c.severity === "reject")) result.verdict = "REJECT";
      else if (extra.length) result.verdict = "REWORK";
      reviewer = `rules+${deps.reviewer.name}`;
    } catch (e) {
      // A reviewer that cannot run is not a reason to send unreviewed copy.
      result.checks.push({ name: "review.model", passed: false, severity: "rework", scope: "communication", detail: `Reviewer unavailable: ${(e as Error).message}` });
      result.verdict = "REWORK";
    }
  }
  const report = deps.repo.addQaReport({ commId, verdict: result.verdict, checks: result.checks, relevance: result.relevance, reviewer, contentHash: ctx.comm.contentHash });
  deps.repo.setCommStatus(commId, result.verdict === "PASS" ? "QA_PASS" : result.verdict === "REWORK" ? "QA_REWORK" : "QA_REJECT");
  const failed = result.checks.filter((c) => !c.passed);
  deps.repo.event(
    "qa.verdict",
    `${ctx.comm.kind} attempt ${ctx.comm.attempt}: ${result.verdict}${failed.length ? ` (${failed.map((c) => c.name).join(", ")})` : ""}`,
    { opcoId: ctx.opco.id, prospectId: ctx.prospect.id },
  );
  return report;
}
