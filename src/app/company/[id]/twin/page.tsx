/** Company Twin — Directive §3 and §22: every field with its provenance. */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/session';
import { getTwin } from '@/lib/db/repositories/company';
import { TWIN_FIELDS, understandingScore, understandingGaps, getField, FIELD_WEIGHTS } from '@/lib/core/company-twin';
import { isConflicted, isStale, valueOf } from '@/lib/core/provenance';
import { PageHead } from '@/components/Shell';
import { CompanyTabs } from '@/components/CompanyTabs';
import { pct } from '@/lib/format';

export const dynamic = 'force-dynamic';

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value
      .map((v) => (typeof v === 'object' && v !== null ? ((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).summary ?? JSON.stringify(v)) : String(v)))
      .slice(0, 8)
      .join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = db();
  const twin = getTwin(database, id);
  if (!twin) notFound();

  const name = (valueOf(twin.legalName) as string | null) ?? id;
  const understanding = understandingScore(twin);
  const gaps = understandingGaps(twin).slice(0, 8);

  return (
    <>
      <PageHead
        title="Company Twin"
        sub={`${understanding}% understanding · ${twin.dataSources.length} data source(s) · every field carries its source, method and confidence`}
        crumb={<><Link href="/">MSP Portfolio</Link> / <Link href={`/company/${id}`}>{name}</Link> / Company Twin</>}
      />
      <CompanyTabs companyId={id} active="twin" />

      <div className="card">
        <div className="card-title">Populated fields</div>
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Method</th>
              <th className="num">Confidence</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {TWIN_FIELDS.filter((key) => getField(twin, key).current).map((key) => {
              const field = getField(twin, key);
              const current = field.current!;
              const conflicted = isConflicted(field);
              const stale = isStale(field, 30);
              return (
                <tr key={key}>
                  <td style={{ fontWeight: 600 }}>
                    {key}
                    {conflicted ? <span className="badge warn" style={{ marginLeft: 6 }}>conflict</span> : null}
                    {stale ? <span className="badge muted" style={{ marginLeft: 6 }}>stale</span> : null}
                  </td>
                  <td className="dim" style={{ maxWidth: 380 }}>{renderValue(current.value)}</td>
                  <td>
                    <span className={`badge ${current.epistemics === 'fact' ? 'fact' : current.epistemics === 'hypothesis' ? 'hypothesis' : 'muted'}`}>
                      {current.method}
                    </span>
                  </td>
                  <td className="num">{pct(current.confidence)}</td>
                  <td className="tiny faint">
                    {current.sources.map((s) => s.label).join(', ')}
                    {field.claims.length > 1 ? ` (+${field.claims.length - 1} other claim${field.claims.length > 2 ? 's' : ''})` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">Biggest gaps</div>
        <p className="tiny faint" style={{ marginTop: -6 }}>
          Fields weighted by analytical value. These are what the understanding score is missing.
        </p>
        <table className="table">
          <tbody>
            {gaps.map((g) => (
              <tr key={g.field}>
                <td style={{ fontWeight: 600 }}>{g.field}</td>
                <td className="num faint">weight {FIELD_WEIGHTS[g.field]}</td>
                <td className="dim">Not populated, or below 40% confidence</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
