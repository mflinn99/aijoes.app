// Understand the OpCo, then turn that understanding into a Prospecting Profile.
// Two model calls: analysis (claims with evidence), then the profile built only
// from settled claims, so a downgraded claim cannot leak into targeting.

import { z } from "zod/v4";
import type { Repo } from "../repo";
import { newId } from "../repo";
import type { Fetcher } from "../research/fetcher";
import { sourceBlock, UNTRUSTED_NOTICE, type Llm } from "../llm/client";
import { hashText, settleStatus } from "../evidence";
import { bareDomain } from "../qualification";
import { ANALYSIS_FIELDS, type Claim, type Epistemic, type Exclusion, type ProfileItem, type ProspectingProfile } from "../../shared/types";
import { EpistemicSchema, EvidenceSchema, pageUrl, retrieve } from "./common";

const OPCO_PATHS = ["/", "/about", "/about-us", "/pricing", "/product", "/products", "/solutions", "/services", "/customers", "/case-studies"];

const AnalysisSchema = z.object({
  claims: z.array(
    z.object({
      key: z.string(),
      field: z.enum(ANALYSIS_FIELDS),
      statement: z.string(),
      status: EpistemicSchema,
      evidence: z.array(EvidenceSchema),
      basis: z.string().nullable(),
    }),
  ),
});

const Item = z.object({ text: z.string(), claimKeys: z.array(z.string()) });
const ProfileSchema = z.object({
  proposition: Item,
  problem: Item,
  usp: Item,
  cost: Item,
  icp: z.object({
    sectors: z.array(z.string()),
    subsectors: z.array(z.string()),
    geographies: z.array(z.string()),
    employeeMin: z.number().nullable(),
    employeeMax: z.number().nullable(),
    revenue: z.string().nullable(),
    technology: z.array(z.string()),
    maturity: z.string().nullable(),
    ownership: z.array(z.string()),
    growth: z.string().nullable(),
    regulatory: z.array(z.string()),
    other: z.array(z.string()),
  }),
  buyers: z.object({
    economic: z.array(z.string()),
    operational: z.array(z.string()),
    technical: z.array(z.string()),
    influencer: z.array(z.string()),
  }),
  signals: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string(), whyItMatters: z.string(), keywords: z.array(z.string()) }),
  ),
  exclusions: z.array(z.object({ kind: z.enum(["domain", "name", "sector", "rule"]), value: z.string(), reason: z.string() })),
});

const ANALYST_SYSTEM = `You analyse a company (an AIGoGo OpCo) so that it can be sold precisely to the right buyers.
${UNTRUSTED_NOTICE}
Classify every statement:
- FACT: directly supported. Give at least one exact quotation (copied character for character) from a source, with its source id.
- INFERENCE: reasonably inferred. Give the basis.
- UNKNOWN: needs confirmation. Say what is unknown.
Never present a marketing claim, statistic, customer name or award as FACT unless a source states it. Record unsupported claims you find on the site under "weaknesses". Quotations are checked against the stored text; any that do not match exactly are discarded.`;

const PROFILE_SYSTEM = `You turn an evidenced analysis of a company into a tight Prospecting Profile: what exactly is sold, the identifiable problem, a narrow ICP, buyer roles (economic buyer, operational sponsor, technical stakeholder, influencer), observable buying signals specific to this proposition, and companies that must not be approached.
Use only the claims provided, citing their keys. Prefer a narrow ICP to a broad one: twenty excellent prospects beat two thousand mediocre ones. Buying signals must be observable in public sources (recruitment, expansion, acquisition, leadership change, regulatory pressure, technology change, funding and so on) and specific to this proposition. Give each signal a short kebab-case id.`;

export interface OpcoDeps {
  repo: Repo;
  llm: Llm;
  fetcher: Fetcher;
}

function itemFrom(item: { text: string; claimKeys: string[] }, byKey: Map<string, Claim>): ProfileItem {
  const claims = item.claimKeys.map((k) => byKey.get(k)).filter((c): c is Claim => !!c);
  const status: Epistemic = claims.some((c) => c.status === "FACT") ? "FACT" : claims.some((c) => c.status === "INFERENCE") ? "INFERENCE" : "UNKNOWN";
  return { text: item.text, status, claimIds: claims.map((c) => c.id) };
}

