import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/session';
import { getTwin, listOpportunities } from '@/lib/db/repositories/company';
import { valueOf } from '@/lib/core/provenance';
import { PageHead } from '@/components/Shell';
import { CompanyTabs } from '@/components/CompanyTabs';
import { OpportunityCard } from '@/components/OpportunityCard';
import { gbp } from '@/lib/format';
import type { OpportunityCategory } from '@/lib/core/opportunity';

export async function CategoryPage({
  id,
  category,
  seg,
  title,
  blurb,
}: {
  id: string;
  category: OpportunityCategory;
  seg: string;
  title: string;
  blurb: string;
}) {
  const database = await db();
  const twin = getTwin(database, id);
  if (!twin) notFound();

  const all = listOpportunities(database, id);
  const opportunities = all.filter((o) => o.category === category);
  const total = opportunities.reduce((s, o) => s + o.estimatedAnnualValue, 0);
  const name = (valueOf(twin.legalName) as string | null) ?? id;

  const bySubcategory = new Map<string, typeof opportunities>();
  for (const o of opportunities) {
    const list = bySubcategory.get(o.subcategory) ?? [];
    list.push(o);
    bySubcategory.set(o.subcategory, list);
  }

  return (
    <>
      <PageHead
        title={title}
        sub={`${opportunities.length} opportunities · ${gbp(total)} estimated annual value`}
        crumb={<><Link href="/">MSP Portfolio</Link> / <Link href={`/company/${id}`}>{name}</Link> / {title}</>}
      />
      <CompanyTabs companyId={id} active={seg} />
      <div className="note" style={{ marginBottom: 16 }}>{blurb}</div>

      {opportunities.length === 0 ? (
        <div className="empty">No opportunities in this category.</div>
      ) : (
        [...bySubcategory.entries()].map(([sub, list]) => (
          <div key={sub} style={{ marginBottom: 20 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 15, margin: 0, color: 'var(--text-dim)' }}>{sub}</h2>
              <span className="tiny faint">{gbp(list.reduce((s, o) => s + o.estimatedAnnualValue, 0))}</span>
            </div>
            {list.map((o) => (
              <OpportunityCard key={o.id} opportunity={o} />
            ))}
          </div>
        ))
      )}
    </>
  );
}
