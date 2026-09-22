/**
 * Durable job queue.
 *
 * Iteration 1 started analysis with a fire-and-forget promise; a container
 * restart mid-run left the run row stuck at "running" with nothing to pick it
 * up. Work is now a row, claimed atomically, retried with backoff, and
 * recoverable — a job whose worker died is reclaimed once its lock goes stale.
 */

import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../db/client';
import type { TenantDb } from '../db/tenant';

export type JobType = 'analysis' | 'execution' | 'verification';

export interface JobRecord {
  id: string;
  tenantId: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'dead';
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A lock older than this is assumed to belong to a process that died. */
export const LOCK_TIMEOUT_MS = 5 * 60_000;

interface JobRow {
  id: string; tenant_id: string; type: string; payload_json: string; status: string;
  attempts: number; max_attempts: number; run_after: string; last_error: string | null;
  created_at: string; updated_at: string;
}

function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type as JobType,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status as JobRecord['status'],
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function enqueue(
  tenantId: string,
  type: JobType,
  payload: Record<string, unknown>,
  options: { maxAttempts?: number; runAfter?: Date } = {},
  db: Database = getDb(),
): JobRecord {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO jobs (id, tenant_id, type, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
  ).run(
    id,
    tenantId,
    type,
    JSON.stringify(payload),
    options.maxAttempts ?? 3,
    (options.runAfter ?? new Date()).toISOString(),
    now,
    now,
  );
  return getJob(id, db)!;
}

export interface AnalysisJobPayload extends Record<string, unknown> {
  runId: string;
  input: string;
  customerId: string;
  offline: boolean;
  syntheticKey: string | null;
}

export function enqueueAnalysis(db: TenantDb, payload: AnalysisJobPayload): JobRecord {
  return enqueue(db.ctx.tenantId, 'analysis', payload, { maxAttempts: 2 }, db.raw);
}

export function getJob(id: string, db: Database = getDb()): JobRecord | null {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
  return row ? toRecord(row) : null;
}

/**
 * Claim one due job. The UPDATE ... WHERE status matches is the lock: two
 * workers racing cannot both claim the same row, because the second one's
 * `changes` is zero.
 */
export function claimNext(workerId: string, db: Database = getDb(), now = new Date()): JobRecord | null {
  const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MS).toISOString();
  const nowIso = now.toISOString();

  const candidate = db
    .prepare(
      `SELECT * FROM jobs
       WHERE (status = 'pending' AND run_after <= ?)
          OR (status = 'running' AND locked_at IS NOT NULL AND locked_at < ?)
       ORDER BY run_after ASC
       LIMIT 1`,
    )
    .get(nowIso, staleBefore) as JobRow | undefined;

  if (!candidate) return null;

  const claimed = db
    .prepare(
      `UPDATE jobs
       SET status = 'running', locked_at = ?, locked_by = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND status = ?`,
    )
    .run(nowIso, workerId, nowIso, candidate.id, candidate.status);

  if (claimed.changes === 0) return null;
  return getJob(candidate.id, db);
}

export function completeJob(id: string, db: Database = getDb()): void {
  db.prepare(`UPDATE jobs SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
}

/** Exponential backoff, then dead-letter once attempts are exhausted. */
export function failJob(id: string, error: string, db: Database = getDb(), now = new Date()): JobRecord | null {
  const job = getJob(id, db);
  if (!job) return null;

  const exhausted = job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(5 * 60_000, 2 ** job.attempts * 1_000);

  db.prepare(
    `UPDATE jobs
     SET status = ?, last_error = ?, run_after = ?, locked_at = NULL, locked_by = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(
    exhausted ? 'dead' : 'pending',
    error.slice(0, 2_000),
    new Date(now.getTime() + backoffMs).toISOString(),
    now.toISOString(),
    id,
  );

  return getJob(id, db);
}

export function listJobs(tenantId: string, limit = 50, db: Database = getDb()): JobRecord[] {
  return (
    db
      .prepare(`SELECT * FROM jobs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(tenantId, Math.min(limit, 200)) as JobRow[]
  ).map(toRecord);
}

export function pendingCount(db: Database = getDb()): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status IN ('pending','running')`).get() as { n: number };
  return row.n;
}
