/** User administration — iteration 2. Requires the "administer" permission. */

import { requirePermission } from '@/lib/session';
import { listUsersForTenant } from '@/lib/auth/users';
import { ROLE_DESCRIPTIONS, permissionsFor, type Role } from '@/lib/auth/rbac';
import { PageHead } from '@/components/Shell';
import { UserAdmin } from '@/components/UserAdmin';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['READ_ONLY', 'MSP_USER', 'MSP_ADMIN'];

export default async function UsersPage() {
  const session = await requirePermission('administer');
  const users = listUsersForTenant(session.context.tenantId);

  return (
    <>
      <PageHead
        title="Users"
        sub={`${users.length} user(s) in this tenant. Roles decide what each can do; the matrix is enforced on every page and every route.`}
      />

      <div className="card">
        <div className="card-title">Roles</div>
        <table className="table">
          <tbody>
            {ROLES.map((role) => (
              <tr key={role}>
                <td style={{ width: 150, fontWeight: 600 }}>{role.replace('_', ' ').toLowerCase()}</td>
                <td className="dim">{ROLE_DESCRIPTIONS[role]}</td>
                <td className="mono tiny faint" style={{ width: 240 }}>{permissionsFor(role).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserAdmin
        currentUserId={session.context.userId}
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          status: u.status,
          lastLogin: u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never',
        }))}
      />
    </>
  );
}
