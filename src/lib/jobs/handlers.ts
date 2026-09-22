/**
 * Job handlers. One per job type; each is idempotent enough to survive a retry,
 * because a job that was claimed and then lost its worker will be run again.
 */

import { TenantDb } from '../db/tenant';
import { getDb } from '../db/client';
import type { JobRecord } from './queue';
import { analyseCompany, getRun } from '../analysis/pipeline';
import { getSynthetic } from '../fixtures/synthetic';
import type { AnalysisJobPayload } from './queue';

export type JobHandler = (job: JobRecord) => Promise<void>;

/** Jobs run as the platform, not as a user, but always inside a tenant scope. */
function systemDb(tenantId: string): TenantDb {
  return new TenantDb({ tenantId, userId: 'system:jobs', role: 'MSP_ADMIN' }, getDb());
}

const analysisHandler: JobHandler = async (job) => {
  const payload = job.payload as AnalysisJobPayload;
  const db = systemDb(job.tenantId);

  // Idempotency: a completed run is not re-analysed on retry.
  const run = getRun(db, payload.runId);
  if (run && run.status === 'completed') return;

  const synthetic = payload.syntheticKey ? getSynthetic(payload.syntheticKey) : undefined;

  await analyseCompany(db, payload.input, {
    runId: payload.runId,
    customerId: payload.customerId,
    offline: payload.offline,
    seedRecords: synthetic?.records,
    userSupplied: synthetic?.userSupplied,
  });
};

/**
 * Verification re-reads the connected system and compares it against the
 * baseline captured before execution. It is retried generously: the system of
 * record may be briefly unreachable, and a verification that never runs leaves
 * value stranded at REALISED.
 */
const verificationHandler: JobHandler = async (job) => {
  const { executionPlanId } = job.payload as { executionPlanId: string };
  const db = systemDb(job.tenantId);
  const { verifyPlan } = await import('../verification/verify');

  const result = verifyPlan(db, executionPlanId, 'system:verification');
  if (!result.verified && result.reason === 'source-unavailable') {
    // Retryable: the connector is down, not the change missing.
    throw new Error(result.narrative);
  }
};

export const HANDLERS: Record<string, JobHandler> = {
  analysis: analysisHandler,
  verification: verificationHandler,
};

export function handlerFor(type: string): JobHandler | null {
  return HANDLERS[type] ?? null;
}
