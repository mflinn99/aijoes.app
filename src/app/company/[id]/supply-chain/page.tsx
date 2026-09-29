import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, requirePermission } from '@/lib/session';
import { getTwin, listSuppliers } from '@/lib/db/repositories/company';
import { summariseSupplyChain } from '@/lib/analysis/supply-chain';
import { valueOf } from '@/lib/core/provenance';
import { PageHead } from '@/components/Shell';
import { CompanyTabs } from '@/components/CompanyTabs';
import { gbp, gbpExact, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('read');
  const { id } = await params;
  const database = await db();
  const twin = getTwin(database, id);
  if (!twin) notFound();

  const suppliers = listSuppliers(database, id);
  const summary = summariseSupplyChain(suppliers);
  const name = (valueOf(twin.legalName) as string | null) ?? id;
  const maxSpend = Math.max(1, ...suppliers.map((s) => s.annualSpend));

  return (
    <>
      <PageHead
        title="Supply chain"
        sub={`${summary.supplierCount} supplier relationships · ${gbp(summary.totalAnnualSpend)} annual spend · ${gbp(summary.totalSavingsPotential)} savings potential`}
        crumb={<><Link href="/">MSP Portfolio</Link> / <Link href={`/company/${id}`}>{name}</Link> / Supply chain</>}
      />
      <CompanyTabs companyId={id} active="supply-chain" />

      {summary.basis !== 'connected' ? (
        <div className="note warn" style={{ marginBottom: 14 }}>
          This supply chain is a hypothesis. Suppliers are inferred from public technology indicators and category
          benchmarks, not from invoices. Connect accounting, banking or procurement and every figure below becomes a
          counted number — and the savings become quantified opportunities rather than estimates.
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">Spend by category</div>
        {suppliers.map((s) => (
          <div key={s.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{s.category}</span>
                <span className="faint tiny" style={{ marginLeft: 8 }}>{s.supplierName}</span>
              </div>
              <div className="nowrap">
                <span className="mono tiny dim">{gbpExact(s.annualSpend)}/yr</span>
                <span className="mono tiny" style={{ color: 'var(--spend-less)', marginLeft: 12 }}>
                  −{gbpExact(s.savingsPotential)}
                </span>
              </div>
            </div>
            <div className="meter" style={{ marginBottom: 8 }}>
              <span style={{ width: `${(s.annualSpend / maxSpend) * 100}%`, background: 'var(--spend-less-dim)' }} />
            </div>
            <div className="opp-meta">
              <span><b>Criticality</b> {s.criticality}</span>
              <span><b>Switching</b> {s.switchingComplexity}</span>
              <span><b>Renewal</b> {s.renewalDate ?? '—'}</span>
              <span><b>Spend confidence</b> {pct(s.spendConfidence)}</span>
              <span><b>Basis</b> {s.basis}</span>
            </div>
            <div className="tiny faint" style={{ marginTop: 6 }}>
              Depends on: {s.dependencies.join(', ') || '—'} · Alternatives: {s.alternatives.join(', ') || '—'}
            </div>
            <div className="tiny" style={{ marginTop: 4, color: 'var(--warn)' }}>{s.risk}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Renewal calendar</div>
        <table className="table">
          <thead>
            <tr>
              <th>Renewal date</th>
              <th>Category</th>
              <th>Supplier</th>
              <th className="num">Annual spend</th>
              <th className="num">Savings potential</th>
            </tr>
          </thead>
          <tbody>
            {[...suppliers]
              .filter((s) => s.renewalDate)
              .sort((a, b) => (a.renewalDate! < b.renewalDate! ? -1 : 1))
              .map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.renewalDate}</td>
                  <td>{s.category}</td>
                  <td className="dim">{s.supplierName}</td>
                  <td className="num">{gbpExact(s.annualSpend)}</td>
                  <td className="num" style={{ color: 'var(--spend-less)' }}>{gbpExact(s.savingsPotential)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
