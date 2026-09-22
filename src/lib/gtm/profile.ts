/**
 * MSP commercial profile — the seller's side of Agentic GTM.
 *
 * Directive Phase 2 and Phase 16. This is the *type*; the Onward instance is
 * configuration under src/config/msp/. That separation is the whole of the
 * MetaMSP reusability story: onboarding another MSP is a new configuration
 * file, not another software build.
 *
 * Every field carries provenance, because "what we can sell" drives every
 * downstream claim and an unverified capability produces an undeliverable
 * proposition.
 */

export type ProfileSource =
  | 'user-supplied'          // the MSP told us directly — strongest
  | 'website-verified'       // fetched from their own site and parsed
  | 'web-search-snippet'     // search result summary, NOT verified by direct fetch
  | 'registry'               // Companies House or similar
  | 'inferred';              // derived, weakest

export interface Provenanced<T> {
  value: T;
  source: ProfileSource;
  /** 0..1 */
  confidence: number;
  retrievedAt: string;
  locator?: string;
  /** Stated when the value needs checking before it is used commercially. */
  caveat?: string;
}

export type DeliveryModel = 'project' | 'managed-service' | 'consultancy' | 'resource-augmentation' | 'product';

export interface ServiceLine {
  id: string;
  name: string;
  category: string;
  description: string;
  deliveryModels: DeliveryModel[];
  /** What a buyer's problem looks like when this is the answer. */
  buyerProblems: string[];
  /** Signals in a target account that indicate this service is relevant. */
  triggerSignals: string[];
  /** Typical commercial shape. Ranges, because every deal differs. */
  commercials: {
    typicalDealLowGbp: number;
    typicalDealHighGbp: number;
    recurring: boolean;
    typicalMonthlyGbp?: number;
    grossMarginPct: number;
  };
  /** Days from first meeting to signature, typical. */
  typicalSalesCycleDays: number;
  /** Can Onward deliver this now, at what capacity? */
  deliveryCapacity: 'ready' | 'constrained' | 'partner-required' | 'not-available';
  /** Which AIGoGo capability extends this beyond what Onward does alone. */
  aigogoExtensions: string[];
  confidence: number;
  provenance: ProfileSource;
}

export interface Accreditation {
  name: string;
  held: boolean | 'claimed-unverified';
  relevance: string;
  provenance: ProfileSource;
}

export interface ProofPoint {
  id: string;
  claim: string;
  sector: string | null;
  serviceIds: string[];
  /** Named customer, or null where the reference is anonymous. */
  customer: string | null;
  quantified: string | null;
  provenance: ProfileSource;
  confidence: number;
  /** Cleared for use in outreach? Unverified proof must not be quoted at a prospect. */
  usableInOutreach: boolean;
}

export interface MspProfile {
  id: string;
  name: Provenanced<string>;
  domain: Provenanced<string>;
  positioning: Provenanced<string>;
  yearsTrading: Provenanced<number>;
  /** Who they sell to. Onward's is unusual: they sell *through* other IT firms. */
  goToMarketModel: Provenanced<string>;
  sectors: Provenanced<string[]>;
  geography: Provenanced<string[]>;
  serviceLines: ServiceLine[];
  accreditations: Accreditation[];
  partnerships: Provenanced<string[]>;
  proofPoints: ProofPoint[];
  routesToMarket: Provenanced<string[]>;
  /** Rate card, where known. Absent is absent — never invented. */
  rateCard: Provenanced<{ role: string; dayRateGbp: number }[]> | null;
  /** Delivery headroom, which caps what should be promoted (Phase 12). */
  capacity: Provenanced<{ consultantsAvailable: number | null; note: string }>;
  /** What we do not know and should ask the MSP for. */
  knownGaps: string[];
}

export function serviceById(profile: MspProfile, id: string): ServiceLine | undefined {
  return profile.serviceLines.find((s) => s.id === id);
}

/**
 * Only accreditations actually held, and proof points cleared for use, may
 * appear in an outreach message. A "claimed-unverified" accreditation quoted at
 * a prospect is a claim the MSP may not be able to stand behind.
 */
export function outreachSafeClaims(profile: MspProfile): { accreditations: string[]; proofPoints: ProofPoint[] } {
  return {
    accreditations: profile.accreditations.filter((a) => a.held === true).map((a) => a.name),
    proofPoints: profile.proofPoints.filter((p) => p.usableInOutreach),
  };
}

/** Services that can actually be delivered right now. */
export function sellableServices(profile: MspProfile): ServiceLine[] {
  return profile.serviceLines.filter((s) => s.deliveryCapacity === 'ready' || s.deliveryCapacity === 'constrained');
}

export function profileCompleteness(profile: MspProfile): { score: number; missing: string[] } {
  const missing: string[] = [...profile.knownGaps];
  let held = 0;
  const total = 8;

  if (profile.serviceLines.length > 0) held++;
  if (profile.serviceLines.some((s) => s.provenance === 'user-supplied')) held++;
  else missing.push('Service lines confirmed by Onward rather than inferred from public sources');
  if (profile.proofPoints.some((p) => p.usableInOutreach)) held++;
  else missing.push('At least one proof point cleared for use in outreach');
  if (profile.rateCard) held++;
  else missing.push('Rate card');
  if (profile.capacity.value.consultantsAvailable !== null) held++;
  else missing.push('Delivery capacity (available consultants)');
  if (profile.accreditations.some((a) => a.held === true)) held++;
  else missing.push('Accreditations verified as held');
  if (profile.sectors.value.length > 0) held++;
  if (profile.routesToMarket.value.length > 0) held++;

  return { score: Math.round((held / total) * 100), missing: [...new Set(missing)] };
}
