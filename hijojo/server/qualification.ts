// Qualification. The Qualification Agent proposes points with reasons and the
// findings behind them; this module decides what those points are worth. It is
// deterministic so the score cannot be talked up.

import type {
  BuyerRoleKind,
  BuyerRoles,
  Contact,
  Exclusion,
  Finding,
  Icp,
  ProspectAttributes,
  ProspectingProfile,
  ProspectStatus,
  ScoreCard,
  ScoreDimension,
  ScoreKey,
  Source,
} from "../shared/types";
import { SCORE_WEIGHTS } from "../shared/types";
import { daysBetween } from "./clock";
import { normalise } from "./evidence";

export const DEFAULT_THRESHOLD = 80;

/** The threshold can be raised by an administrator; it can never be weakened. */
export function effectiveThreshold(configured: number | undefined | null): number {
  if (configured == null || !Number.isFinite(configured)) return DEFAULT_THRESHOLD;
  return Math.min(100, Math.max(DEFAULT_THRESHOLD, Math.round(configured)));
}

export type AssessedKey = Exclude<ScoreKey, "buyer" | "evidence">;
export type Assessment = Record<AssessedKey, { points: number; rationale: string; findingIds: string[] }>;

// ---- ICP --------------------------------------------------------------------

type Match = "match" | "mismatch" | "unknown";

function textMatches(value: string, options: string[]): boolean {
  const v = normalise(value);
  return options.some((o) => {
    const n = normalise(o);
    return n.length > 0 && (v.includes(n) || n.includes(v));
  });
}

export function icpMatch(a: ProspectAttributes, icp: Icp): { sector: Match; size: Match; geography: Match; cap: number; reasons: string[] } {
  const reasons: string[] = [];
  const sector: Match = !a.sector || icp.sectors.length === 0 ? "unknown" : textMatches(a.sector, [...icp.sectors, ...icp.subsectors]) ? "match" : "mismatch";
  let size: Match = "unknown";
  if (a.employees != null && (icp.employeeMin != null || icp.employeeMax != null)) {
    size = (icp.employeeMin == null || a.employees >= icp.employeeMin) && (icp.employeeMax == null || a.employees <= icp.employeeMax) ? "match" : "mismatch";
  }
  const geography: Match = !a.geography || icp.geographies.length === 0 ? "unknown" : textMatches(a.geography, icp.geographies) ? "match" : "mismatch";

  let cap: number = SCORE_WEIGHTS.icpFit;
  if (sector === "mismatch") (cap = 0), reasons.push(`Sector "${a.sector}" is outside the ICP`);
  if (size === "mismatch") (cap = Math.min(cap, 15)), reasons.push(`${a.employees} employees is outside the ICP range`);
  if (geography === "mismatch") (cap = Math.min(cap, 10)), reasons.push(`Geography "${a.geography}" is outside the ICP`);
  const unknowns = [sector, size, geography].filter((m) => m === "unknown").length;
  if (unknowns > 0) (cap = Math.min(cap, SCORE_WEIGHTS.icpFit - 5 * unknowns)), reasons.push(`${unknowns} ICP attribute(s) unconfirmed`);
  return { sector, size, geography, cap: Math.max(0, cap), reasons };
}

// ---- exclusions -------------------------------------------------------------

export function bareDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

export function matchExclusion(
  p: { name: string; domain: string; attributes: ProspectAttributes },
  profile: Pick<ProspectingProfile, "exclusions">,
): Exclusion | null {
  const domain = bareDomain(p.domain);
  for (const x of profile.exclusions) {
    const v = normalise(x.value);
    if (x.kind === "domain" && (domain === bareDomain(x.value) || domain.endsWith("." + bareDomain(x.value)))) return x;
    if (x.kind === "name" && normalise(p.name) === v) return x;
    if (x.kind === "sector" && p.attributes.sector && normalise(p.attributes.sector).includes(v)) return x;
  }
  return null;
}

// ---- buyer roles ------------------------------------------------------------

