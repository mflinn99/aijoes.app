/**
 * Deterministic mock adapters — Directive §29.
 *
 * No AIGoGo opco service is reachable from this environment (see
 * docs/current-state.md), so every capability is backed by a mock that honours
 * the real interface. Outcomes are deterministic given the same inputs so that
 * tests are stable, and every outcome is flagged `simulated: true` so the UI and
 * the Benefits Ledger can never present simulated value as realised value.
 */

import type { Capability, CapabilityAdapter, CapabilityInvocation, CapabilityOutcome } from '../types';

/** Small deterministic hash so mock outcomes vary by input but never randomly. */
export function seedFrom(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) / 2 ** 31;
}

export interface MockBehaviour {
  /** Fraction of the action's target value this action typically realises. */
  valueFraction?: number;
  outputs?: (inv: CapabilityInvocation, seed: number) => Record<string, unknown>;
  evidence?: (inv: CapabilityInvocation, seed: number) => string[];
  /** Deterministic failure trigger, for the retry tests. */
  failWhen?: (inv: CapabilityInvocation) => string | null;
}

export function createMockAdapter(capability: Capability, behaviour: MockBehaviour = {}): CapabilityAdapter {
  return {
    capability,
    async invoke(inv: CapabilityInvocation): Promise<CapabilityOutcome> {
      const action = capability.supportedActions.find((a) => a.id === inv.actionId);
      if (!action) {
        return {
          ok: false,
          simulated: true,
          outputs: {},
          evidence: [],
          costGbp: 0,
          durationMs: 0,
          failure: `Capability ${capability.id} does not support action "${inv.actionId}"`,
        };
      }

      const missing = action.requiredInputs.filter((k) => inv.inputs[k] === undefined);
      if (missing.length > 0) {
        return {
          ok: false,
          simulated: true,
          outputs: {},
          evidence: [],
          costGbp: 0,
          durationMs: 0,
          failure: `Missing required input(s): ${missing.join(', ')}`,
        };
      }

      const forced = behaviour.failWhen?.(inv) ?? null;
      if (forced) {
        return {
          ok: false,
          simulated: true,
          outputs: {},
          evidence: [],
          costGbp: action.unitCostGbp,
          durationMs: 10,
          failure: forced,
        };
      }

      const seed = seedFrom(`${capability.id}:${inv.actionId}:${inv.companyId}`);
      const target = Number(inv.inputs['financialTarget'] ?? 0);
      const fraction = behaviour.valueFraction ?? 0;
      const measured = fraction > 0 ? Math.round(target * fraction * (0.7 + seed * 0.6)) : undefined;

      return {
        ok: true,
        simulated: true,
        outputs: behaviour.outputs?.(inv, seed) ?? { acknowledged: true },
        evidence: behaviour.evidence?.(inv, seed) ?? [
          `Simulated ${capability.name} · ${action.name}. No live ${capability.opco} service is connected.`,
        ],
        costGbp: action.unitCostGbp,
        durationMs: Math.round(capability.typicalDurationSec * 1000 * (0.5 + seed)),
        ...(measured !== undefined ? { measuredValueGbp: measured } : {}),
      };
    },
  };
}
