// Research Agent, contact identification and Qualification Agent.

import { z } from "zod/v4";
import type { Repo } from "../repo";
import { newId } from "../repo";
import type { Fetcher } from "../research/fetcher";
import { extractJsonBlock, sourceBlock, UNTRUSTED_NOTICE, type Llm } from "../llm/client";
import { settleStatus, verifyQuote } from "../evidence";
import { bareDomain, decideQualification, matchExclusion, roleMatch, scoreProspect, type Assessment } from "../qualification";
import type { Contact, EmailStatus, Finding, Opco, Prospect, ProspectAttributes, ProspectingProfile, Source } from "../../shared/types";
import { EpistemicSchema, EvidenceSchema, pageUrl, retrieve } from "./common";

// ---- discovery ----------------------------------------------------------------

export interface Candidate {
  name: string;
  domain: string;
  /** Pages where the reason for selection was found. Fetched during research. */
  urls: string[];
  why: string;
  via: string;
}

export interface CandidateSource {
  readonly name: string;
  find(input: { opco: Opco; profile: ProspectingProfile; limit: number }): Promise<Candidate[]>;
}

const CandidatesSchema = z.object({
  candidates: z.array(z.object({ name: z.string(), domain: z.string(), urls: z.array(z.string()), why: z.string() })),
});

/**
 * Finds candidates with Claude's web search. A candidate counts only if the
 * pages it is based on were actually returned by the search tool.
 */
export class WebSearchCandidates implements CandidateSource {
  readonly name = "web-search";
  constructor(private llm: Llm) {}

  async find({ opco, profile, limit }: { opco: Opco; profile: ProspectingProfile; limit: number }): Promise<Candidate[]> {
    const res = await this.llm.webSearch({
      task: "prospect_discovery",
      maxUses: 8,
      system: `You find a small number of companies that are genuinely likely to buy a specific proposition now. ${UNTRUSTED_NOTICE} Prefer a few excellent candidates with a specific, observable buying signal over many plausible ones. Never include a company merely because it is in the target sector.`,
      prompt: `Proposition: ${profile.proposition.text}\nProblem: ${profile.problem.text}\nICP: ${JSON.stringify(profile.icp)}\nBuying signals: ${profile.signals
        .map((s) => `${s.id}: ${s.name} (${s.description})`)
        .join("; ")}\nDo not include: ${profile.exclusions.map((x) => `${x.kind} ${x.value}`).join(", ")}, or ${opco.name}.\n\nSearch for up to ${limit} companies showing one of these signals. Finish with a fenced JSON block: {"candidates":[{"name","domain","urls":[pages showing the signal],"why"}]}`,
      context: { opco, profile, limit },
    });
    const returned = new Set(res.urls.map((u) => u.url));
    const returnedHosts = new Set(res.urls.map((u) => bareDomain(u.url)));
    const parsed = CandidatesSchema.parse(extractJsonBlock(res.text));
    return parsed.candidates
      .map((c) => ({ ...c, domain: bareDomain(c.domain), urls: c.urls.filter((u) => returned.has(u)), via: this.name }))
      .filter((c) => c.urls.length > 0 || returnedHosts.has(c.domain))
      .slice(0, limit);
  }
}

/** Collapses the same company reached by different URLs or casing. */
export function dedupeCandidates(cands: Candidate[]): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const c of cands) {
    const d = bareDomain(c.domain);
    const prev = by.get(d);
    if (prev) prev.urls = [...new Set([...prev.urls, ...c.urls])];
    else by.set(d, { ...c, domain: d });
  }
  return [...by.values()];
}

// ---- contacts -------------------------------------------------------------------

export interface ContactCandidate {
  name: string;
  title: string;
  email: string;
  emailStatus: EmailStatus;
  sourceUrl: string | null;
}

export interface ContactProvider {
  readonly name: string;
  readonly configured: boolean;
  find(prospect: Prospect, profile: ProspectingProfile): Promise<ContactCandidate[]>;
}

/** The provider has not been named yet; no contacts are invented in its place. */
export class UnconfiguredContactProvider implements ContactProvider {
  readonly name = "unconfigured";
  readonly configured = false;
  async find(): Promise<ContactCandidate[]> {
    return [];
  }
}

export class StaticContactProvider implements ContactProvider {
  readonly name: string;
  readonly configured = true;
  constructor(
    private byDomain: Record<string, ContactCandidate[]>,
    name = "static",
  ) {
    this.name = name;
  }
  async find(prospect: Prospect): Promise<ContactCandidate[]> {
    return this.byDomain[prospect.domain] ?? [];
  }
}

