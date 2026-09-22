/**
 * Opportunity Hypothesis Engine — Directive Phase 5.
 *
 * "Do not generate generic sales leads. Generate evidence-backed opportunity
 * hypotheses... Reject weak hypotheses. Quality is more important than database
 * size."
 *
 * The rejection rules are the product here, not the generation. Anything can
 * emit a paragraph about a company; the value is in refusing to.
 */

import { randomUUID } from 'node:crypto';
import type { MspProfile, ServiceLine } from './profile';
import { serviceById, outreachSafeClaims } from './profile';
import { ARCHETYPES, type AccountScores, type ArchetypeMatch, type IcpContext } from './icp';
import type { EvidenceItem, GtmAccount, HypothesisQuality, OpportunityHypothesis } from './types';

/** The bar a hypothesis has to clear before anyone is contacted about it. */
export const THRESHOLDS = {
  /** Below this archetype fit there is no demonstrated need. */
  minFit: 0.45,
  /** Below this, we are guessing about the company itself. */
  minUnderstanding: 25,
  /** A hypothesis resting on fewer observations than this is a hunch. */
  minEvidenceItems: 2,
  /** Not worth a sales cycle. */
  minValueGbp: 8_000,
  /** Combined confidence floor for outreach. */
  minConfidenceForOutreach: 0.5,
} as const;

export interface RejectionReason {
  rule: string;
  detail: string;
}

/**
 * Every reason this hypothesis should not be acted on. An empty array is the
 * only thing that makes a hypothesis workable.
 */
export function evaluate(
  match: ArchetypeMatch,
  ctx: IcpContext,
  scores: AccountScores,
  account: GtmAccount,
  service: ServiceLine | undefined,
  valuePoint: number,
): RejectionReason[] {
  const reasons: RejectionReason[] = [];

  if (match.fit < THRESHOLDS.minFit) {
    reasons.push({ rule: 'min-fit', detail: `Archetype fit ${Math.round(match.fit * 100)}% is below the ${Math.round(THRESHOLDS.minFit * 100)}% needed to claim a demonstrated need.` });
  }
  if (ctx.understanding < THRESHOLDS.minUnderstanding) {
    reasons.push({ rule: 'min-understanding', detail: `Only ${ctx.understanding}% is known about this account. Research it before forming a commercial view.` });
  }
  if (match.evidence.length < THRESHOLDS.minEvidenceItems) {
    reasons.push({ rule: 'min-evidence', detail: `${match.evidence.length} observation(s) behind this; at least ${THRESHOLDS.minEvidenceItems} are needed. This is a hunch, not a hypothesis.` });
  }
  if (!service) {
    reasons.push({ rule: 'no-deliverable-service', detail: 'No Onward service that is currently deliverable maps to this archetype.' });
  } else if (service.deliveryCapacity === 'not-available') {
    reasons.push({ rule: 'not-deliverable', detail: `${service.name} cannot currently be delivered.` });
  }
  if (valuePoint < THRESHOLDS.minValueGbp) {
    reasons.push({ rule: 'min-value', detail: `Indicative value £${Math.round(valuePoint).toLocaleString('en-GB')} does not justify a sales cycle.` });
  }
  if (account.suppressed) {
    reasons.push({ rule: 'suppressed', detail: account.suppressReason ?? 'Account is suppressed.' });
  }
  if (scores.evidence.value < 0.3) {
    reasons.push({ rule: 'weak-evidence-score', detail: `Evidence score ${Math.round(scores.evidence.value * 100)}% — ${scores.evidence.summary}` });
  }

  return reasons;
}

function qualityFrom(reasons: RejectionReason[], match: ArchetypeMatch, scores: AccountScores): HypothesisQuality {
  if (reasons.length > 0) return 'rejected';
  const combined = (match.fit + scores.evidence.value + scores.timing.value) / 3;
  if (combined >= 0.7 && match.evidence.length >= 3) return 'strong';
  if (combined >= 0.5) return 'workable';
  return 'weak';
}

function valueFor(service: ServiceLine | undefined, scores: AccountScores): { low: number; high: number; point: number; basis: string; recurring: boolean } {
  if (!service) return { low: 0, high: 0, point: 0, basis: 'No deliverable service matched', recurring: false };

  const { typicalDealLowGbp: low, typicalDealHighGbp: high, recurring } = service.commercials;
  // Scale within the service's own range by how well the account fits, rather
  // than inventing a number outside what Onward actually sells at.
  const position = scores.value.value;
  const point = Math.round(low + (high - low) * position);

  return {
    low,
    high,
    point,
    basis:
      `${service.name} typically runs £${low.toLocaleString('en-GB')}–£${high.toLocaleString('en-GB')}` +
      `${recurring ? ` with roughly £${(service.commercials.typicalMonthlyGbp ?? 0).toLocaleString('en-GB')}/month recurring` : ''}. ` +
      `Positioned at ${Math.round(position * 100)}% of that range on account size and fit.`,
    recurring,
  };
}

function evidenceItems(match: ArchetypeMatch, ctx: IcpContext): EvidenceItem[] {
  const domain = (ctx.twin.domain.current?.value as string | undefined) ?? 'the company website';
  return match.evidence.map((statement) => ({
    statement,
    source: 'Company Twin (public web research)',
    locator: domain,
    confidence: ctx.understanding / 100,
  }));
}

export interface HypothesisInput {
  account: GtmAccount;
  ctx: IcpContext;
  scores: AccountScores;
  profile: MspProfile;
}

/**
 * Produce a hypothesis per matched archetype, then let the caller keep only the
 * ones that survive. Rejected hypotheses are retained with their reasons —
 * knowing why an account was passed over is worth as much as knowing why one
 * was chosen.
 */
