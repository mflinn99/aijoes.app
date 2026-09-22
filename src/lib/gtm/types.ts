/** Shared GTM types. Directive Phases 4, 5, 9, 10. */

import type { AccountScores, ArchetypeId } from './icp';

export type ResearchState = 'unresearched' | 'queued' | 'researched' | 'research-failed';
export type AccountStatus = 'candidate' | 'qualified-target' | 'engaged' | 'opportunity' | 'rejected' | 'customer';
export type HypothesisQuality = 'strong' | 'workable' | 'weak' | 'rejected';
export type HypothesisStatus = 'draft' | 'approved' | 'outreach-prepared' | 'engaged' | 'converted' | 'discarded';

export interface GtmAccount {
  id: string;
  mspId: string;
  name: string;
  domain: string | null;
  /** The Company Twin holding the research, when the account has been researched. */
  companyId: string | null;
  source: string;
  /** Synthetic accounts prove the engine at scale and can never be contacted. */
  synthetic: boolean;
  status: AccountStatus;
  researchState: ResearchState;
  priorityScore: number;
  scores: AccountScores | null;
  suppressed: boolean;
  suppressReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GtmSignal {
  id: string;
  accountId: string;
  kind: string;
  summary: string;
  /** 0..1 */
  strength: number;
  source: string;
  locator: string | null;
  detectedAt: string;
  expiresAt: string | null;
}

export interface EvidenceItem {
  statement: string;
  source: string;
  locator?: string;
  confidence: number;
}

/**
 * The eleven questions of Directive Phase 5, answered. A hypothesis that cannot
 * answer them is not a hypothesis, it is a lead — and the engine rejects it.
 */
export interface OpportunityHypothesis {
  id: string;
  accountId: string;
  archetype: ArchetypeId;
  serviceIds: string[];
  headline: string;

  whatIsHappening: string;
  whyItMatters: string;
  whatProblemMayExist: string;
  evidence: EvidenceItem[];
  whatOnwardCouldDo: string;
  whatAigogoAdds: string | null;
  whoOwnsTheProblem: string[];
  whyContactNow: string;
  commercialValue: { low: number; high: number; point: number; basis: string; recurring: boolean };
  whatToSay: string;
  nextAction: string;

  confidence: number;
  quality: HypothesisQuality;
  status: HypothesisStatus;
  /** Why it was rejected, when it was. */
  rejectionReasons: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GtmContact {
  id: string;
  accountId: string;
  name: string | null;
  role: string | null;
  email: string | null;
  linkedin: string | null;
  source: string;
  confidence: number;
  consentBasis: string | null;
  suppressed: boolean;
}

export type OutreachStatus =
  | 'draft'
  | 'awaiting-approval'
  | 'approved'
  | 'sent'
  | 'blocked'
  | 'suppressed';

export interface OutreachMessage {
  id: string;
  accountId: string;
  hypothesisId: string;
  contactId: string | null;
  channel: 'email' | 'linkedin' | 'call';
  step: number;
  subject: string | null;
  body: string;
  status: OutreachStatus;
  reasonForContact: string;
  evidence: EvidenceItem[];
  approvedBy: string | null;
  sentAt: string | null;
  blockedReason: string | null;
  createdAt: string;
}

export type PipelineStage =
  | 'identified'
  | 'contacted'
  | 'responded'
  | 'meeting-booked'
  | 'qualified'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'stalled';

export const STAGE_PROBABILITY: Record<PipelineStage, number> = {
  identified: 0.02,
  contacted: 0.05,
  responded: 0.12,
  'meeting-booked': 0.2,
  qualified: 0.35,
  proposal: 0.55,
  won: 1,
  lost: 0,
  stalled: 0.05,
};

export interface GtmOpportunity {
  id: string;
  accountId: string;
  hypothesisId: string;
  name: string;
  stage: PipelineStage;
  valueGbp: number;
  probability: number;
  weightedGbp: number;
  owner: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  lastActionAt: string | null;
  closeDate: string | null;
  source: string;
  crmId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GtmMeeting {
  id: string;
  accountId: string;
  opportunityId: string | null;
  contactId: string | null;
  scheduledFor: string;
  status: 'booked' | 'held' | 'no-show' | 'cancelled';
  notes: string | null;
  createdAt: string;
}
