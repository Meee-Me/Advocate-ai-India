import Link from 'next/link';
import { isAuthConfigured } from '@/lib/auth/provider';
import { safeNext } from '@/lib/auth/routes';

export const metadata = { title: 'Sign in' };

const MESSAGES: Record<string, string> = {
  not_configured: 'Sign-in with Deluxe Main has not been configured on this server yet. The site owner needs to set DELUXE_MAIN_URL.',
  failed: 'That sign-in did not work. Please try again.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const configured = isAuthConfigured();
  const error = sp.error ? MESSAGES[sp.error] ?? MESSAGES.failed : !configured ? MESSAGES.not_configured : null;
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-sm">
        <p className="font-serif text-2xl font-bold">⚖ Advocate AI <span className="text-brass">India</span></p>
        <p className="mt-2 text-sm text-muted">Sign in with your Deluxe account. There is no separate password for this site.</p>
        {error && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {configured ? (
          <a href={`/api/auth/start?next=${encodeURIComponent(next)}`} className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-navy font-semibold text-white hover:bg-navy-soft">Sign in with Deluxe Main</a>
        ) : (
          <span className="mt-6 inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-lg bg-navy/40 font-semibold text-white">Sign in with Deluxe Main</span>
        )}
        <p className="mt-6 text-xs text-muted">You will be sent to Deluxe Main to sign in and then brought back here. <Link href="/" className="underline">About this site</Link></p>
      </div>
    </main>
  );
}
