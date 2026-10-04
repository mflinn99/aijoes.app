// Independent QA. It does not take the Communication Agent's word for anything:
// it rebuilds the facts from the database, re-verifies every quotation against
// the stored source, and judges the rendered message. Only PASS permits a send.

import type {
  Claim,
  Communication,
  Contact,
  Finding,
  InboundMessage,
  Opco,
  Prospect,
  ProspectingProfile,
  QaCheck,
  QaScope,
  QaVerdict,
  RelevanceAnswers,
  Source,
} from "../../shared/types";
import type { Config } from "../config";
import type { OutboundRow } from "../repo";
import { contentWords, normalise, verifyQuote } from "../evidence";
import { daysBetween } from "../clock";
import { bareDomain, matchExclusion, roleMatch } from "../qualification";
import { optOutLine } from "../agents/compose";

export interface QaContext {
  comm: Communication;
  opco: Opco;
  otherOpcoNames: string[];
  prospect: Prospect;
  profile: ProspectingProfile;
  contact: Contact;
  findings: Finding[];
  sources: (id: string) => Source | undefined;
  claims: Claim[];
  suppressed: { suppressed: boolean; reason: string | null };
  history: {
    /** Outbound rows for this prospect or to this address, any OpCo. */
    outbound: OutboundRow[];
    /** Anything received from this address or company. */
    inbound: InboundMessage[];
    /** The introduction, when judging a follow-up, and the findings it cited. */
    intro: Communication | null;
    introFindings: Finding[];
    /** Bodies of this OpCo's other messages, to catch templated copy. */
    otherBodies: string[];
    /** Messages to this company from other OpCos in the cooldown window. */
    domainOutboundOtherOpcos: OutboundRow[];
  };
  now: Date;
  config: Config;
}

