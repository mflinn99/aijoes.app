/** Company Overview — Directive §20. */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, requirePermission } from '@/lib/session';
import { getTwin, listOpportunities } from '@/lib/db/repositories/company';
import { listCustomers } from '@/lib/db/repositories/tenant-data';
import { listPlans } from '@/lib/execution/engine';
import { understandingScore, type Signal } from '@/lib/core/company-twin';
import { valueOf } from '@/lib/core/provenance';
import { buildContext } from '@/lib/analysis/context';
import { getFacts } from '@/lib/db/repositories/facts';
import { recommendedConnections } from '@/lib/discovery/registry';
import { listBenefits, summariseLedger } from '@/lib/benefits/ledger';
import { PageHead } from '@/components/Shell';
import { CompanyTabs } from '@/components/CompanyTabs';
import { MoneyCards } from '@/components/MoneyCards';
import { OpportunityCard } from '@/components/OpportunityCard';
import { JojoBar } from '@/components/JojoBar';
import { gbp, gbpExact, pct, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CompanyOverview({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('read');
  const { id } = await params;
  const database = await db();
  const twin = getTwin(database, id);
  if (!twin) notFound();

  const opportunities = listOpportunities(database, id);
  const customer = listCustomers(database).find((c) => c.domain === (valueOf(twin.domain) as string | null));
  const ctx = buildContext(twin, getFacts(database, id));
  const understanding = understandingScore(twin);
  const plans = listPlans(database, id);
  const ledger = summariseLedger(listBenefits(database, id));
  const top = opportunities[0];

  const connections = recommendedConnections(twin.dataSources).slice(0, 4);
  const name = (valueOf(twin.legalName) as string | null) ?? (valueOf(twin.domain) as string | null) ?? id;
  const sectors = ctx.sectors;
  const signals = [
    ...((valueOf(twin.recruitmentSignals) as Signal[] | null) ?? []),
    ...((valueOf(twin.cyberIndicators) as Signal[] | null) ?? []),
  ];

  return (
    <>
      <PageHead
        title={name.toUpperCase()}
        sub={`Company understanding ${understanding}% · last analysed ${relativeTime(twin.lastUpdatedAt)}`}
        crumb={<><Link href="/">MSP Portfolio</Link> / {name}</>}
      />
      <CompanyTabs companyId={id} active="" />

      {understanding < 45 ? (
        <div className="note warn" style={{ marginBottom: 14 }}>
          Understanding is {understanding}%. The figures below are largely benchmark-led hypotheses rather than counted
          facts. Connecting the systems listed at the bottom of this page is the fastest way to make them defensible.
        </div>
      ) : null}

      <MoneyCards opportunities={opportunities} />

      {top ? (
        <div className="card" style={{ marginTop: 14, borderColor: 'var(--border-strong)' }}>
          <div className="card-title">Top next action</div>
          <div className="row between">
            <div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{top.title}</div>
              <div className="dim tiny" style={{ marginTop: 3 }}>
                Potential value {gbpExact(top.estimatedAnnualValue)} · confidence {pct(top.confidence)} · expected time
                to value {top.timeToValue} days
              </div>
            </div>
            <Link className="btn primary" href={`/opportunity/${top.id}`}>
              START
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-title">Company snapshot</div>
          <dl className="kv">
            <dt>Domain</dt><dd>{(valueOf(twin.domain) as string) ?? '—'}</dd>
            <dt>Sectors</dt><dd>{sectors.length ? sectors.join(', ') : <span className="faint">Not determined</span>}</dd>
            <dt>Customer segments</dt><dd>{ctx.segments.length ? ctx.segments.join(', ') : <span className="faint">Not determined</span>}</dd>
            <dt>Employees</dt>
            <dd>
              {ctx.employees.value} <span className="faint tiny">({ctx.employees.basis})</span>
            </dd>
            <dt>Turnover</dt>
            <dd>
              {gbpExact(ctx.turnover.value)} <span className="faint tiny">({ctx.turnover.basis}, {pct(ctx.turnover.confidence)} confidence)</span>
            </dd>
            <dt>Estimated IT spend</dt><dd>{gbpExact(ctx.itSpendEstimate)}</dd>
            <dt>Current MSP MRR</dt><dd>{customer ? gbpExact(customer.currentMrr) : '—'}</dd>
            <dt>Data sources</dt><dd>{twin.dataSources.join(', ') || <span className="faint">None</span>}</dd>
          </dl>
        </div>

        <div className="card">
          <div className="card-title">Business model &amp; proposition</div>
          <p style={{ marginTop: 0, fontSize: 14 }}>
            {((valueOf(twin.valuePropositions) as string[] | null) ?? [])[0] ?? (
              <span className="faint">No public proposition statement was found.</span>
            )}
          </p>
          <div className="card-title" style={{ marginTop: 16 }}>Services observed</div>
          <div className="tiny dim">
            {((valueOf(twin.services) as string[] | null) ?? []).slice(0, 8).join(' · ') || (
              <span className="faint">None identified</span>
            )}
          </div>
          <div className="card-title" style={{ marginTop: 16 }}>Key signals</div>
          {signals.length === 0 ? (
            <div className="tiny faint">No external signals detected.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} className="dim">
              {signals.slice(0, 6).map((s, i) => (
                <li key={i}>{s.summary}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Realised benefit</div>
        <div className="grid-4">
          <Mini label="Identified" value={gbp(ledger.identified)} />
          <Mini label="Approved" value={gbp(ledger.approved)} />
          <Mini label="Realised" value={gbp(ledger.realised)} tone="ok" />
          <Mini label="Active executions" value={String(plans.filter((p) => p.status === 'EXECUTING' || p.status === 'AWAITING_APPROVAL').length)} />
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Top opportunities</h2>
          <span className="tiny faint">{opportunities.length} total, ranked by score</span>
        </div>
        {opportunities.slice(0, 6).map((o) => (
          <OpportunityCard key={o.id} opportunity={o} />
        ))}
      </div>

      {connections.length > 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-title">Improve this analysis</div>
          <p className="tiny faint" style={{ marginTop: -6 }}>
            Estimated understanding uplift per connection. The platform becomes more valuable as data connections
            increase — and hypotheses become counted facts.
          </p>
          <table className="table">
            <tbody>
              {connections.map((c) => (
                <tr key={c.id}>
                  <td style={{ width: 240, fontWeight: 600 }}>Connect {c.name}</td>
                  <td className="dim">{c.unlocks}</td>
                  <td className="num" style={{ width: 90, color: 'var(--make-more)' }}>
                    +{c.understandingUplift}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <JojoBar companyId={id} />
      </div>
    </>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'ok' }) {
  return (
    <div>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: tone === 'ok' ? 'var(--ok)' : undefined }}>{value}</div>
    </div>
  );
}
