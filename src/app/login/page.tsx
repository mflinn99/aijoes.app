import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/auth/guard';
import { availableProviders } from '@/lib/auth/identity';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await currentSession();
  if (session) redirect('/');

  const { next } = await searchParams;
  const providers = availableProviders()
    .filter((p) => p.id !== 'local')
    .map((p) => ({ id: p.id, name: p.name }));

  return <LoginForm next={next ?? '/'} ssoProviders={providers} />;
}
