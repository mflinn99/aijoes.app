import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, requirePermission } from '@/lib/session';
import { getTwin, listOpportunities } from '@/lib/db/repositories/company';
import { listCustomers } from '@/lib/db/repositories/tenant-data';
import { valueOf } from '@/lib/core/provenance';
import { buildContext } from '@/lib/analysis/context';
import { getFacts } from '@/lib/db/repositories/facts';
import { mspExpansionSummary, MSP_SERVICES } from '@/lib/analysis/engines/msp-expand';
import { ServicesHeld } from '@/components/ServicesHeld';
import { can } from '@/lib/auth/rbac';
import { PageHead } from '@/components/Shell';
import { CompanyTabs } from '@/components/CompanyTabs';
import { OpportunityCard } from '@/components/OpportunityCard';
import { gbpExact, pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('read');
  const { id } = await params;
  const database = await db();
  const twin = getTwin(database, id);
  if (!twin) notFound();

  const opportunities = listOpportunities(database, id).filter((o) => o.category === 'MSP_EXPAND');
  const ctx = buildContext(twin, getFacts(database, id));
  const domain = valueOf(twin.domain) as string | null;
  const customer = listCustomers(database).find((c) => c.domain === domain);
  const summary = mspExpansionSummary(opportunities, customer?.currentMrr ?? 0);
  const name = (valueOf(twin.legalName) as string | null) ?? id;

  return (
    <>
      <PageHead
        title="MSP expand"
        sub="What this company's MSP should reasonably offer next, with the delivery economics attached."
        crumb={<><Link href="/">MSP Portfolio</Link> / <Link href={`/company/${id}`}>{name}</Link> / MSP expand</>}
      />
      <CompanyTabs companyId={id} active="msp-expand" />

      {customer ? (
        <ServicesHeld
          customerId={customer.id}
          catalogue={MSP_SERVICES.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
          held={customer.currentServices}
          editable={can(session.context.role, 'analyse')}
        />
      ) : null}

      <div className="grid-4" style={{ marginTop: 14 }}>
        <Fig label="Current MSP MRR" value={gbpExact(summary.currentMrr)} />
        <Fig label="Potential MSP MRR" value={gbpExact(summary.potentialMrr)} tone="msp" />
        <Fig label="Expansion opportunity" value={`+${gbpExact(summary.expansionMrr)} MRR`} tone="msp" />
        <Fig label="Potential annual increase" value={gbpExact(summary.potentialAnnualIncrease)} tone="msp" />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Service economics</div>
        <table className="table">
          <thead>
            <tr>
              <th>Service</th>
              <th className="num">Monthly charge</th>
              <th className="num">Delivery cost</th>
              <th className="num">Gross margin</th>
              <th className="num">ARR</th>
              <th>Sensitivity</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => {
              const charge = o.financialModel.lines.find((l) => l.label === 'Monthly charge')?.value ?? 0;
              const cost = o.financialModel.lines.find((l) => l.label === 'MSP delivery cost')?.value ?? 0;
              const margin = o.financialModel.lines.find((l) => l.label === 'Monthly gross margin')?.value ?? 0;
              const sensitivity = o.risk === 'high' ? 'delicate' : o.risk === 'medium' ? 'considered' : 'routine';
              return (
                <tr key={o.id}>
                  <td>
                    <Link href={`/opportunity/${o.id}`} style={{ fontWeight: 600 }}>{o.title}</Link>
                    <div className="tiny faint">{o.subcategory}</div>
                  </td>
                  <td className="num">{gbpExact(charge)}</td>
                  <td className="num faint">{gbpExact(cost)}</td>
                  <td className="num" style={{ color: 'var(--msp-expand)' }}>
                    {gbpExact(margin)} <span className="faint tiny">({charge > 0 ? pct(margin / charge) : '—'})</span>
                  </td>
                  <td className="num">{gbpExact(o.estimatedAnnualValue)}</td>
                  <td>
                    <span className={`badge ${sensitivity === 'delicate' ? 'danger' : sensitivity === 'considered' ? 'warn' : 'ok'}`}>
                      {sensitivity}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>Expansion opportunities</h2>
        {opportunities.map((o) => (
          <OpportunityCard key={o.id} opportunity={o} />
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Actions</div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn" href={`/opportunity/${opportunities[0]?.id ?? ''}`}>BUILD PROPOSAL</Link>
          <Link className="btn" href={`/opportunity/${opportunities[0]?.id ?? ''}`}>PREPARE CUSTOMER REVIEW</Link>
          <Link className="btn primary" href={`/opportunity/${opportunities[0]?.id ?? ''}#start`}>START DELIVERY</Link>
        </div>
        <div className="tiny faint" style={{ marginTop: 10 }}>
          Each action creates a real execution plan against the {ctx.employees.value}-user estate and stops at
          authorisation before anything reaches the customer.
        </div>
      </div>
    </>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: 'msp' }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: tone === 'msp' ? 'var(--msp-expand)' : undefined }}>
        {value}
      </div>
    </div>
  );
}