/** Best buyer-role match first; otherwise the first candidate, which QA will judge. */
export function selectContact(cands: ContactCandidate[], profile: ProspectingProfile): ContactCandidate | null {
  const rank = { economic: 0, operational: 1, technical: 2, influencer: 3 } as const;
  const usable = cands.filter((c) => c.emailStatus !== "invalid" && c.emailStatus !== "bounced");
  const scored = usable
    .map((c) => ({ c, kind: roleMatch(c.title, profile.buyers) }))
    .sort((a, b) => (a.kind ? rank[a.kind] : 9) - (b.kind ? rank[b.kind] : 9));
  return scored[0]?.c ?? null;
}

// ---- research -------------------------------------------------------------------

const PROSPECT_PATHS = ["/", "/about", "/news", "/careers", "/press"];

const Attr = <T extends z.ZodType>(t: T) => z.object({ value: t.nullable(), evidence: z.array(EvidenceSchema) });
const ResearchSchema = z.object({
  attributes: z.object({ sector: Attr(z.string()), employees: Attr(z.number()), geography: Attr(z.string()) }),
  findings: z.array(
    z.object({
      kind: z.enum(["identity", "icp", "trigger", "need", "commercial"]),
      statement: z.string(),
      status: EpistemicSchema,
      evidence: z.array(EvidenceSchema),
      basis: z.string().nullable(),
      signalId: z.string().nullable(),
    }),
  ),
  conflicts: z.array(z.string()),
});

export interface ResearchDeps {
  repo: Repo;
  llm: Llm;
  fetcher: Fetcher;
}

export async function researchProspect(deps: ResearchDeps, prospectId: string, extraUrls: string[] = []): Promise<{ ok: boolean; reason: string }> {
  const { repo, llm, fetcher } = deps;
  const prospect = repo.prospect(prospectId)!;
  const profile = repo.profile(prospect.opcoId)!;
  const base = `https://${prospect.domain}`;
  const urls = [
    ...extraUrls.map((url) => ({ url, kind: "news" as const })),
    ...PROSPECT_PATHS.map((p) => ({ url: pageUrl(base, p), kind: "prospect-site" as const })),
  ];
  const { sources, failures } = await retrieve(repo, fetcher, urls, { prospectId });
  if (!sources.length) {
    const reason = `No evidence could be retrieved (${failures.slice(0, 2).join("; ")})`;
    repo.setProspectStatus(prospectId, "RESEARCHING", reason);
    return { ok: false, reason };
  }

  // Judge only what was retrieved now: a page that has since gone cannot re-verify a finding.
  const all = sources;
  const byId = new Map(all.map((s) => [s.id, s]));
  const out = await llm.run({
    task: "prospect_research",
    effort: "high",
    system: `You research one company to decide whether it should hear about a specific proposition now. ${UNTRUSTED_NOTICE}
Record findings as FACT (with exact quotations and source ids), INFERENCE (with a basis) or UNKNOWN. Kinds: identity (who the company is), icp (sector, size, geography, environment), trigger (a dated event matching one of the buying signals; give its signal id), need (evidence of the problem), commercial (scale or spend relevant to the proposition). List any conflicting facts about the company's identity or data under conflicts.`,
    prompt: `Company: ${prospect.name} (${prospect.domain})\nProposition: ${profile.proposition.text}\nProblem: ${profile.problem.text}\nICP: ${JSON.stringify(profile.icp)}\nBuying signals:\n${profile.signals
      .map((s) => `- ${s.id}: ${s.name}: ${s.description}`)
      .join("\n")}\n\n${all.map((s) => sourceBlock(s)).join("\n\n")}`,
    context: { prospect, sources: all.map((s) => ({ id: s.id, url: s.url })) },
    schema: ResearchSchema,
  });

  const signalIds = new Set(profile.signals.map((s) => s.id));
  const findings: Finding[] = out.findings.map((f) => {
    const settled = settleStatus({ status: f.status, evidence: f.evidence, basis: f.basis }, byId);
    const dates = settled.evidence.map((e) => byId.get(e.sourceId)?.publishedAt).filter((d): d is string => !!d).sort();
    return {
      id: newId("fd"),
      prospectId,
      kind: f.kind,
      statement: f.statement,
      status: settled.status,
      evidence: settled.evidence,
      signalId: f.signalId && signalIds.has(f.signalId) ? f.signalId : null,
      observedAt: dates.length ? dates[dates.length - 1] : null,
      note: settled.note,
    };
  });
  const attr = <T>(a: { value: T | null; evidence: { sourceId: string; quote: string }[] }): T | null =>
    a.value != null && a.evidence.some((e) => verifyQuote(e, byId)) ? a.value : null;
  const attributes: ProspectAttributes = {
    sector: attr(out.attributes.sector),
    employees: attr(out.attributes.employees),
    geography: attr(out.attributes.geography),
  };
  repo.replaceFindings(prospectId, findings);
  repo.updateProspect(prospectId, { attributes, conflicts: out.conflicts, researchedAt: repo.now() });
  repo.event(
    "prospect.researched",
    `${sources.length} source(s); ${findings.filter((f) => f.status === "FACT").length} verified finding(s), ${findings.filter((f) => f.note).length} downgraded`,
    { opcoId: prospect.opcoId, prospectId },
  );
  return { ok: true, reason: "" };
}