const ABBREVIATIONS: Record<string, string> = {
  ceo: "chief executive officer",
  coo: "chief operating officer",
  cfo: "chief financial officer",
  cto: "chief technology officer",
  cio: "chief information officer",
  ciso: "chief information security officer",
  cro: "chief revenue officer",
  cmo: "chief marketing officer",
  md: "managing director",
  vp: "vice president",
  it: "it",
  ops: "operations",
};
const JUNIOR = /\b(intern|internship|trainee|graduate|student|apprentice|junior|assistant|placement)\b/i;
const TITLE_STOP = new Set(["of", "and", "the", "&", "for", "group", "global", "uk", "senior"]);

function titleTokens(t: string): Set<string> {
  const expanded = normalise(t)
    .replace(/[^a-z0-9& ]/g, " ")
    .split(/\s+/)
    .map((w) => ABBREVIATIONS[w] ?? w)
    .join(" ");
  return new Set(expanded.split(/\s+/).filter((w) => w && !TITLE_STOP.has(w)));
}

export function roleMatch(title: string, buyers: BuyerRoles): BuyerRoleKind | null {
  if (!title || JUNIOR.test(title)) return null;
  const have = titleTokens(title);
  for (const kind of ["economic", "operational", "technical", "influencer"] as const) {
    for (const role of buyers[kind]) {
      const need = [...titleTokens(role)];
      if (need.length > 0 && need.every((w) => have.has(w))) return kind;
    }
  }
  return null;
}

const BUYER_POINTS: Record<BuyerRoleKind, number> = { economic: 15, operational: 15, technical: 10, influencer: 6 };

// ---- scoring ----------------------------------------------------------------

export interface ScoreInput {
  assessment: Assessment;
  findings: Finding[];
  sources: Map<string, Source> | ((id: string) => Source | undefined);
  contact: Contact | null;
  profile: ProspectingProfile;
  attributes: ProspectAttributes;
  now: Date;
  threshold?: number;
  suspendedSignals?: string[];
}

