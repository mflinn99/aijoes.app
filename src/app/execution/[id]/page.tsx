/** Execution Monitoring — Directive §19 screens 11–12. */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, requirePermission } from '@/lib/session';
import { getPlan } from '@/lib/execution/engine';
import { getOpportunity, getTwin } from '@/lib/db/repositories/company';
import { getBenefitByOpportunity } from '@/lib/benefits/ledger';
import { valueOf } from '@/lib/core/provenance';
import { PageHead } from '@/components/Shell';
import { ExecutionControls } from '@/components/ExecutionControls';
import { VerifyPanel } from '@/components/VerifyPanel';
import { getBaseline } from '@/lib/verification/baseline';
import { gbpExact } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('read');
  const { id } = await params;
  const database = await db();
  const plan = getPlan(database, id);
  if (!plan) notFound();

  const opportunity = getOpportunity(database, plan.opportunityId);
  const twin = getTwin(database, plan.companyId);
  const companyName = twin ? ((valueOf(twin.legalName) as string | null) ?? plan.companyId) : plan.companyId;
  const benefit = getBenefitByOpportunity(database, plan.opportunityId);

  const done = plan.tasks.filter((t) => t.status === 'COMPLETED').length;
  const measured = plan.tasks.reduce((s, t) => s + (t.measuredValueGbp ?? 0), 0);
  const cost = plan.tasks.reduce((s, t) => s + t.costGbp, 0);
  const awaiting = plan.tasks.find((t) => t.status === 'AWAITING_APPROVAL') ?? null;
  const baseline = getBaseline(database, plan.id);

  return (
    <>
      <PageHead
        title={plan.objective}
        sub={`Execution plan ${plan.id.slice(0, 8)} · ${plan.status.replace(/_/g, ' ').toLowerCase()}`}
        crumb={
          <>
            <Link href="/">MSP Portfolio</Link> / <Link href={`/company/${plan.companyId}`}>{companyName}</Link> /{' '}
            {opportunity ? <Link href={`/opportunity/${opportunity.id}`}>{opportunity.title}</Link> : 'Execution'}
          </>
        }
      />

      <div className="grid-4">
        <Fig label="Progress" value={`${done}/${plan.tasks.length} tasks`} />
        <Fig label="Financial target" value={gbpExact(plan.financialTarget)} />
        <Fig label="Measured value" value={gbpExact(measured)} tone={measured > 0 ? 'ok' : undefined} />
        <Fig label="Execution cost" value={`£${cost.toFixed(2)}`} />
      </div>

      <ExecutionControls
        planId={plan.id}
        status={plan.status}
        awaitingTask={awaiting ? { id: awaiting.id, name: awaiting.name, capability: awaiting.assignedCapabilityName } : null}
      />

      {plan.status === 'COMPLETED' ? (
        <VerifyPanel
          planId={plan.id}
          hasBaseline={Boolean(baseline)}
          verifyAfter={baseline?.verifyAfter ?? null}
          alreadyVerified={Boolean(baseline?.verifiedAt)}
          verifiedValue={baseline?.verifiedValue ?? null}
          outcome={baseline?.outcome ?? null}
        />
      ) : null}

      <div className="card">
        <div className="card-title">Tasks</div>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Task</th>
              <th>Capability</th>
              <th style={{ width: 130 }}>Status</th>
              <th className="num" style={{ width: 110 }}>Value</th>
              <th className="num" style={{ width: 80 }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {plan.tasks.map((t) => (
              <tr key={t.id}>
                <td className="faint num">{t.seq + 1}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  {t.outcome ? <div className="tiny faint">{t.outcome}</div> : null}
                  {t.evidence.length > 0 ? (
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16 }} className="tiny faint">
                      {t.evidence.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  ) : null}
                </td>
                <td>
                  {t.assignedCapabilityName}
                  {t.simulated ? <span className="badge warn" style={{ marginLeft: 6 }}>sim</span> : null}
                </td>
                <td>
                  <span className={`badge ${statusTone(t.status)}`}>{t.status.replace(/_/g, ' ').toLowerCase()}</span>
                  {t.retryCount > 0 ? <div className="tiny faint">{t.retryCount} retr{t.retryCount === 1 ? 'y' : 'ies'}</div> : null}
                </td>
                <td className="num">{t.measuredValueGbp ? gbpExact(t.measuredValueGbp) : <span className="faint">—</span>}</td>
                <td className="num faint">£{t.costGbp.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Benefit</div>
          {benefit ? (
            <dl className="kv">
              <dt>Stage</dt><dd><span className="badge ok">{benefit.stage}</span></dd>
              <dt>Type</dt><dd>{benefit.type}</dd>
              <dt>Forecast</dt><dd>{gbpExact(benefit.forecastValue)}</dd>
              <dt>Realised</dt><dd style={{ color: 'var(--ok)' }}>{gbpExact(benefit.realisedValue)}</dd>
              <dt>Verified</dt>
              <dd>
                {benefit.verifiedValue > 0 ? gbpExact(benefit.verifiedValue) : (
                  <span className="faint">Not verified — requires a connected system of record</span>
                )}
              </dd>
              <dt>Measurement</dt><dd className="tiny mono dim">{benefit.measurementMethod}</dd>
            </dl>
          ) : (
            <div className="faint">No benefit record.</div>
          )}
        </div>
        <div className="card">
          <div className="card-title">Plan detail</div>
          <dl className="kv">
            <dt>Playbook</dt><dd>{plan.playbookId} <span className="mono tiny faint">v{plan.playbookVersion}</span></dd>
            <dt>Autonomy</dt><dd className="tiny dim">{plan.autonomyReason}</dd>
            <dt>Authorised by</dt><dd>{plan.authorisedBy ?? <span className="faint">Not authorised</span>}</dd>
            <dt>Authorised at</dt><dd className="tiny">{plan.authorisedAt ?? '—'}</dd>
            <dt>Capabilities</dt><dd>{plan.requiredCapabilities.join(', ')}</dd>
            <dt>Rollback</dt><dd className="tiny dim">{plan.rollbackPlan}</dd>
          </dl>
        </div>
      </div>
    </>
  );
}

function statusTone(status: string): string {
  if (status === 'COMPLETED') return 'ok';
  if (status === 'FAILED') return 'danger';
  if (status === 'AWAITING_APPROVAL') return 'warn';
  return 'muted';
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: tone ? `var(--${tone})` : undefined }}>{value}</div>
    </div>
  );
}
