import Link from 'next/link';

const TABS = [
  { seg: '', label: 'Overview' },
  { seg: 'make-more', label: 'Make more' },
  { seg: 'spend-less', label: 'Spend less' },
  { seg: 'msp-expand', label: 'MSP expand' },
  { seg: 'supply-chain', label: 'Supply chain' },
  { seg: 'twin', label: 'Company Twin' },
];

export function CompanyTabs({ companyId, active }: { companyId: string; active: string }) {
  return (
    <div className="tabs">
      {TABS.map((t) => (
        <Link
          key={t.seg}
          href={`/company/${companyId}${t.seg ? `/${t.seg}` : ''}`}
          className={`tab ${active === t.seg ? 'active' : ''}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
