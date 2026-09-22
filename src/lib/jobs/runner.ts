/**
 * In-process job worker.
 *
 * One worker per instance, polling the jobs table. It is deliberately simple:
 * the durability lives in the table, not in the runner, so moving to a separate
 * worker process later changes only where `start()` is called.
 */

import { randomUUID } from 'node:crypto';
import { claimNext, completeJob, failJob, type JobRecord } from './queue';
import { handlerFor } from './handlers';
import { getDb } from '../db/client';
import { purgeExpiredSessions } from '../auth/sessions';

const POLL_INTERVAL_MS = 1_000;
const IDLE_BACKOFF_MS = 3_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

/** Run a single due job. Returns false when the queue was empty. */
export async function tick(): Promise<boolean> {
  const job = claimNext(workerId, getDb());
  if (!job) return false;

  const handler = handlerFor(job.type);
  if (!handler) {
    failJob(job.id, `No handler registered for job type "${job.type}"`, getDb());
    return true;
  }

  try {
    await handler(job);
    completeJob(job.id, getDb());
  } catch (err) {
    failJob(job.id, err instanceof Error ? (err.stack ?? err.message) : String(err), getDb());
  }
  return true;
}

/** Drain the queue. Used by tests and by one-shot runs. */
export async function drain(maxJobs = 100): Promise<number> {
  let processed = 0;
  while (processed < maxJobs) {
    const did = await tick();
    if (!did) break;
    processed++;
  }
  return processed;
}

async function loop(): Promise<void> {
  if (!running) return;
  let worked = false;
  try {
    worked = await tick();
  } catch {
    // A failure inside tick must not stop the loop; the job itself records it.
  }
  if (!running) return;
  timer = setTimeout(() => void loop(), worked ? POLL_INTERVAL_MS : IDLE_BACKOFF_MS);
  timer.unref?.();
}

let housekeepingTimer: ReturnType<typeof setInterval> | null = null;

export function start(): void {
  if (running) return;
  running = true;
  void loop();

  housekeepingTimer = setInterval(
    () => {
      try {
        purgeExpiredSessions(getDb());
      } catch {
        /* housekeeping failure is not fatal */
      }
    },
    15 * 60_000,
  );
  housekeepingTimer.unref?.();
}

export function stop(): void {
  running = false;
  if (timer) clearTimeout(timer);
  if (housekeepingTimer) clearInterval(housekeepingTimer);
  timer = null;
  housekeepingTimer = null;
}

export function isRunning(): boolean {
  return running;
}
