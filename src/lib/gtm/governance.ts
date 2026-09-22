/**
 * Commercial governance — Directive Phase 7.
 *
 * "The system should reduce Mark's workload rather than create an approval
 * queue." So the default is that routine work proceeds, and escalation is the
 * exception with a stated trigger. Every escalation carries context, evidence,
 * a recommendation, an expected value and a proposed action — never raw data.
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import type { EvidenceItem, OpportunityHypothesis, GtmOpportunity } from './types';
import type { MspProfile } from './profile';
import { audit } from '../observability/events';

export type EscalationTrigger =
  | 'strategic-proposition-change'
  | 'major-partnership'
  | 'unusually-high-value'
  | 'commercial-risk-threshold'
  | 'pricing-outside-parameters'
  | 'new-market-proposition'
  | 'judgement-materially-improves-outcome';

export interface CommercialPolicy {
  /** Above this, a single opportunity is Mark's call. */
  highValueThresholdGbp: number;
  /** Above this, a campaign's total committed value needs sign-off. */
  campaignValueThresholdGbp: number;
  /** Archetypes already approved as propositions; anything else is new. */
  approvedArchetypes: string[];
  /** Services cleared to sell without asking. */
  approvedServiceIds: string[];
  /** Outreach volume that may go out per day under standing policy. */
  dailyOutreachLimit: number;
  /** Minimum hypothesis quality that may be contacted without sign-off. */
  minQualityForAutoOutreach: 'strong' | 'workable';
}

export const DEFAULT_POLICY: CommercialPolicy = {
  highValueThresholdGbp: 100_000,
  campaignValueThresholdGbp: 250_000,
  approvedArchetypes: [
    'microsoft-cloud-optimisation', 'cyber-security', 'infrastructure-modernisation',
    'managed-it', 'ps-augmentation', 'technology-migration', 'application-infrastructure-project',
  ],
  approvedServiceIds: ['azure-virtual-desktop', 'managed-it', 'it-consultancy', 'cyber-security', 'cloud-hosting', 'white-label-delivery'],
  dailyOutreachLimit: 25,
  minQualityForAutoOutreach: 'workable',
};

