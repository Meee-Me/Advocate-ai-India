import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { AppShell } from '@/components/AppShell';
import { hasAuthCookie } from '@/lib/auth/supabase';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy already blocks signed-out visitors, and every API call verifies the session with Supabase.
  if (!hasAuthCookie((await cookies()).getAll().map((c) => c.name))) redirect('/login');
  return <AppShell>{children}</AppShell>;
}