export interface QaResult {
  verdict: QaVerdict;
  checks: QaCheck[];
  relevance: RelevanceAnswers;
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/gi;
// "Leading" only as an adjective ("the UK's leading platform"), not as a verb ("leading the move").
const SUPERLATIVE_RE =
  /\b((?:the|a|an|our|its|[a-z]+'s)\s+(?:market[- ]|industry[- ])?leading|leading (?:provider|platform|supplier|company|solution|vendor|name)s?|market[- ]leading|industry[- ]leading|best|#1|number one|world[- ]class|unrivall?ed|unmatched|fastest|cheapest|award[- ]winning|proven|revolutionary|guaranteed)\b/gi;
const COMMITMENT_RE =
  /\b(discount(?:s|ed)?|\d+\s?% off|special offer|free trial|trial period|guarantee[sd]?|contracts?|binding|terms and conditions|money[- ]back|price[sd]? at|pricing starts|per month|a month|per year|we will (?:deliver|commit))\b|[£$€]\s?\d/gi;
const GENERIC_RE =
  /\b(i hope (?:this|you)[^.]*(?:well|great)|innovative|cutting[- ]edge|game[- ]chang\w*|revolutioni[sz]\w*|transform(?:ation|ational|ing)? your|synerg\w*|leverage|best[- ]in[- ]class|companies like yours|businesses like yours|quick question|touch base|circle back|reach(?:ing)? out to introduce|i wanted to introduce|we help (?:companies|organisations|organizations|businesses))\b/gi;
const STALE_FOLLOWUP_RE = /\b(just following up|following up on my (?:previous|last|earlier)|circling back|bumping (?:this|my)|just checking in|did you (?:get|see) my (?:last|previous))\b/i;
const CTA_RE = /\?|\b(reply|book|let me know|worth a|would it|shall i|could we|happy to send)\b/i;
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

function numbersIn(text: string): string[] {
  return (text.match(NUMBER_RE) ?? []).map((n) => n.replace(/,/g, ""));
}

function trigrams(text: string): Set<string> {
  const w = contentWords(text);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

export function similarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

/** The copy the agent wrote, without the rendered greeting, link, signature and opt-out. */
function copyOf(c: Communication): string {
  return Object.values(c.sections).join("\n");
}

export function runQa(ctx: QaContext): QaResult {
  const { comm, contact, prospect, opco, profile, config } = ctx;
  const checks: QaCheck[] = [];
  const add = (name: string, passed: boolean, severity: "reject" | "rework", scope: QaScope, detail: string) =>
    checks.push({ name, passed, severity, scope, detail });

  const findingById = new Map(ctx.findings.map((f) => [f.id, f]));
  const cited = (section?: keyof Communication["sections"]) =>
    comm.evidence.filter((e) => !section || e.section === section).map((e) => findingById.get(e.findingId));
  const facts = (fs: (Finding | undefined)[]) => fs.filter((f): f is Finding => !!f && f.status === "FACT" && f.prospectId === prospect.id);
  const copy = copyOf(comm);

  // ---- recipient ------------------------------------------------------------
  const email = contact.email.trim().toLowerCase();
  const validEmail = EMAIL_RE.test(email) && contact.emailStatus !== "invalid" && contact.emailStatus !== "bounced";
  add("recipient.valid", validEmail, "reject", "research", validEmail ? email : `Address ${email} is ${contact.emailStatus === "verified" ? "malformed" : contact.emailStatus}`);
  const verified = contact.emailStatus === "verified";
  add("recipient.verified", verified, "rework", "research", verified ? "Deliverability verified" : `Address status is ${contact.emailStatus}; verify before sending`);

  const domain = bareDomain(prospect.domain);
  const emailDomain = email.split("@")[1] ?? "";
  const sameCompany = (emailDomain === domain || emailDomain.endsWith("." + domain)) && bareDomain(contact.employerDomain) === domain && contact.prospectId === prospect.id;
  add("recipient.identity", sameCompany, "reject", "research", sameCompany ? `${email} is at ${domain}` : `${email} is not at ${prospect.name} (${domain})`);

  const role = roleMatch(contact.title, profile.buyers);
  add("recipient.relevant", !!role, "reject", "research", role ? `${contact.title} is a ${role} buyer` : `${contact.title} is not a relevant decision-maker for this proposition`);

  // ---- status of the prospect and of the address ------------------------------
  add("suppression", !ctx.suppressed.suppressed, "reject", "prospect", ctx.suppressed.suppressed ? `Suppressed: ${ctx.suppressed.reason}` : "Not suppressed");
  const exclusion = matchExclusion(prospect, profile);
  add("exclusion", !exclusion, "reject", "prospect", exclusion ? `Excluded: ${exclusion.reason}` : "Not excluded");
  add("conflicts", prospect.conflicts.length === 0, "reject", "research", prospect.conflicts.length ? prospect.conflicts.join("; ") : "No conflicting data");

  const responded = ctx.history.inbound.length > 0;
  add(
    "history.previousResponse",
    !responded,
    "reject",
    "prospect",
    responded ? `Already received ${ctx.history.inbound.length} message(s) from ${prospect.name}; a human owns this conversation` : "No previous response",
  );

  const live = (o: OutboundRow) => o.status === "SENT" || o.status === "SENDING" || o.status === "UNCERTAIN";
  const mine = ctx.history.outbound.filter((o) => o.prospectId === prospect.id && live(o));
  const dupReasons: string[] = [];
  if (comm.kind === "intro" && mine.some((o) => o.kind === "intro")) dupReasons.push("An introduction has already been sent");
  if (comm.kind === "followup") {
    if (!mine.some((o) => o.kind === "intro" && o.status === "SENT")) dupReasons.push("No introduction was sent, so there is nothing to follow up");
    if (mine.some((o) => o.kind === "followup")) dupReasons.push("The one follow-up has already been sent");
  }
  const cooldownStart = new Date(ctx.now.getTime() - config.contactCooldownDays * 86_400_000).toISOString();
  const toPerson = ctx.history.outbound.filter((o) => o.prospectId !== prospect.id && o.toEmail === email && live(o) && o.createdAt >= cooldownStart);
  if (toPerson.length) dupReasons.push(`${email} was contacted for another prospect within ${config.contactCooldownDays} days`);
  if (ctx.history.domainOutboundOtherOpcos.length) dupReasons.push(`${prospect.name} is already being contacted by another AIGoGo company`);
  add("history.duplicate", dupReasons.length === 0, "reject", "prospect", dupReasons.join("; ") || "No duplicate contact");

  // ---- evidence ---------------------------------------------------------------
  const citedAll = cited();
  const missing = comm.evidence.filter((e) => !findingById.get(e.findingId)).map((e) => e.findingId);
  const notFact = citedAll.filter((f) => f && f.status !== "FACT").map((f) => f!.id);
  const wrongProspect = citedAll.filter((f) => f && f.prospectId !== prospect.id).map((f) => f!.id);
  const unverifiable = facts(citedAll).filter((f) => !f.evidence.length || !f.evidence.every((e) => verifyQuote(e, ctx.sources))).map((f) => f.id);
  const evidenceOk = comm.evidence.length > 0 && !missing.length && !notFact.length && !wrongProspect.length && !unverifiable.length;
  add(
    "evidence.verified",
    evidenceOk,
    "reject",
    "communication",
    evidenceOk
      ? `${comm.evidence.length} citation(s) re-verified against stored sources`
      : [
          comm.evidence.length ? "" : "No findings cited",
          missing.length ? `unknown findings ${missing.join(", ")}` : "",
          notFact.length ? `not verified FACT: ${notFact.join(", ")}` : "",
          wrongProspect.length ? `belong to another prospect: ${wrongProspect.join(", ")}` : "",
          unverifiable.length ? `quotation no longer matches source: ${unverifiable.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; "),
  );

  const staleSources: string[] = [];
  for (const f of facts(citedAll)) {
    for (const e of f.evidence) {
      const s = ctx.sources(e.sourceId);
      if (s && daysBetween(s.retrievedAt, ctx.now) > config.evidenceMaxAgeDays) staleSources.push(s.url);
    }
    if (f.kind === "trigger" && f.observedAt && daysBetween(f.observedAt, ctx.now) > config.triggerMaxAgeDays) {
      staleSources.push(`trigger "${f.statement}" dated ${f.observedAt.slice(0, 10)}`);
    }
  }
  add("evidence.fresh", staleSources.length === 0, "rework", "research", staleSources.length ? `Refresh needed: ${[...new Set(staleSources)].join("; ")}` : "Evidence is current");

  // ---- the six relevance questions ------------------------------------------------
  const evidenceWords = (fs: Finding[]) => new Set(fs.flatMap((f) => [...contentWords(f.statement), ...f.evidence.flatMap((e) => contentWords(e.quote))]));
  const nameWords = new Set(contentWords(prospect.name));

  const themFacts = facts(cited("whyThem"));
  const themWords = contentWords(comm.sections.whyThem);
  const themOverlap = themWords.filter((w) => evidenceWords(themFacts).has(w) || nameWords.has(w));
  const whyCompanyOk = themFacts.length > 0 && (normalise(comm.sections.whyThem).includes(normalise(prospect.name)) || themOverlap.length >= 2);
  add(
    "relevance.whyCompany",
    whyCompanyOk,
    "reject",
    "communication",
    whyCompanyOk ? `Grounded in: ${themFacts.map((f) => f.statement).join("; ")}` : "The opening does not give an evidenced, specific reason for choosing this company",
  );

  const nowFacts = facts(cited("whyNow")).filter((f) => f.kind === "trigger" && f.signalId);
  add(
    "relevance.whyNow",
    nowFacts.length > 0,
    "reject",
    "communication",
    nowFacts.length ? `Trigger: ${nowFacts.map((f) => `${f.statement}${f.observedAt ? ` (${f.observedAt.slice(0, 10)})` : ""}`).join("; ")}` : "No verified trigger explains why now",
  );

  const claimById = new Map(ctx.claims.map((c) => [c.id, c]));
  const opcoClaims = comm.opcoClaimIds.map((id) => claimById.get(id));
  const whyOpcoOk = opcoClaims.length > 0 && opcoClaims.every((c) => c && c.status === "FACT") && comm.sections.proposition.trim().length > 0;
  add(
    "relevance.whyOpco",
    whyOpcoOk,
    "reject",
    "communication",
    whyOpcoOk
      ? `Proposition rests on: ${opcoClaims.map((c) => c!.statement).join("; ")}`
      : opcoClaims.length
        ? "The proposition relies on an OpCo claim that is not verified FACT"
        : "The proposition cites no verified OpCo claim",
  );

  const specificWords = new Set([...themOverlap, ...contentWords(comm.sections.whyNow).filter((w) => evidenceWords(nowFacts).has(w))]);
  const strip = (b: string) => b.replace(new RegExp(contact.name.split(/\s+/)[0], "gi"), "");
  const maxSim = Math.max(0, ...ctx.history.otherBodies.map((b) => similarity(strip(comm.body), b.replace(/^Hi [^,]+,/, ""))));
  const specificOk = specificWords.size >= 3 && maxSim < 0.6;
  add(
    "relevance.specific",
    specificOk,
    "rework",
    "communication",
    `${specificWords.size} recipient-specific term(s)${specificWords.size ? ` (${[...specificWords].slice(0, 6).join(", ")})` : ""}; highest similarity to another message ${(maxSim * 100).toFixed(0)}%`,
  );

  // ---- claims ----------------------------------------------------------------------
  const supportText = normalise(
    [
      ...facts(citedAll).flatMap((f) => f.evidence.map((e) => ctx.sources(e.sourceId)?.text ?? "")),
      ...opcoClaims.flatMap((c) => (c ? c.evidence.map((e) => ctx.sources(e.sourceId)?.text ?? e.quote) : [])),
      prospect.name,
      opco.name,
    ].join("\n"),
  );
  const supportNumbers = new Set(numbersIn(supportText));
  const unsupportedNumbers = numbersIn(copy).filter((n) => !supportNumbers.has(n));
  const superlatives = [...copy.matchAll(SUPERLATIVE_RE)].map((m) => m[0]).filter((w) => !supportText.includes(normalise(w)));
  const claimsOk = !unsupportedNumbers.length && !superlatives.length;
  add(
    "claims.supported",
    claimsOk,
    "reject",
    "communication",
    claimsOk
      ? "Every figure and claim is in the cited evidence"
      : [unsupportedNumbers.length ? `unsupported figures: ${unsupportedNumbers.join(", ")}` : "", superlatives.length ? `unsupported claims: ${superlatives.join(", ")}` : ""]
          .filter(Boolean)
          .join("; "),
  );

  const commitments = [...copy.matchAll(COMMITMENT_RE)].map((m) => m[0]);
  add(
    "claims.noCommitments",
    commitments.length === 0,
    "reject",
    "communication",
    commitments.length ? `Outside the agentic boundary (pricing, terms or commitments): ${commitments.join(", ")}` : "No pricing, terms or commitments",
  );

  const generic = [...copy.matchAll(GENERIC_RE)].map((m) => m[0]);
  add("generic.language", generic.length === 0, "rework", "communication", generic.length ? `Generic sales language: ${generic.join(", ")}` : "No generic sales language");

  // ---- link, OpCo, format ----------------------------------------------------------
  const urls = (comm.body.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ""));
  const allowedHosts = new Set([bareDomain(opco.website), bareDomain(opco.introLink)]);
  const linkHost = bareDomain(comm.link);
  const linkOk = urls.length === 1 && urls[0] === comm.link && comm.link === opco.introLink && allowedHosts.has(linkHost);
  add(
    "link.correct",
    linkOk,
    "reject",
    "communication",
    linkOk ? comm.link : `Expected exactly ${opco.introLink}; found ${urls.length ? urls.join(", ") : "no link"}`,
  );

  const others = ctx.otherOpcoNames.filter((n) => n && normalise(n) !== normalise(opco.name) && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(comm.body));
  const opcoOk = normalise(comm.body).includes(normalise(opco.name)) && others.length === 0;
  add("opco.correct", opcoOk, "reject", "communication", opcoOk ? `From ${opco.name}` : others.length ? `Names another OpCo: ${others.join(", ")}` : `Does not name ${opco.name}`);

  const words = comm.body.split(/\s+/).filter(Boolean).length;
  const maxWords = comm.kind === "intro" ? 180 : 160;
  const subjectOk = comm.subject.length >= 3 && comm.subject.length <= 80 && !/^(re|fw|fwd)\s*:/i.test(comm.subject);
  // Capitals for emphasis; a name the evidence itself writes in capitals (e.g. CHIEF) is fine.
  const evidenceRaw = [
    ...facts(citedAll).flatMap((f) => [f.statement, ...f.evidence.flatMap((e) => [e.quote, ctx.sources(e.sourceId)?.text ?? ""])]),
    ...opcoClaims.flatMap((c) => (c ? [c.statement, ...c.evidence.map((e) => e.quote)] : [])),
  ].join("\n");
  const shouting = (copy.match(/\b[A-Z]{5,}\b/g) ?? []).some((w) => !evidenceRaw.includes(w));
  const optOut = comm.body.includes(optOutLine(opco.name));
  const formatProblems = [
    words > maxWords ? `${words} words (limit ${maxWords})` : "",
    subjectOk ? "" : "subject is misleading or the wrong length",
    shouting ? "uses capitals for emphasis" : "",
    optOut ? "" : "missing the opt-out line",
  ].filter(Boolean);
  add("format", formatProblems.length === 0, "rework", "communication", formatProblems.join("; ") || `${words} words`);
  add("format.cta", CTA_RE.test(comm.sections.cta), "rework", "communication", CTA_RE.test(comm.sections.cta) ? comm.sections.cta : "No clear, low-friction call to action");

  if (comm.kind === "followup") {
    // Findings are re-created when a prospect is re-validated, so compare content, not ids.
    const usedQuotes = new Set(ctx.history.introFindings.flatMap((f) => f.evidence.map((e) => normalise(e.quote))));
    const usedIds = new Set((ctx.history.intro?.evidence ?? []).map((e) => e.findingId));
    const fresh = facts(citedAll).filter((f) => !usedIds.has(f.id) && f.evidence.some((e) => !usedQuotes.has(normalise(e.quote))));
    const stale = STALE_FOLLOWUP_RE.test(copy);
    const ok = fresh.length > 0 && !stale;
    add(
      "followup.addsValue",
      ok,
      "rework",
      "communication",
      ok ? `Adds: ${fresh.map((f) => f.statement).join("; ")}` : [fresh.length ? "" : "repeats the introduction's evidence", stale ? "contentless follow-up phrasing" : ""].filter(Boolean).join("; "),
    );
  }

  const failedChecks = checks.filter((c) => !c.passed);
  const verdict: QaVerdict = failedChecks.some((c) => c.severity === "reject") ? "REJECT" : failedChecks.length ? "REWORK" : "PASS";
  const pass = (n: string) => checks.find((c) => c.name === n)?.passed;
  const relevance: RelevanceAnswers = {
    whyCompany: pass("relevance.whyCompany") ? comm.sections.whyThem : null,
    whyPerson: role ? `${contact.name}, ${contact.title} (${role} buyer)` : null,
    whyNow: pass("relevance.whyNow") ? checks.find((c) => c.name === "relevance.whyNow")!.detail : null,
    whyOpco: pass("relevance.whyOpco") ? checks.find((c) => c.name === "relevance.whyOpco")!.detail : null,
    evidence: pass("evidence.verified")
      ? [...new Set(facts(citedAll).flatMap((f) => f.evidence.map((e) => ctx.sources(e.sourceId)?.url ?? e.sourceId)))].join(", ")
      : null,
    specific: pass("relevance.specific") ? checks.find((c) => c.name === "relevance.specific")!.detail : null,
  };
  return { verdict, checks, relevance };
}
