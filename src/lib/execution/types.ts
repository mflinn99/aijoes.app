import type { AutonomyLevel } from '../core/autonomy';

export type PlanStatus =
  | 'DRAFT'
  | 'AWAITING_AUTHORISATION'
  | 'AUTHORISED'
  | 'EXECUTING'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED';

export type TaskStatus =
  | 'PENDING'
  | 'AWAITING_APPROVAL'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'BLOCKED';

export interface ExecutionTask {
  id: string;
  executionPlanId: string;
  seq: number;
  action: string;
  name: string;
  description: string;
  assignedCapability: string;
  assignedCapabilityName: string;
  assignedAgent: string;
  capabilityAction: string;
  /** Why the router chose this capability, kept for audit. */
  routingRationale: string;
  inputs: Record<string, unknown>;
  expectedOutputs: string[];
  preconditions: string[];
  approvalRequired: boolean;
  approvalId: string | null;
  status: TaskStatus;
  startedAt: string | null;
  completedAt: string | null;
  outcome: string | null;
  evidence: string[];
  costGbp: number;
  measuredValueGbp: number | null;
  retryCount: number;
  simulated: boolean;
}

export interface ExecutionPlan {
  id: string;
  tenantId: string;
  companyId: string;
  opportunityId: string;
  playbookId: string;
  playbookVersion: string;
  objective: string;
  targetOutcome: string;
  financialTarget: number;
  tasks: ExecutionTask[];
  requiredCapabilities: string[];
  integrations: string[];
  permissions: string[];
  approvals: string[];
  constraints: string[];
  metrics: { id: string; name: string; unit: string; measurement: string }[];
  stopConditions: string[];
  rollbackPlan: string;
  status: PlanStatus;
  autonomyLevel: AutonomyLevel;
  autonomyReason: string;
  estimatedCostGbp: number;
  createdAt: string;
  authorisedAt: string | null;
  authorisedBy: string | null;
  completedAt: string | null;
  /** Populated when the plan could not be created, so the UI can explain it. */
  blockers: string[];
}

export interface ExecutionPreview {
  plan: ExecutionPlan;
  /** Everything a human needs to decide, assembled before anything runs (§11 step 8). */
  summary: {
    taskCount: number;
    externalTaskCount: number;
    approvalsRequired: number;
    estimatedCostGbp: number;
    financialTarget: number;
    proportionality: string;
    simulatedCapabilities: string[];
  };
}
