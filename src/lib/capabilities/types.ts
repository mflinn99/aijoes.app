/**
 * Capability Registry — Directive §5.
 *
 * "The user should not have to understand the individual opcos. JoJo chooses
 * capabilities behind the scenes. The system should behave as a unified AIGoGo
 * capability mesh."
 */

export type CapabilityMaturity = 'production' | 'beta' | 'mock' | 'planned';
export type ExecutionMode = 'synchronous' | 'asynchronous' | 'human-in-loop';
export type CapabilityHealth = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export interface CapabilityAction {
  id: string;
  name: string;
  description: string;
  /** Does performing this action touch systems, money, customers or comms? (§11) */
  external: boolean;
  risk: 'low' | 'medium' | 'high';
  /** Typical GBP cost to AIGoGo of running this action once. Drives §26. */
  unitCostGbp: number;
  requiredInputs: string[];
  outputs: string[];
}

export interface Capability {
  id: string;
  name: string;
  /** The AIGoGo opco or service this belongs to. */
  opco: string;
  type: 'growth' | 'procurement' | 'intelligence' | 'automation' | 'msp' | 'data';
  description: string;
  supportedActions: CapabilityAction[];
  apiEndpoint: string | null;
  authMethod: 'none' | 'api-key' | 'oauth2' | 'internal-mesh';
  maturity: CapabilityMaturity;
  executionMode: ExecutionMode;
  requiredInputs: string[];
  outputs: string[];
  owner: string;
  health: CapabilityHealth;
  /** Rolling success rate 0..1, used by the router (§14). */
  successRate: number;
  /** Typical seconds to complete an action. */
  typicalDurationSec: number;
  /** Why this is mocked, when it is. Surfaced in the gap analysis. */
  mockReason?: string;
}

export interface CapabilityInvocation {
  capabilityId: string;
  actionId: string;
  tenantId: string;
  companyId: string;
  inputs: Record<string, unknown>;
}

export interface CapabilityOutcome {
  ok: boolean;
  /** Clearly marked when the result did not come from a live opco service. */
  simulated: boolean;
  outputs: Record<string, unknown>;
  evidence: string[];
  costGbp: number;
  durationMs: number;
  /** Value this action is measured to have produced, when measurable. */
  measuredValueGbp?: number;
  failure?: string;
}

export interface CapabilityAdapter {
  capability: Capability;
  invoke(invocation: CapabilityInvocation): Promise<CapabilityOutcome>;
}
