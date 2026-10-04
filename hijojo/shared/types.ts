// Domain types shared by the server and the UI.
//
// The vocabulary follows docs/BUILD-REMIT.txt. Anything that asserts something
// about the world carries an epistemic status and the evidence behind it.

export type Epistemic = "FACT" | "INFERENCE" | "UNKNOWN";

/** A quotation from a stored source. A FACT needs at least one that verifies. */
export interface EvidenceRef {
  sourceId: string;
  quote: string;
}

export type SourceKind =
  | "opco-site"
  | "opco-document"
  | "prospect-site"
  | "news"
  | "filing"
  | "job-posting"
  | "contact-provider"
  | "manual";

/** A retrieved document. Model recollection is never a source. */
export interface Source {
  id: string;
  url: string;
  kind: SourceKind;
  title: string | null;
  retrievedAt: string;
  publishedAt: string | null;
  contentHash: string;
  text: string;
}

export interface Claim {
  id: string;
  field: AnalysisField;
  statement: string;
  status: Epistemic;
  evidence: EvidenceRef[];
  /** Reasoning behind an INFERENCE. */
  basis: string | null;
  /** Why a proposed status was downgraded, if it was. */
  note: string | null;
}

export const ANALYSIS_FIELDS = [
  "proposition",
  "products",
  "problem",
  "targetCustomer",
  "buyer",
  "benefit",
  "usp",
  "differentiation",
  "commercialModel",
  "cost",
  "implementation",
  "proof",
  "arguments",
  "weaknesses",
] as const;
export type AnalysisField = (typeof ANALYSIS_FIELDS)[number];

export type OpcoStatus = "NEW" | "ANALYSING" | "PROFILED" | "INCOMPLETE" | "FAILED";

export interface Opco {
  id: string;
  name: string;
  website: string;
  /** The introduction/demo link used in outreach. Defaults to the website. */
  introLink: string;
  notes: string;
  status: OpcoStatus;
  statusDetail: string | null;
  createdAt: string;
}

export interface ProfileItem {
  text: string;
  status: Epistemic;
  claimIds: string[];
}

export interface BuyingSignal {
  id: string;
  name: string;
  description: string;
  whyItMatters: string;
  keywords: string[];
}

export type ExclusionKind = "domain" | "name" | "sector" | "rule";
export interface Exclusion {
  kind: ExclusionKind;
  value: string;
  reason: string;
}

export interface Icp {
  sectors: string[];
  subsectors: string[];
  geographies: string[];
  employeeMin: number | null;
  employeeMax: number | null;
  revenue: string | null;
  technology: string[];
  maturity: string | null;
  ownership: string[];
  growth: string | null;
  regulatory: string[];
  other: string[];
}

export interface BuyerRoles {
  economic: string[];
  operational: string[];
  technical: string[];
  influencer: string[];
}

export interface ProspectingProfile {
  opcoId: string;
  version: number;
  proposition: ProfileItem;
  problem: ProfileItem;
  usp: ProfileItem;
  cost: ProfileItem;
  icp: Icp;
  buyers: BuyerRoles;
  signals: BuyingSignal[];
  exclusions: Exclusion[];
  /** False when a gap prevents prospecting; `gaps` says which. */
  complete: boolean;
  gaps: string[];
  createdAt: string;
}

export type ProspectStatus =
  | "RESEARCHING"
  | "REJECTED"
  | "QUALIFIED"
  | "CONTACTED"
  | "FOLLOW_UP_DUE"
  | "FOLLOWED_UP"
  | "RESPONDED"
  | "PASSED_TO_MARK"
  | "CLOSED";

export type FindingKind = "identity" | "icp" | "trigger" | "need" | "commercial";

export interface Finding {
  id: string;
  prospectId: string;
  kind: FindingKind;
  statement: string;
  status: Epistemic;
  evidence: EvidenceRef[];
  signalId: string | null;
  /** Publication date of the supporting source, where known. */
  observedAt: string | null;
  note: string | null;
}

export interface ProspectAttributes {
  sector: string | null;
  employees: number | null;
  geography: string | null;
}

export interface ScoreDimension {
  points: number;
  max: number;
  rationale: string;
  findingIds: string[];
}

export const SCORE_WEIGHTS = {
  icpFit: 30,
  need: 30,
  buyer: 15,
  timing: 10,
  commercial: 10,
  evidence: 5,
} as const;
export type ScoreKey = keyof typeof SCORE_WEIGHTS;

export interface ScoreCard {
  dimensions: Record<ScoreKey, ScoreDimension>;
  total: number;
  threshold: number;
  passed: boolean;
  confidence: number;
  notes: string[];
}

