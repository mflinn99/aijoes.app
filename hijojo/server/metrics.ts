// Continuous QA. Measures what the remit says success is (precision, relevance,
// useful conversations), not volume. Learning only ever tightens qualification.

import type { Repo } from "./repo";
import type { ResponseClass } from "../shared/types";

const ENGAGED: ResponseClass[] = ["POSITIVE", "INTERESTED", "REFERRAL"];
const NEGATIVE: ResponseClass[] = ["NOT_INTERESTED", "UNSUBSCRIBE"];

interface Rate {
  n: number;
  of: number;
  rate: number | null;
}
const rate = (n: number, of: number): Rate => ({ n, of, rate: of ? Math.round((1000 * n) / of) / 10 : null });

export interface Breakdown {
  key: string;
  contacted: number;
  replied: number;
  engaged: number;
}

export interface Metrics {
  prospects: Record<string, number>;
  qualifiedProspectRate: Rate;
  emailsSent: { intro: number; followup: number };
  delivered: Rate;
  bounced: number;
  opensAndClicks: string;
  replies: Rate;
  positiveReplies: Rate;
  negativeReplies: number;
  unsubscribeRate: Rate;
  contactAccuracy: Rate;
  qaRejectionRate: Rate;
  falsePositiveRate: Rate;
  humanAcceptedOpportunityRate: Rate;
  byIcp: Breakdown[];
  byTrigger: Breakdown[];
  byApproach: Breakdown[];
  suspendedSignals: string[];
}

/** Which buying signal justified each contacted prospect's introduction. */
function introSignals(repo: Repo): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of repo.communications()) {
    if (c.kind !== "intro" || c.status !== "SENT") continue;
    const sigs = c.evidence
      .filter((e) => e.section === "whyNow")
      .map((e) => repo.finding(e.findingId)?.signalId)
      .filter((s): s is string => !!s);
    out.set(c.prospectId, [...new Set(sigs)]);
  }
  return out;
}

function falsePositives(repo: Repo): Set<string> {
  const fp = new Set(repo.feedback().filter((f) => f.falsePositive).map((f) => f.prospectId));
  for (const h of repo.handoffs()) if (h.verdict === "DECLINED") fp.add(h.prospectId);
  return fp;
}

/**
 * A signal that keeps producing prospects people judge should not have been
 * contacted stops counting as a reason to contact anyone.
 */
export function suspendedSignals(repo: Repo, minJudged = 3, maxFpRate = 0.5): string[] {
  const fp = falsePositives(repo);
  const judged = new Set([...repo.feedback().map((f) => f.prospectId), ...repo.handoffs().filter((h) => h.verdict).map((h) => h.prospectId)]);
  const per = new Map<string, { judged: number; fp: number }>();
  for (const [prospectId, sigs] of introSignals(repo)) {
    if (!judged.has(prospectId)) continue;
    for (const s of sigs) {
      const e = per.get(s) ?? { judged: 0, fp: 0 };
      e.judged++;
      if (fp.has(prospectId)) e.fp++;
      per.set(s, e);
    }
  }
  return [...per].filter(([, e]) => e.judged >= minJudged && e.fp / e.judged > maxFpRate).map(([s]) => s);
}

export function computeMetrics(repo: Repo, opcoId?: string): Metrics {
  const prospects = repo.prospects(opcoId);
  const ids = new Set(prospects.map((p) => p.id));
  const byStatus: Record<string, number> = {};
  for (const p of prospects) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;

  const outbound = repo.allOutbound().filter((o) => ids.has(o.prospectId) && o.kind !== "handoff" && o.status === "SENT");
  const contacted = new Set(outbound.filter((o) => o.kind === "intro").map((o) => o.prospectId));
  const inbound = repo.allInbound().filter((m) => m.prospectId && ids.has(m.prospectId));
  const firstReply = new Map<string, ResponseClass>();
  for (const m of inbound) if (m.classification && !firstReply.has(m.prospectId!)) firstReply.set(m.prospectId!, m.classification);
  const human = [...firstReply].filter(([, c]) => c !== "BOUNCE" && c !== "AUTO_REPLY");
  const engaged = human.filter(([, c]) => ENGAGED.includes(c));
  const bounced = [...firstReply.values()].filter((c) => c === "BOUNCE").length;

  const scored = prospects.filter((p) => p.score);
  const everQualified = scored.filter((p) => p.score!.passed && p.status !== "REJECTED");

  const qa = repo.communications(opcoId ? { opcoId } : {}).flatMap((c) => repo.qaReports(c.id));
  const fp = falsePositives(repo);
  const judgedHandoffs = repo.handoffs().filter((h) => ids.has(h.prospectId) && h.verdict);

  const breakdown = (keyOf: (prospectId: string) => string[]): Breakdown[] => {
    const m = new Map<string, Breakdown>();
    for (const pid of contacted) {
      for (const key of keyOf(pid)) {
        const b = m.get(key) ?? { key, contacted: 0, replied: 0, engaged: 0 };
        b.contacted++;
        const cls = firstReply.get(pid);
        if (cls && cls !== "BOUNCE" && cls !== "AUTO_REPLY") b.replied++;
        if (cls && ENGAGED.includes(cls)) b.engaged++;
        m.set(key, b);
      }
    }
    return [...m.values()].sort((a, b) => b.contacted - a.contacted);
  };
  const signals = introSignals(repo);
  const approach = new Map(repo.communications().filter((c) => c.kind === "intro" && c.status === "SENT").map((c) => [c.prospectId, c.approach]));
  const prospectById = new Map(prospects.map((p) => [p.id, p]));

  return {
    prospects: byStatus,
    qualifiedProspectRate: rate(everQualified.length, scored.length),
    emailsSent: { intro: outbound.filter((o) => o.kind === "intro").length, followup: outbound.filter((o) => o.kind === "followup").length },
    delivered: rate(outbound.length - bounced, outbound.length),
    bounced,
    opensAndClicks: "Not tracked: no tracking pixels or rewritten links are used",
    replies: rate(human.length, contacted.size),
    positiveReplies: rate(engaged.length, contacted.size),
    negativeReplies: human.filter(([, c]) => NEGATIVE.includes(c)).length,
    unsubscribeRate: rate(human.filter(([, c]) => c === "UNSUBSCRIBE").length, contacted.size),
    contactAccuracy: rate(human.filter(([, c]) => c !== "REFERRAL").length, human.length),
    qaRejectionRate: rate(qa.filter((r) => r.verdict !== "PASS").length, qa.length),
    falsePositiveRate: rate([...contacted].filter((p) => fp.has(p)).length, contacted.size),
    humanAcceptedOpportunityRate: rate(judgedHandoffs.filter((h) => h.verdict === "ACCEPTED").length, judgedHandoffs.length),
    byIcp: breakdown((pid) => [prospectById.get(pid)?.attributes.sector ?? "Unknown sector"]),
    byTrigger: breakdown((pid) => (signals.get(pid)?.length ? signals.get(pid)! : ["No trigger recorded"])),
    byApproach: breakdown((pid) => [approach.get(pid) ?? "unknown"]),
    suspendedSignals: suspendedSignals(repo),
  };
}
