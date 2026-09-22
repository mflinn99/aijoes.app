/** Background work — visibility into the durable queue (iteration 2). */

import { requirePermission } from '@/lib/session';
import { listJobs } from '@/lib/jobs/queue';
import { isRunning } from '@/lib/jobs/runner';
import { PageHead } from '@/components/Shell';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const session = await requirePermission('read');
  const jobs = listJobs(session.context.tenantId, 60);
  const active = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length;

  return (
    <>
      <PageHead
        title="Background work"
        sub={`${active} job(s) in flight · worker ${isRunning() ? 'running' : 'stopped'}`}
      />

      <div className="note">
        Analysis and execution run as durable jobs rather than in-request promises. A job whose worker dies is
        reclaimed once its lock goes stale, retried with backoff, and dead-lettered once its attempts are spent — so a
        restart mid-analysis no longer leaves a run stuck.
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Recent jobs</div>
        {jobs.length === 0 ? (
          <div className="empty">No background work yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th>Created</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{job.type}</div>
                    <div className="tiny faint mono">{job.id.slice(0, 8)}</div>
                  </td>
                  <td>
                    <span className={`badge ${
                      job.status === 'succeeded' ? 'ok'
                      : job.status === 'dead' || job.status === 'failed' ? 'danger'
                      : job.status === 'running' ? 'warn' : 'muted'
                    }`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="num faint">{job.attempts}/{job.maxAttempts}</td>
                  <td className="faint tiny nowrap">{relativeTime(job.createdAt)}</td>
                  <td className="tiny" style={{ color: job.lastError ? 'var(--danger)' : undefined, maxWidth: 420 }}>
                    {job.lastError ? job.lastError.split('\n')[0] : <span className="faint">—</span>}
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