export async function analyseOpco(deps: OpcoDeps, opcoId: string): Promise<ProspectingProfile | null> {
  const { repo, llm, fetcher } = deps;
  const opco = repo.opco(opcoId);
  if (!opco) throw new Error(`No OpCo ${opcoId}`);
  repo.setOpcoStatus(opcoId, "ANALYSING");
  const hasWebsite = opco.website.trim() !== "";
  repo.event("opco.analysis.started", hasWebsite ? opco.website : "From supplied documents only (no website)", { opcoId });

  // A sale mandate or an unlaunched OpCo may have no website; documents are then the only source.
  const fetched = hasWebsite
    ? await retrieve(repo, fetcher, OPCO_PATHS.map((path) => ({ url: pageUrl(opco.website, path), kind: "opco-site" as const })), { opcoId })
    : { sources: [], failures: [] as string[] };
  const sources = [...fetched.sources];
  if (opco.notes.trim()) {
    sources.push(
      repo.addSource(
        { url: "supplied:notes", kind: "opco-document", title: "Supplied information", retrievedAt: repo.now(), publishedAt: null, contentHash: hashText(opco.notes), text: opco.notes },
        { opcoId },
      ),
    );
  }
  const failure = hasWebsite
    ? fetched.sources.length
      ? null
      : `Could not retrieve the website: ${fetched.failures.slice(0, 3).join("; ")}`
    : sources.length
      ? null
      : "No website and no supporting document to analyse";
  if (failure) {
    repo.setOpcoStatus(opcoId, "FAILED", failure);
    repo.event("opco.analysis.failed", failure, { opcoId });
    return null;
  }

  const byId = new Map(sources.map((s) => [s.id, s]));
  const analysis = await llm.run({
    task: "opco_analysis",
    system: ANALYST_SYSTEM,
    effort: "high",
    prompt: `OpCo: ${opco.name}\nWebsite: ${opco.website || "none (analyse the supplied documents)"}\n\nAnalyse: proposition, products/services, problem solved, target customer, likely buyer, business benefit, USP, differentiation, commercial model, indicative customer cost, implementation requirements, proof/evidence available, strongest sales arguments, weaknesses or unsupported claims.\n\n${sources.map((s) => sourceBlock(s)).join("\n\n")}`,
    context: { opco, sources: sources.map((s) => ({ id: s.id, url: s.url, text: s.text })) },
    schema: AnalysisSchema,
  });

  const byKey = new Map<string, Claim>();
  const claims: Claim[] = analysis.claims.map((c) => {
    const settled = settleStatus({ status: c.status, evidence: c.evidence, basis: c.basis }, byId);
    const claim: Claim = { id: newId("cl"), field: c.field, statement: c.statement, ...settled };
    byKey.set(c.key, claim);
    return claim;
  });
  repo.replaceClaims(opcoId, claims);
  const downgraded = claims.filter((c) => c.note).length;
  repo.event("opco.analysis.done", `${claims.length} claims (${claims.filter((c) => c.status === "FACT").length} fact, ${downgraded} downgraded)`, { opcoId });

  const draft = await llm.run({
    task: "opco_profile",
    system: PROFILE_SYSTEM,
    effort: "high",
    prompt: `OpCo: ${opco.name}${opco.website ? ` (${opco.website})` : ""}\n\nSettled claims:\n${[...byKey]
      .map(([k, c]) => `- [${k}] ${c.field} | ${c.status} | ${c.statement}${c.basis ? ` (basis: ${c.basis})` : ""}`)
      .join("\n")}`,
    context: { opco, claims: [...byKey].map(([key, c]) => ({ key, ...c })) },
    schema: ProfileSchema,
  });

  // Never prospect an AIGoGo company, this one included.
  const ownDomains = repo.opcos().map((o) => bareDomain(o.website)).filter(Boolean);
  const exclusions: Exclusion[] = [
    ...ownDomains.map((d) => ({ kind: "domain" as const, value: d, reason: "AIGoGo company" })),
    ...draft.exclusions.filter((x) => !(x.kind === "domain" && ownDomains.includes(bareDomain(x.value)))),
  ];

  const profile = {
    opcoId,
    proposition: itemFrom(draft.proposition, byKey),
    problem: itemFrom(draft.problem, byKey),
    usp: itemFrom(draft.usp, byKey),
    cost: itemFrom(draft.cost, byKey),
    icp: draft.icp,
    buyers: draft.buyers,
    signals: draft.signals.map((s) => ({ ...s, id: s.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-") })),
    exclusions,
    complete: true,
    gaps: [] as string[],
  };
  if (profile.proposition.status !== "FACT") profile.gaps.push("The proposition is not supported by evidence");
  if (profile.problem.status === "UNKNOWN") profile.gaps.push("The problem solved is unknown");
  if (!profile.icp.sectors.length) profile.gaps.push("The ICP names no sector");
  if (!profile.buyers.economic.length && !profile.buyers.operational.length) profile.gaps.push("No economic buyer or operational sponsor identified");
  if (!profile.signals.length) profile.gaps.push("No buying signals defined");
  profile.complete = profile.gaps.length === 0;

  const saved = repo.saveProfile(profile);
  repo.setOpcoStatus(opcoId, saved.complete ? "PROFILED" : "INCOMPLETE", saved.complete ? null : saved.gaps.join("; "));
  repo.event("opco.profile.saved", saved.complete ? `Profile v${saved.version}` : `Profile v${saved.version} incomplete: ${saved.gaps.join("; ")}`, { opcoId });
  return saved;
}
