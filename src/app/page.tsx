/** MSP Portfolio — Directive §17. */

import Link from 'next/link';
import { db } from '@/lib/session';
import { listCompanies, listOpportunities } from '@/lib/db/repositories/company';
import { listCustomers } from '@/lib/db/repositories/tenant-data';
import { nextBestActionAcrossEstate, portfolioValueSummary } from '@/lib/jojo/orchestrator';
import { PageHead } from '@/components/Shell';
import { JojoBar } from '@/components/JojoBar';
import { gbp, gbpExact, pct, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function PortfolioPage() {
  const database = db();
  const companies = listCompanies(database);
  const customers = listCustomers(database);
  const allOpportunities = listOpportunities(database);
  const nextAction = nextBestActionAcrossEstate(database);
  const ledger = portfolioValueSummary(database);

  const rows = companies.map((company) => {
    const customer = customers.find((c) => c.id === company.customerId);
    const opportunities = allOpportunities.filter((o) => o.companyId === company.id);
    const byCategory = (cat: string) =>
      opportunities.filter((o) => o.category === cat).reduce((s, o) => s + o.estimatedAnnualValue, 0);
    return {
      company,
      customer,
      makeMore: byCategory('MAKE_MORE'),
      spendLess: byCategory('SPEND_LESS'),
      mspExpand: byCategory('MSP_EXPAND'),
      active: opportunities.filter((o) => o.executionStatus !== 'NOT_STARTED').length,
      total: opportunities.length,
    };
  });

  const totals = {
    mrr: rows.reduce((s, r) => s + (r.customer?.currentMrr ?? 0), 0),
    makeMore: rows.reduce((s, r) => s + r.makeMore, 0),
    spendLess: rows.reduce((s, r) => s + r.spendLess, 0),
    mspExpand: rows.reduce((s, r) => s + r.mspExpand, 0),
  };

  return (
    <>
      <PageHead
        title="MSP Portfolio"
        sub={`${rows.length} customers · ${gbpExact(totals.mrr)} current MRR · ${gbp(totals.makeMore + totals.spendLess + totals.mspExpand)} identified opportunity`}
      />

      <JojoBar />

      {nextAction ? (
        <div className="card" style={{ marginTop: 14, borderColor: 'var(--border-strong)' }}>
          <div className="card-title">Next best action across estate</div>
          <div className="row between">
            <div>
              <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 2 }}>
                {nextAction.opportunity.title} — {nextAction.customerName}
              </div>
              <div className="dim tiny">
                {gbpExact(nextAction.opportunity.estimatedAnnualValue)} at{' '}
                {pct(nextAction.opportunity.confidence)} confidence, {nextAction.reason}
              </div>
            </div>
            <Link className="btn primary" href={`/opportunity/${nextAction.opportunity.id}`}>
              Review and start
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid-4" style={{ marginTop: 14 }}>
        <Stat label="Value identified" value={gbp(ledger.identified)} />
        <Stat label="Approved" value={gbp(ledger.approved)} />
        <Stat label="Realised" value={gbp(ledger.realised)} tone="ok" />
        <Stat label="Verified" value={gbp(ledger.verified)} tone={ledger.verified > 0 ? 'ok' : 'faint'} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Customer estate</div>
        {rows.length === 0 ? (
          <div className="empty">
            No companies analysed yet. <Link href="/analyse" style={{ color: 'var(--make-more)' }}>Analyse a company</Link> to begin.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Current MRR</th>
                <th className="num">Make more</th>
                <th className="num">Spend less</th>
                <th className="num">MSP expand ARR</th>
                <th className="num">Understanding</th>
                <th className="num">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.company.id}>
                  <td>
                    <Link href={`/company/${r.company.id}`} style={{ fontWeight: 600 }}>
                      {r.customer?.name ?? r.company.displayName}
                    </Link>
                    <div className="tiny faint">
                      {r.company.domain ?? '—'} · analysed {relativeTime(r.company.lastUpdatedAt)}
                    </div>
                  </td>
                  <td className="num">{gbpExact(r.customer?.currentMrr ?? 0)}</td>
                  <td className="num" style={{ color: 'var(--make-more)' }}>{gbp(r.makeMore)}</td>
                  <td className="num" style={{ color: 'var(--spend-less)' }}>{gbp(r.spendLess)}</td>
                  <td className="num" style={{ color: 'var(--msp-expand)' }}>{gbp(r.mspExpand)}</td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                      <span>{r.company.understanding}%</span>
                      <div className="meter" style={{ width: 48 }}>
                        <span style={{ width: `${r.company.understanding}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="num">{r.active > 0 ? r.active : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'faint' }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          marginTop: 4,
          letterSpacing: '-0.02em',
          color: tone === 'ok' ? 'var(--ok)' : tone === 'faint' ? 'var(--text-faint)' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
