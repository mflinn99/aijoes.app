/** MSP Portfolio — Directive §17. */

import Link from 'next/link';
import { requirePermission } from '@/lib/session';
import { listCompanies, listOpportunities } from '@/lib/db/repositories/company';
import { listCustomers } from '@/lib/db/repositories/tenant-data';
import { nextBestActionAcrossEstate, portfolioValueSummary } from '@/lib/jojo/orchestrator';
import { TenantDb } from '@/lib/db/tenant';
import { getDb } from '@/lib/db/client';
import { PageHead } from '@/components/Shell';
import { JojoBar } from '@/components/JojoBar';
import { PortfolioTable, type PortfolioRow } from '@/components/PortfolioTable';
import { gbp, gbpExact, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; page?: string }>;
}) {
  const session = await requirePermission('read');
  const database = new TenantDb(session.context, getDb());
  const { q, sort, page } = await searchParams;

  const companies = listCompanies(database);
  const customers = listCustomers(database);
  const allOpportunities = listOpportunities(database);
  const nextAction = nextBestActionAcrossEstate(database);
  const ledger = portfolioValueSummary(database);

  const rows: PortfolioRow[] = companies.map((company) => {
    const customer = customers.find((c) => c.id === company.customerId);
    const opportunities = allOpportunities.filter((o) => o.companyId === company.id);
    const byCategory = (cat: string) =>
      opportunities.filter((o) => o.category === cat).reduce((s, o) => s + o.estimatedAnnualValue, 0);

    return {
      companyId: company.id,
      name: customer?.name ?? company.displayName,
      domain: company.domain,
      lastUpdatedAt: company.lastUpdatedAt,
      currentMrr: customer?.currentMrr ?? 0,
      renewalDate: customer?.renewalDate ?? null,
      makeMore: byCategory('MAKE_MORE'),
      spendLess: byCategory('SPEND_LESS'),
      mspExpand: byCategory('MSP_EXPAND'),
      understanding: company.understanding,
      active: opportunities.filter((o) => o.executionStatus !== 'NOT_STARTED').length,
      unstarted: opportunities
        .filter((o) => o.executionStatus === 'NOT_STARTED')
        .reduce((s, o) => s + o.estimatedAnnualValue, 0),
      realised: opportunities.reduce((s, o) => s + (o.realisedValue ?? 0), 0),
    };
  });

  const totals = {
    mrr: rows.reduce((s, r) => s + r.currentMrr, 0),
    opportunity: rows.reduce((s, r) => s + r.makeMore + r.spendLess + r.mspExpand, 0),
  };

  // Customers imported but not yet analysed have no twin, so they are counted
  // separately rather than silently missing from the estate.
  const unanalysed = customers.filter((c) => !companies.some((co) => co.customerId === c.id));

  return (
    <>
      <PageHead
        title="MSP Portfolio"
        sub={`${rows.length} analysed · ${gbpExact(totals.mrr)} current MRR · ${gbp(totals.opportunity)} identified opportunity`}
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
                {gbpExact(nextAction.opportunity.estimatedAnnualValue)} at {pct(nextAction.opportunity.confidence)}{' '}
                confidence, {nextAction.reason}
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

      {unanalysed.length > 0 ? (
        <div className="note warn" style={{ marginTop: 14 }}>
          {unanalysed.length} imported customer(s) have not been analysed yet — they appear here once their analysis
          completes. Watch progress on <Link href="/jobs" style={{ color: 'var(--make-more)' }}>Background work</Link>.
        </div>
      ) : null}

      <PortfolioTable
        rows={rows}
        query={q ?? ''}
        sort={sort ?? 'unstarted'}
        page={Number(page ?? '1')}
      />
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
