/** Benefits Ledger — Directive §16. */

import Link from 'next/link';
import { db } from '@/lib/session';
import { listBenefits, summariseLedger, STAGE_ORDER, STAGE_DESCRIPTIONS } from '@/lib/benefits/ledger';
import { listOpportunities, listCompanies } from '@/lib/db/repositories/company';
import { getCapability } from '@/lib/capabilities/registry';
import { costSummary } from '@/lib/observability/events';
import { PageHead } from '@/components/Shell';
import { gbp, gbpExact } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function BenefitsPage() {
  const database = db();
  const benefits = listBenefits(database);
  const summary = summariseLedger(benefits);
  const opportunities = listOpportunities(database);
  const companies = listCompanies(database);
  const costs = costSummary(database);

  const moved = benefits.filter((b) => b.stage !== 'THEORETICAL');

  return (
    <>
      <PageHead
        title="Benefits Ledger"
        sub="How much value have we identified, how much is approved, how much is executing, and how much has actually been realised."
      />

      <div className="grid-4">
        <Stat label="Identified" value={gbp(summary.identified)} />
        <Stat label="Approved" value={gbp(summary.approved)} />
        <Stat label="Executing" value={gbp(summary.executing)} />
        <Stat label="Realised" value={gbp(summary.realised)} tone="ok" />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Value by stage</div>
        <table className="table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>What it means</th>
              <th className="num">Value</th>
              <th className="num">Records</th>
            </tr>
          </thead>
          <tbody>
            {STAGE_ORDER.map((stage) => {
              const records = benefits.filter((b) => b.stage === stage);
              return (
                <tr key={stage}>
                  <td style={{ fontWeight: 600 }}>{stage}</td>
                  <td className="dim tiny">{STAGE_DESCRIPTIONS[stage]}</td>
                  <td className="num">{gbpExact(summary.byStage[stage])}</td>
                  <td className="num faint">{records.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {summary.verified === 0 ? (
          <div className="note warn" style={{ marginTop: 12 }}>
            Nothing is verified. Verification requires confirmation against a connected system of record — with every
            AIGoGo capability currently simulated, realised value is modelled and must not be presented to a customer
            as confirmed.
          </div>
        ) : null}
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-title">Which capabilities created the value</div>
          {summary.byCapability.length === 0 ? (
            <div className="faint tiny">No value has been realised yet.</div>
          ) : (
            <table className="table">
              <tbody>
                {summary.byCapability.map((c) => (
                  <tr key={c.capabilityId}>
                    <td style={{ fontWeight: 600 }}>{getCapability(c.capabilityId)?.name ?? c.capabilityId}</td>
                    <td className="num">{gbpExact(c.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-title">Cost versus benefit</div>
          <dl className="kv">
            <dt>Execution and AI cost</dt><dd>£{costs.totalCostGbp.toFixed(2)}</dd>
            <dt>Benefit produced</dt><dd style={{ color: 'var(--ok)' }}>{gbpExact(costs.totalBenefitGbp)}</dd>
            <dt>Return on execution</dt><dd>{costs.returnOnExecution > 0 ? `${costs.returnOnExecution}×` : '—'}</dd>
            <dt>Agent events</dt><dd>{costs.eventCount} ({costs.failureCount} failed)</dd>
          </dl>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Which customers have the largest unexploited opportunity</div>
        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th className="num">Unstarted value</th>
              <th className="num">In flight</th>
              <th className="num">Realised</th>
            </tr>
          </thead>
          <tbody>
            {companies
              .map((company) => {
                const opps = opportunities.filter((o) => o.companyId === company.id);
                return {
                  company,
                  unstarted: opps.filter((o) => o.executionStatus === 'NOT_STARTED').reduce((s, o) => s + o.estimatedAnnualValue, 0),
                  inFlight: opps.filter((o) => o.executionStatus === 'EXECUTING' || o.executionStatus === 'AWAITING_APPROVAL').reduce((s, o) => s + o.estimatedAnnualValue, 0),
                  realised: opps.reduce((s, o) => s + (o.realisedValue ?? 0), 0),
                };
              })
              .sort((a, b) => b.unstarted - a.unstarted)
              .map((r) => (
                <tr key={r.company.id}>
                  <td><Link href={`/company/${r.company.id}`} style={{ fontWeight: 600 }}>{r.company.displayName}</Link></td>
                  <td className="num">{gbpExact(r.unstarted)}</td>
                  <td className="num">{r.inFlight > 0 ? gbpExact(r.inFlight) : <span className="faint">—</span>}</td>
                  <td className="num" style={{ color: r.realised > 0 ? 'var(--ok)' : undefined }}>
                    {r.realised > 0 ? gbpExact(r.realised) : <span className="faint">—</span>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {moved.length > 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-title">Benefit records in flight</div>
          <table className="table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Type</th>
                <th>Stage</th>
                <th className="num">Forecast</th>
                <th className="num">Realised</th>
              </tr>
            </thead>
            <tbody>
              {moved.map((b) => {
                const o = opportunities.find((x) => x.id === b.opportunityId);
                return (
                  <tr key={b.id}>
                    <td>
                      {o ? <Link href={`/opportunity/${o.id}`}>{o.title}</Link> : <span className="faint">{b.opportunityId}</span>}
                    </td>
                    <td className="faint">{b.type}</td>
                    <td><span className="badge ok">{b.stage}</span></td>
                    <td className="num">{gbpExact(b.forecastValue)}</td>
                    <td className="num" style={{ color: b.realisedValue > 0 ? 'var(--ok)' : undefined }}>
                      {b.realisedValue > 0 ? gbpExact(b.realisedValue) : <span className="faint">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: tone === 'ok' ? 'var(--ok)' : undefined }}>{value}</div>
    </div>
  );
}
