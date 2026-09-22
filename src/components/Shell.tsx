import Link from 'next/link';
import type { ReactNode } from 'react';
import { can, type Role } from '@/lib/auth/rbac';
import { SignOutButton } from './SignOutButton';

const NAV = [
  {
    label: 'Estate',
    items: [
      { href: '/', label: 'MSP Portfolio', permission: 'read' as const },
      { href: '/analyse', label: 'Analyse a company', permission: 'analyse' as const },
      { href: '/benefits', label: 'Benefits Ledger', permission: 'read' as const },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/capabilities', label: 'Capability health', permission: 'read' as const },
      { href: '/integrations', label: 'Integrations', permission: 'read' as const },
      { href: '/autonomy', label: 'Autonomy & permissions', permission: 'read' as const },
      { href: '/activity', label: 'Activity & audit', permission: 'read' as const },
      { href: '/jobs', label: 'Background work', permission: 'read' as const },
    ],
  },
  {
    label: 'Administration',
    items: [{ href: '/settings/users', label: 'Users', permission: 'administer' as const }],
  },
];

export interface ShellUser {
  name: string;
  email: string;
  role: Role;
}

export function Shell({ children, user }: { children: ReactNode; user: ShellUser }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">AIGoGo MetaMSP</div>
          <div className="brand-sub">Land &amp; Expand Engine</div>
        </div>

        {NAV.map((group) => {
          const items = group.items.filter((item) => can(user.role, item.permission));
          if (items.length === 0) return null;
          return (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {items.map((item) => (
                <Link className="nav-item" href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          );
        })}

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name}</div>
          <div className="sidebar-user-meta">{user.email}</div>
          <div className="row between" style={{ marginTop: 8 }}>
            <span className={`badge ${user.role === 'READ_ONLY' ? 'muted' : 'ok'}`}>
              {user.role.replace('_', ' ').toLowerCase()}
            </span>
            <SignOutButton />
          </div>
        </div>
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