export function generateHypotheses(input: HypothesisInput): OpportunityHypothesis[] {
  const { account, ctx, scores, profile } = input;
  const now = new Date().toISOString();
  const safe = outreachSafeClaims(profile);

  return scores.matches.map((match) => {
    const archetype = ARCHETYPES.find((a) => a.id === match.archetype)!;
    const services = match.serviceIds
      .map((id) => serviceById(profile, id))
      .filter((s): s is ServiceLine => Boolean(s) && s!.deliveryCapacity !== 'not-available');
    const service = services.sort((a, b) => b.commercials.typicalDealHighGbp - a.commercials.typicalDealHighGbp)[0];

    const value = valueFor(service, scores);
    const reasons = evaluate(match, ctx, scores, account, service, value.point);
    const quality = qualityFrom(reasons, match, scores);
    const evidence = evidenceItems(match, ctx);

    const aigogo = service?.aigogoExtensions ?? [];

    return {
      id: randomUUID(),
      accountId: account.id,
      archetype: match.archetype,
      serviceIds: service ? [service.id] : [],
      headline: service ? `${archetype.name} — ${service.name}` : archetype.name,

      whatIsHappening: match.evidence[0] ?? 'Nothing specific observed.',
      whyItMatters: whyItMatters(match.archetype, ctx),
      whatProblemMayExist: archetype.description,
      evidence,
      whatOnwardCouldDo: service
        ? `${service.name}: ${service.description}`
        : 'Nothing Onward currently delivers maps to this.',
      whatAigogoAdds: aigogo.length > 0
        ? `${aigogo.join(', ')} could extend this beyond what Onward delivers alone — though every AIGoGo capability is currently simulated, so this is a roadmap statement rather than a deliverable today.`
        : null,
      whoOwnsTheProblem: archetype.buyerRoles,
      whyContactNow: scores.timing.summary,
      commercialValue: value,
      whatToSay: whatToSay(match, service, safe),
      nextAction: nextAction(quality, scores),

      confidence: Math.round(((match.fit + scores.evidence.value + scores.icp.value) / 3) * 100) / 100,
      quality,
      status: quality === 'rejected' ? 'discarded' : 'draft',
      rejectionReasons: reasons.map((r) => `${r.rule}: ${r.detail}`),
      createdAt: now,
      updatedAt: now,
    } satisfies OpportunityHypothesis;
  });
}

function whyItMatters(archetype: string, ctx: IcpContext): string {
  const size = ctx.employees ? `${ctx.employees} people` : 'a business of this size';
  switch (archetype) {
    case 'ma-change-event':
      return `An acquisition forces estate decisions on somebody else's timetable. Two of everything, one deadline, and usually nobody whose job it is to sort it out.`;
    case 'cyber-security':
      return `Certification is increasingly a condition of trading, not a nice-to-have. Losing a tender for want of Cyber Essentials costs more than the certification.`;
    case 'ps-augmentation':
      return `An IT firm that cannot staff what it sells either turns work away or delivers it badly. Both are expensive, and hiring takes months.`;
    case 'infrastructure-modernisation':
      return `Ageing infrastructure fails on its own schedule. The cost of the decision only goes up, and end-of-support dates do not move.`;
    case 'managed-it':
      return `At ${size}, informal IT support stops scaling. The symptom is usually people waiting, which nobody measures.`;
    case 'rapid-growth':
      return `Headcount growing faster than the platform underneath it is the most common cause of an IT estate that nobody can support.`;
    case 'public-sector':
      return `Framework routes mean a procurement path that does not require a full tender, which shortens everything.`;
    default:
      return `This is a recurring pattern in ${size} businesses, and it usually surfaces as cost or risk before anybody calls it a technology problem.`;
  }
}

function whatToSay(match: ArchetypeMatch, service: ServiceLine | undefined, safe: { accreditations: string[]; proofPoints: { claim: string }[] }): string {
  if (!service) return 'Nothing to say — no deliverable service matched.';

  const observation = match.evidence[0] ?? 'a pattern we see often';
  // Only claims cleared for outreach may be quoted. Unverified proof points are
  // deliberately absent rather than hedged.
  const proof = safe.proofPoints[0]?.claim;
  const creds = safe.accreditations.length > 0 ? ` We are ${safe.accreditations.slice(0, 2).join(' and ')}.` : '';

  return (
    `Lead with the observation, not the service: "${observation}". ` +
    `Then the consequence, then one question that is cheap for them to answer. ` +
    `Offer ${service.name} only if they engage.${creds}` +
    (proof ? ` Proof point available: ${proof}` : ' No proof point is cleared for use — do not quote results.')
  );
}

function nextAction(quality: HypothesisQuality, scores: AccountScores): string {
  if (quality === 'rejected') return 'No action. Recorded so the account is not re-picked for the same reason.';
  if (scores.contactability.value < 0.4) return 'Identify a named contact in the likely owning role before any outreach.';
  if (quality === 'strong') return 'Prepare outreach for approval.';
  return 'Research further to raise evidence, then reconsider.';
}

/** Only these are worth a human's attention. */
export function workable(hypotheses: OpportunityHypothesis[]): OpportunityHypothesis[] {
  return hypotheses.filter((h) => h.quality === 'strong' || h.quality === 'workable');
}

export function rejectionSummary(hypotheses: OpportunityHypothesis[]): { rule: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const h of hypotheses) {
    for (const reason of h.rejectionReasons) {
      const rule = reason.split(':')[0]!;
      counts.set(rule, (counts.get(rule) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count);
}
