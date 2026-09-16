/**
 * Autonomy policy — Directive §12.
 *
 * "Never imply autonomy where authority has not been granted."
 *
 * Pure policy resolution. Deny by default: an action with no matching grant
 * resolves to LEVEL 0, and a newly-introduced action type is therefore OBSERVE
 * for every tenant until someone grants otherwise.
 */

export enum AutonomyLevel {
  OBSERVE = 0,
  RECOMMEND = 1,
  PREPARE = 2,
  EXECUTE = 3,
  AUTONOMOUS = 4,
}

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  [AutonomyLevel.OBSERVE]: 'Observe',
  [AutonomyLevel.RECOMMEND]: 'Recommend',
  [AutonomyLevel.PREPARE]: 'Prepare',
  [AutonomyLevel.EXECUTE]: 'Execute',
  [AutonomyLevel.AUTONOMOUS]: 'Autonomous',
};

export const AUTONOMY_DESCRIPTIONS: Record<AutonomyLevel, string> = {
  [AutonomyLevel.OBSERVE]: 'Analyse only. Nothing is proposed or prepared.',
  [AutonomyLevel.RECOMMEND]: 'Analyse and propose actions. Nothing is produced.',
  [AutonomyLevel.PREPARE]: 'Prepare deliverables, but require approval before anything leaves the platform.',
  [AutonomyLevel.EXECUTE]: 'Execute within explicitly delegated scopes.',
  [AutonomyLevel.AUTONOMOUS]: 'Continuously execute approved low-risk action classes within guardrails.',
};

export type ActionRisk = 'low' | 'medium' | 'high';

/**
 * Directive §12: "Store autonomy by organisation, user, action type,
 * capability, monetary threshold, risk level."
 */
export interface AutonomyGrant {
  id: string;
  tenantId: string;
  /** null = applies to all users in the tenant. */
  userId: string | null;
  /** null = all action types. Specific wins over wildcard. */
  actionType: string | null;
  /** null = all capabilities. */
  capabilityId: string | null;
  level: AutonomyLevel;
  /** Max GBP an action may commit/affect under this grant. 0 = no monetary effect permitted. */
  monetaryThreshold: number;
  /** Highest risk this grant covers. */
  maxRisk: ActionRisk;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string | null;
}

export interface ActionRequest {
  tenantId: string;
  userId: string;
  actionType: string;
  capabilityId: string;
  /** GBP the action commits or affects. */
  monetaryImpact: number;
  risk: ActionRisk;
  /** Does this action touch external systems, money, customers, contracts or comms? (§11) */
  external: boolean;
}

export interface AutonomyDecision {
  level: AutonomyLevel;
  /** May the platform perform this without a human pressing approve? */
  mayExecute: boolean;
  requiresApproval: boolean;
  /** The grant that decided it, for the audit trail. */
  grantId: string | null;
  reason: string;
}

const RISK_ORDER: Record<ActionRisk, number> = { low: 0, medium: 1, high: 2 };

/**
 * Specificity: a grant naming both the action type and the capability beats one
 * naming only the action type, which beats a tenant-wide wildcard. Ties go to
 * the *lower* level — the conservative reading of ambiguous authority.
 */
function specificity(g: AutonomyGrant): number {
  return (g.userId ? 4 : 0) + (g.actionType ? 2 : 0) + (g.capabilityId ? 1 : 0);
}

export function resolveAutonomy(
  req: ActionRequest,
  grants: AutonomyGrant[],
  now = new Date(),
): AutonomyDecision {
  const applicable = grants.filter((g) => {
    if (g.tenantId !== req.tenantId) return false;
    if (g.userId !== null && g.userId !== req.userId) return false;
    if (g.actionType !== null && g.actionType !== req.actionType) return false;
    if (g.capabilityId !== null && g.capabilityId !== req.capabilityId) return false;
    if (g.expiresAt && new Date(g.expiresAt).getTime() < now.getTime()) return false;
    return true;
  });

  if (applicable.length === 0) {
    return {
      level: AutonomyLevel.OBSERVE,
      mayExecute: false,
      requiresApproval: true,
      grantId: null,
      reason: 'No autonomy has been granted for this action. Defaulting to Observe.',
    };
  }

  applicable.sort((a, b) => specificity(b) - specificity(a) || a.level - b.level);
  const grant = applicable[0]!;

  // A grant caps what it covers. Exceeding the money threshold or the risk
  // ceiling does not fail the action — it drops it to PREPARE, so the work is
  // still done and a human approves the last step.
  if (req.monetaryImpact > grant.monetaryThreshold) {
    return {
      level: Math.min(grant.level, AutonomyLevel.PREPARE),
      mayExecute: false,
      requiresApproval: true,
      grantId: grant.id,
      reason: `Monetary impact £${req.monetaryImpact.toLocaleString('en-GB')} exceeds the granted threshold of £${grant.monetaryThreshold.toLocaleString('en-GB')}. Approval required.`,
    };
  }

  if (RISK_ORDER[req.risk] > RISK_ORDER[grant.maxRisk]) {
    return {
      level: Math.min(grant.level, AutonomyLevel.PREPARE),
      mayExecute: false,
      requiresApproval: true,
      grantId: grant.id,
      reason: `Action risk "${req.risk}" exceeds the granted maximum of "${grant.maxRisk}". Approval required.`,
    };
  }

  // Anything touching the outside world needs LEVEL 3+ (§11).
  if (req.external && grant.level < AutonomyLevel.EXECUTE) {
    return {
      level: grant.level,
      mayExecute: false,
      requiresApproval: true,
      grantId: grant.id,
      reason: `Action affects external systems and autonomy is ${AUTONOMY_LABELS[grant.level]}. Approval required before anything leaves the platform.`,
    };
  }

  const mayExecute = grant.level >= AutonomyLevel.EXECUTE;
  return {
    level: grant.level,
    mayExecute,
    requiresApproval: !mayExecute,
    grantId: grant.id,
    reason: mayExecute
      ? `Executing under delegated authority (${AUTONOMY_LABELS[grant.level]}).`
      : `Autonomy is ${AUTONOMY_LABELS[grant.level]}. Approval required before execution.`,
  };
}

/**
 * The single control that drops a tenant, or everything, to Observe. Returns the
 * grants that should replace the current set.
 */
export function haltAll(grants: AutonomyGrant[], tenantId: string | null): AutonomyGrant[] {
  return grants.map((g) =>
    tenantId === null || g.tenantId === tenantId ? { ...g, level: AutonomyLevel.OBSERVE } : g,
  );
}
