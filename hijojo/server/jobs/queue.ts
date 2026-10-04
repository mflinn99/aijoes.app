// Durable jobs in the same database as the state they change. A job is claimed
// with a lease, so a crashed worker's job is picked up again; keys make
// scheduling idempotent (one follow-up check per prospect, ever).

import { randomUUID } from "node:crypto";
import type { Repo } from "../repo";
import { writeTx } from "../db";

export type JobType =
  | "analyse_opco"
  | "discover"
  | "research"
  | "qualify"
  | "compose"
  | "send"
  | "reconcile"
  | "followup_check"
  | "close_sequence"
  | "sync_inbox"
  | "handoff";

export interface Job {
  id: string;
  type: JobType;
  key: string;
  payload: any;
  runAt: string;
  status: "pending" | "running" | "done" | "dead" | "cancelled";
  attempts: number;
  lastError: string | null;
}

const row = (r: any): Job => ({
  id: r.id,
  type: r.type,
  key: r.key,
  payload: JSON.parse(r.payload),
  runAt: r.run_at,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
});

export class JobQueue {
  constructor(private repo: Repo) {}

  /** Returns false if a job with this key already exists. */
  enqueue(type: JobType, payload: unknown, opts: { runAt?: string; key?: string } = {}): boolean {
    const now = this.repo.now();
    const res = this.repo.db
      .prepare("INSERT OR IGNORE INTO jobs (id,type,key,payload,run_at,status,attempts,created_at,updated_at) VALUES (?,?,?,?,?,'pending',0,?,?)")
      .run(randomUUID(), type, opts.key ?? `${type}:${randomUUID()}`, JSON.stringify(payload), opts.runAt ?? now, now, now);
    return res.changes > 0;
  }

  cancel(key: string): boolean {
    return this.repo.db.prepare("UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE key = ? AND status = 'pending'").run(this.repo.now(), key).changes > 0;
  }

  /** Cancel all pending jobs whose key starts with a prefix. */
  cancelPrefix(prefix: string): number {
    return this.repo.db
      .prepare("UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE key LIKE ? AND status = 'pending'")
      .run(this.repo.now(), `${prefix.replace(/[%_]/g, "\\$&")}%`).changes;
  }

  claim(leaseMs = 10 * 60_000): Job | null {
    const now = this.repo.now();
    return writeTx(this.repo.db, () => {
      const r = this.repo.db
        .prepare(
          `SELECT * FROM jobs WHERE (status = 'pending' AND run_at <= ?) OR (status = 'running' AND lease_until < ?)
           ORDER BY run_at, created_at LIMIT 1`,
        )
        .get(now, now);
      if (!r) return null;
      const lease = new Date(new Date(now).getTime() + leaseMs).toISOString();
      this.repo.db.prepare("UPDATE jobs SET status = 'running', lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?").run(lease, now, (r as any).id);
      return row({ ...(r as any), status: "running", attempts: (r as any).attempts + 1 });
    });
  }

  complete(id: string): void {
    this.repo.db.prepare("UPDATE jobs SET status = 'done', lease_until = NULL, updated_at = ? WHERE id = ?").run(this.repo.now(), id);
  }

  /** Retry with backoff, or give up after `maxAttempts`. */
  fail(job: Job, error: string, maxAttempts = 5): "retry" | "dead" {
    const now = this.repo.clock.now();
    if (job.attempts >= maxAttempts) {
      this.repo.db.prepare("UPDATE jobs SET status = 'dead', last_error = ?, lease_until = NULL, updated_at = ? WHERE id = ?").run(error, now.toISOString(), job.id);
      return "dead";
    }
    const runAt = new Date(now.getTime() + 2 ** job.attempts * 60_000).toISOString();
    this.repo.db
      .prepare("UPDATE jobs SET status = 'pending', run_at = ?, last_error = ?, lease_until = NULL, updated_at = ? WHERE id = ?")
      .run(runAt, error, now.toISOString(), job.id);
    return "retry";
  }

  /** Push a claimed job back without counting it as a failure. */
  defer(job: Job, runAt: string): void {
    this.repo.db
      .prepare("UPDATE jobs SET status = 'pending', run_at = ?, attempts = attempts - 1, lease_until = NULL, updated_at = ? WHERE id = ?")
      .run(runAt, this.repo.now(), job.id);
  }

  list(filter: { status?: Job["status"] } = {}): Job[] {
    const rows = filter.status
      ? this.repo.db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY run_at").all(filter.status)
      : this.repo.db.prepare("SELECT * FROM jobs ORDER BY run_at").all();
    return (rows as any[]).map(row);
  }

  byKey(key: string): Job | null {
    const r = this.repo.db.prepare("SELECT * FROM jobs WHERE key = ?").get(key);
    return r ? row(r) : null;
  }
}