export interface Decision {
  id: string;
  trigger: EscalationTrigger;
  subjectType: 'hypothesis' | 'opportunity' | 'campaign' | 'proposition' | 'partnership';
  subjectId: string;
  context: string;
  evidence: EvidenceItem[];
  recommendation: string;
  expectedValue: number;
  proposedAction: string;
  status: 'open' | 'approved' | 'rejected' | 'deferred';
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface EscalationCheck {
  required: boolean;
  trigger: EscalationTrigger | null;
  reason: string;
}

/**
 * Does this hypothesis need Mark, or can it proceed under standing policy?
 *
 * Most should proceed. If this function escalates more than a small minority,
 * the policy is wrong, not the pipeline.
 */
export function needsEscalation(
  hypothesis: OpportunityHypothesis,
  profile: MspProfile,
  policy: CommercialPolicy = DEFAULT_POLICY,
): EscalationCheck {
  if (hypothesis.commercialValue.point >= policy.highValueThresholdGbp) {
    return {
      required: true,
      trigger: 'unusually-high-value',
      reason: `£${hypothesis.commercialValue.point.toLocaleString('en-GB')} is at or above the £${policy.highValueThresholdGbp.toLocaleString('en-GB')} threshold where Mark decides how it is approached.`,
    };
  }

  if (!policy.approvedArchetypes.includes(hypothesis.archetype)) {
    return {
      required: true,
      trigger: 'new-market-proposition',
      reason: `"${hypothesis.archetype}" is not among the approved propositions. Testing a new market position is a commercial decision.`,
    };
  }

  const unapproved = hypothesis.serviceIds.filter((id) => !policy.approvedServiceIds.includes(id));
  if (unapproved.length > 0) {
    return {
      required: true,
      trigger: 'strategic-proposition-change',
      reason: `Proposes ${unapproved.join(', ')}, which is not on the approved service list.`,
    };
  }

  const service = hypothesis.serviceIds.map((id) => profile.serviceLines.find((s) => s.id === id)).find(Boolean);
  if (service && service.deliveryCapacity === 'partner-required') {
    return {
      required: true,
      trigger: 'major-partnership',
      reason: `${service.name} needs a delivery partner, which is a partnership decision rather than a sales one.`,
    };
  }

  // No rate card means every price is outside approved parameters by definition.
  if (!profile.rateCard && hypothesis.commercialValue.point >= 50_000) {
    return {
      required: true,
      trigger: 'pricing-outside-parameters',
      reason: `No rate card is configured, so a £${hypothesis.commercialValue.point.toLocaleString('en-GB')} opportunity cannot be priced within agreed parameters.`,
    };
  }

  return { required: false, trigger: null, reason: 'Proceeds under standing commercial policy.' };
}

export function raiseDecision(
  db: TenantDb,
  input: Omit<Decision, 'id' | 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'createdAt'>,
): Decision {
  const decision: Decision = {
    id: randomUUID(),
    status: 'open',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: new Date().toISOString(),
    ...input,
  };

  db.run(
    `INSERT INTO gtm_decisions (id, tenant_id, trigger, subject_type, subject_id, context, evidence_json,
       recommendation, expected_value, proposed_action, status, created_at)
     VALUES (@id, @tenantId, @trigger, @subjectType, @subjectId, @context, @evidence, @recommendation,
       @expectedValue, @proposedAction, 'open', @createdAt)`,
    {
      id: decision.id, trigger: decision.trigger, subjectType: decision.subjectType,
      subjectId: decision.subjectId, context: decision.context,
      evidence: JSON.stringify(decision.evidence), recommendation: decision.recommendation,
      expectedValue: decision.expectedValue, proposedAction: decision.proposedAction,
      createdAt: decision.createdAt,
    },
  );

  audit(db, {
    actor: 'agent:governance', actorKind: 'agent', action: 'gtm.decision.raised',
    subjectType: decision.subjectType, subjectId: decision.subjectId,
    detail: { trigger: decision.trigger, expectedValue: decision.expectedValue },
  });

  return decision;
}

/**
 * The autopilot runs repeatedly, so escalating must not mean escalating again.
 * One open decision per subject per trigger — Mark's queue stays a queue of
 * decisions rather than a queue of reminders.
 */
export function raiseDecisionOnce(
  db: TenantDb,
  input: Omit<Decision, 'id' | 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'createdAt'>,
): Decision | null {
  const existing = db.get<{ id: string }>(
    `SELECT id FROM gtm_decisions
     WHERE tenant_id = @tenantId AND subject_id = @subjectId AND trigger = @trigger AND status = 'open'`,
    { subjectId: input.subjectId, trigger: input.trigger },
  );
  if (existing) return null;
  return raiseDecision(db, input);
}

export function listDecisions(db: TenantDb, status: 'open' | 'all' = 'open'): Decision[] {
  const rows = db.all<{
    id: string; trigger: string; subject_type: string; subject_id: string; context: string;
    evidence_json: string; recommendation: string; expected_value: number; proposed_action: string;
    status: string; decided_by: string | null; decided_at: string | null; decision_note: string | null; created_at: string;
  }>(
    status === 'open'
      ? `SELECT * FROM gtm_decisions WHERE tenant_id = @tenantId AND status = 'open' ORDER BY expected_value DESC`
      : `SELECT * FROM gtm_decisions WHERE tenant_id = @tenantId ORDER BY created_at DESC LIMIT 200`,
  );

  return rows.map((r) => ({
    id: r.id, trigger: r.trigger as EscalationTrigger,
    subjectType: r.subject_type as Decision['subjectType'], subjectId: r.subject_id,
    context: r.context, evidence: JSON.parse(r.evidence_json) as EvidenceItem[],
    recommendation: r.recommendation, expectedValue: r.expected_value,
    proposedAction: r.proposed_action, status: r.status as Decision['status'],
    decidedBy: r.decided_by, decidedAt: r.decided_at, decisionNote: r.decision_note, createdAt: r.created_at,
  }));
}

export function resolveDecision(
  db: TenantDb,
  id: string,
  outcome: 'approved' | 'rejected' | 'deferred',
  decidedBy: string,
  note: string,
): void {
  db.run(
    `UPDATE gtm_decisions SET status = @status, decided_by = @by, decided_at = @at, decision_note = @note
     WHERE tenant_id = @tenantId AND id = @id AND status = 'open'`,
    { id, status: outcome, by: decidedBy, at: new Date().toISOString(), note },
  );

  audit(db, {
    actor: decidedBy, actorKind: 'human', action: `gtm.decision.${outcome}`,
    subjectType: 'decision', subjectId: id, detail: { note },
  });
}

/**
 * Build the escalation exactly as Mark should receive it: context, evidence,
 * recommendation, expected value, proposed action. Nothing raw.
 */
export function escalationFor(
  hypothesis: OpportunityHypothesis,
  accountName: string,
  check: EscalationCheck,
): Omit<Decision, 'id' | 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'createdAt'> {
  return {
    trigger: check.trigger!,
    subjectType: 'hypothesis',
    subjectId: hypothesis.id,
    context:
      `${accountName}: ${hypothesis.headline}. ${hypothesis.whatIsHappening} ${hypothesis.whyItMatters}`,
    evidence: hypothesis.evidence,
    recommendation:
      check.trigger === 'unusually-high-value'
        ? `Approach it, but decide who leads and how it is priced before anything goes out.`
        : check.trigger === 'new-market-proposition'
          ? `Worth a controlled test: a small number of accounts in this archetype before committing to it as a proposition.`
          : check.trigger === 'pricing-outside-parameters'
            ? `Supply a rate card, or set a price for this one deal, before the conversation starts.`
            : `Approve the approach, or tell the system to stop pursuing this archetype.`,
    expectedValue: hypothesis.commercialValue.point,
    proposedAction: hypothesis.nextAction,
  };
}
