'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '@/components/api';

/** Deluxe Main sends people back here with #deluxe_code=...; the server trades it for a session. */
export default function Callback() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false); // React strict mode runs effects twice in development; a code works once
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = /(?:^#|&)deluxe_code=([0-9a-f]{48})/.exec(location.hash)?.[1];
    const state = new URLSearchParams(location.search).get('state');
    // Remove the one-use code from the address bar and browser history straight away.
    history.replaceState(null, '', location.pathname);
    if (!code || !state) { setError('This sign-in link is incomplete. Please start again.'); return; }
    api<{ next: string }>('/api/auth/callback', { body: { code, state } })
      .then((r) => window.location.replace(r.next))
      .catch((e) => setError(errorText(e)));
  }, []);
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      {error ? (
        <div className="max-w-sm space-y-3"><p role="alert" className="text-danger">{error}</p><Link href="/login" className="underline">Back to sign in</Link></div>
      ) : <p className="text-muted" role="status">Signing you in…</p>}
    </main>
  );
}
