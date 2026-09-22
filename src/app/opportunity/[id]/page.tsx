/** Opportunity Detail + Evidence — Directive §21. */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, requirePermission } from '@/lib/session';
import { getOpportunity, getTwin } from '@/lib/db/repositories/company';
import { listPlans } from '@/lib/execution/engine';
import { getPlaybook } from '@/lib/playbooks/registry';
import { getCapability } from '@/lib/capabilities/registry';
import { scoreOpportunity, startAvailable, effortLabel, timeToValueLabel } from '@/lib/core/opportunity';
import { valueOf } from '@/lib/core/provenance';
import { PageHead } from '@/components/Shell';
import { StartPanel } from '@/components/StartPanel';
import { categoryClass, categoryLabel, gbp, gbpExact, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('read');
  const { id } = await params;
  const database = await db();
  const o = getOpportunity(database, id);
  if (!o) notFound();

  const twin = getTwin(database, o.companyId);
  const companyName = twin ? ((valueOf(twin.legalName) as string | null) ?? o.companyId) : o.companyId;
  const playbook = o.playbookId ? getPlaybook(o.playbookId) : undefined;
  const gate = startAvailable(o);
  const breakdown = scoreOpportunity(o, undefined, o.category === 'MSP_EXPAND' ? 0.8 : 0.5);
  const existingPlan = listPlans(database, o.companyId).find((p) => p.opportunityId === o.id) ?? null;

  return (
    <>
      <PageHead
        title={o.title}
        crumb={
          <>
            <Link href="/">MSP Portfolio</Link> / <Link href={`/company/${o.companyId}`}>{companyName}</Link> /{' '}
            {categoryLabel(o.category)}
          </>
        }
      />

      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <span className={`badge ${categoryClass(o.category)}`}>{categoryLabel(o.category)}</span>
        <span className="badge muted">{o.subcategory}</span>
        <span className={`badge ${o.epistemics === 'hypothesis' ? 'hypothesis' : 'fact'}`}>
          {o.epistemics === 'hypothesis' ? 'Hypothesis' : 'Evidenced'}
        </span>
        {o.executionStatus !== 'NOT_STARTED' ? <span className="badge warn">{o.executionStatus.replace(/_/g, ' ')}</span> : null}
      </div>

      <div className="grid-4">
        <Fig label="Estimated annual value" value={gbpExact(o.estimatedAnnualValue)} tone={categoryClass(o.category)} />
        <Fig label="Implementation cost" value={gbpExact(o.implementationCost)} />
        <Fig label="Net benefit" value={gbpExact(o.netBenefit)} />
        <Fig label="ROI" value={Number.isFinite(o.roi) ? `${Math.round(o.roi * 100)}%` : '—'} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">The problem</div>
        <p style={{ marginTop: 0 }}>{o.problem}</p>
        <div className="card-title" style={{ marginTop: 16 }}>Why we are recommending this</div>
        <p style={{ marginTop: 0 }} className="dim">{o.reasoningSummary}</p>
        <div className="opp-meta" style={{ marginTop: 14 }}>
          <span><b>Confidence</b> {pct(o.confidence)}</span>
          <span><b>Effort</b> {effortLabel(o.effort)}</span>
          <span><b>Time to value</b> {timeToValueLabel(o.timeToValue)}</span>
          <span><b>Risk</b> {o.risk}</span>
          <span><b>Execution readiness</b> {pct(o.executionReadiness)}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Financial model</div>
        <p className="tiny faint" style={{ marginTop: -6 }}>
          <span className="mono">{o.financialModel.formula}</span>
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Line</th>
              <th className="num">Value</th>
              <th>Basis</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {o.financialModel.lines.map((line, i) => (
              <tr key={i}>
                <td>{line.label}</td>
                <td className="num">
                  {line.unit === 'GBP' || line.unit === 'GBP/month'
                    ? gbpExact(line.value)
                    : line.unit === 'percent'
                      ? `${line.value}%`
                      : line.value.toLocaleString('en-GB')}
                  {line.unit === 'GBP/month' ? <span className="faint tiny">/mo</span> : null}
                </td>
                <td>
                  <span className={`badge ${line.basis === 'observed' || line.basis === 'connected' ? 'fact' : line.basis === 'assumption' ? 'danger' : 'hypothesis'}`}>
                    {line.basis}
                  </span>
                </td>
                <td className="tiny faint">{line.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note" style={{ marginTop: 12 }}>
          Range {gbpExact(o.financialModel.lowEstimate)}–{gbpExact(o.financialModel.highEstimate)}. The band widens when
          the model rests on benchmarks rather than counted data.
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Evidence</div>
          {o.evidence.map((e, i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: i < o.evidence.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize: 13.5 }}>{e.statement}</div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <span className={`badge ${e.epistemics === 'fact' ? 'fact' : 'hypothesis'}`}>{e.epistemics}</span>
                <span className="tiny faint">{pct(e.confidence)} confidence</span>
                <span className="tiny faint">
                  {e.sources.map((s) => s.label).join(', ') || 'no source'}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Assumptions &amp; uncertainty</div>
          <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 13.5 }} className="dim">
            {o.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
          <div className="card-title">What would improve confidence</div>
          <div className="tiny dim">
            {o.requiredIntegrations.length > 0
              ? `Connect ${o.requiredIntegrations.join(', ')} to replace modelled figures with counted ones.`
              : 'No further data connection is needed for this opportunity.'}
          </div>
          {o.dependencies.length > 0 ? (
            <>
              <div className="card-title" style={{ marginTop: 16 }}>Dependencies</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} className="dim">
                {o.dependencies.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Score breakdown</div>
        <p className="tiny faint" style={{ marginTop: -6 }}>
          Ranking is an explicit calculation, not an opaque model judgement. Total {breakdown.total}.
        </p>
        <table className="table">
          <tbody>
            {breakdown.components.map((c, i) => (
              <tr key={i}>
                <td style={{ width: 220 }}>{c.label}</td>
                <td className="num faint" style={{ width: 80 }}>{c.weight > 0 ? `+${c.weight}` : c.weight}</td>
                <td className="num faint" style={{ width: 80 }}>×{c.input.toFixed(2)}</td>
                <td className="num" style={{ width: 90, color: c.contribution >= 0 ? 'var(--make-more)' : 'var(--danger)' }}>
                  {c.contribution >= 0 ? '+' : ''}{c.contribution.toFixed(1)}
                </td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {playbook ? (
        <div className="card">
          <div className="card-title">Recommended playbook</div>
          <div className="row between" style={{ marginBottom: 10 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{playbook.name}</span>
              <span className="mono tiny faint" style={{ marginLeft: 8 }}>v{playbook.version}</span>
            </div>
            <span className="tiny faint">{playbook.tasks.length} tasks</span>
          </div>
          <p className="dim tiny" style={{ marginTop: 0 }}>{playbook.description}</p>
          <table className="table">
            <tbody>
              {playbook.tasks.map((t, i) => (
                <tr key={t.action}>
                  <td className="faint num" style={{ width: 30 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600, width: 260 }}>{t.name}</td>
                  <td className="dim">{t.description}</td>
                  <td style={{ width: 120 }}>
                    {t.approvalRequired ? <span className="badge warn">approval</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card-title" style={{ marginTop: 16 }}>Capabilities</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {o.capabilities.map((c) => {
              const cap = getCapability(c);
              return (
                <span key={c} className={`badge ${cap?.maturity === 'mock' ? 'warn' : 'ok'}`}>
                  {cap?.name ?? c}{cap?.maturity === 'mock' ? ' · simulated' : ''}
                </span>
              );
            })}
          </div>
          <div className="card-title" style={{ marginTop: 16 }}>Stop conditions</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} className="dim">
            {playbook.stopConditions.length > 0
              ? playbook.stopConditions.map((s, i) => <li key={i}>{s}</li>)
              : <li className="faint">None defined</li>}
          </ul>
        </div>
      ) : null}

      <div id="start" />
      <StartPanel
        opportunityId={o.id}
        available={gate.available}
        reason={gate.reason}
        existingPlanId={existingPlan?.id ?? null}
        existingPlanStatus={existingPlan?.status ?? null}
      />
    </>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: tone ? `var(--${tone})` : undefined }}>{value}</div>
    </div>
  );
}
