/**
 * Refresh scheduling — Directive §22.
 *
 * A Company Twin decays. Public pages change, headcount moves, licences drift,
 * and a figure that is eighteen months old still renders with the same
 * confidence as one from this morning unless something re-reads it. This keeps
 * each company on an interval and queues the re-analysis when it falls due.
 *
 * Re-analysis is already non-destructive: anything started, or whose benefit has
 * advanced, is history and is kept.
 */

import { randomUUID } from 'node:crypto';
import type { TenantDb } from '../db/tenant';
import { enqueueAnalysis } from '../jobs/queue';
import { createRun } from './pipeline';
import { getSynthetic } from '../fixtures/synthetic';

export const DEFAULT_INTERVAL_DAYS = 30;

export interface RefreshSchedule {
  id: string;
  companyId: string;
  intervalDays: number;
  nextRunAt: string;
  lastRunAt: string | null;
  enabled: boolean;
}

interface Row {
  id: string; company_id: string; interval_days: number;
  next_run_at: string; last_run_at: string | null; enabled: number;
}

function toSchedule(row: Row): RefreshSchedule {
  return {
    id: row.id,
    companyId: row.company_id,
    intervalDays: row.interval_days,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    enabled: row.enabled === 1,
  };
}

export function scheduleRefresh(
  db: TenantDb,
  companyId: string,
  intervalDays = DEFAULT_INTERVAL_DAYS,
  from = new Date(),
): RefreshSchedule {
  const nextRunAt = new Date(from.getTime() + intervalDays * 86_400_000).toISOString();
  db.run(
    `INSERT INTO refresh_schedules (id, tenant_id, company_id, interval_days, next_run_at, last_run_at, enabled, created_at)
     VALUES (@id, @tenantId, @companyId, @intervalDays, @nextRunAt, @lastRunAt, 1, @createdAt)
     ON CONFLICT(tenant_id, company_id) DO UPDATE SET
       interval_days = @intervalDays, next_run_at = @nextRunAt, last_run_at = @lastRunAt, enabled = 1`,
    {
      id: randomUUID(),
      companyId,
      intervalDays,
      nextRunAt,
      lastRunAt: from.toISOString(),
      createdAt: new Date().toISOString(),
    },
  );
  return getSchedule(db, companyId)!;
}

export function getSchedule(db: TenantDb, companyId: string): RefreshSchedule | null {
  const row = db.get<Row>(
    `SELECT * FROM refresh_schedules WHERE tenant_id = @tenantId AND company_id = @companyId`,
    { companyId },
  );
  return row ? toSchedule(row) : null;
}

export function listSchedules(db: TenantDb): RefreshSchedule[] {
  return db
    .all<Row>(`SELECT * FROM refresh_schedules WHERE tenant_id = @tenantId ORDER BY next_run_at`)
    .map(toSchedule);
}

export function setScheduleEnabled(db: TenantDb, companyId: string, enabled: boolean): void {
  db.run(
    `UPDATE refresh_schedules SET enabled = @enabled WHERE tenant_id = @tenantId AND company_id = @companyId`,
    { companyId, enabled: enabled ? 1 : 0 },
  );
}

export function dueSchedules(db: TenantDb, now = new Date()): RefreshSchedule[] {
  return db
    .all<Row>(
      `SELECT * FROM refresh_schedules
       WHERE tenant_id = @tenantId AND enabled = 1 AND next_run_at <= @now
       ORDER BY next_run_at`,
      { now: now.toISOString() },
    )
    .map(toSchedule);
}

/**
 * Queue a re-analysis for every company whose interval has elapsed. Returns the
 * number queued. Idempotent within a cycle: the schedule advances as it queues,
 * so a second call in the same minute finds nothing due.
 */
export function queueDueRefreshes(db: TenantDb, now = new Date()): number {
  const due = dueSchedules(db, now);
  let queued = 0;

  for (const schedule of due) {
    const company = db.get<{ domain: string | null; display_name: string; customer_id: string | null }>(
      `SELECT domain, display_name, customer_id FROM company_twins WHERE tenant_id = @tenantId AND id = @id`,
      { id: schedule.companyId },
    );
    if (!company) continue;

    const input = company.domain ?? company.display_name;
    const run = createRun(db, input);

    // A reference company refreshes from its fixture, not from a domain that
    // does not exist.
    const synthetic = getSynthetic(input);

    enqueueAnalysis(db, {
      runId: run.id,
      input,
      customerId: company.customer_id ?? '',
      offline: Boolean(synthetic),
      syntheticKey: synthetic?.key ?? null,
    });

    db.run(
      `UPDATE refresh_schedules
       SET last_run_at = @now, next_run_at = @next
       WHERE tenant_id = @tenantId AND id = @id`,
      {
        id: schedule.id,
        now: now.toISOString(),
        next: new Date(now.getTime() + schedule.intervalDays * 86_400_000).toISOString(),
      },
    );
    queued++;
  }

  return queued;
}
