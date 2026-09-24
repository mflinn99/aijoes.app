/** Import a customer estate — iteration 3. */

import Link from 'next/link';
import { requirePermission } from '@/lib/session';
import { listCustomers } from '@/lib/db/repositories/tenant-data';
import { listSchedules } from '@/lib/analysis/refresh';
import { TenantDb } from '@/lib/db/tenant';
import { getDb } from '@/lib/db/client';
import { PageHead } from '@/components/Shell';
import { EstateImport } from '@/components/EstateImport';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function EstatePage() {
  const session = await requirePermission('analyse');
  const database = new TenantDb(session.context, getDb());
  const customers = listCustomers(database);
  const schedules = listSchedules(database);

  return (
    <>
      <PageHead
        title="Customer estate"
        sub={`${customers.length} customer(s) · ${schedules.filter((s) => s.enabled).length} on a refresh schedule`}
      />

      <EstateImport />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Refresh schedule</div>
        <p className="tiny faint" style={{ marginTop: -6 }}>
          A Company Twin decays: public pages change, headcount moves, licences drift. Without a refresh, an
          eighteen-month-old figure still renders at full confidence. Each analysed company is re-read on an interval.
        </p>
        {schedules.length === 0 ? (
          <div className="empty">Nothing scheduled yet — a schedule is created the first time a company is analysed.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th className="num">Interval</th>
                <th>Last refreshed</th>
                <th>Next due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/company/${s.companyId}`}>{s.companyId.slice(0, 8)}</Link>
                  </td>
                  <td className="num faint">{s.intervalDays} days</td>
                  <td className="faint tiny">{s.lastRunAt ? relativeTime(s.lastRunAt) : 'never'}</td>
                  <td className="faint tiny nowrap">{s.nextRunAt.slice(0, 10)}</td>
                  <td>
                    <span className={`badge ${s.enabled ? 'ok' : 'muted'}`}>{s.enabled ? 'scheduled' : 'paused'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
