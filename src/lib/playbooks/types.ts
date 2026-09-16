/**
 * Playbook Engine — Directive §15. Playbooks are versioned and reusable.
 */

export interface PlaybookTask {
  /** Stable within the playbook; becomes the execution task's action. */
  action: string;
  name: string;
  /** The capability action id the router will be asked to satisfy. */
  capabilityAction: string;
  description: string;
  inputs: string[];
  expectedOutputs: string[];
  preconditions: string[];
  /** Overrides the capability's own approval requirement upward, never down. */
  approvalRequired: boolean;
}

export interface EligibilityRule {
  id: string;
  description: string;
  /** Returns null when satisfied, else the reason it is not. */
  check: (input: { confidence: number; value: number; integrations: string[]; readiness: number }) => string | null;
}

export interface PlaybookKpi {
  id: string;
  name: string;
  unit: string;
  /** How the KPI is measured, shown in the Benefits Ledger. */
  measurement: string;
}

export interface Playbook {
  id: string;
  version: string;
  name: string;
  category: 'MAKE_MORE' | 'SPEND_LESS' | 'MSP_EXPAND';
  description: string;
  requiredEvidence: string[];
  eligibilityRules: EligibilityRule[];
  tasks: PlaybookTask[];
  capabilityRequirements: string[];
  financialModel: {
    /** Share of the opportunity's annual value this playbook targets in run one. */
    targetRealisationRate: number;
    measurementWindowDays: number;
    note: string;
  };
  defaultKPIs: PlaybookKpi[];
  approvalPolicy: {
    /** Approval gates before anything external happens. */
    gates: string[];
    /** Above this GBP figure, a named human must authorise regardless of autonomy. */
    humanAuthorisationThreshold: number;
  };
  stopConditions: string[];
}
