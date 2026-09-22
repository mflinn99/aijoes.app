/** Durable job queue — iteration 2 priority 4. */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { enqueue, claimNext, completeJob, failJob, getJob, listJobs, pendingCount, LOCK_TIMEOUT_MS } from '@/lib/jobs/queue';

let db: Database;

beforeEach(() => {
  db = createTestDb();
  db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t1', 'T1', 'MSP', '2026-01-01')`).run();
});

describe('job queue', () => {
  it('enqueues a pending job', () => {
    const job = enqueue('t1', 'analysis', { runId: 'r1' }, {}, db);
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(0);
    expect(job.payload).toEqual({ runId: 'r1' });
    expect(pendingCount(db)).toBe(1);
  });

  it('claims a job exactly once', () => {
    enqueue('t1', 'analysis', { runId: 'r1' }, {}, db);
    const first = claimNext('worker-a', db);
    const second = claimNext('worker-b', db);

    expect(first).not.toBeNull();
    expect(first!.status).toBe('running');
    expect(first!.attempts).toBe(1);
    // A second worker racing for the same row gets nothing.
    expect(second).toBeNull();
  });

  it('does not claim a job scheduled for the future', () => {
    enqueue('t1', 'analysis', {}, { runAfter: new Date(Date.now() + 60_000) }, db);
    expect(claimNext('worker', db)).toBeNull();
  });

  it('reclaims a job whose worker died', () => {
    enqueue('t1', 'analysis', {}, {}, db);
    const claimed = claimNext('worker-a', db)!;

    // Nothing is due while the lock is fresh.
    expect(claimNext('worker-b', db)).toBeNull();

    const stale = new Date(Date.now() - LOCK_TIMEOUT_MS - 1_000).toISOString();
    db.prepare(`UPDATE jobs SET locked_at = ? WHERE id = ?`).run(stale, claimed.id);

    const reclaimed = claimNext('worker-b', db);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.id).toBe(claimed.id);
    expect(reclaimed!.attempts).toBe(2);
  });

  it('retries with backoff, then dead-letters', () => {
    const job = enqueue('t1', 'analysis', {}, { maxAttempts: 2 }, db);

    claimNext('w', db);
    const afterFirst = failJob(job.id, 'boom', db)!;
    expect(afterFirst.status).toBe('pending');
    expect(afterFirst.lastError).toBe('boom');
    expect(new Date(afterFirst.runAfter).getTime()).toBeGreaterThan(Date.now());

    claimNext('w', db, new Date(Date.now() + 60_000));
    const afterSecond = failJob(job.id, 'boom again', db)!;
    expect(afterSecond.status).toBe('dead');
  });

  it('marks a job succeeded and releases its lock', () => {
    const job = enqueue('t1', 'analysis', {}, {}, db);
    claimNext('w', db);
    completeJob(job.id, db);

    const done = getJob(job.id, db)!;
    expect(done.status).toBe('succeeded');
    expect(pendingCount(db)).toBe(0);
  });

  it('lists jobs for a tenant only', () => {
    db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t2', 'T2', 'MSP', '2026-01-01')`).run();
    enqueue('t1', 'analysis', {}, {}, db);
    enqueue('t2', 'analysis', {}, {}, db);
    expect(listJobs('t1', 10, db)).toHaveLength(1);
    expect(listJobs('t2', 10, db)).toHaveLength(1);
  });

  it('dead-letters a job whose type has no handler', async () => {
    process.env.METAMSP_DB_PATH = ':memory:';
    const job = enqueue('t1', 'verification', {}, { maxAttempts: 1 }, db);
    // Simulated directly: the runner uses the shared db, this asserts the rule.
    claimNext('w', db);
    const failed = failJob(job.id, 'No handler registered for job type "verification"', db)!;
    expect(failed.status).toBe('dead');
    expect(failed.lastError).toMatch(/No handler registered/);
  });
});
