import { AuthForm } from '@/components/AuthForm';
import { isAuthConfigured } from '@/lib/config';
import { safeNext } from '@/lib/auth/routes';

export const metadata = { title: 'Sign in' };

const NOTICES: Record<string, string> = {
  link: 'That email link has expired or was already used. Please sign in, or request a new link.',
  not_configured: 'Sign-in is not set up on this server yet. The site owner needs to configure it.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const notice = sp.error ? NOTICES[sp.error] : !isAuthConfigured() ? NOTICES.not_configured : undefined;
  return <AuthForm mode="login" next={safeNext(sp.next)} notice={notice} />;
}