function clamp(n: number, max: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

export function scoreProspect(input: ScoreInput): ScoreCard {
  const { assessment, profile, now } = input;
  const byId = new Map(input.findings.map((f) => [f.id, f]));
  const signalIds = new Set(profile.signals.map((s) => s.id));
  const suspended = new Set(input.suspendedSignals ?? []);
  const notes: string[] = [];

  const cited = (ids: string[]) => ids.map((id) => byId.get(id)).filter((f): f is Finding => !!f);
  const facts = (fs: Finding[]) => fs.filter((f) => f.status === "FACT" && f.evidence.length > 0);

  const dims = {} as Record<ScoreKey, ScoreDimension>;

  // ICP fit: needs verified findings; capped by what the attributes support.
  {
    const a = assessment.icpFit;
    const fs = cited(a.findingIds);
    const icp = icpMatch(input.attributes, profile.icp);
    let cap = icp.cap;
    if (facts(fs).length === 0) cap = fs.some((f) => f.status === "INFERENCE") ? Math.min(cap, 15) : 0;
    const points = clamp(Math.min(a.points, cap), SCORE_WEIGHTS.icpFit);
    if (points < a.points) notes.push(`ICP fit held to ${points}: ${icp.reasons.join("; ") || "insufficient verified evidence"}`);
    dims.icpFit = { points, max: SCORE_WEIGHTS.icpFit, rationale: a.rationale, findingIds: fs.map((f) => f.id) };
  }

  // Current need: only a verified trigger or need tied to one of the profile's signals.
  const triggers = facts(cited(assessment.need.findingIds)).filter(
    (f) => (f.kind === "trigger" || f.kind === "need") && f.signalId && signalIds.has(f.signalId) && !suspended.has(f.signalId),
  );
  {
    const a = assessment.need;
    const points = triggers.length ? clamp(a.points, SCORE_WEIGHTS.need) : 0;
    if (!triggers.length && a.points > 0) notes.push("Need scored 0: no verified trigger tied to a buying signal");
    dims.need = { points, max: SCORE_WEIGHTS.need, rationale: a.rationale, findingIds: triggers.map((f) => f.id) };
  }

  // Buyer fit is decided by the contact's role, not by opinion.
  {
    const kind = input.contact ? roleMatch(input.contact.title, profile.buyers) : null;
    const points = kind ? BUYER_POINTS[kind] : 0;
    const rationale = input.contact
      ? kind
        ? `${input.contact.name}, ${input.contact.title}: ${kind} buyer`
        : `${input.contact.name}, ${input.contact.title}: not a profile buyer role`
      : "No decision-maker identified";
    dims.buyer = { points, max: SCORE_WEIGHTS.buyer, rationale, findingIds: [] };
  }

  // Timing: the freshness of the trigger caps it.
  {
    const a = assessment.timing;
    const timed = facts(cited(a.findingIds)).filter((f) => f.kind === "trigger" && f.signalId && !suspended.has(f.signalId));
    let cap = 0;
    for (const f of timed) {
      const age = f.observedAt ? daysBetween(f.observedAt, now) : null;
      const c = age == null ? 3 : age <= 90 ? 10 : age <= 180 ? 5 : 0;
      cap = Math.max(cap, c);
    }
    const points = clamp(Math.min(a.points, cap), SCORE_WEIGHTS.timing);
    if (points < a.points) notes.push(`Timing held to ${points} by the age of the trigger`);
    dims.timing = { points, max: SCORE_WEIGHTS.timing, rationale: a.rationale, findingIds: timed.map((f) => f.id) };
  }

  // Commercial potential.
  {
    const a = assessment.commercial;
    const fs = cited(a.findingIds);
    const cap = facts(fs).length ? SCORE_WEIGHTS.commercial : fs.some((f) => f.status === "INFERENCE") ? 5 : 0;
    const points = clamp(Math.min(a.points, cap), SCORE_WEIGHTS.commercial);
    dims.commercial = { points, max: SCORE_WEIGHTS.commercial, rationale: a.rationale, findingIds: fs.map((f) => f.id) };
  }

  // Evidence quality: distinct verified sources behind what was cited.
  const allCited = new Set([...dims.icpFit.findingIds, ...dims.need.findingIds, ...dims.timing.findingIds, ...dims.commercial.findingIds]);
  const citedFindings = cited([...allCited]);
  const distinctSources = new Set(facts(citedFindings).flatMap((f) => f.evidence.map((e) => e.sourceId)));
  const lookup = (id: string) => (typeof input.sources === "function" ? input.sources(id) : input.sources.get(id));
  const known = [...distinctSources].filter((id) => lookup(id));
  {
    const n = known.length;
    const points = n >= 3 ? 5 : n === 2 ? 3 : n === 1 ? 1 : 0;
    dims.evidence = { points, max: SCORE_WEIGHTS.evidence, rationale: `${n} independent source(s)`, findingIds: [] };
  }

  const total = (Object.keys(SCORE_WEIGHTS) as ScoreKey[]).reduce((s, k) => s + dims[k].points, 0);
  const threshold = effectiveThreshold(input.threshold);
  const factShare = citedFindings.length ? facts(citedFindings).length / citedFindings.length : 0;
  const confidence = Math.round(100 * factShare * Math.min(1, known.length / 3));

  return { dimensions: dims, total, threshold, passed: total >= threshold, confidence, notes };
}

export function decideQualification(input: {
  card: ScoreCard;
  exclusion: Exclusion | null;
  conflicts: string[];
}): { status: ProspectStatus; reason: string } {
  if (input.exclusion) return { status: "REJECTED", reason: `Excluded (${input.exclusion.kind}): ${input.exclusion.reason}` };
  if (input.conflicts.length) return { status: "RESEARCHING", reason: `Conflicting data to resolve: ${input.conflicts.join("; ")}` };
  if (!input.card.passed) {
    return { status: "REJECTED", reason: `Scored ${input.card.total}/100, below the ${input.card.threshold} threshold` };
  }
  return { status: "QUALIFIED", reason: `Scored ${input.card.total}/100 (confidence ${input.card.confidence}%)` };
}
