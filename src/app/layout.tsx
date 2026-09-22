import './globals.css';
import type { Metadata } from 'next';
import { Shell } from '@/components/Shell';
import { currentSession } from '@/lib/auth/guard';

export const metadata: Metadata = {
  title: 'AIGoGo MetaMSP',
  description: 'Automated Land & Expand Engine for MSPs',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();

  return (
    <html lang="en-GB">
      {/* The session's CSRF token travels to client components on the body,
          so every mutating fetch can carry it without a round trip. */}
      <body data-csrf={session?.session.csrfToken ?? ''}>
        {session ? (
          <Shell
            user={{ name: session.name, email: session.email, role: session.context.role }}
          >
            {children}
          </Shell>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
