import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  {
    label: 'Estate',
    items: [
      { href: '/', label: 'MSP Portfolio' },
      { href: '/analyse', label: 'Analyse a company' },
      { href: '/benefits', label: 'Benefits Ledger' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/capabilities', label: 'Capability health' },
      { href: '/integrations', label: 'Integrations' },
      { href: '/autonomy', label: 'Autonomy & permissions' },
      { href: '/activity', label: 'Activity & audit' },
    ],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">AIGoGo MetaMSP</div>
          <div className="brand-sub">Land &amp; Expand Engine</div>
        </div>
        {NAV.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => (
              <Link className="nav-item" href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

export function PageHead({ title, sub, crumb }: { title: string; sub?: string; crumb?: ReactNode }) {
  return (
    <div className="page-head">
      {crumb ? <div className="breadcrumb">{crumb}</div> : null}
      <h1 className="page-title">{title}</h1>
      {sub ? <p className="page-sub">{sub}</p> : null}
    </div>
  );
}
