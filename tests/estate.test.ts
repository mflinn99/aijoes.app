/** Bulk estate import and refresh scheduling — iteration 3. */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb } from '@/lib/db/client';
import { TenantDb } from '@/lib/db/tenant';
import { parseImport, applyImport, splitCsvLine } from '@/lib/estate/import';
import { listCustomers } from '@/lib/db/repositories/tenant-data';
import { listJobs } from '@/lib/jobs/queue';
import { scheduleRefresh, getSchedule, listSchedules, dueSchedules, queueDueRefreshes, setScheduleEnabled } from '@/lib/analysis/refresh';

let db: Database;
let tdb: TenantDb;

beforeEach(() => {
  db = createTestDb();
  db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t1', 'T1', 'MSP', '2026-01-01')`).run();
  tdb = new TenantDb({ tenantId: 't1', userId: 'u1', role: 'MSP_ADMIN' }, db);
});

describe('CSV parsing', () => {
  it('honours quoted fields containing commas', () => {
    expect(splitCsvLine('"Acme, Ltd",acme.com,2400')).toEqual(['Acme, Ltd', 'acme.com', '2400']);
    expect(splitCsvLine('a\tb\tc')).toEqual(['a', 'b', 'c']);
    expect(splitCsvLine('"He said ""hi""",x')).toEqual(['He said "hi"', 'x']);
  });

  it('detects a header row and maps by alias', () => {
    const parsed = parseImport(`Company Name,Website,Current MRR\nAcme Ltd,acme.co.uk,£2,400`);
    expect(parsed.headers).toEqual(['company name', 'website', 'current mrr']);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.name).toBe('Acme Ltd');
    expect(parsed.rows[0]!.domain).toBe('acme.co.uk');
  });

  it('falls back to column position with no header', () => {
    const parsed = parseImport(`Acme Ltd,acme.co.uk,2400,2027-03-31,Key account`);
    expect(parsed.headers).toBeNull();
    expect(parsed.rows[0]).toMatchObject({
      name: 'Acme Ltd', domain: 'acme.co.uk', currentMrr: 2400, renewalDate: '2027-03-31', note: 'Key account',
    });
  });

  it('accepts a bare list of domains or names', () => {
    const parsed = parseImport(`acme.co.uk\nBright Dental Group\nnorthern-logistics.com`);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]!.domain).toBe('acme.co.uk');
    expect(parsed.rows[1]!.domain).toBeNull();
    expect(parsed.rows[1]!.name).toBe('Bright Dental Group');
  });

  it('parses UK and ISO dates, and money with symbols', () => {
    const parsed = parseImport(`Acme,acme.co.uk,"£1,250",31/03/2027`);
    expect(parsed.rows[0]!.currentMrr).toBe(1250);
    expect(parsed.rows[0]!.renewalDate).toBe('2027-03-31');
  });

  it('reports a malformed domain rather than importing without one', () => {
    const parsed = parseImport(`name,domain\nAcme,not a domain. com`);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.problems[0]!.reason).toMatch(/not a usable domain/);
  });

  it('reports duplicates within the import', () => {
    const parsed = parseImport(`Acme,acme.co.uk\nAcme Again,acme.co.uk`);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.problems[0]!.reason).toMatch(/Duplicate/);
  });

  it('reports a line with nothing usable on it', () => {
    const parsed = parseImport(`name,domain\n,`);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.problems[0]!.reason).toMatch(/No customer name or domain/);
  });

  it('handles an empty input without throwing', () => {
    expect(parseImport('')).toEqual({ rows: [], problems: [], headers: null });
    expect(parseImport('\n\n   \n')).toEqual({ rows: [], problems: [], headers: null });
  });
});

