'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { gbp, gbpExact, relativeTime } from '@/lib/format';

export interface PortfolioRow {
  companyId: string;
  name: string;
  domain: string | null;
  lastUpdatedAt: string;
  currentMrr: number;
  renewalDate: string | null;
  makeMore: number;
  spendLess: number;
  mspExpand: number;
  understanding: number;
  active: number;
  unstarted: number;
  realised: number;
}

/** Directive §17: the sorts an MSP actually works from. */
const SORTS: { id: string; label: string; compare: (a: PortfolioRow, b: PortfolioRow) => number }[] = [
  { id: 'unstarted', label: 'Unstarted value', compare: (a, b) => b.unstarted - a.unstarted },
  { id: 'make-more', label: 'Largest revenue opportunity', compare: (a, b) => b.makeMore - a.makeMore },
  { id: 'spend-less', label: 'Largest saving opportunity', compare: (a, b) => b.spendLess - a.spendLess },
  { id: 'msp-expand', label: 'Largest MSP expansion', compare: (a, b) => b.mspExpand - a.mspExpand },
  { id: 'understanding', label: 'Highest confidence', compare: (a, b) => b.understanding - a.understanding },
  { id: 'realised', label: 'Realised value', compare: (a, b) => b.realised - a.realised },
  { id: 'mrr', label: 'Current MRR', compare: (a, b) => b.currentMrr - a.currentMrr },
  {
    id: 'renewal',
    label: 'Renewal date',
    compare: (a, b) => (a.renewalDate ?? '9999').localeCompare(b.renewalDate ?? '9999'),
  },
  { id: 'name', label: 'Customer name', compare: (a, b) => a.name.localeCompare(b.name) },
];

const PAGE_SIZE = 25;

export function PortfolioTable({
  rows,
  query: initialQuery,
  sort: initialSort,
  page: initialPage,
}: {
  rows: PortfolioRow[];
  query: string;
  sort: string;
  page: number;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(Number.isFinite(initialPage) && initialPage > 0 ? initialPage : 1);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? rows.filter((r) => r.name.toLowerCase().includes(needle) || (r.domain ?? '').toLowerCase().includes(needle))
      : rows;
    const comparator = SORTS.find((s) => s.id === sort)?.compare ?? SORTS[0]!.compare;
    return [...matched].sort(comparator);
  }, [rows, query, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row between" style={{ marginBottom: 12, gap: 12 }}>
        <div className="card-title" style={{ margin: 0 }}>Customer estate</div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ width: 220, padding: '6px 10px', fontSize: 13 }}
            placeholder="Search customer or domain"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          />
          <select
            className="input"
            style={{ width: 230, padding: '6px 10px', fontSize: 13 }}
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(1); }}
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          {rows.length === 0 ? (
            <>No companies analysed yet. <Link href="/analyse" style={{ color: 'var(--make-more)' }}>Analyse a company</Link> or <Link href="/estate" style={{ color: 'var(--make-more)' }}>import your estate</Link>.</>
          ) : (
            <>Nothing matches &ldquo;{query}&rdquo;.</>
          )}
        </div>
      ) : (
        <>
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
              {visible.map((r) => (
                <tr key={r.companyId}>
                  <td>
                    <Link href={`/company/${r.companyId}`} style={{ fontWeight: 600 }}>{r.name}</Link>
                    <div className="tiny faint">
                      {r.domain ?? '—'} · analysed {relativeTime(r.lastUpdatedAt)}
                      {r.renewalDate ? ` · renews ${r.renewalDate}` : ''}
                    </div>
                  </td>
                  <td className="num">{gbpExact(r.currentMrr)}</td>
                  <td className="num" style={{ color: 'var(--make-more)' }}>{gbp(r.makeMore)}</td>
                  <td className="num" style={{ color: 'var(--spend-less)' }}>{gbp(r.spendLess)}</td>
                  <td className="num" style={{ color: 'var(--msp-expand)' }}>{gbp(r.mspExpand)}</td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                      <span>{r.understanding}%</span>
                      <div className={`meter ${r.understanding < 25 ? 'low' : r.understanding < 50 ? 'mid' : ''}`} style={{ width: 48 }}>
                        <span style={{ width: `${r.understanding}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="num">
                    {r.active > 0 ? r.active : <span className="faint">—</span>}
                    {r.realised > 0 ? <div className="tiny" style={{ color: 'var(--ok)' }}>{gbp(r.realised)}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pages > 1 ? (
            <div className="row between" style={{ marginTop: 12 }}>
              <span className="tiny faint">
                Showing {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn small" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button>
                <span className="tiny faint" style={{ padding: '0 6px' }}>Page {current} of {pages}</span>
                <button className="btn small" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
