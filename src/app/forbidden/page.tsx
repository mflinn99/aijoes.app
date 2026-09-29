import Link from 'next/link';
import { requireSession } from '@/lib/auth/guard';
import { permissionsFor, ROLE_DESCRIPTIONS } from '@/lib/auth/rbac';
import { PageHead } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ permission?: string }>;
}) {
  const session = await requireSession();
  const { permission } = await searchParams;
  const role = session.context.role;

  return (
    <>
      <PageHead title="Not permitted" sub="Your role does not allow this action." />
      <div className="card">
        <dl className="kv">
          <dt>Your role</dt>
          <dd>
            <span className="badge muted">{role.replace('_', ' ').toLowerCase()}</span>
          </dd>
          <dt>What it allows</dt>
          <dd className="dim">{ROLE_DESCRIPTIONS[role]}</dd>
          <dt>Permissions held</dt>
          <dd className="mono tiny">{permissionsFor(role).join(', ')}</dd>
          {permission ? (
            <>
              <dt>Permission required</dt>
              <dd className="mono tiny" style={{ color: 'var(--warn)' }}>{permission}</dd>
            </>
          ) : null}
        </dl>
        <div className="note" style={{ marginTop: 14 }}>
          An MSP administrator in your organisation can change your role under Administration → Users.
        </div>
        <div style={{ marginTop: 14 }}>
          <Link className="btn" href="/">Back to the portfolio</Link>
        </div>
      </div>
    </>
  );
}
