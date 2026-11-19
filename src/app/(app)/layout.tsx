import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { AppShell } from '@/components/AppShell';
import { openSession, sessionCookieName } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy already blocks signed-out visitors; this is the second check.
  const session = await openSession((await cookies()).get(sessionCookieName())?.value);
  if (!session) redirect('/login');
  return <AppShell>{children}</AppShell>;
}
