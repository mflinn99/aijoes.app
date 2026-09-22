import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/session';
import { createUser, getUserByEmail, listUsersForTenant, setPassword, setRole, setStatus, getUserById } from '@/lib/auth/users';
import { WeakPasswordError } from '@/lib/auth/passwords';
import { audit } from '@/lib/observability/events';
import type { Role } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

type Body =
  | { action: 'create'; email: string; name: string; role: Role; password: string }
  | { action: 'set-role'; userId: string; role: Role }
  | { action: 'set-status'; userId: string; status: 'active' | 'disabled' }
  | { action: 'reset-password'; userId: string; password: string };

const ASSIGNABLE: Role[] = ['READ_ONLY', 'MSP_USER', 'MSP_ADMIN'];

export async function POST(request: Request) {
  const guard = await guardRoute(request, 'administer');
  if (!guard.ok) return guard.response;
  const { db: database, session } = guard;
  const tenantId = session.context.tenantId;

  const body = (await request.json().catch(() => ({}))) as Body;

  try {
    switch (body.action) {
      case 'create': {
        if (!ASSIGNABLE.includes(body.role)) {
          return NextResponse.json({ error: 'That role cannot be assigned here.' }, { status: 400 });
        }
        if (getUserByEmail(body.email)) {
          return NextResponse.json({ error: 'A user with that email already exists.' }, { status: 409 });
        }
        const created = await createUser({
          tenantId,
          email: body.email,
          name: body.name,
          role: body.role,
          password: body.password,
        });
        audit(database, {
          actor: session.email, actorKind: 'human', action: 'user.created',
          subjectType: 'user', subjectId: created.id, detail: { email: created.email, role: created.role },
        });
        return NextResponse.json({ ok: true, userId: created.id });
      }

      case 'set-role': {
        const target = getUserById(body.userId);
        if (!target || target.tenantId !== tenantId) {
          return NextResponse.json({ error: 'User not found.' }, { status: 404 });
        }
        if (!ASSIGNABLE.includes(body.role)) {
          return NextResponse.json({ error: 'That role cannot be assigned here.' }, { status: 400 });
        }
        // An administrator cannot demote themselves out of administration and
        // leave the tenant with nobody able to manage it.
        if (target.id === session.context.userId && body.role !== 'MSP_ADMIN') {
          return NextResponse.json({ error: 'You cannot remove your own administrator role.' }, { status: 400 });
        }
        setRole(body.userId, body.role);
        audit(database, {
          actor: session.email, actorKind: 'human', action: 'user.role-changed',
          subjectType: 'user', subjectId: body.userId, detail: { from: target.role, to: body.role },
        });
        return NextResponse.json({ ok: true });
      }

      case 'set-status': {
        const target = getUserById(body.userId);
        if (!target || target.tenantId !== tenantId) {
          return NextResponse.json({ error: 'User not found.' }, { status: 404 });
        }
        if (target.id === session.context.userId) {
          return NextResponse.json({ error: 'You cannot disable your own account.' }, { status: 400 });
        }
        const activeAdmins = listUsersForTenant(tenantId).filter(
          (u) => u.role === 'MSP_ADMIN' && u.status === 'active' && u.id !== body.userId,
        );
        if (body.status === 'disabled' && target.role === 'MSP_ADMIN' && activeAdmins.length === 0) {
          return NextResponse.json({ error: 'This is the last active administrator.' }, { status: 400 });
        }
        setStatus(body.userId, body.status);
        audit(database, {
          actor: session.email, actorKind: 'human', action: 'user.status-changed',
          subjectType: 'user', subjectId: body.userId, detail: { status: body.status },
        });
        return NextResponse.json({ ok: true });
      }

      case 'reset-password': {
        const target = getUserById(body.userId);
        if (!target || target.tenantId !== tenantId) {
          return NextResponse.json({ error: 'User not found.' }, { status: 404 });
        }
        await setPassword(body.userId, body.password);
        audit(database, {
          actor: session.email, actorKind: 'human', action: 'user.password-reset',
          subjectType: 'user', subjectId: body.userId, detail: { sessionsRevoked: true },
        });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof WeakPasswordError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