export interface Prospect {
  id: string;
  opcoId: string;
  name: string;
  domain: string;
  status: ProspectStatus;
  statusReason: string | null;
  attributes: ProspectAttributes;
  score: ScoreCard | null;
  whyThem: string | null;
  whyNow: string | null;
  whyProposition: string | null;
  conflicts: string[];
  contactId: string | null;
  discoveredVia: string;
  createdAt: string;
  updatedAt: string;
  researchedAt: string | null;
}

export type EmailStatus = "verified" | "unverified" | "invalid" | "bounced";
export type BuyerRoleKind = keyof BuyerRoles;

export interface Contact {
  id: string;
  prospectId: string;
  name: string;
  title: string;
  email: string;
  emailStatus: EmailStatus;
  employerDomain: string;
  source: string;
  sourceUrl: string | null;
}

export type CommKind = "intro" | "followup";
export type CommStatus =
  | "DRAFT"
  | "QA_PASS"
  | "QA_REWORK"
  | "QA_REJECT"
  | "SENDING"
  | "SENT"
  | "SEND_BLOCKED"
  | "UNCERTAIN"
  | "FAILED"
  | "CANCELLED";

export interface CommSections {
  whyThem: string;
  whyNow: string;
  problem: string;
  proposition: string;
  teaser: string;
  cta: string;
}

export interface CommEvidence {
  section: keyof CommSections;
  findingId: string;
}

export interface Communication {
  id: string;
  prospectId: string;
  contactId: string;
  kind: CommKind;
  attempt: number;
  subject: string;
  body: string;
  link: string;
  sections: CommSections;
  evidence: CommEvidence[];
  opcoClaimIds: string[];
  approach: string;
  status: CommStatus;
  statusReason: string | null;
  contentHash: string;
  createdAt: string;
  sentAt: string | null;
}

export type QaVerdict = "PASS" | "REWORK" | "REJECT";
/**
 * What a failed check means: "communication" can be rewritten; "research" sends
 * the prospect back for research (wrong person, stale or conflicting evidence);
 * "prospect" means the company must not be contacted.
 */
export type QaScope = "communication" | "research" | "prospect";

export interface QaCheck {
  name: string;
  passed: boolean;
  severity: "reject" | "rework";
  scope: QaScope;
  detail: string;
}

export interface RelevanceAnswers {
  whyCompany: string | null;
  whyPerson: string | null;
  whyNow: string | null;
  whyOpco: string | null;
  evidence: string | null;
  specific: string | null;
}

export interface QaReport {
  id: string;
  commId: string;
  verdict: QaVerdict;
  checks: QaCheck[];
  relevance: RelevanceAnswers;
  reviewer: string;
  contentHash: string;
  createdAt: string;
}

export type ResponseClass =
  | "POSITIVE"
  | "INTERESTED"
  | "REFERRAL"
  | "NOT_NOW"
  | "NOT_INTERESTED"
  | "UNSUBSCRIBE"
  | "OTHER"
  | "BOUNCE"
  | "AUTO_REPLY";

export const HANDOFF_CLASSES: ResponseClass[] = ["POSITIVE", "INTERESTED", "REFERRAL"];

export interface InboundMessage {
  id: string;
  providerId: string;
  prospectId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  body: string;
  receivedAt: string;
  conversationId: string | null;
  classification: ResponseClass | null;
  classificationReason: string | null;
}

export interface Handoff {
  id: string;
  inboundId: string;
  prospectId: string;
  to: string;
  subject: string;
  body: string;
  status: "PENDING" | "SENT" | "FAILED";
  createdAt: string;
  sentAt: string | null;
  verdict: "ACCEPTED" | "DECLINED" | null;
}

export interface ActivityEvent {
  id: number;
  opcoId: string | null;
  prospectId: string | null;
  type: string;
  detail: string;
  at: string;
}

export type Role = "ADMIN" | "OPERATOR" | "VIEWER";

/** The stage groups the UI shows, mapped from prospect status. */
export const STAGE_GROUPS: { label: string; statuses: ProspectStatus[] }[] = [
  { label: "Qualified", statuses: ["QUALIFIED"] },
  { label: "Researching", statuses: ["RESEARCHING"] },
  { label: "Rejected", statuses: ["REJECTED"] },
  { label: "Contacted", statuses: ["CONTACTED", "FOLLOWED_UP", "CLOSED"] },
  { label: "Follow-up Due", statuses: ["FOLLOW_UP_DUE"] },
  { label: "Responded", statuses: ["RESPONDED"] },
  { label: "Passed to Mark", statuses: ["PASSED_TO_MARK"] },
];