describe('applying an import', () => {
  it('creates customers and queues one analysis each', () => {
    const parsed = parseImport(`Acme,acme.co.uk,2400\nBright,bright.co.uk,1800`);
    const result = applyImport(tdb, parsed);

    expect(result.created).toBe(2);
    expect(result.queued).toBe(2);
    expect(listCustomers(tdb)).toHaveLength(2);

    const jobs = listJobs('t1', 10, db);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.type === 'analysis' && j.status === 'pending')).toBe(true);
  });

  it('updates rather than duplicating a customer already present', () => {
    applyImport(tdb, parseImport(`Acme,acme.co.uk,2400`), { analyse: false });
    const second = applyImport(tdb, parseImport(`Acme Renamed,acme.co.uk,3000`), { analyse: false });

    expect(second.updated).toBe(1);
    expect(second.created).toBe(0);
    const customers = listCustomers(tdb);
    expect(customers).toHaveLength(1);
    expect(customers[0]!.currentMrr).toBe(3000);
  });

  it('can import without queueing any analysis', () => {
    const result = applyImport(tdb, parseImport(`Acme,acme.co.uk`), { analyse: false });
    expect(result.queued).toBe(0);
    expect(listJobs('t1', 10, db)).toHaveLength(0);
  });

  it('carries skipped lines through to the result', () => {
    const result = applyImport(tdb, parseImport(`Acme,acme.co.uk\nDup,acme.co.uk`), { analyse: false });
    expect(result.created).toBe(1);
    expect(result.skipped).toHaveLength(1);
  });

  it('keeps one tenant\'s import out of another\'s estate', () => {
    db.prepare(`INSERT INTO tenants (id, name, kind, created_at) VALUES ('t2', 'T2', 'MSP', '2026-01-01')`).run();
    const other = new TenantDb({ tenantId: 't2', userId: 'u2', role: 'MSP_ADMIN' }, db);

    applyImport(tdb, parseImport(`Acme,acme.co.uk`), { analyse: false });
    expect(listCustomers(other)).toHaveLength(0);
  });
});

describe('refresh scheduling', () => {
  beforeEach(() => {
    db.prepare(
      `INSERT INTO company_twins (id, tenant_id, display_name, domain, understanding, twin_json, created_at, last_updated_at)
       VALUES ('co1', 't1', 'Acme', 'acme.co.uk', 40, '{}', 'x', 'x')`,
    ).run();
  });

  it('schedules a company on an interval', () => {
    const schedule = scheduleRefresh(tdb, 'co1', 30, new Date('2026-09-01T00:00:00Z'));
    expect(schedule.intervalDays).toBe(30);
    expect(schedule.nextRunAt.slice(0, 10)).toBe('2026-10-01');
    expect(getSchedule(tdb, 'co1')!.enabled).toBe(true);
  });

  it('re-scheduling updates rather than duplicating', () => {
    scheduleRefresh(tdb, 'co1', 30);
    scheduleRefresh(tdb, 'co1', 7);
    expect(listSchedules(tdb)).toHaveLength(1);
    expect(getSchedule(tdb, 'co1')!.intervalDays).toBe(7);
  });

  it('reports nothing due before the interval elapses', () => {
    scheduleRefresh(tdb, 'co1', 30, new Date());
    expect(dueSchedules(tdb)).toHaveLength(0);
  });

  it('queues a re-analysis once due, and moves the schedule on', () => {
    scheduleRefresh(tdb, 'co1', 30, new Date('2026-01-01T00:00:00Z'));
    expect(dueSchedules(tdb)).toHaveLength(1);

    const queued = queueDueRefreshes(tdb);
    expect(queued).toBe(1);
    expect(listJobs('t1', 10, db)[0]!.type).toBe('analysis');

    // The schedule advanced, so a second pass in the same cycle finds nothing.
    expect(queueDueRefreshes(tdb)).toBe(0);
    expect(new Date(getSchedule(tdb, 'co1')!.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('skips a paused schedule', () => {
    scheduleRefresh(tdb, 'co1', 30, new Date('2026-01-01T00:00:00Z'));
    setScheduleEnabled(tdb, 'co1', false);
    expect(dueSchedules(tdb)).toHaveLength(0);
    expect(queueDueRefreshes(tdb)).toBe(0);
  });

  it('does not queue for a company that no longer exists', () => {
    scheduleRefresh(tdb, 'gone', 30, new Date('2026-01-01T00:00:00Z'));
    expect(queueDueRefreshes(tdb)).toBe(0);
  });
});