export async function identifyContact(deps: { repo: Repo; contacts: ContactProvider }, prospectId: string): Promise<Contact | null> {
  const { repo } = deps;
  const prospect = repo.prospect(prospectId)!;
  if (prospect.contactId) return repo.contact(prospect.contactId);
  const profile = repo.profile(prospect.opcoId)!;
  const cands = await deps.contacts.find(prospect, profile);
  const pick = selectContact(cands, profile);
  if (!pick) return null;
  const contact = repo.addContact({
    prospectId,
    name: pick.name,
    title: pick.title,
    email: pick.email,
    emailStatus: pick.emailStatus,
    employerDomain: prospect.domain,
    source: deps.contacts.name,
    sourceUrl: pick.sourceUrl,
  });
  repo.updateProspect(prospectId, { contactId: contact.id });
  repo.event("contact.identified", `${contact.name}, ${contact.title} (${deps.contacts.name})`, { opcoId: prospect.opcoId, prospectId });
  return contact;
}

// ---- qualification --------------------------------------------------------------

const Dim = z.object({ points: z.number(), rationale: z.string(), findingIds: z.array(z.string()) });
const QualifySchema = z.object({
  icpFit: Dim,
  need: Dim,
  timing: Dim,
  commercial: Dim,
  whyThem: z.string(),
  whyNow: z.string(),
  whyProposition: z.string(),
});

/**
 * Score a prospect. With `apply: false` (re-validation before a follow-up) the
 * score is recorded but the prospect's status is left for the caller to decide.
 */
export async function qualifyProspect(
  deps: { repo: Repo; llm: Llm; threshold: number; suspendedSignals?: string[] },
  prospectId: string,
  opts: { apply: boolean } = { apply: true },
): Promise<{ status: Prospect["status"]; reason: string }> {
  const { repo, llm } = deps;
  const prospect = repo.prospect(prospectId)!;
  const profile = repo.profile(prospect.opcoId)!;
  const exclusion = matchExclusion(prospect, profile);
  if (exclusion) {
    const reason = `Excluded (${exclusion.kind}): ${exclusion.reason}`;
    if (opts.apply) repo.setProspectStatus(prospectId, "REJECTED", reason);
    return { status: "REJECTED", reason };
  }
  const findings = repo.findings(prospectId);
  const contact = prospect.contactId ? repo.contact(prospect.contactId) : null;
  const out = await llm.run({
    task: "prospect_qualification",
    effort: "high",
    system: `You are the Qualification Agent. Score honestly against the weights: ICP fit 30, current need/trigger 30, timing 10, commercial potential 10 (buyer fit and evidence quality are computed separately). Cite finding ids for every point awarded. A company is never qualified merely for being in the target sector. Points without cited, verified findings are discarded.`,
    prompt: `Company: ${prospect.name} (${prospect.domain})\nAttributes: ${JSON.stringify(prospect.attributes)}\nProposition: ${profile.proposition.text}\nICP: ${JSON.stringify(profile.icp)}\nSignals: ${profile.signals
      .map((s) => `${s.id}: ${s.name}`)
      .join("; ")}\nContact: ${contact ? `${contact.name}, ${contact.title}` : "none identified"}\n\nFindings:\n${findings
      .map((f) => `- [${f.id}] ${f.kind} | ${f.status}${f.signalId ? ` | signal ${f.signalId}` : ""}${f.observedAt ? ` | ${f.observedAt.slice(0, 10)}` : ""} | ${f.statement}`)
      .join("\n")}\n\nAlso write, in one or two plain sentences each: why this company, why now, and why this proposition.`,
    context: { prospect, findings, contact },
    schema: QualifySchema,
  });
  const assessment: Assessment = { icpFit: out.icpFit, need: out.need, timing: out.timing, commercial: out.commercial };
  const card = scoreProspect({
    assessment,
    findings,
    sources: (id: string) => repo.source(id) as Source | undefined,
    contact,
    profile,
    attributes: prospect.attributes,
    now: repo.clock.now(),
    threshold: deps.threshold,
    suspendedSignals: deps.suspendedSignals,
  });
  const decision = decideQualification({ card, exclusion: null, conflicts: prospect.conflicts });
  repo.updateProspect(prospectId, { score: card, whyThem: out.whyThem, whyNow: out.whyNow, whyProposition: out.whyProposition });
  if (opts.apply) repo.setProspectStatus(prospectId, decision.status, decision.reason);
  else repo.event("prospect.revalidated", `${decision.status}: ${decision.reason}`, { opcoId: prospect.opcoId, prospectId });
  return decision;
}
